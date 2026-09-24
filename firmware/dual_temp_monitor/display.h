// =====================================================================
//  display.h - Local display for the Lab 1 "third box".
//
//  Hardware: SH1106-compatible, 128 x 64, I2C, address 0x3C.
//  (Adrian verified the part on the bench 2026-09-07; the KiCad symbol
//   had said SSD1306 128 x 32.)
//
//  Required local states, per R4:
//    sensor shown + valid       -> temperature in degrees C
//    sensor display turned off  -> "Sensor N off"
//    sensor missing/faulty      -> "Sensor N ERROR"
//
//  Both halves are always drawn. R4c requires all four button
//  combinations to read correctly at the same time, and R4 names the
//  wording "Sensor 1/Sensor 2 off" for a sensor whose button is off, so
//  an off sensor still occupies its half rather than vanishing.
//
//  PARTIAL UPDATE, and this is what makes R4a achievable at the rated
//  I2C clock. Adafruit_GrayOLED tracks a dirty rectangle and display()
//  sends only the pages inside it. clearDisplay() throws that away by
//  marking the whole screen dirty, which forces all 1024 bytes and about
//  23 ms, over the 20 ms budget. So this file never calls clearDisplay()
//  after startup. It clears and repaints only the half that changed:
//  512 bytes, about 11.5 ms. See the timing note in config.h.
// =====================================================================
#pragma once

#include <Arduino.h>
#include "config.h"
#include "sensors.h"

#if DISPLAY_BACKEND == DISPLAY_SH1106
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SH110X.h>
#endif

struct Snapshot {
  bool        shown[2];
  SensorState state[2];
  float       celsius[2];     // canonical value; conversion happens at draw
  bool        fahrenheit[2];  // repeated per band for repaint bookkeeping
};

namespace ui {

// Builds the exact text for one sensor state.
// ERROR OUTRANKS OFF, and this was a real bug caught on hardware.
//
// The first version checked "off" first, so unplugging a sensor whose
// button happened to be off changed nothing on screen. R4d does not
// condition the error on the button: "If any temperature sensor is not
// plugged into the third box, or is not working in some way, the display
// should notify the user that there is an error." A fault the user
// cannot see is not a notification, so the error is checked first.
inline void rowText(const Snapshot& s, uint8_t i, char* out, size_t n) {
  if (s.state[i] != SENSOR_OK || isnan(s.celsius[i])) {
    snprintf(out, n, "Sensor %u ERROR", i + 1);
  } else if (!s.shown[i]) {
    snprintf(out, n, "Sensor %u off", i + 1);
  } else if (s.fahrenheit[i]) {
    snprintf(out, n, "%.1f F", s.celsius[i] * 9.0f / 5.0f + 32.0f);
  } else {
    snprintf(out, n, "%.1f C", s.celsius[i]);
  }
}

// True when sensor i reads differently between two snapshots.
inline bool halfChanged(const Snapshot& a, const Snapshot& b, uint8_t i) {
  if (a.shown[i] != b.shown[i]) return true;
  if (a.fahrenheit[i] != b.fahrenheit[i]) return true;
  if (a.state[i] != b.state[i]) return true;
  const bool an = isnan(a.celsius[i]);
  const bool bn = isnan(b.celsius[i]);
  if (an != bn) return true;
  if (!an && fabsf(a.celsius[i] - b.celsius[i]) >= 0.05f) return true;
  return false;
}

inline bool bothOff(const Snapshot& s) { return !s.shown[0] && !s.shown[1]; }

inline bool sameSnapshot(const Snapshot& a, const Snapshot& b) {
  return !halfChanged(a, b, 0) && !halfChanged(a, b, 1);
}

// ---------------------------------------------------------------------
#if DISPLAY_BACKEND == DISPLAY_SH1106
// ---------------------------------------------------------------------

// Adafruit_SH1106G takes separate I2C rates for an active display
// transfer and for the bus afterwards.
Adafruit_SH1106G g_oled(
  OLED_WIDTH,
  OLED_HEIGHT,
  &Wire,
  -1,
  OLED_I2C_DURING_HZ,
  OLED_I2C_AFTER_HZ
);

// DISPLAY HYSTERESIS, found on hardware 2026-09-08.
//
// A DS18B20 at 11-bit resolves 0.125 C, and a still room sits between
// two adjacent codes, so the raw reading dithers: 24.12, 24.25, 24.12,
// 24.25 ... forever. halfChanged() repaints on 0.05 C, so every wobble
// of the last bit repainted the band two or three times a second and
// the screen visibly flickered.
//
// The sensor is not wrong and the reading is not noisy. The display was
// simply chasing the least significant bit. So the value actually shown
// is held until the temperature moves by more than one LSB, which makes
// the screen stable without hiding any real change. The lab sets no
// requirement on display resolution, and the tightest accuracy anywhere
// in it is +/-2 C (R8d), so 0.2 C of hold costs nothing.
//
// It also cuts repaints by roughly an order of magnitude, which takes
// I2C traffic off the R4a path as a side effect.
static const float DISPLAY_HYSTERESIS_C = 0.2f;
float s_dispC[2] = {NAN, NAN};

inline float heldValue(uint8_t i, float c) {
  if (isnan(c)) { s_dispC[i] = NAN; return NAN; }
  if (isnan(s_dispC[i]) || fabsf(c - s_dispC[i]) >= DISPLAY_HYSTERESIS_C) {
    s_dispC[i] = c;
  }
  return s_dispC[i];
}

inline Snapshot applyHysteresis(const Snapshot& in) {
  Snapshot s = in;
  for (uint8_t i = 0; i < 2; i++) s.celsius[i] = heldValue(i, in.celsius[i]);
  return s;
}

Snapshot s_prev       = {};
uint8_t  s_drawn      = 0;      // bit i set once band i has been drawn
bool     s_hintDrawn  = false;
bool     s_hintBothOff = false;

// MEASURED 2026-09-07, and the measurement is why this layout exists.
//
// The first build gave each sensor a full 32 px half and repainted all of
// it. Measured cost: 18 ms for one half, 36 ms for both, against a 20 ms
// budget. The calculation in config.h had said 11.5 ms; real I2C page
// overhead made it 18. The design argument was right in direction and
// wrong in magnitude, which is the whole reason R4a is measured at
// runtime instead of asserted.
//
// An SH1106 page is 8 px tall and is the smallest unit that can be sent.
// 32 px = 4 pages. So the fix is to make a sensor's content occupy
// 16 px = 2 pages, aligned to page boundaries, and never touch the rest:
//
//   page 0  (y  0.. 7)  blank
//   page 1-2 (y  8..23) SENSOR 1 band      <- redrawn on change
//   page 3  (y 24..31)  divider at y=31, drawn once, never repainted
//   page 4  (y 32..39)  blank
//   page 5-6 (y 40..55) SENSOR 2 band      <- redrawn on change
//   page 7  (y 56..63)  "press a button" hint, only while both are off
//
// Those y ranges are screen positions and stay true under
// DISPLAY_ROTATE_180. The page numbers beside them do not; see BAND_PAGE.
//
// Halving the pages should roughly halve the transfer.
static const int16_t BAND_Y[2] = {8, 40};
static const int16_t HINT_Y    = 56;

// Which SH1106 pages each region occupies. A page is 8 px tall and is the
// smallest unit the controller can be sent.
//
// DISPLAY_ROTATE_180 INVERTS THIS TABLE, and that coupling is the trap in
// this file. setRotation(2) is handled entirely inside
// Adafruit_GrayOLED::drawPixel, which maps a drawn pixel to buffer row
// (HEIGHT - 1 - y) and column (WIDTH - 1 - x). The library's own
// display() would not need telling, because it recomputes its dirty
// window from those rotated coordinates. But flushPages() below bypasses
// display() and addresses pages directly, so it has to be told where the
// drawing actually landed. Leaving this table alone would rotate the
// image correctly and then send the wrong two pages: pressing sensor 1's
// button would repaint sensor 2's band.
//
//   band 0, y  8..23  ->  buffer rows 40..55  ->  pages 5,6
//   band 1, y 40..55  ->  buffer rows  8..23  ->  pages 1,2
//   hint,   y 56..63  ->  buffer rows  0.. 7  ->  page 0
//   divider at y=31   ->  buffer row 32       ->  page 4, drawn once
//
// Still two pages per band, still page-aligned, still non-overlapping and
// clear of the divider, so the measured R4a transfer cost is unchanged.
#if DISPLAY_ROTATE_180
static const uint8_t BAND_PAGE[2][2] = {{5, 6}, {1, 2}};
static const uint8_t HINT_PAGE       = 0;
#else
static const uint8_t BAND_PAGE[2][2] = {{1, 2}, {5, 6}};
static const uint8_t HINT_PAGE       = 7;
#endif

// SH1106 has 132 columns of RAM against a 128 px panel, so the visible
// area starts at column 2. This is the offset that makes an SSD1306
// driver render an SH1106 shifted.
static const uint8_t SH1106_COL_OFFSET = 2;

// WHY THIS EXISTS instead of just calling g_oled.display().
//
// Adafruit_SH110X::display() honours the TOP of the dirty rectangle and
// ignores the BOTTOM. In the library source, last_page and the
// pages = min(pages, last_page) line that would use it are both
// commented out, so the page loop runs from first_page to the end of the
// screen every time:
//
//     uint8_t first_page = window_y1 / 8;
//     //  uint8_t last_page = (window_y2 + 7) / 8;
//     //  pages = min(pages, last_page);
//     for (uint8_t p = first_page; p < pages; p++) {
//
// Measured cost of that: pressing sensor 1's button repainted pages 1
// through 7 and took 27 ms, while sensor 2's repainted pages 5 through 7
// and took 12.7 ms. Same amount of drawing, wildly different cost, and
// the sensor 1 case failed R4a outright.
//
// This sends exactly the pages asked for, and puts a whole page in one
// I2C transaction rather than Adafruit's 32-byte chunks.
inline void flushPages(uint8_t firstPage, uint8_t lastPage) {
  uint8_t* buf = g_oled.getBuffer();
  for (uint8_t p = firstPage; p <= lastPage; p++) {
    Wire.beginTransmission(OLED_ADDR);
    Wire.write(0x00);                                       // command stream
    Wire.write(0xB0 | p);                                   // set page
    Wire.write(0x10 | (SH1106_COL_OFFSET >> 4));            // col high nibble
    Wire.write(0x00 | (SH1106_COL_OFFSET & 0x0F));          // col low nibble
    Wire.endTransmission();

    Wire.beginTransmission(OLED_ADDR);
    Wire.write(0x40);                                       // data stream
    Wire.write(buf + (uint16_t)p * OLED_WIDTH, OLED_WIDTH);
    Wire.endTransmission();
  }
}

inline bool begin() {
  Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL);
  // One whole 128-byte page plus the 0x40 control byte in a single
  // transaction, instead of Adafruit's 32-byte chunks.
  Wire.setBufferSize(OLED_WIDTH + 8);

  if (!g_oled.begin(OLED_ADDR, true)) {
    return false;
  }

#if DISPLAY_ROTATE_180
  // Before anything is drawn, including the divider a few lines down.
  g_oled.setRotation(2);
#endif

  g_oled.clearDisplay();
  g_oled.setTextWrap(false);
  g_oled.setTextColor(SH110X_WHITE);
  // Drawn once here so the divider never costs a page again.
  g_oled.drawFastHLine(0, 31, OLED_WIDTH, SH110X_WHITE);
  g_oled.display();

  // MUST come after that display() call, and this cost a whole
  // measurement round to find.
  //
  // Adafruit_SH1106G is constructed with two I2C rates. Its display()
  // raises the bus to clkDuring for the transfer and then drops it back
  // to clkAfter, which is 100 kHz. That is fine while the library is
  // doing the sending. But flushPages() below bypasses display(), so
  // nothing ever raised the clock again and every flush ran at 100 kHz:
  //     128 bytes x 9 bits / 100 kHz = 11.5 ms per page
  // Two pages measured 27.1 ms, matching that arithmetic exactly, and
  // both buttons cost the same which is how we knew it was the clock and
  // not the page range. At 400 kHz the same page is 2.9 ms.
  Wire.setClock(OLED_I2C_DURING_HZ);

  s_drawn     = 0;
  s_hintDrawn = false;
  return true;
}

// 128 x 64 layout:
//   top 32 pixels    -> Sensor 1
//   bottom 32 pixels -> Sensor 2
//
// A valid reading uses a small sensor label and a larger temperature.
// OFF and ERROR states are written in the corresponding half. When
// neither button has been pressed, a hint sits at the bottom so the box
// is not a blank-looking screen at power-on.
inline void drawHalf(const Snapshot& s, uint8_t i) {
  const int16_t y = BAND_Y[i];
  char line[24];
  rowText(s, i, line, sizeof(line));

  // Clearing exactly the 2-page band is what keeps the transfer small.
  g_oled.fillRect(0, y, OLED_WIDTH, 16, SH110X_BLACK);

  const bool isTemp = s.shown[i] &&
                      s.state[i] == SENSOR_OK &&
                      !isnan(s.celsius[i]);

  if (isTemp) {
    // Small sensor label in a gutter, large temperature beside it, both
    // inside the same 16 px band. "-10.5 C" at size 2 is 84 px and the
    // gutter is 20, so the widest case ends at 104 of 128.
    g_oled.setTextSize(1);
    g_oled.setCursor(0, y + 4);
    g_oled.printf("S%u", i + 1);

    g_oled.setTextSize(2);
    g_oled.setCursor(20, y);
    g_oled.print(line);
  } else {
    g_oled.setTextSize(1);
    g_oled.setCursor(0, y + 4);
    g_oled.print(line);
  }
}

// The hint sits alone on page 7 so it never shares a page with a band.
inline void drawHint(const Snapshot& s) {
  g_oled.fillRect(0, HINT_Y, OLED_WIDTH, 8, SH110X_BLACK);
  if (bothOff(s)) {
    g_oled.setTextSize(1);
    g_oled.setCursor(0, HINT_Y);
    g_oled.print("press a button");
  }
}

// Draws at most ONE region per call and reports whether more is left.
//
// A press arriving during this repaint waits for it to finish, so this
// is a blocking window on the R4a path even though it is not on the R4a
// clock. Repainting both bands and the hint together is 5 pages, about
// 22 ms, which would put a press landing inside it over budget on its
// own. One region is 2 pages, about 9 ms, and the loop gets a chance to
// service a press between each.
inline bool render(const Snapshot& raw) {
  const Snapshot s = applyHysteresis(raw);
  for (uint8_t i = 0; i < 2; i++) {
    const bool first = !(s_drawn & (1 << i));
    if (first || halfChanged(s, s_prev, i)) {
      drawHalf(s, i);
      flushPages(BAND_PAGE[i][0], BAND_PAGE[i][1]);
      s_prev.shown[i]   = s.shown[i];
      s_prev.state[i]   = s.state[i];
      s_prev.celsius[i] = s.celsius[i];
      s_prev.fahrenheit[i] = s.fahrenheit[i];
      s_drawn |= (1 << i);
      return true;
    }
  }

  if (!s_hintDrawn || bothOff(s) != s_hintBothOff) {
    drawHint(s);
    flushPages(HINT_PAGE, HINT_PAGE);
    s_hintBothOff = bothOff(s);
    s_hintDrawn   = true;
    return true;
  }

  return false;
}

// URGENT PATH, and the measurements are what forced it into existence.
//
// With page alignment, one band costs about 12.7 ms and both cost about
// 27 ms. Both bands were repainting far more often than expected because
// halfChanged() trips on 0.05 C of drift, so any press that landed in
// the same pass as the other sensor's reading ticking over paid double
// and blew the 20 ms budget.
//
// R4a only asks that the pressed sensor's temperature appear within
// 20 ms. The other sensor drifting by a tenth of a degree is not on that
// clock. So a press repaints exactly one band and nothing else, and the
// ordinary render() catches up the rest on the following pass.
inline void renderUrgent(const Snapshot& raw, uint8_t i) {
  const Snapshot s = applyHysteresis(raw);
  drawHalf(s, i);
  flushPages(BAND_PAGE[i][0], BAND_PAGE[i][1]);

  // Only this half is now on screen, so only this half's history is
  // recorded. The other half stays "changed" and render() redraws it
  // next pass, off the critical path.
  s_prev.shown[i]   = s.shown[i];
  s_prev.state[i]   = s.state[i];
  s_prev.celsius[i] = s.celsius[i];
  s_prev.fahrenheit[i] = s.fahrenheit[i];
  s_drawn |= (1 << i);
}

// ---------------------------------------------------------------------
#else  // DISPLAY_SERIAL
// ---------------------------------------------------------------------

inline bool begin() {
  return true;
}

inline bool render(const Snapshot& s) {
  char a[24], b[24];
  rowText(s, 0, a, sizeof(a));
  rowText(s, 1, b, sizeof(b));
  Serial.printf("[SCREEN] | SENSOR 1: %-16s | SENSOR 2: %-16s |%s\n",
                a, b, bothOff(s) ? " (press a button)" : "");
  return false;
}

inline void renderUrgent(const Snapshot& s, uint8_t) {
  render(s);
}

#endif

}  // namespace ui
