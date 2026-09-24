"use client";

import {
  AlertTriangle,
  CircleCheck,
  CircleOff,
  LoaderCircle,
  Radio,
} from "lucide-react";
import clsx from "clsx";

import { formatClockTime, formatTemperature } from "@/lib/temperature";
import type { AlertSettings, Sensor, TemperatureUnit } from "@/lib/types";

interface SensorCardProps {
  sensor: Sensor;
  settings: AlertSettings;
  unit: TemperatureUnit;
  systemAvailable: boolean;
  boxControlEnabled: boolean;
  syncing: boolean;
  isLoading: boolean;
  onToggleBoxDisplay: (sensorId: Sensor["id"]) => void;
}

type CardState =
  | "normal"
  | "display-off"
  | "unplugged"
  | "fault"
  | "no-data"
  | "high"
  | "low";

function getCardState(
  sensor: Sensor,
  settings: AlertSettings,
  systemAvailable: boolean,
): CardState {
  if (!systemAvailable) return "no-data";
  if (sensor.connectionStatus === "unplugged") return "unplugged";
  if (sensor.connectionStatus === "fault") return "fault";
  if (sensor.temperatureC > settings.maximumC) return "high";
  if (sensor.temperatureC < settings.minimumC) return "low";
  if (!sensor.boxDisplayEnabled) return "display-off";
  return "normal";
}

const stateStyles: Record<CardState, string> = {
  normal: "border-slate-200",
  "display-off": "border-amber-300",
  unplugged: "border-amber-300",
  fault: "border-red-300",
  "no-data": "border-slate-300",
  high: "border-red-300",
  low: "border-blue-300",
};

export function SensorCard({
  sensor,
  settings,
  unit,
  systemAvailable,
  boxControlEnabled,
  syncing,
  isLoading,
  onToggleBoxDisplay,
}: SensorCardProps) {
  const state = getCardState(sensor, settings, systemAvailable);
  const sensorColor = sensor.id === "sensor-1" ? "bg-blue-600" : "bg-orange-500";
  const sensorTextColor =
    sensor.id === "sensor-1" ? "text-blue-700" : "text-orange-700";

  const stateContent: Record<
    CardState,
    { label: string; tone: string; icon: typeof CircleCheck }
  > = {
    normal: {
      label: "Normal",
      tone: "text-emerald-700",
      icon: CircleCheck,
    },
    "display-off": {
      label: "Box display off",
      tone: "text-amber-700",
      icon: CircleOff,
    },
    unplugged: {
      label: "Unplugged sensor",
      tone: "text-amber-700",
      icon: CircleOff,
    },
    fault: {
      label: "Sensor error",
      tone: "text-red-700",
      icon: AlertTriangle,
    },
    "no-data": {
      label: "No data available",
      tone: "text-slate-600",
      icon: Radio,
    },
    high: {
      label: "Above maximum",
      tone: "text-red-700",
      icon: AlertTriangle,
    },
    low: {
      label: "Below minimum",
      tone: "text-blue-700",
      icon: AlertTriangle,
    },
  };

  const status = stateContent[state];
  const StatusIcon = status.icon;
  const shouldShowTemperature = ["normal", "display-off", "high", "low"].includes(
    state,
  );

  if (isLoading) {
    return (
      <section
        aria-label={`${sensor.name} loading`}
        className="animate-pulse rounded-lg border border-slate-200 bg-white p-5"
      >
        <div className="h-5 w-28 rounded bg-slate-200" />
        <div className="mt-8 h-14 w-44 rounded bg-slate-200" />
        <div className="mt-8 h-10 rounded bg-slate-100" />
      </section>
    );
  }

  return (
    <section
      aria-labelledby={`${sensor.id}-heading`}
      className={clsx(
        "relative overflow-hidden rounded-lg border bg-white p-5 transition-colors",
        stateStyles[state],
      )}
    >
      <div className={clsx("absolute inset-y-0 left-0 w-1", sensorColor)} />

      <div className="flex items-center justify-between gap-4">
        <h2 id={`${sensor.id}-heading`} className="font-semibold text-slate-950">
          {sensor.name}
        </h2>

        <span
          className={clsx(
            "inline-flex items-center gap-1.5 text-xs font-medium",
            status.tone,
          )}
        >
          <StatusIcon size={13} aria-hidden="true" />
          {status.label}
        </span>
      </div>

      <div className="mt-5 min-h-20">
        {shouldShowTemperature ? (
          <div className="flex items-end gap-2">
            <span className="text-5xl font-semibold tabular-nums tracking-[-0.05em] text-slate-950 sm:text-6xl">
              {formatTemperature(sensor.temperatureC, unit, false)}
            </span>
            <span className={clsx("mb-1.5 text-xl font-medium", sensorTextColor)}>
              °{unit}
            </span>
          </div>
        ) : (
          <div className="flex min-h-16 items-center">
            <p
              className={clsx(
                "text-xl font-semibold tracking-tight",
                state === "fault" ? "text-red-700" : "text-slate-700",
              )}
            >
              {status.label}
            </p>
          </div>
        )}

        {state === "display-off" && (
          <p className="mt-1 text-sm text-amber-700">{sensor.name} off</p>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-3 text-xs text-slate-500">
        <p>
          Range {formatTemperature(settings.minimumC, unit)}–{formatTemperature(settings.maximumC, unit)}
        </p>
        <p>Updated {formatClockTime(sensor.lastUpdated)}</p>
      </div>

      <div className="mt-3 flex items-center justify-between">
        <p className="text-sm font-medium text-slate-700">Box display</p>
        <button
          type="button"
          role="switch"
          aria-checked={sensor.boxDisplayEnabled}
          aria-label={`Display ${sensor.name} on the third box`}
          title={boxControlEnabled ? undefined : "Waiting for the box to connect"}
          disabled={!systemAvailable || !boxControlEnabled || syncing}
          onClick={() => onToggleBoxDisplay(sensor.id)}
          className={clsx(
            "relative h-6 w-11 rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-50",
            sensor.boxDisplayEnabled ? "bg-blue-600" : "bg-slate-300",
          )}
        >
          <span
            className={clsx(
              "absolute top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-white shadow-sm transition-transform",
              sensor.boxDisplayEnabled ? "translate-x-5.5" : "translate-x-0.5",
            )}
          >
            {syncing && (
              <LoaderCircle
                size={13}
                className="animate-spin text-blue-600"
                aria-hidden="true"
              />
            )}
          </span>
        </button>
      </div>
    </section>
  );
}
