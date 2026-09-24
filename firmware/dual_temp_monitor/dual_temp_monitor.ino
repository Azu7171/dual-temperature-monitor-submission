// =====================================================================
//  dual_temp_monitor.ino
//
//  ECE:4880 Principles of ECE/CSE Design, Lab 1.
//  Team: Rawad Al Souki, Ali Khalil, Adrian Rodriguez,
//                         Yassin Fateh El Rahman.
//
//  Third-box firmware for the ESP32 DevKit V1: two DS18B20 sensors, two
//  buttons, a display, and a 1 Hz HTTPS feed to the web API.
//
//  ARCHITECTURE: one superloop with no delay() in it, because two
//  requirements pull in opposite directions:
//
//     R4a  button press to display update, under 20 ms
//     R5a  publish both temperatures to the cloud, once per second
//
//  and a DS18B20 conversion takes 375 ms. So conversions run free in the
//  background and cache their results, buttons come in on interrupts,
//  and the display repaints from cache. See sensors.h for the reasoning.
//
//  An earlier version of this comment claimed nothing here ever blocks.
//  That was wrong, and measuring proved it wrong twice: the serial
//  publish blocked for 8.7 ms at 115200, and a 1-Wire transaction blocks
//  for about 10 ms because it is bit-banged. Neither can be made
//  properly asynchronous without rewriting a library, so instead every
//  long blocking job yields to a press the ISR has already latched. The
//  honest claim is: nothing blocks the R4a path, not nothing blocks.
//
//  Requirements covered by THIS file, per Lab1_2026Fall.pdf:
//     R3   power switch cuts local display and cloud data
//     R4a  sub-20 ms button response      (measured and printed)
//     R4c  four independent button states
//     R4d  error shown for a missing or faulty sensor
//     R2d  unplug and replug recovers with no user intervention
//     R5a  one publish per second
//     R5b  remote virtual button press
//
//  AI DISCLOSURE (class policy):  i drafted this with the
//  assistance of an AI coding tool. Every register-level and library
//  claim in it - DS18B20 conversion times, DEVICE_DISCONNECTED_C, the
//  85.0 power-on default, ESP32 strapping pins, SSD1306 frame timing -
//  was checked against the DS18B20 datasheet, the DallasTemperature
//  library source, and the Espressif ESP32 datasheet before use. The
//  20 ms figure in R4a is measured at runtime, not assumed. I used Ai pretty much
// to make sure I am abiding by all requirements with my approach.
// =====================================================================

#include "config.h"
#include "sensors.h"
#include "buttons.h"
#include "display.h"
#include "cloud_uploader.h"

TempSensor g_sensor1(PIN_SENSOR_1);
TempSensor g_sensor2(PIN_SENSOR_2);

bool     g_shown[2]      = {DISPLAY_ON_AT_BOOT, DISPLAY_ON_AT_BOOT};
                                           // "button on" state per sensor.
                                           // Both start OFF: at power-on no
                                           // button has been pressed, so no
                                           // temperature should be showing.
Snapshot g_lastDrawn     = {};
bool     g_dirty         = true;
uint32_t g_nextPublishMs = 0;
bool     g_fahrenheit    = UNITS_F_AT_BOOT;
bool     g_unitsLocked   = false;
bool     g_peekActive    = false;
bool     g_peekReturnF   = false;
uint32_t g_peekUntilMs   = 0;

// ---------------------------------------------------------------------

Snapshot buildSnapshot() {
  Snapshot s;
  s.shown[0]   = g_shown[0];
  s.shown[1]   = g_shown[1];
  s.state[0]   = g_sensor1.state();
  s.state[1]   = g_sensor2.state();
  s.celsius[0] = g_sensor1.celsius();
  s.celsius[1] = g_sensor2.celsius();
  s.fahrenheit[0] = g_fahrenheit;
  s.fahrenheit[1] = g_fahrenheit;
  return s;
}

// One line per second in the same shape sent to the website API. It also
// doubles as the raw serial log for the lab report's test evidence.
void publish(const Snapshot& s, uint32_t now) {
  Serial.printf(
    "{\"ts\":%lu,\"s1\":{\"c\":%s,\"state\":\"%s\",\"shown\":%s},"
    "\"s2\":{\"c\":%s,\"state\":\"%s\",\"shown\":%s}}\n",
    (unsigned long)now,
    s.state[0] == SENSOR_OK ? String(s.celsius[0], 2).c_str() : "null",
    sensorStateName(s.state[0]), s.shown[0] ? "true" : "false",
    s.state[1] == SENSOR_OK ? String(s.celsius[1], 2).c_str() : "null",
    sensorStateName(s.state[1]), s.shown[1] ? "true" : "false");

  net::publish(s, now);
}

// Both the physical buttons and the remote command update these same display
// flags. Remote commands specify an absolute state so a retry cannot undo one.
void applyToggle(uint8_t index, const char* source) {
  g_shown[index] = !g_shown[index];
  g_dirty = true;
  Serial.printf("[EVENT] sensor %u display %s (%s)\n",
                index + 1, g_shown[index] ? "ON" : "OFF", source);
}

void applyRemoteDisplay(const net::ControlCommand& command) {
  const uint8_t index = command.sensor - 1;
  if (g_shown[index] != command.shown) {
    g_shown[index] = command.shown;
    g_dirty = true;
  }
  Serial.printf("[EVENT] sensor %u display %s (website)\n",
                command.sensor, command.shown ? "ON" : "OFF");
  net::acknowledge(command);
  // Publish the acknowledged state immediately instead of waiting a full
  // second for the normal telemetry tick.
  g_nextPublishMs = 0;
}

// Units affect only the box display. Published values remain Celsius.
void applyUnits(const char* source) {
  const bool base = g_peekActive ? g_peekReturnF : g_fahrenheit;
  g_peekActive = false;
  g_fahrenheit = !base;
  g_dirty = true;
  Serial.printf("[EVENT] units %s (%s)\n", g_fahrenheit ? "F" : "C", source);
}

// A hold starts as an immediate tap to preserve R4a, so restore that sensor.
void undoTap(uint8_t index) {
  g_shown[index] = !g_shown[index];
  g_dirty = true;
  Serial.printf("[EVENT] sensor %u display %s (hold, tap undone)\n",
                index + 1, g_shown[index] ? "ON" : "OFF");
}

void startPeek(uint32_t now, const char* source) {
  g_peekReturnF = g_fahrenheit;
  g_fahrenheit  = !g_fahrenheit;
  g_peekActive  = true;
  g_peekUntilMs = now + BUTTON_BOTH_PEEK_MS;
  g_dirty = true;
  Serial.printf("[EVENT] units %s for %u ms (%s)\n",
                g_fahrenheit ? "F" : "C", (unsigned)BUTTON_BOTH_PEEK_MS, source);
}

// ---------------------------------------------------------------------

void setup() {
  // 921600, not 115200, and this was a real bug rather than a tweak.
  // The 1 Hz publish line is about 100 characters. At 115200 that is
  // 8.7 ms of blocking transmit, and it showed up in the measurements
  // as 10.8 ms of latency between a button edge and the render
  // starting. This file claims nothing ever blocks; the serial write
  // was blocking. At 921600 the same line costs about 1.1 ms.
  Serial.begin(921600);
  delay(200);                        // only delay in the firmware, and it
                                     // is before the loop starts
  Serial.println();
  Serial.println("=== Brown Brigade third box, fw " FW_VERSION " ===");
  Serial.printf("sensors on GPIO %u and %u, buttons on GPIO %u and %u\n",
                PIN_SENSOR_1, PIN_SENSOR_2, PIN_BUTTON_1, PIN_BUTTON_2);
  Serial.printf("display SDA %u SCL %u, OLED %ux%u\n",
                PIN_I2C_SDA, PIN_I2C_SCL, OLED_WIDTH, OLED_HEIGHT);
  Serial.println("both displays start OFF, press a button or type 1 / 2");
  Serial.println("hold one button 3 s (or type u) to switch C / F, boots in C");
  Serial.println("hold both 3 s (or type p) to preview the other unit for 2 s");

  if (!ui::begin()) Serial.println("[WARN] display init failed");
  buttons::begin();
  g_sensor1.begin();
  g_sensor2.begin();
  net::begin();
}

void loop() {
  const uint32_t now = millis();

  // 1. Sensors.
  //
  //    "Never blocking" was too strong a claim, and the measurements
  //    caught it. The conversion WAIT is non-blocking, but the 1-Wire
  //    transactions either side of it are bit-banged with microsecond
  //    delays: a reset plus ROM match plus a 9-byte scratchpad read
  //    holds the CPU for roughly 10 ms. That is half the R4a budget,
  //    and a press landing inside one waits it out. It showed up as a
  //    13% tail of 20 to 43 ms presses while the render itself was a
  //    flat 8.9 ms.
  //
  //    The ISR has already latched the press by then, so before starting
  //    a long blocking job, check whether one is waiting. The sensors
  //    can lose one pass out of thousands. The requirement cannot.
  if (!buttons::pending()) {
    if (g_sensor1.tick(now)) g_dirty = true;
    if (g_sensor2.tick(now)) g_dirty = true;
  }

  // 2. Buttons. R4a's clock starts at the interrupt edge captured here.
  uint32_t pressUs = 0;
  uint8_t held = 0;
  const uint8_t pressed = buttons::poll(now, &pressUs, &held);
  if (pressed & 0x1) applyToggle(0, "button");
  if (pressed & 0x2) applyToggle(1, "button");

  // A single hold permanently switches units. A two-button hold previews the
  // other unit for two seconds. In either case, undo the tap(s) that fired at
  // the leading edge so holds do not change which sensors are shown.
  for (uint8_t i = 0; i < 2; i++) {
    if (!(held & (1 << i))) continue;
    undoTap(i);
    if (g_unitsLocked) continue;
    g_unitsLocked = true;

    const uint8_t other = 1 - i;
    if (buttons::isHeld(other)) {
      undoTap(other);
      buttons::consumeHold(other);
      held &= ~(1 << other);
      startPeek(now, "both held");
    } else {
      applyUnits("hold");
    }
  }
  if (g_unitsLocked && buttons::allReleased()) g_unitsLocked = false;

  if (g_peekActive && (int32_t)(now - g_peekUntilMs) >= 0) {
    g_peekActive = false;
    g_fahrenheit = g_peekReturnF;
    g_dirty = true;
    Serial.printf("[EVENT] units %s (preview over)\n",
                  g_fahrenheit ? "F" : "C");
  }

  // 3. Remote display commands arrive through a FreeRTOS queue. The network
  // task never touches the display or these flags directly.
  net::ControlCommand command;
  if (net::takeCommand(&command)) applyRemoteDisplay(command);

  // Serial controls are retained for local testing.
  while (Serial.available()) {
    const int c = Serial.read();
    if (c == '1') applyToggle(0, "remote");
    if (c == '2') applyToggle(1, "remote");
    if (c == 'u') applyUnits("remote");
    if (c == 'p' && !g_peekActive) startPeek(now, "remote");
  }

  // 4a. URGENT: a button press repaints only that sensor's band and
  //     nothing else. This is the R4a path and it is timed edge-to-pixels
  //     from the interrupt timestamp captured above.
  if (pressed) {
    const uint8_t idx = (pressed & 0x1) ? 0 : 1;
    const Snapshot s  = buildSnapshot();
#if RENDER_TIMING
    const uint32_t t0 = micros();
#endif
    ui::renderUrgent(s, idx);
#if RENDER_TIMING
    const uint32_t renderUs = micros() - t0;
    // Test T5 in the lab report, measured rather than asserted.
    Serial.printf("[R4a] press to display: %lu us (render %lu us)\n",
                  (unsigned long)(micros() - pressUs),
                  (unsigned long)renderUs);
#endif
    g_dirty = true;   // let 4b catch up the other band, off the clock
  }

  // 4b. ORDINARY: everything not on the R4a clock. Temperature drift on
  //     the sensor whose button was not pressed, error states, the hint.
  //     Also yields to a waiting press: this repaint is another ~9 ms of
  //     blocking and nothing here is on the R4a clock.
  if (g_dirty && !buttons::pending()) {
    const Snapshot s = buildSnapshot();
    g_dirty = ui::render(s);   // one region per pass, true = more to do
  }

  // 5. Publish at exactly 1 Hz (R5a).
  if ((int32_t)(now - g_nextPublishMs) >= 0 && !buttons::pending()) {
    g_nextPublishMs = now + PUBLISH_INTERVAL_MS;
    publish(buildSnapshot(), now);
  }
}
