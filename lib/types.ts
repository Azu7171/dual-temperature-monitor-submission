export type TemperatureUnit = "C" | "F";

export type SystemConnection = "online" | "offline";
export type SystemPower = "on" | "off";
export type SensorConnectionStatus = "connected" | "unplugged" | "fault";
export type TemperatureState =
  | "valid"
  | "missing"
  | "above-range"
  | "below-range";

export interface SystemStatus {
  power: SystemPower;
  connection: SystemConnection;
  lastUpdated: number;
}

export interface Sensor {
  id: "sensor-1" | "sensor-2";
  name: "Sensor 1" | "Sensor 2";
  temperatureC: number;
  connectionStatus: SensorConnectionStatus;
  boxDisplayEnabled: boolean;
  lastUpdated: number;
  minimumThresholdC: number;
  maximumThresholdC: number;
}

export interface TemperatureSample {
  timestamp: number;
  sensor1C: number | null;
  sensor2C: number | null;
  sensor1State: TemperatureState;
  sensor2State: TemperatureState;
  // Older stored samples predate these flags; the chart uses the current
  // display state for those rows during the five-minute transition window.
  sensor1DisplayEnabled?: boolean;
  sensor2DisplayEnabled?: boolean;
}

export interface AlertSettings {
  sensorId: Sensor["id"];
  enabled: boolean;
  minimumC: number;
  maximumC: number;
  highMessage: string;
  lowMessage: string;
}

export type EventSeverity = "info" | "success" | "warning" | "critical";

export type EventType =
  | "high-temperature"
  | "low-temperature"
  | "sensor-unplugged"
  | "sensor-reconnected"
  | "sensor-fault"
  | "third-box-offline"
  | "third-box-online"
  | "display-toggled"
  | "test-notification";

export interface MonitorEvent {
  id: string;
  timestamp: number;
  sensorId: Sensor["id"] | "system";
  type: EventType;
  message: string;
  temperatureC?: number;
  severity: EventSeverity;
}

export type PreviewMode = "normal" | "loading" | "empty";
