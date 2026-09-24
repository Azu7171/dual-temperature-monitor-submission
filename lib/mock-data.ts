import { getTemperatureState } from "@/lib/temperature";
import type {
  AlertSettings,
  MonitorEvent,
  Sensor,
  SystemStatus,
  TemperatureSample,
} from "@/lib/types";

export function createInitialSystem(timestamp: number): SystemStatus {
  return {
    power: "on",
    connection: "online",
    lastUpdated: timestamp,
  };
}

export function createInitialSensors(timestamp: number): Sensor[] {
  return [
    {
      id: "sensor-1",
      name: "Sensor 1",
      temperatureC: 22.4,
      connectionStatus: "connected",
      boxDisplayEnabled: true,
      lastUpdated: timestamp,
      minimumThresholdC: 15,
      maximumThresholdC: 35,
    },
    {
      id: "sensor-2",
      name: "Sensor 2",
      temperatureC: 23.1,
      connectionStatus: "connected",
      boxDisplayEnabled: true,
      lastUpdated: timestamp,
      minimumThresholdC: 15,
      maximumThresholdC: 35,
    },
  ];
}

export function createInitialAlertSettings(): AlertSettings[] {
  return ["sensor-1", "sensor-2"].map((sensorId) => ({
    sensorId: sensorId as AlertSettings["sensorId"],
    enabled: true,
    minimumC: 15,
    maximumC: 35,
    highMessage: "Warning: temperature exceeded the maximum limit.",
    lowMessage: "Warning: temperature dropped below the minimum limit.",
  }));
}

export function createMockHistory(timestamp: number): TemperatureSample[] {
  return Array.from({ length: 300 }, (_, index) => {
    const secondsAgo = 299 - index;
    const sampleTimestamp = timestamp - secondsAgo * 1_000;
    const missing = secondsAgo >= 174 && secondsAgo <= 186;
    const sensor1C = missing
      ? null
      : 22.4 + Math.sin(index / 16) * 0.8 + Math.cos(index / 41) * 0.25;
    const sensor2C = missing
      ? null
      : 23.1 + Math.cos(index / 19) * 0.65 + Math.sin(index / 37) * 0.2;

    return {
      timestamp: sampleTimestamp,
      sensor1C,
      sensor2C,
      sensor1State: getTemperatureState(sensor1C),
      sensor2State: getTemperatureState(sensor2C),
      sensor1DisplayEnabled: true,
      sensor2DisplayEnabled: true,
    };
  });
}

export function createInitialEvents(timestamp: number): MonitorEvent[] {
  return [
    {
      id: "event-initial-online",
      timestamp: timestamp - 42_000,
      sensorId: "system",
      type: "third-box-online",
      message: "Third box connected and streaming data",
      severity: "success",
    },
    {
      id: "event-initial-display",
      timestamp: timestamp - 118_000,
      sensorId: "sensor-2",
      type: "display-toggled",
      message: "Remote box display turned on",
      severity: "info",
    },
    {
      id: "event-initial-reconnect",
      timestamp: timestamp - 181_000,
      sensorId: "sensor-1",
      type: "sensor-reconnected",
      message: "Sensor reconnected after a brief interruption",
      temperatureC: 22.2,
      severity: "success",
    },
  ];
}
