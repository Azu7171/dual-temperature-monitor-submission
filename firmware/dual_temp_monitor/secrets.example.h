// Copy this file to secrets.h and fill it in. secrets.h is gitignored.
// NEVER commit real credentials. The ESP sends data to the website API;
// Firebase admin credentials stay on the server.
#pragma once

#define WIFI_SSID        "your-ssid"
#define WIFI_PASSWORD    "your-password"
#define DEVICE_INGEST_KEY "paste-the-device-ingest-key-here"
#define INGEST_URL        "https://your-deployment.example/api/readings"
