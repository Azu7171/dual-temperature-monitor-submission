# Dual Temperature Monitor

An ESP32 thermometer and web dashboard for two DS18B20 sensors. The ESP32 reads the sensors, drives an SH1106 OLED, and sends one reading per second to a Next.js API. The API stores the latest reading and a rolling five-minute history in Firebase Realtime Database. The dashboard shows live readings, sensor faults, history, display state, and alerts.

## Project structure

| Path | Purpose |
| --- | --- |
| `app/` | Dashboard page and API routes for readings, display control, and push notifications |
| `components/` | Dashboard UI, chart, alerts, and demo controls |
| `lib/` | Data types, Firebase access, temperature handling, and Web Push |
| `firmware/dual_temp_monitor/` | ESP32 sensor, button, display, and network code |
| `firmware/build.sh`, `firmware/build.ps1` | Firmware build and upload helpers |

## Run the web app

Requires Node.js 22 or later. From the repository root:

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000`. Without configured Firebase credentials, the dashboard falls back to its interactive demo mode. The source for that mode is in `lib/mock-data.ts` and `components/demo-controls.tsx`.

To connect real hardware, fill in `.env.local` with your Firebase Realtime Database URL, a base64-encoded Firebase service account JSON, and a `DEVICE_INGEST_KEY`. The browser uses `NEXT_PUBLIC_FIREBASE_DATABASE_URL` to subscribe to the database. The service account and ingest key are server-side values; do not expose them in `NEXT_PUBLIC_` variables. `.env.local` is excluded from Git.

Web Push additionally uses a VAPID public/private key pair, `WEB_PUSH_SUBJECT`, and an Upstash Redis REST URL and token to store device subscriptions. All required variable names are listed in `.env.example`. Push notifications require HTTPS in a deployed browser session.

## ESP32 firmware

The firmware targets an ESP32 DevKit V1 with two DS18B20 sensors, two buttons, and an SH1106 OLED. Install the ESP32 Arduino core plus DallasTemperature, OneWire, Adafruit GFX, Adafruit BusIO, and Adafruit SH110X. See [firmware/README.md](firmware/README.md) for wiring, behavior, and build commands.

Copy `firmware/dual_temp_monitor/secrets.example.h` to `secrets.h` and set the Wi-Fi credentials, `DEVICE_INGEST_KEY`, and the URL of your deployed `/api/readings` endpoint. `secrets.h` is excluded from Git. Without it, the firmware still builds as a local thermometer.

```bash
cd firmware
./build.sh
```

## Data flow

```text
DS18B20 sensors → ESP32 → POST /api/readings → Firebase → dashboard
                                      ↓
                             Web Push alerts
```

The API validates the ingest key, request size, sensor states, and temperature range. It writes the current reading and rotating history slots. The dashboard marks the device offline after ten seconds without a reading and shows gaps in the five-minute chart. A display can be turned off locally or from the dashboard; raw temperatures continue to upload for monitoring and alerts.

## Prototype scope

This is a course project prototype. Display-control requests are currently unauthenticated, and the Firebase client needs read access to the device data. Add user authentication and restrict database rules before using it for private data or exposing a live deployment beyond the project demonstration. Alert settings are held in browser memory and reset on reload.
