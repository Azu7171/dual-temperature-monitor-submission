// =====================================================================
//  buttons.h  -  Interrupt-driven buttons with leading-edge debounce
//                and three-second hold detection.
//
//  Requirement R4a allows 20 ms from the button press to the correct
//  temperature being on the display. Two things could
//   eat that budget:
//
//    1. Polling. A 10 ms poll loop spends up to 10 ms of the 20 ms
//       before it has even noticed the press.
//    2. Conventional debounce. "Wait for 30 ms of stable level, then
//       act" spends 30 ms by definition and fails the requirement on
//       its own, before any drawing happens.
//
//  So: a GPIO interrupt catches the edge in microseconds, and the
//  debounce is LEADING edge. The first edge is acted on immediately and
//  further edges are ignored for BUTTON_LOCKOUT_MS. Contact bounce is
//  still rejected, and it costs zero response time.
//
//  The ISR does nothing but set a flag and a timestamp. All real work
//  happens in loop().
// =====================================================================
#pragma once

#include <Arduino.h>
#include "config.h"

namespace buttons {

volatile uint32_t g_lastEdgeUs[2] = {0, 0};
volatile bool     g_pressed[2]    = {false, false};
uint32_t          g_lockoutUntilMs[2] = {0, 0};
bool              g_armed[2]      = {true, true};
uint32_t          g_releasedSince[2] = {0, 0};   // 0 = not currently released
uint32_t          g_pressStartMs[2]  = {0, 0};
bool              g_longFired[2]     = {false, false};
const uint8_t     g_pin[2]        = {PIN_BUTTON_1, PIN_BUTTON_2};

void IRAM_ATTR isr0() { g_pressed[0] = true; g_lastEdgeUs[0] = micros(); }
void IRAM_ATTR isr1() { g_pressed[1] = true; g_lastEdgeUs[1] = micros(); }

inline void begin() {
  pinMode(PIN_BUTTON_1, BUTTON_MODE);
  pinMode(PIN_BUTTON_2, BUTTON_MODE);
  const int edge = BUTTON_ACTIVE_LOW ? FALLING : RISING;
  attachInterrupt(digitalPinToInterrupt(PIN_BUTTON_1), isr0, edge);
  attachInterrupt(digitalPinToInterrupt(PIN_BUTTON_2), isr1, edge);
}

// True if the ISR has latched a press that poll() has not consumed yet.
// Lets the main loop skip a long blocking job and service the press
// first. Reads the flags without clearing them.
inline bool pending() { return g_pressed[0] || g_pressed[1]; }

inline bool allReleased() { return g_armed[0] && g_armed[1]; }

inline bool isHeld(uint8_t i) {
  const int pressedLevel = BUTTON_ACTIVE_LOW ? LOW : HIGH;
  return !g_armed[i] && digitalRead(g_pin[i]) == pressedLevel;
}

inline void consumeHold(uint8_t i) { g_longFired[i] = true; }

// Returns a 2-bit mask of taps on this pass. holdOut receives a mask of
// buttons that have just crossed the long-press threshold. Taps still act
// immediately; the main loop later undoes the initiating tap for a hold.
// Bit 0 = sensor 1 button, bit 1 = sensor 2 button.
// RELEASE BOUNCE, found on hardware 2026-09-08.
//
// Locking out for a fixed time after the first edge rejects the bounce
// on the way DOWN, but a tactile switch bounces on the way UP too. A
// release 200 ms after the press is well past a 60 ms lockout, so its
// bounce registered as a second and third press. On screen that read as
// a value appearing, vanishing and reappearing.
//
// So the lockout is no longer purely time-based. After a press the
// button is DISARMED, and it only re-arms once two things are true: the
// lockout has expired, and the pin actually reads released. Edges
// latched by the ISR while disarmed are discarded rather than queued,
// so a long bounce cannot fire late.
//
// The press itself is still acted on at the first edge, so none of this
// costs response time. R4a stays measured at 9 ms.
inline uint8_t poll(uint32_t now, uint32_t* pressUsOut = nullptr,
                    uint8_t* holdOut = nullptr) {
  uint8_t mask = 0;
  if (holdOut) *holdOut = 0;
  const int releasedLevel = BUTTON_ACTIVE_LOW ? HIGH : LOW;

  for (uint8_t i = 0; i < 2; i++) {
    if (!g_armed[i]) {
      // Throw away anything the ISR latched during the bounce window.
      g_pressed[i] = false;

      // Re-arming needs the button to be released CONTINUOUSLY, not just
      // to read released at the instant we happen to look. Sampling once
      // was the previous bug: a contact bouncing high exactly when the
      // lockout expired re-armed the button mid-chatter, and the next
      // falling edge counted as a fresh press. That is why roughly one
      // press in five toggled twice and the screen flipped on, off, on.
      if (digitalRead(g_pin[i]) == releasedLevel) {
        if (g_releasedSince[i] == 0) g_releasedSince[i] = now ? now : 1;
      } else {
        g_releasedSince[i] = 0;          // still down or still bouncing
        if (!g_longFired[i] &&
            (uint32_t)(now - g_pressStartMs[i]) >= BUTTON_LONG_PRESS_MS) {
          g_longFired[i] = true;
          if (holdOut) *holdOut |= (1 << i);
        }
      }

      if (g_releasedSince[i] != 0 &&
          (int32_t)(now - g_lockoutUntilMs[i]) >= 0 &&
          (int32_t)(now - g_releasedSince[i]) >= BUTTON_RELEASE_STABLE_MS) {
        g_armed[i] = true;
      }
      continue;
    }

    if (!g_pressed[i]) continue;

    noInterrupts();
    g_pressed[i] = false;
    const uint32_t edgeUs = g_lastEdgeUs[i];
    interrupts();

    g_armed[i]          = false;
    g_lockoutUntilMs[i] = now + BUTTON_LOCKOUT_MS;
    g_releasedSince[i]  = 0;
    g_pressStartMs[i]   = now;
    g_longFired[i]      = false;

    mask |= (1 << i);
    if (pressUsOut) *pressUsOut = edgeUs;   // for the R4a measurement
  }
  return mask;
}

}  // namespace buttons
