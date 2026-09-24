import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";

import { getTemperatureState } from "@/lib/temperature";

export const MAX_READING_BODY_BYTES = 4_096;
export const MAX_DEVICE_TIMESTAMP_SKEW_MS = 5 * 60 * 1_000;

export type DeviceSensorState = "ok" | "unplugged" | "fault";

export interface DeviceSensorReading {
  c: number | null;
  state: DeviceSensorState;
  shown: boolean;
}

export interface DeviceReading {
  ts?: number;
  s1: DeviceSensorReading;
  s2: DeviceSensorReading;
}

function parseSensor(value: unknown): DeviceSensorReading | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (
    !["ok", "unplugged", "fault"].includes(String(candidate.state)) ||
    typeof candidate.shown !== "boolean"
  ) {
    return null;
  }

  const state = candidate.state as DeviceSensorState;
  const celsius = candidate.c;
  if (state === "ok") {
    if (
      typeof celsius !== "number" ||
      !Number.isFinite(celsius) ||
      celsius < -55 ||
      celsius > 125
    ) {
      return null;
    }
  } else if (celsius !== null) {
    return null;
  }

  return { c: state === "ok" ? (celsius as number) : null, state, shown: candidate.shown };
}

export function parseDeviceReading(value: unknown): DeviceReading | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const s1 = parseSensor(candidate.s1);
  const s2 = parseSensor(candidate.s2);
  if (!s1 || !s2) return null;

  const ts = candidate.ts;
  if (ts !== undefined && (typeof ts !== "number" || !Number.isFinite(ts) || ts < 0)) {
    return null;
  }

  return { ts: ts as number | undefined, s1, s2 };
}

export function hasValidDeviceKey(received: string | null) {
  const expected = process.env.DEVICE_INGEST_KEY;
  if (!expected || !received) return false;

  const expectedHash = createHash("sha256").update(expected).digest();
  const receivedHash = createHash("sha256").update(received).digest();
  return timingSafeEqual(expectedHash, receivedHash);
}

export function createFirebaseReading(reading: DeviceReading, timestamp: number) {
  // New firmware sends an NTP-backed capture timestamp so buffered readings
  // can fill their original graph slots after a brief outage. Old firmware
  // sent device uptime here, so implausible values deliberately fall back to
  // server receipt time. Only authenticated devices can reach this function.
  const sampleTimestamp =
    reading.ts !== undefined &&
    Math.abs(reading.ts - timestamp) <= MAX_DEVICE_TIMESTAMP_SKEW_MS
      ? Math.round(reading.ts)
      : timestamp;
  const sampleId = String(Math.floor(sampleTimestamp / 1_000) % 300).padStart(3, "0");
  const current = {
    timestamp,
    power: "on" as const,
    connection: "online" as const,
    sensor1C: reading.s1.c,
    sensor2C: reading.s2.c,
    sensor1State: reading.s1.state,
    sensor2State: reading.s2.state,
    sensor1DisplayEnabled: reading.s1.shown,
    sensor2DisplayEnabled: reading.s2.shown,
  };
  const sample = {
    timestamp: sampleTimestamp,
    sensor1C: reading.s1.c,
    sensor2C: reading.s2.c,
    sensor1DisplayEnabled: reading.s1.shown,
    sensor2DisplayEnabled: reading.s2.shown,
    sensor1State:
      reading.s1.state === "ok" ? getTemperatureState(reading.s1.c) : "missing",
    sensor2State:
      reading.s2.state === "ok" ? getTemperatureState(reading.s2.c) : "missing",
  };

  return { current, sample, sampleId, sampleTimestamp };
}
