# ESP32 firmware

This sketch reads two DS18B20 sensors, controls an SH1106 OLED with two physical buttons, and uploads readings to the web API. It targets an ESP32 DevKit V1.

## Hardware

| Connection | ESP32 pin |
| --- | --- |
| Sensor 1 data | GPIO 13 |
| Sensor 2 data | GPIO 18 |
| Button 1 | GPIO 14 to ground |
| Button 2 | GPIO 27 to ground |
| OLED SDA / SCL | GPIO 21 / GPIO 22 |

Each DS18B20 data line needs a 4.7 kΩ pull-up to 3.3 V. The buttons use the ESP32's internal pull-ups. The OLED is an SH1106-compatible 128 × 64 display at I²C address `0x3C`.

## Dependencies

Install the ESP32 Arduino core and these Arduino libraries: DallasTemperature, OneWire, Adafruit GFX, Adafruit BusIO, and Adafruit SH110X. WiFi, HTTPClient, and WiFiClientSecure come with the ESP32 core.

## Credentials

Copy `dual_temp_monitor/secrets.example.h` to `dual_temp_monitor/secrets.h`. Set the Wi-Fi network, device ingest key, and deployed `/api/readings` URL. `secrets.h` is ignored by Git. If the file is absent, the local thermometer still compiles and runs without networking.

The Firebase service account belongs only in the web app's server environment, never in the firmware.

## Build and upload

With `arduino-cli` installed and the ESP32 core configured:

```bash
arduino-cli board list
./build.sh
./build.sh --upload --port /dev/cu.usbserial-0001
./build.sh --monitor --port /dev/cu.usbserial-0001
```

`./build.sh` compiles both the serial and SH1106 backends. On Windows, `build.ps1` provides the same build, upload, and monitor operations:

```powershell
.\build.ps1
.\build.ps1 -Upload -Oled
.\build.ps1 -Monitor
```

The background network task handles Wi-Fi, TLS, time sync, uploads, and remote display commands. The button and display loop remains local. Up to 30 readings are queued during brief network outages; older readings are discarded if the queue fills. The server receives canonical temperatures in Celsius.

| Button action | Result |
| --- | --- |
| Tap either button | Toggle that sensor's OLED reading |
| Hold one button for 3 seconds | Switch between Celsius and Fahrenheit |
| Hold both buttons for 3 seconds | Preview the other unit for 2 seconds |

Serial keys `1` and `2` toggle readings, `u` switches units, and `p` starts the unit preview.
