// HTTPS uploader for the Lab 1 third box.
//
// WiFi, DNS, TLS, and HTTP can each block for far longer than R4a's 20 ms
// button-response budget. They therefore run only on this background task.
// The display loop copies its newest snapshot into a bounded FIFO and returns.
// Brief connection stalls are retried from that FIFO without blocking the UI.
#pragma once

#include <Arduino.h>
#include <sys/time.h>
#include "config.h"
#include "display.h"

#if ENABLE_NETWORK
#include <esp_sntp.h>
#include <HTTPClient.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include "secrets.h"
#endif

namespace net {

struct ControlCommand {
  uint64_t id;
  uint8_t sensor;
  bool shown;
};

#if ENABLE_NETWORK

struct UploadFrame {
  uint32_t deviceUptimeMs;
  bool shown[2];
  SensorState state[2];
  float celsius[2];
};

QueueHandle_t s_uploadQueue = nullptr;
QueueHandle_t s_controlQueue = nullptr;
WiFiClientSecure s_client;
HTTPClient s_http;
bool s_httpReady = false;
bool s_clockRequested = false;
volatile bool s_clockSynchronized = false;
uint32_t s_lastWifiAttemptMs = 0;
uint32_t s_lastClockRequestMs = 0;
uint32_t s_lastControlPollMs = 0;
uint64_t s_lastQueuedCommandId = 0;
uint64_t s_appliedCommandId = 0;
bool s_appliedShown = false;
portMUX_TYPE s_ackLock = portMUX_INITIALIZER_UNLOCKED;

// Google Trust Services Root R1. The certificate chain used by the Vercel
// endpoint terminates at this root. Do not replace this with setInsecure().
static const char GTS_ROOT_R1[] PROGMEM = R"EOF(
-----BEGIN CERTIFICATE-----
MIIFVzCCAz+gAwIBAgINAgPlk28xsBNJiGuiFzANBgkqhkiG9w0BAQwFADBHMQsw
CQYDVQQGEwJVUzEiMCAGA1UEChMZR29vZ2xlIFRydXN0IFNlcnZpY2VzIExMQzEU
MBIGA1UEAxMLR1RTIFJvb3QgUjEwHhcNMTYwNjIyMDAwMDAwWhcNMzYwNjIyMDAw
MDAwWjBHMQswCQYDVQQGEwJVUzEiMCAGA1UEChMZR29vZ2xlIFRydXN0IFNlcnZp
Y2VzIExMQzEUMBIGA1UEAxMLR1RTIFJvb3QgUjEwggIiMA0GCSqGSIb3DQEBAQUA
A4ICDwAwggIKAoICAQC2EQKLHuOhd5s73L+UPreVp0A8of2C+X0yBoJx9vaMf/vo
27xqLpeXo4xL+Sv2sfnOhB2x+cWX3u+58qPpvBKJXqeqUqv4IyfLpLGcY9vXmX7w
Cl7raKb0xlpHDU0QM+NOsROjyBhsS+z8CZDfnWQpJSMHobTSPS5g4M/SCYe7zUjw
TcLCeoiKu7rPWRnWr4+wB7CeMfGCwcDfLqZtbBkOtdh+JhpFAz2weaSUKK0Pfybl
qAj+lug8aJRT7oM6iCsVlgmy4HqMLnXWnOunVmSPlk9orj2XwoSPwLxAwAtcvfaH
szVsrBhQf4TgTM2S0yDpM7xSma8ytSmzJSq0SPly4cpk9+aCEI3oncKKiPo4Zor8
Y/kB+Xj9e1x3+naH+uzfsQ55lVe0vSbv1gHR6xYKu44LtcXFilWr06zqkUspzBmk
MiVOKvFlRNACzqrOSbTqn3yDsEB750Orp2yjj32JgfpMpf/VjsPOS+C12LOORc92
wO1AK/1TD7Cn1TsNsYqiA94xrcx36m97PtbfkSIS5r762DL8EGMUUXLeXdYWk70p
aDPvOmbsB4om3xPXV2V4J95eSRQAogB/mqghtqmxlbCluQ0WEdrHbEg8QOB+DVrN
VjzRlwW5y0vtOUucxD/SVRNuJLDWcfr0wbrM7Rv1/oFB2ACYPTrIrnqYNxgFlQID
AQABo0IwQDAOBgNVHQ8BAf8EBAMCAYYwDwYDVR0TAQH/BAUwAwEB/zAdBgNVHQ4E
FgQU5K8rJnEaK0gnhS9SZizv8IkTcT4wDQYJKoZIhvcNAQEMBQADggIBAJ+qQibb
C5u+/x6Wki4+omVKapi6Ist9wTrYggoGxval3sBOh2Z5ofmmWJyq+bXmYOfg6LEe
QkEzCzc9zolwFcq1JKjPa7XSQCGYzyI0zzvFIoTgxQ6KfF2I5DUkzps+GlQebtuy
h6f88/qBVRRiClmpIgUxPoLW7ttXNLwzldMXG+gnoot7TiYaelpkttGsN/H9oPM4
7HLwEXWdyzRSjeZ2axfG34arJ45JK3VmgRAhpuo+9K4l/3wV3s6MJT/KYnAK9y8J
ZgfIPxz88NtFMN9iiMG1D53Dn0reWVlHxYciNuaCp+0KueIHoI17eko8cdLiA6Ef
MgfdG+RCzgwARWGAtQsgWSl4vflVy2PFPEz0tv/bal8xa5meLMFrUKTX5hgUvYU/
Z6tGn6D/Qqc6f1zLXbBwHSs09dR2CQzreExZBfMzQsNhFRAbd03OIozUhfJFfbdT
6u9AWpQKXCBfTkBdYiJ23//OYb2MI3jSNwLgjt7RETeJ9r/tSQdirpLsQBqvFAnZ
0E6yove+7u7Y/9waLd64NnHi/Hm3lCXRSHNboTXns5lndcEZOitHTtNCjv0xyBZm
2tIMPNuzjsmhDYAPexZ3FL//2wmUspO8IFgV6dtxQ/PeEMMA3KgqlbbC1j+Qa3bb
bP6MvPJwNQzcmRk13NfIRmPVNnGuV/u3gm3c
-----END CERTIFICATE-----
)EOF";

inline bool clockIsReady() {
  return time(nullptr) >= 1700000000;
}

inline void onClockSynchronized(timeval*) {
  s_clockSynchronized = true;
}

inline void resetHttp() {
  if (s_httpReady) s_http.end();
  s_client.stop();
  s_httpReady = false;
}

inline bool ensureWiFiAndClock() {
  if (WiFi.status() != WL_CONNECTED) {
    resetHttp();
    const uint32_t now = millis();
    if (now - s_lastWifiAttemptMs >= WIFI_RESTART_MS) {
      Serial.println("[NET] restarting WiFi connection");
      WiFi.disconnect(false, false);
      WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
      s_lastWifiAttemptMs = now;
    }
    return false;
  }

  if (!s_clockSynchronized || !clockIsReady()) {
    const uint32_t now = millis();
    if (!s_clockRequested || now - s_lastClockRequestMs >= WIFI_RESTART_MS) {
      configTime(0, 0, "pool.ntp.org", "time.google.com");
      s_clockRequested = true;
      s_lastClockRequestMs = now;
      Serial.println("[NET] requesting network time");
    }
    return false;
  }
  return true;
}

inline uint64_t sampleTimestampMs(const UploadFrame& frame) {
  timeval now = {};
  gettimeofday(&now, nullptr);
  const uint64_t epochNowMs = static_cast<uint64_t>(now.tv_sec) * 1000ULL
    + static_cast<uint64_t>(now.tv_usec / 1000);
  const uint32_t ageMs = millis() - frame.deviceUptimeMs;
  return epochNowMs > ageMs ? epochNowMs - ageMs : epochNowMs;
}

inline bool prepareHttp() {
  if (s_httpReady) return true;

  s_client.setCACert(GTS_ROOT_R1);
  s_client.setHandshakeTimeout(5);
  s_http.setConnectTimeout(5000);
  s_http.setTimeout(5000);
  s_http.setReuse(true);
  if (!s_http.begin(s_client, INGEST_URL)) {
    Serial.println("[NET] invalid ingest URL");
    return false;
  }
  s_http.addHeader("Content-Type", "application/json");
  s_http.addHeader("x-device-key", DEVICE_INGEST_KEY);
  s_httpReady = true;
  return true;
}

inline bool upload(const UploadFrame& frame) {
  if (!ensureWiFiAndClock()) {
    return false;
  }

  char sensor1[16];
  char sensor2[16];
  if (frame.state[0] == SENSOR_OK) {
    snprintf(sensor1, sizeof(sensor1), "%.2f", frame.celsius[0]);
  } else {
    strcpy(sensor1, "null");
  }
  if (frame.state[1] == SENSOR_OK) {
    snprintf(sensor2, sizeof(sensor2), "%.2f", frame.celsius[1]);
  } else {
    strcpy(sensor2, "null");
  }

  char body[320];
  snprintf(
    body,
    sizeof(body),
    "{\"ts\":%llu,\"s1\":{\"c\":%s,\"state\":\"%s\",\"shown\":%s},"
    "\"s2\":{\"c\":%s,\"state\":\"%s\",\"shown\":%s}}",
    static_cast<unsigned long long>(sampleTimestampMs(frame)),
    sensor1,
    sensorStateName(frame.state[0]),
    frame.shown[0] ? "true" : "false",
    sensor2,
    sensorStateName(frame.state[1]),
    frame.shown[1] ? "true" : "false"
  );

  if (!prepareHttp()) return false;

  const int status = s_http.POST(reinterpret_cast<uint8_t*>(body), strlen(body));
  // Consume the small JSON response so the socket is clean for HTTP keep-alive.
  const String response = status > 0 ? s_http.getString() : String();

  if (status >= 200 && status < 300) {
    Serial.printf("[NET] upload ok (%d)\n", status);
    return true;
  }

  if (status < 0) {
    Serial.printf(
      "[NET] upload failed (%d: %s); retrying\n",
      status,
      HTTPClient::errorToString(status).c_str()
    );
    resetHttp();
    return false;
  }

  // Retry temporary server/rate-limit failures. A 4xx response is a permanent
  // payload or credential rejection, so dropping it avoids wedging the FIFO.
  const bool retryable = status == 408 || status == 429 || status >= 500;
  Serial.printf(
    "[NET] upload rejected (%d)%s%s\n",
    status,
    retryable ? "; retrying" : "; dropping reading",
    response.length() ? response.c_str() : ""
  );
  if (retryable) resetHttp();
  return !retryable;
}

// The same authenticated TLS connection is reused for uploads and command
// polls. All network work stays on core 0, away from the urgent button path.
inline void pollControl() {
  if (!s_controlQueue || !ensureWiFiAndClock() || !prepareHttp()) return;

  uint64_t ackId;
  bool ackShown;
  portENTER_CRITICAL(&s_ackLock);
  ackId = s_appliedCommandId;
  ackShown = s_appliedShown;
  portEXIT_CRITICAL(&s_ackLock);

  char body[80];
  snprintf(body, sizeof(body), "{\"ack\":%llu,\"shown\":%s}",
           static_cast<unsigned long long>(ackId),
           ackShown ? "true" : "false");

  const int status = s_http.sendRequest(
    "PUT", reinterpret_cast<uint8_t*>(body), strlen(body));
  const String response = status > 0 ? s_http.getString() : String();
  if (status < 200 || status >= 300) {
    if (status < 0 || status >= 500) resetHttp();
    return;
  }

  if (ackId > 0) {
    portENTER_CRITICAL(&s_ackLock);
    if (s_appliedCommandId == ackId) s_appliedCommandId = 0;
    portEXIT_CRITICAL(&s_ackLock);
  }

  unsigned long long parsedId = 0;
  unsigned int parsedSensor = 0;
  unsigned int parsedShown = 0;
  if (sscanf(response.c_str(), "%llu %u %u",
             &parsedId, &parsedSensor, &parsedShown) != 3) return;
  if (parsedId == 0 || parsedId <= s_lastQueuedCommandId ||
      (parsedSensor != 1 && parsedSensor != 2) || parsedShown > 1) return;

  const ControlCommand command = {
    static_cast<uint64_t>(parsedId),
    static_cast<uint8_t>(parsedSensor),
    parsedShown == 1,
  };
  if (xQueueOverwrite(s_controlQueue, &command) == pdTRUE) {
    s_lastQueuedCommandId = command.id;
    Serial.printf("[NET] remote sensor %u display %s queued\n",
                  command.sensor, command.shown ? "ON" : "OFF");
  }
}

inline void worker(void*) {
  UploadFrame frame;
  bool hasFrame = false;
  for (;;) {
    if (!hasFrame) {
      hasFrame = xQueueReceive(s_uploadQueue, &frame, pdMS_TO_TICKS(50)) == pdTRUE;
    }
    if (hasFrame) {
      if (upload(frame)) {
        hasFrame = false;
      } else {
        vTaskDelay(pdMS_TO_TICKS(UPLOAD_RETRY_MS));
      }
    }
    bool acknowledgementPending;
    portENTER_CRITICAL(&s_ackLock);
    acknowledgementPending = s_appliedCommandId > 0;
    portEXIT_CRITICAL(&s_ackLock);
    const uint32_t now = millis();
    if ((acknowledgementPending && now - s_lastControlPollMs >= 100) ||
        now - s_lastControlPollMs >= CONTROL_POLL_MS) {
      s_lastControlPollMs = now;
      pollControl();
    }
  }
}

inline void begin() {
  s_uploadQueue = xQueueCreate(UPLOAD_QUEUE_LENGTH, sizeof(UploadFrame));
  s_controlQueue = xQueueCreate(1, sizeof(ControlCommand));
  if (!s_uploadQueue || !s_controlQueue) {
    Serial.println("[NET] queue allocation failed");
    return;
  }

  WiFi.persistent(false);
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  sntp_set_time_sync_notification_cb(onClockSynchronized);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  s_lastWifiAttemptMs = millis();
  xTaskCreatePinnedToCore(worker, "reading-upload", 8192, nullptr, 1, nullptr, 0);
}

inline bool takeCommand(ControlCommand* command) {
  return s_controlQueue &&
    xQueueReceive(s_controlQueue, command, 0) == pdTRUE;
}

inline void acknowledge(const ControlCommand& command) {
  portENTER_CRITICAL(&s_ackLock);
  s_appliedCommandId = command.id;
  s_appliedShown = command.shown;
  portEXIT_CRITICAL(&s_ackLock);
}

inline void publish(const Snapshot& snapshot, uint32_t deviceUptimeMs) {
  if (!s_uploadQueue) return;
  UploadFrame frame = {
    deviceUptimeMs,
    {snapshot.shown[0], snapshot.shown[1]},
    {snapshot.state[0], snapshot.state[1]},
    {snapshot.celsius[0], snapshot.celsius[1]},
  };
  if (xQueueSend(s_uploadQueue, &frame, 0) == pdTRUE) return;

  UploadFrame discarded;
  if (xQueueReceive(s_uploadQueue, &discarded, 0) == pdTRUE
      && xQueueSend(s_uploadQueue, &frame, 0) == pdTRUE) {
    Serial.println("[NET] upload queue full; discarded oldest reading");
  } else {
    Serial.println("[NET] upload queue full; could not enqueue reading");
  }
}

#else

inline void begin() {
  Serial.println("[NET] disabled; copy secrets.example.h to secrets.h to enable");
}

inline void publish(const Snapshot&, uint32_t) {}

inline bool takeCommand(ControlCommand*) { return false; }

inline void acknowledge(const ControlCommand&) {}

#endif

}  // namespace net
