"use client";

import { useEffect, useState } from "react";
import {
  BellRing,
  Check,
  LoaderCircle,
  Smartphone,
  X,
} from "lucide-react";
import clsx from "clsx";

import {
  convertFromCelsius,
  convertToCelsius,
} from "@/lib/temperature";
import type { PushClientSummary } from "@/lib/push-types";
import type { AlertSettings, Sensor, TemperatureUnit } from "@/lib/types";

interface AlertsDrawerProps {
  settings: AlertSettings[];
  sensors: Sensor[];
  unit: TemperatureUnit;
  pushSummary: PushClientSummary;
  pushBusy: boolean;
  onClose: () => void;
  onSave: (settings: AlertSettings[]) => void;
  onTestAlert: (settings: AlertSettings) => void;
  onEnablePush: () => void;
}

function pushStatusLabel(summary: PushClientSummary) {
  if (summary.status === "checking") return "Checking…";
  if (summary.status === "ready") return "This device is registered";
  if (summary.status === "blocked") return "Blocked in browser settings";
  if (summary.status === "unsupported") return "Not supported on this device";
  if (summary.status === "error") return "Registration failed — try again";
  return "This device is not registered";
}

export function AlertsDrawer({
  settings,
  sensors,
  unit,
  pushSummary,
  pushBusy,
  onClose,
  onSave,
  onTestAlert,
  onEnablePush,
}: AlertsDrawerProps) {
  const [activeSensorId, setActiveSensorId] = useState<Sensor["id"]>("sensor-1");
  const [draft, setDraft] = useState<AlertSettings[]>(() =>
    settings.map((item) => ({ ...item })),
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const activeSettings =
    draft.find((item) => item.sensorId === activeSensorId) ?? draft[0];
  const isDirty = JSON.stringify(draft) !== JSON.stringify(settings);
  const thresholdError =
    activeSettings.minimumC >= activeSettings.maximumC
      ? "Maximum temperature must be greater than minimum temperature."
      : null;
  const messageError =
    !activeSettings.highMessage.trim() || !activeSettings.lowMessage.trim()
      ? "Enter both alert messages."
      : null;
  const isValid = !thresholdError && !messageError;

  function updateActiveSettings(patch: Partial<AlertSettings>) {
    setDraft((current) =>
      current.map((item) =>
        item.sensorId === activeSensorId ? { ...item, ...patch } : item,
      ),
    );
  }

  return (
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        aria-label="Close alert settings"
        className="absolute inset-0 bg-slate-950/30 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="alerts-drawer-title"
        className="absolute inset-y-0 right-0 flex w-full flex-col bg-white shadow-2xl sm:max-w-xl"
      >
        <div className="flex items-start justify-between border-b border-slate-200 px-5 py-5 sm:px-7">
          <div>
            <div className="flex items-center gap-2">
              <BellRing size={20} className="text-blue-600" aria-hidden="true" />
              <h2 id="alerts-drawer-title" className="text-xl font-semibold text-slate-950">
                Alert settings
              </h2>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
          >
            <X size={20} aria-hidden="true" />
            <span className="sr-only">Close settings</span>
          </button>
        </div>

        <div className="border-b border-slate-200 px-5 pt-4 sm:px-7">
          <div className="flex gap-1" role="tablist" aria-label="Sensor alert settings">
            {sensors.map((sensor) => (
              <button
                key={sensor.id}
                type="button"
                role="tab"
                aria-selected={activeSensorId === sensor.id}
                onClick={() => setActiveSensorId(sensor.id)}
                className={clsx(
                  "border-b-2 px-4 py-3 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600",
                  activeSensorId === sensor.id
                    ? sensor.id === "sensor-1"
                      ? "border-blue-600 text-blue-700"
                      : "border-orange-500 text-orange-700"
                    : "border-transparent text-slate-500 hover:text-slate-800",
                )}
              >
                {sensor.name}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-6 sm:px-7">
          <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3">
            <p className="text-sm font-semibold text-slate-900">Enable alerts</p>
            <button
              type="button"
              role="switch"
              aria-checked={activeSettings.enabled}
              onClick={() => updateActiveSettings({ enabled: !activeSettings.enabled })}
              className={clsx(
                "relative h-7 w-12 rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600",
                activeSettings.enabled ? "bg-blue-600" : "bg-slate-300",
              )}
            >
              <span
                className={clsx(
                  "absolute top-1 h-5 w-5 rounded-full bg-white shadow-sm transition-transform",
                  activeSettings.enabled ? "translate-x-6" : "translate-x-1",
                )}
              />
            </button>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-4">
            <label className="text-sm font-semibold text-slate-700">
              Minimum (°{unit})
              <input
                type="number"
                step="0.1"
                value={convertFromCelsius(activeSettings.minimumC, unit).toFixed(1)}
                onChange={(event) =>
                  updateActiveSettings({
                    minimumC: convertToCelsius(Number(event.target.value), unit),
                  })
                }
                className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 font-normal text-slate-950 outline-none transition focus:border-blue-500 focus:ring-3 focus:ring-blue-100"
              />
            </label>
            <label className="text-sm font-semibold text-slate-700">
              Maximum (°{unit})
              <input
                type="number"
                step="0.1"
                value={convertFromCelsius(activeSettings.maximumC, unit).toFixed(1)}
                onChange={(event) =>
                  updateActiveSettings({
                    maximumC: convertToCelsius(Number(event.target.value), unit),
                  })
                }
                className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 font-normal text-slate-950 outline-none transition focus:border-blue-500 focus:ring-3 focus:ring-blue-100"
              />
            </label>
          </div>
          {thresholdError && (
            <p className="mt-2 text-sm font-medium text-red-600">{thresholdError}</p>
          )}

          <label className="mt-6 block text-sm font-semibold text-slate-700">
            High-temperature message
            <textarea
              rows={3}
              maxLength={220}
              value={activeSettings.highMessage}
              onChange={(event) => updateActiveSettings({ highMessage: event.target.value })}
              className="mt-2 w-full resize-none rounded-xl border border-slate-300 bg-white px-3 py-2.5 font-normal leading-6 text-slate-950 outline-none transition focus:border-blue-500 focus:ring-3 focus:ring-blue-100"
            />
          </label>

          <label className="mt-5 block text-sm font-semibold text-slate-700">
            Low-temperature message
            <textarea
              rows={3}
              maxLength={220}
              value={activeSettings.lowMessage}
              onChange={(event) => updateActiveSettings({ lowMessage: event.target.value })}
              className="mt-2 w-full resize-none rounded-xl border border-slate-300 bg-white px-3 py-2.5 font-normal leading-6 text-slate-950 outline-none transition focus:border-blue-500 focus:ring-3 focus:ring-blue-100"
            />
          </label>

          {messageError && (
            <p className="mt-2 text-sm font-medium text-red-600">{messageError}</p>
          )}

          <section className="mt-6 rounded-xl border border-slate-200 p-4" aria-labelledby="push-device-title">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 id="push-device-title" className="text-sm font-semibold text-slate-900">
                  Notification device
                </h3>
                <p className="mt-1 text-xs text-slate-500">
                  {pushSummary.registeredDeviceCount} registered · {pushStatusLabel(pushSummary)}
                </p>
              </div>
              <Smartphone size={19} className="shrink-0 text-slate-500" aria-hidden="true" />
            </div>
            <button
              type="button"
              disabled={
                pushBusy ||
                pushSummary.status === "checking" ||
                pushSummary.status === "blocked" ||
                pushSummary.status === "unsupported"
              }
              onClick={onEnablePush}
              className="mt-3 inline-flex min-h-12 w-full touch-manipulation items-center justify-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 active:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pushBusy ? <LoaderCircle size={15} className="animate-spin" aria-hidden="true" /> : null}
              {pushSummary.status === "ready"
                ? "Sync this device"
                : pushSummary.status === "error"
                  ? "Try again"
                  : "Register this device"}
            </button>
            <p className="mt-2 text-xs text-slate-500">
              On iPhone, add this dashboard to the Home Screen first.
            </p>
            {pushSummary.error ? (
              <p className="mt-2 text-xs font-medium text-red-600">{pushSummary.error}</p>
            ) : null}
          </section>
        </div>

        <div className="border-t border-slate-200 bg-white px-5 py-4 sm:px-7">
          <div className="mb-3 flex min-h-5 items-center text-xs font-medium">
            {isDirty ? (
              <span className="text-amber-700">Unsaved changes</span>
            ) : (
              <span className="inline-flex items-center gap-1 text-emerald-700">
                <Check size={13} aria-hidden="true" /> Settings saved
              </span>
            )}
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              disabled={!isValid || pushBusy || pushSummary.registeredDeviceCount === 0}
              onClick={() => onTestAlert(activeSettings)}
              className="flex-1 rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pushBusy ? "Sending…" : "Test notification"}
            </button>
            <button
              type="button"
              disabled={!isDirty || !isValid}
              onClick={() => {
                onSave(draft);
                onClose();
              }}
              className="flex-1 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              Save changes
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}
