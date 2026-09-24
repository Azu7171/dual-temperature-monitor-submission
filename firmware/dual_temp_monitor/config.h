// =====================================================================
//  config.h
//
//  ECE:4880 Lab 1, Team Rawad, Ali, Adrian, Yassin.
//
//  Central configuration for the ESP32 DevKit V1 thermometer.
//  Nothing outside this file knows a pin number, a timing, or a
//  credential.
// =====================================================================
#pragma once

// ---------------------------------------------------------------------
// 1. PINS   (from Lab1.kicad_sch, verified against the built circuit)
//
// ---------------------------------------------------------------------
#define PIN_SENSOR_1    13    // DS18B20 #1 DQ, 4.7k pull-up to 3.3 V
#define PIN_SENSOR_2    18    // DS18B20 #2 DQ, 4.7k pull-up to 3.3 V
#define PIN_BUTTON_1    14    // SW2 -> GND when pressed
#define PIN_BUTTON_2    27    // SW3 -> GND when pressed

// Buttons use the ESP32 internal pull-ups.
#define BUTTON_ACTIVE_LOW   1
#define BUTTON_MODE         INPUT_PULLUP

// ---------------------------------------------------------------------
// 2. DISPLAY
//
//  CORRECTED 2026-09-07 by Adrian, from the bench rather than the
//  schematic: the real panel is an SH1106-compatible 128 x 64 at 0x3C,
//  not the SSD1306 128 x 32 the KiCad symbol implied. The controller
//  matters as much as the size. An SH1106 has 132 columns internally
//  with a 2-column offset, so driving it with the SSD1306 library gives
//  a shifted and wrapped image. Adafruit_SH110X handles the offset.
//
//  Measured hardware beats a schematic symbol.
// ---------------------------------------------------------------------
#define DISPLAY_SERIAL   0
#define DISPLAY_SH1106   1

#ifndef DISPLAY_BACKEND
#define DISPLAY_BACKEND  DISPLAY_SH1106
#endif

#define PIN_I2C_SDA      21
#define PIN_I2C_SCL      22
#define OLED_ADDR        0x3C
#define OLED_WIDTH       128
#define OLED_HEIGHT      64

// PANEL ORIENTATION, 2026-09-16. The module sits in the enclosure rotated
// 180 degrees from the controller's default scan order, so an un-rotated
// image reads upside down through the window. 1 rotates the drawing to
// match how the panel is actually mounted.
//
// This is a GFX-level rotation, not the SH1106's own segment-remap and
// COM-scan-direction commands, and the difference is not cosmetic. A
// hardware flip mirrors the finished framebuffer on its way to the glass,
// so it would also move sensor 1's band to the bottom of the panel and
// the "press a button" hint to the top. Rotating inside GFX leaves the
// on-screen layout exactly as designed and as measured; it only changes
// which buffer pages that layout lands in.
//
// It costs nothing on the R4a path: the rotation is one subtract per
// drawn pixel, and the number of pages sent per repaint is unchanged.
// See BAND_PAGE in display.h, which MUST follow this flag.
#define DISPLAY_ROTATE_180   1

// I2C RATE, and the reasoning here is a design decision worth writing up.
//
// The earlier draft ran this bus at 1 MHz to buy speed. Adrian pulled it
// back to the rated 400 kHz Fast-mode, and he was right: the SH1106 is
// not specified above 400 kHz, and a bus that works on the bench at an
// out-of-spec clock is a bug waiting for a longer cable or a warmer room.
//
// That leaves a real problem, because the arithmetic no longer fits:
//     128 x 64 frame buffer       = 1024 bytes
//     9 bits per byte on the wire = 9216 bits
//     at 400 kHz                  = 23 ms for a full frame
// and R4a allows 20 ms from button press to display. So a full-screen
// repaint fails the requirement on its own, at the correct clock.
//
// The fix is not a faster bus, it is sending less. Adafruit_GrayOLED
// tracks a dirty rectangle and display() transmits only the pages that
// changed. clearDisplay() defeats that by marking the whole screen
// dirty, so display.h clears and repaints only the half that actually
// changed. One sensor changing costs 4 pages instead of 8:
//     512 bytes -> 4608 bits -> 11.5 ms at 400 kHz, inside the budget.
//
// The firmware measures the real number at runtime and prints it, so the
// report can quote a measurement rather than this calculation.
#define OLED_I2C_DURING_HZ   400000UL
#define OLED_I2C_AFTER_HZ    100000UL

// ---------------------------------------------------------------------
// 3. SENSORS
//
//    Resolution trade, also worth writing up:
//      12-bit -> 0.0625 C, 750 ms per conversion
//      11-bit -> 0.1250 C, 375 ms per conversion
//    The tightest accuracy requirement in the lab is R8d, 0 +/-2 C in
//    ice water. 0.125 C is 16x tighter than that, and the DS18B20's
//    rated accuracy (+/-0.5 C from -10 to +85 C) dominates either way.
//    So 11-bit costs nothing real and doubles the refresh headroom over
//    the 1 Hz publish rate R5a needs. 11-bit it is.
// ---------------------------------------------------------------------
#define SENSOR_RESOLUTION_BITS   11
#define SENSOR_CONVERSION_MS    375   // must match the resolution above
#define SENSOR_RESCAN_MS       2000   // how often to hunt for a replugged
                                      // sensor. R2d: recovery must need no
                                      // user intervention.
#define SENSOR_BAD_READS_MAX      2   // consecutive failures before we
                                      // declare UNPLUGGED. Stops a single
                                      // noisy sample from flapping the UI.

// ---------------------------------------------------------------------
// 4. TIMING
// ---------------------------------------------------------------------
#define PUBLISH_INTERVAL_MS    1000   // R5a: web updates once per second
#define BUTTON_LOCKOUT_MS        60   // trailing debounce lockout.
                                      // The press is acted on at the FIRST
                                      // edge and the lockout runs after it,
                                      // so debounce costs zero response
                                      // time. A "wait for N ms of stable
                                      // level" debounce would spend 30-50 ms
                                      // of the 20 ms budget in R4a and fail.
#define BUTTON_RELEASE_STABLE_MS 30   // the button must read released for
                                      // this long, continuously, before it
                                      // can fire again. Sampling the pin
                                      // once was not enough: a contact
                                      // bouncing high at that instant
                                      // re-armed mid-chatter and one press
                                      // in five registered twice.
#define BUTTON_LONG_PRESS_MS   3000   // hold either button this long to
                                      // switch the box between C and F.
                                      // A tap still acts on the first edge
                                      // for R4a; a hold undoes that tap.
#define BUTTON_BOTH_PEEK_MS    2000   // holding both buttons previews the
                                      // other unit, then restores the prior
                                      // unit automatically.
#define RENDER_TIMING             1   // 1 = measure and print render time

// ---------------------------------------------------------------------
// 5. STARTUP STATE
//
//  Both sensor displays start OFF. Adrian, 2026-09-07: the box needs a
//  defined screen "when we turn it on and neither button was pressed."
//  Off is also the honest reading of R4, which says a sensor's
//  temperature appears *when its button is pressed*. At power-on nothing
//  has been pressed, so nothing should be showing a temperature.
// ---------------------------------------------------------------------
#define DISPLAY_ON_AT_BOOT        0
#define UNITS_F_AT_BOOT           0   // units are RAM-only; every boot starts C

// ---------------------------------------------------------------------
// 6. NETWORK
// ---------------------------------------------------------------------
#if __has_include("secrets.h")
#define ENABLE_NETWORK   1
#else
#define ENABLE_NETWORK   0
#endif

#define DEVICE_ID        "third-box"
#define FW_VERSION       "0.4.4"

// Network work runs on its own FreeRTOS task. Keep a short FIFO so a slow TLS
// request or brief WiFi interruption does not turn into holes in the graph.
// If an outage lasts longer than this window, the oldest queued reading is
// discarded so the live display can eventually catch up to the present.
#define UPLOAD_QUEUE_LENGTH       30
#define UPLOAD_RETRY_MS          500
#define CONTROL_POLL_MS          250   // remote button checks, off the display loop
#define WIFI_RESTART_MS        15000
