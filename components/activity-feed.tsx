"use client";

import {
  AlertTriangle,
  BellRing,
  Check,
  CircleOff,
  Info,
  Power,
  Thermometer,
} from "lucide-react";
import clsx from "clsx";

import { formatClockTime, formatTemperature } from "@/lib/temperature";
import type { MonitorEvent, TemperatureUnit } from "@/lib/types";

interface ActivityFeedProps {
  events: MonitorEvent[];
  unit: TemperatureUnit;
  isLoading: boolean;
  onClear: () => void;
}

const severityStyles = {
  info: "bg-blue-50 text-blue-700",
  success: "bg-emerald-50 text-emerald-700",
  warning: "bg-amber-50 text-amber-700",
  critical: "bg-red-50 text-red-700",
};

function EventIcon({ event }: { event: MonitorEvent }) {
  const iconProps = { size: 16, "aria-hidden": true } as const;

  if (event.type === "high-temperature" || event.type === "low-temperature") {
    return <Thermometer {...iconProps} />;
  }
  if (event.type === "test-notification") return <BellRing {...iconProps} />;
  if (event.type === "third-box-offline" || event.type === "third-box-online") {
    return <Power {...iconProps} />;
  }
  if (event.type === "sensor-unplugged") return <CircleOff {...iconProps} />;
  if (event.type === "sensor-fault") return <AlertTriangle {...iconProps} />;
  if (event.type === "sensor-reconnected") return <Check {...iconProps} />;
  return <Info {...iconProps} />;
}

export function ActivityFeed({
  events,
  unit,
  isLoading,
  onClear,
}: ActivityFeedProps) {
  return (
    <section
      id="activity"
      aria-labelledby="activity-title"
      className="rounded-lg border border-slate-200 bg-white p-5"
    >
      <div className="flex items-center justify-between gap-4">
        <h2 id="activity-title" className="font-semibold text-slate-950">Activity</h2>
        {events.length > 0 && !isLoading && (
          <button
            type="button"
            onClick={onClear}
            className="rounded-lg px-2 py-1 text-xs font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
          >
            Clear
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="mt-5 space-y-4" aria-label="Activity loading">
          {[0, 1, 2, 3].map((item) => (
            <div key={item} className="flex animate-pulse gap-3">
              <div className="h-9 w-9 shrink-0 rounded-full bg-slate-200" />
              <div className="flex-1">
                <div className="h-4 w-3/4 rounded bg-slate-200" />
                <div className="mt-2 h-3 w-1/2 rounded bg-slate-100" />
              </div>
            </div>
          ))}
        </div>
      ) : events.length === 0 ? (
        <div className="mt-4 flex min-h-48 flex-col items-center justify-center rounded-md border border-dashed border-slate-300 bg-slate-50 px-5 text-center">
          <Check size={28} className="text-emerald-600" aria-hidden="true" />
          <h3 className="mt-2 text-sm font-medium text-slate-700">No events</h3>
        </div>
      ) : (
        <ol className="mt-3 max-h-[410px] divide-y divide-slate-100 overflow-y-auto">
          {events.slice(0, 12).map((event) => (
            <li key={event.id} className="flex gap-3 py-3">
              <span
                className={clsx(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-md",
                  severityStyles[event.severity],
                )}
              >
                <EventIcon event={event} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-semibold text-slate-800">
                    {event.sensorId === "system"
                      ? "Third box"
                      : event.sensorId === "sensor-1"
                        ? "Sensor 1"
                        : "Sensor 2"}
                  </p>
                  <time
                    className="shrink-0 text-xs text-slate-400"
                    dateTime={new Date(event.timestamp).toISOString()}
                  >
                    {formatClockTime(event.timestamp)}
                  </time>
                </div>
                <p className="mt-0.5 text-sm leading-5 text-slate-600">{event.message}</p>
                {event.temperatureC !== undefined && (
                  <p className="mt-1 text-xs font-semibold text-slate-500">
                    {formatTemperature(event.temperatureC, unit)}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
