"use client";

import { getApp, getApps, initializeApp } from "firebase/app";
import {
  getDatabase,
  limitToLast,
  onValue,
  orderByChild,
  query,
  ref,
} from "firebase/database";

import type {
  SensorConnectionStatus,
  SystemConnection,
  SystemPower,
  TemperatureSample,
} from "@/lib/types";

interface LiveCurrentReading {
  timestamp: number;
  power: SystemPower;
  connection: SystemConnection;
  sensor1C: number | null;
  sensor2C: number | null;
  sensor1State: SensorConnectionStatus;
  sensor2State: SensorConnectionStatus;
  sensor1DisplayEnabled: boolean;
  sensor2DisplayEnabled: boolean;
}

export interface LiveMonitorData {
  current: LiveCurrentReading | null;
  samples: TemperatureSample[];
}

const FIREBASE_APP_NAME = "dual-temperature-monitor-browser";

function parseState(value: unknown): SensorConnectionStatus {
  if (value === "fault") return "fault";
  if (value === "unplugged") return "unplugged";
  return "connected";
}

function parseNullableTemperature(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseCurrent(value: unknown): LiveCurrentReading | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.timestamp !== "number" || !Number.isFinite(row.timestamp)) return null;

  return {
    timestamp: row.timestamp,
    power: row.power === "off" ? "off" : "on",
    connection: row.connection === "offline" ? "offline" : "online",
    sensor1C: parseNullableTemperature(row.sensor1C),
    sensor2C: parseNullableTemperature(row.sensor2C),
    sensor1State: parseState(row.sensor1State),
    sensor2State: parseState(row.sensor2State),
    sensor1DisplayEnabled: row.sensor1DisplayEnabled !== false,
    sensor2DisplayEnabled: row.sensor2DisplayEnabled !== false,
  };
}

function parseSamples(value: unknown): TemperatureSample[] {
  if (!value || typeof value !== "object") return [];

  const samples = Object.values(value as Record<string, unknown>)
    .flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const row = item as Record<string, unknown>;
      if (typeof row.timestamp !== "number" || !Number.isFinite(row.timestamp)) return [];

      const sensor1C = parseNullableTemperature(row.sensor1C);
      const sensor2C = parseNullableTemperature(row.sensor2C);
      const validStates = ["valid", "missing", "above-range", "below-range"];
      return [{
        timestamp: row.timestamp,
        sensor1C,
        sensor2C,
        sensor1State: validStates.includes(String(row.sensor1State))
          ? (row.sensor1State as TemperatureSample["sensor1State"])
          : "missing",
        sensor2State: validStates.includes(String(row.sensor2State))
          ? (row.sensor2State as TemperatureSample["sensor2State"])
          : "missing",
        sensor1DisplayEnabled:
          typeof row.sensor1DisplayEnabled === "boolean"
            ? row.sensor1DisplayEnabled
            : undefined,
        sensor2DisplayEnabled:
          typeof row.sensor2DisplayEnabled === "boolean"
            ? row.sensor2DisplayEnabled
            : undefined,
      }];
    })
    .sort((a, b) => a.timestamp - b.timestamp);

  if (samples.length === 0) return [];

  const samplesBySecond = new Map(
    samples.map((sample) => [Math.floor(sample.timestamp / 1_000), sample]),
  );
  const newestSecond = Math.floor(Date.now() / 1_000);
  const window: TemperatureSample[] = [];

  for (let second = newestSecond - 299; second <= newestSecond; second += 1) {
    const sample = samplesBySecond.get(second);
    window.push(
      sample
        ? { ...sample, timestamp: second * 1_000 }
        : {
            timestamp: second * 1_000,
            sensor1C: null,
            sensor2C: null,
            sensor1State: "missing",
            sensor2State: "missing",
          },
    );
  }

  return window;
}

function getBrowserDatabase() {
  const databaseURL = process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL;
  if (!databaseURL) {
    throw new Error("NEXT_PUBLIC_FIREBASE_DATABASE_URL is not configured.");
  }

  const existing = getApps().find((app) => app.name === FIREBASE_APP_NAME);
  const app = existing ?? initializeApp({ databaseURL }, FIREBASE_APP_NAME);
  return getDatabase(app);
}

export function subscribeToLiveMonitor(
  onData: (data: LiveMonitorData) => void,
  onError: (error: Error) => void,
) {
  const database = getBrowserDatabase();
  const currentRef = ref(database, "devices/third-box/current");
  const samplesRef = query(
    ref(database, "devices/third-box/samples"),
    orderByChild("timestamp"),
    limitToLast(300),
  );
  let current: LiveCurrentReading | null = null;
  let samples: TemperatureSample[] = [];
  let currentReady = false;
  let samplesReady = false;

  const emit = () => {
    if (currentReady && samplesReady) onData({ current, samples });
  };
  const reportError = (error: Error) => onError(error);

  const unsubscribeCurrent = onValue(
    currentRef,
    (snapshot) => {
      current = parseCurrent(snapshot.val());
      currentReady = true;
      emit();
    },
    reportError,
  );
  const unsubscribeSamples = onValue(
    samplesRef,
    (snapshot) => {
      samples = parseSamples(snapshot.val());
      samplesReady = true;
      emit();
    },
    reportError,
  );

  return () => {
    unsubscribeCurrent();
    unsubscribeSamples();
  };
}
