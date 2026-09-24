"use client";

import {
  AlertTriangle,
  Bell,
  BellOff,
  ChevronDown,
  CircleOff,
  PlugZap,
  Power,
  RotateCcw,
  Waves,
} from "lucide-react";
import clsx from "clsx";

import { formatTemperature } from "@/lib/temperature";
import type {
  PreviewMode,
  Sensor,
  SensorConnectionStatus,
  SystemStatus,
  TemperatureUnit,
} from "@/lib/types";

interface DemoControlsProps {
  system: SystemStatus;
  sensors: Sensor[];
  unit: TemperatureUnit;
  previewMode: PreviewMode;
  onSetPower: (power: SystemStatus["power"]) => void;
  onSetConnection: (connection: SystemStatus["connection"]) => void;
  onSetSensorStatus: (
    sensorId: Sensor["id"],
    status: SensorConnectionStatus,
  ) => void;
  onSetTemperature: (sensorId: Sensor["id"], temperatureC: number) => void;
  onNormalize: () => void;
  onTriggerExtreme: (sensorId: Sensor["id"], direction: "high" | "low") => void;
  onInsertMissing: () => void;
  onSetPreviewMode: (mode: PreviewMode) => void;
  demoPush: boolean;
  onSetDemoPush: (enabled: boolean) => void;
  onReset: () => void;
}

export function DemoControls({
  system,
  sensors,
  unit,
  previewMode,
  onSetPower,
  onSetConnection,
  onSetSensorStatus,
  onSetTemperature,
  onNormalize,
  onTriggerExtreme,
  onInsertMissing,
  onSetPreviewMode,
  demoPush,
  onSetDemoPush,
  onReset,
}: DemoControlsProps) {
  return (
    <details className="group rounded-lg border border-slate-200 bg-white">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">
        <h2 className="font-semibold text-slate-950">Demo controls</h2>
        <ChevronDown
          size={19}
          className="text-slate-500 transition-transform group-open:rotate-180"
          aria-hidden="true"
        />
      </summary>

      <div className="border-t border-slate-200 px-5 py-5">
        <div className="grid gap-6 lg:grid-cols-2">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
              Third box
            </h3>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => onSetPower(system.power === "on" ? "off" : "on")}
                className={clsx(
                  "flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600",
                  system.power === "on"
                    ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                    : "border-slate-300 bg-slate-100 text-slate-700",
                )}
              >
                <Power size={16} aria-hidden="true" />
                Power {system.power}
              </button>
              <button
                type="button"
                disabled={system.power === "off"}
                onClick={() =>
                  onSetConnection(
                    system.connection === "online" ? "offline" : "online",
                  )
                }
                className={clsx(
                  "flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-45",
                  system.connection === "online"
                    ? "border-blue-300 bg-blue-50 text-blue-700"
                    : "border-amber-300 bg-amber-50 text-amber-800",
                )}
              >
                <PlugZap size={16} aria-hidden="true" />
                Link {system.connection}
              </button>
            </div>

            <h3 className="mt-6 text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
              Notifications
            </h3>
            <button
              type="button"
              aria-pressed={demoPush}
              onClick={() => onSetDemoPush(!demoPush)}
              className={clsx(
                "mt-3 flex w-full items-start gap-3 rounded-xl border px-3 py-2.5 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600",
                demoPush
                  ? "border-rose-300 bg-rose-50"
                  : "border-slate-300 bg-white hover:bg-slate-50",
              )}
            >
              {demoPush ? (
                <Bell size={16} className="mt-0.5 shrink-0 text-rose-600" aria-hidden="true" />
              ) : (
                <BellOff size={16} className="mt-0.5 shrink-0 text-slate-500" aria-hidden="true" />
              )}
              <span className="min-w-0">
                <span
                  className={clsx(
                    "block text-sm font-semibold",
                    demoPush ? "text-rose-800" : "text-slate-700",
                  )}
                >
                  Send real notifications: {demoPush ? "on" : "off"}
                </span>
                <span
                  className={clsx(
                    "mt-0.5 block text-xs",
                    demoPush ? "text-rose-700" : "text-slate-500",
                  )}
                >
                  {demoPush
                    ? "Demo alerts push to every registered device."
                    : "Demo alerts are logged on screen only."}
                </span>
              </span>
            </button>

            <h3 className="mt-6 text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
              Interface previews
            </h3>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {(["normal", "loading", "empty"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={previewMode === mode}
                  onClick={() => onSetPreviewMode(mode)}
                  className={clsx(
                    "rounded-xl border px-2 py-2 text-xs font-semibold capitalize focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600",
                    previewMode === mode
                      ? "border-blue-500 bg-blue-50 text-blue-700"
                      : "border-slate-300 text-slate-600 hover:bg-slate-50",
                  )}
                >
                  {mode}
                </button>
              ))}
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={onInsertMissing}
                className="flex items-center justify-center gap-2 rounded-xl border border-slate-300 px-3 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
              >
                <CircleOff size={16} aria-hidden="true" />
                Insert gap
              </button>
              <button
                type="button"
                onClick={onNormalize}
                className="flex items-center justify-center gap-2 rounded-xl border border-slate-300 px-3 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
              >
                <Waves size={16} aria-hidden="true" />
                Normalize
              </button>
            </div>
          </div>

          <div className="space-y-5">
            {sensors.map((sensor) => (
              <fieldset key={sensor.id} className="rounded-xl border border-slate-200 p-4">
                <legend className="px-1 text-sm font-semibold text-slate-900">
                  {sensor.name}
                </legend>
                <div className="flex flex-wrap gap-2">
                  {(["connected", "unplugged", "fault"] as const).map((status) => (
                    <button
                      key={status}
                      type="button"
                      aria-pressed={sensor.connectionStatus === status}
                      onClick={() => onSetSensorStatus(sensor.id, status)}
                      className={clsx(
                        "rounded-lg border px-2.5 py-1.5 text-xs font-semibold capitalize focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600",
                        sensor.connectionStatus === status
                          ? status === "connected"
                            ? "border-emerald-400 bg-emerald-50 text-emerald-700"
                            : status === "fault"
                              ? "border-red-400 bg-red-50 text-red-700"
                              : "border-amber-400 bg-amber-50 text-amber-800"
                          : "border-slate-300 text-slate-600 hover:bg-slate-50",
                      )}
                    >
                      {status}
                    </button>
                  ))}
                </div>

                <label className="mt-4 block text-xs font-semibold text-slate-600">
                  Simulated temperature: {formatTemperature(sensor.temperatureC, unit)}
                  <input
                    type="range"
                    min="-10"
                    max="63"
                    step="0.1"
                    value={sensor.temperatureC}
                    onChange={(event) =>
                      onSetTemperature(sensor.id, Number(event.target.value))
                    }
                    className="mt-2 w-full accent-blue-600"
                  />
                </label>

                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => onTriggerExtreme(sensor.id, "high")}
                    className="flex items-center justify-center gap-1.5 rounded-lg bg-red-50 px-2 py-2 text-xs font-semibold text-red-700 ring-1 ring-inset ring-red-200 hover:bg-red-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600"
                  >
                    <AlertTriangle size={14} aria-hidden="true" /> High alert
                  </button>
                  <button
                    type="button"
                    onClick={() => onTriggerExtreme(sensor.id, "low")}
                    className="flex items-center justify-center gap-1.5 rounded-lg bg-blue-50 px-2 py-2 text-xs font-semibold text-blue-700 ring-1 ring-inset ring-blue-200 hover:bg-blue-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
                  >
                    <AlertTriangle size={14} aria-hidden="true" /> Low alert
                  </button>
                </div>
              </fieldset>
            ))}
          </div>
        </div>

        <div className="mt-5 flex justify-end border-t border-slate-100 pt-4">
          <button
            type="button"
            onClick={onReset}
            className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
          >
            <RotateCcw size={15} aria-hidden="true" /> Reset demo
          </button>
        </div>
      </div>
    </details>
  );
}
