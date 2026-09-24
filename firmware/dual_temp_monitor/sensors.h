// =====================================================================
//  sensors.h  -  Non-blocking DS18B20 manager, one instance per sensor.
//
//  THE POINT OF THIS FILE
//
//  A DS18B20 needs 375 ms (11-bit) to complete a temperature conversion.
//  R4a gives us 20 ms between a button press and the temperature
//  appearing. So measurement is decoupled from display: this class runs
//  a free-running conversion loop and caches the latest good reading,
//  and a button press only changes which cached value gets drawn.
//
//  Each sensor sits on its own 1-Wire bus with its own 4.7k pull-up (per
//  Adrian's schematic), so there is exactly one device per bus.
//
//  WHY THIS USES RAW OneWire INSTEAD OF DallasTemperature
//
//  Measured on hardware 2026-09-07: with DallasTemperature the render
//  was a flat 8.9 ms but 11% of presses still landed between 20 and
//  43 ms. The latency was always BEFORE the render. 1-Wire is bit-banged
//  with microsecond delays and cannot be interrupted, and the library
//  does a whole transaction in one call:
//
//      reset              ~1.0 ms
//      MATCH ROM + addr   ~4.7 ms   (72 bits at ~65 us per slot)
//      command            ~0.5 ms
//      9 scratchpad bytes ~5.2 ms
//      --------------------------
//      about 11 ms in a single uninterruptible call
//
//  Yielding before a transaction only helps when the press arrives
//  first. A press landing INSIDE the call waits it out, which is exactly
//  the 11% tail. The blocking window itself had to get smaller.
//
//  Two changes do that:
//
//  1. SKIP ROM (0xCC) instead of MATCH ROM (0x55). There is one device
//     per bus, so matching a 64-bit address spends 4.7 ms addressing the
//     only thing that could possibly answer. SKIP ROM is 8 bits.
//
//  2. The 9-byte scratchpad is read ONE BYTE PER LOOP PASS. The bus
//     idles between bytes and the device holds its position, so a 5.2 ms
//     read becomes nine 0.55 ms reads with the loop free in between.
//
//  Longest uninterruptible window drops from about 11 ms to about 2 ms.
// =====================================================================
#pragma once

#include <OneWire.h>
#include "config.h"

enum SensorState : uint8_t {
  SENSOR_OK = 0,        // reading is fresh and valid
  SENSOR_UNPLUGGED,     // no device answering on the bus
  SENSOR_FAULT          // device present but returning bad data
};

inline const char* sensorStateName(SensorState s) {
  switch (s) {
    case SENSOR_OK:        return "ok";
    case SENSOR_UNPLUGGED: return "unplugged";
    default:               return "fault";
  }
}

class TempSensor {
 public:
  explicit TempSensor(uint8_t pin) : wire_(pin) {}

  void begin() {
    phase_    = PH_PROBE;
    nextMs_   = 0;
    state_    = SENSOR_UNPLUGGED;
    celsius_  = NAN;
    badReads_ = 0;
    idx_      = 0;
  }

  // Call every loop. Returns true if the reading or the state changed,
  // which is the signal to repaint. No call here blocks for more than
  // about 2 ms.
  bool tick(uint32_t now) {
    if ((int32_t)(now - nextMs_) < 0) return false;

    switch (phase_) {
      case PH_PROBE:      return probe(now);
      case PH_START_CONV: return startConversion(now);
      case PH_WAIT_CONV:  phase_ = PH_START_READ; nextMs_ = now; return false;
      case PH_START_READ: return startRead(now);
      case PH_READ_BYTE:  return readByte(now);
    }
    return false;
  }

  float celsius() const     { return celsius_; }
  SensorState state() const { return state_; }
  bool valid() const        { return state_ == SENSOR_OK && !isnan(celsius_); }

 private:
  enum Phase : uint8_t {
    PH_PROBE,        // is anything there, and set its resolution
    PH_START_CONV,   // reset + skip + CONVERT T
    PH_WAIT_CONV,    // conversion running, bus idle, we do nothing
    PH_START_READ,   // reset + skip + READ SCRATCHPAD
    PH_READ_BYTE     // one scratchpad byte per pass
  };

  // DS18B20 commands
  static const uint8_t CMD_CONVERT_T     = 0x44;
  static const uint8_t CMD_READ_SCRATCH  = 0xBE;
  static const uint8_t CMD_WRITE_SCRATCH = 0x4E;

  // Resolution config: 9-bit 0x1F, 10-bit 0x3F, 11-bit 0x5F, 12-bit 0x7F
  static const uint8_t CFG_11_BIT = 0x5F;

  // R2d: a sensor unplugged and replugged must come back with no user
  // intervention. This runs only while the sensor is missing, so it
  // costs nothing in normal operation. reset() returns 1 when a device
  // answers with a presence pulse.
  bool probe(uint32_t now) {
    if (!wire_.reset()) {
      nextMs_  = now + SENSOR_RESCAN_MS;
      celsius_ = NAN;
      return setState(SENSOR_UNPLUGGED);
    }
    wire_.skip();
    wire_.write(CMD_WRITE_SCRATCH);
    wire_.write(0x00);          // TH alarm, unused
    wire_.write(0x00);          // TL alarm, unused
    wire_.write(CFG_11_BIT);
    phase_    = PH_START_CONV;
    nextMs_   = now;
    badReads_ = 0;
    return false;               // not OK until a real reading lands
  }

  bool startConversion(uint32_t now) {
    if (!wire_.reset()) return dropOut(now);
    wire_.skip();
    wire_.write(CMD_CONVERT_T);
    phase_  = PH_WAIT_CONV;
    nextMs_ = now + SENSOR_CONVERSION_MS;
    return false;
  }

  bool startRead(uint32_t now) {
    if (!wire_.reset()) return dropOut(now);
    wire_.skip();
    wire_.write(CMD_READ_SCRATCH);
    idx_    = 0;
    phase_  = PH_READ_BYTE;
    nextMs_ = now;
    return false;
  }

  // One byte, about 0.55 ms, then straight back to the loop.
  bool readByte(uint32_t now) {
    data_[idx_++] = wire_.read();
    nextMs_ = now;
    if (idx_ < 9) return false;

    phase_ = PH_START_CONV;     // queue the next conversion either way

    // The scratchpad carries a CRC over its first 8 bytes. A bad CRC is
    // how a damaged or half-seated sensor shows up, and it is what
    // drives the ERROR state required by R4d.
    if (OneWire::crc8(data_, 8) != data_[8]) return dropOut(now);

    int16_t raw = ((int16_t)data_[1] << 8) | data_[0];
    raw &= ~1;                  // bit 0 is undefined at 11-bit resolution
    const float c = raw * 0.0625f;

    // 85.0 C is the DS18B20's power-on scratchpad default and means the
    // conversion never ran, which happens on a marginal joint.
    if (c == 85.0f && (isnan(celsius_) || celsius_ < 60.0f)) {
      return dropOut(now);
    }

    badReads_ = 0;
    const bool changed = isnan(celsius_) || fabsf(c - celsius_) >= 0.05f;
    celsius_ = c;
    return setState(SENSOR_OK) || changed;
  }

  // One bad read is ridden out; two in a row means the sensor is gone,
  // so stop reporting a stale temperature and go hunting for it.
  bool dropOut(uint32_t now) {
    if (++badReads_ < SENSOR_BAD_READS_MAX) {
      phase_  = PH_START_CONV;
      nextMs_ = now;
      return false;
    }
    phase_   = PH_PROBE;
    nextMs_  = now;
    celsius_ = NAN;
    return setState(SENSOR_UNPLUGGED);
  }

  bool setState(SensorState s) {
    if (state_ == s) return false;
    state_ = s;
    return true;
  }

  OneWire     wire_;
  Phase       phase_    = PH_PROBE;
  uint32_t    nextMs_   = 0;
  uint8_t     data_[9]  = {0};
  uint8_t     idx_      = 0;
  float       celsius_  = NAN;
  SensorState state_    = SENSOR_UNPLUGGED;
  uint8_t     badReads_ = 0;
};
