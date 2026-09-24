"use client";

import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type DotItemDotProps,
} from "recharts";
import { ChartNoAxesCombined } from "lucide-react";

import {
  convertFromCelsius,
  convertToCelsius,
  getGraphRange,
} from "@/lib/temperature";
import type {
  TemperatureSample,
  TemperatureState,
  TemperatureUnit,
} from "@/lib/types";

interface TemperatureChartProps {
  samples: TemperatureSample[];
  displayEnabled: [boolean, boolean];
  unit: TemperatureUnit;
  isLoading: boolean;
}

interface ChartDatum {
  secondsAgo: number;
  sensor1Plot: number | null;
  sensor2Plot: number | null;
  sensor1Raw: number | null;
  sensor2Raw: number | null;
  sensor1State: TemperatureState;
  sensor2State: TemperatureState;
  sensor1DisplayEnabled: boolean;
  sensor2DisplayEnabled: boolean;
}

interface ShadedRange {
  start: number;
  end: number;
}

interface GraphRange {
  minimum: number;
  maximum: number;
}

type BoundaryDotProps = Omit<DotItemDotProps, "payload"> & { payload: ChartDatum };

function BoundaryDot({
  cx,
  cy,
  payload,
  stateKey,
  color,
}: BoundaryDotProps & {
  stateKey: "sensor1State" | "sensor2State";
  color: string;
}) {
  if (cx === undefined || cy === undefined || !payload) return null;
  const state = payload[stateKey];
  if (state !== "above-range" && state !== "below-range") return null;

  const points =
    state === "above-range"
      ? `${cx},${cy - 7} ${cx - 5},${cy + 2} ${cx + 5},${cy + 2}`
      : `${cx},${cy + 7} ${cx - 5},${cy - 2} ${cx + 5},${cy - 2}`;

  return <polygon points={points} fill={color} stroke="white" strokeWidth={1.5} />;
}

function getShadedRanges(
  data: ChartDatum[],
  includes: (point: ChartDatum) => boolean,
): ShadedRange[] {
  const shadedPoints = data.filter(includes);
  if (shadedPoints.length === 0) return [];

  const ranges: ShadedRange[] = [];
  let start = shadedPoints[0].secondsAgo;
  let previous = start;

  for (const point of shadedPoints.slice(1)) {
    if (Math.abs(previous - point.secondsAgo) > 1.1) {
      ranges.push({ start, end: previous });
      start = point.secondsAgo;
    }
    previous = point.secondsAgo;
  }

  ranges.push({ start, end: previous });
  return ranges;
}

function getAutoRange(
  samples: TemperatureSample[],
  sensor1Enabled: boolean,
  sensor2Enabled: boolean,
  unit: TemperatureUnit,
  fallback: GraphRange,
): GraphRange {
  const values = samples.flatMap((sample) => [
    (sample.sensor1DisplayEnabled ?? sensor1Enabled) ? sample.sensor1C : null,
    (sample.sensor2DisplayEnabled ?? sensor2Enabled) ? sample.sensor2C : null,
  ].filter((value): value is number => value !== null)
    .map((value) => convertFromCelsius(value, unit)));
  if (values.length === 0) return fallback;

  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const minimumSpan = unit === "C" ? 5 : 9;
  const span = Math.max(maximum - minimum, minimumSpan);
  const center = (minimum + maximum) / 2;
  const padding = Math.max(1, span * 0.1);

  return {
    minimum: Math.floor(center - span / 2 - padding),
    maximum: Math.ceil(center + span / 2 + padding),
  };
}

function getPlotState(
  value: number | null,
  range: GraphRange,
): TemperatureState {
  if (value === null) return "missing";
  if (value > range.maximum) return "above-range";
  if (value < range.minimum) return "below-range";
  return "valid";
}

export function TemperatureChart({
  samples,
  displayEnabled,
  unit,
  isLoading,
}: TemperatureChartProps) {
  const [sensor1Enabled, sensor2Enabled] = displayEnabled;
  const [autoScale, setAutoScale] = useState(false);
  const [customRangeC, setCustomRangeC] = useState<GraphRange>(getGraphRange("C"));
  const customRange = useMemo(
    () => ({
      minimum: convertFromCelsius(customRangeC.minimum, unit),
      maximum: convertFromCelsius(customRangeC.maximum, unit),
    }),
    [customRangeC, unit],
  );
  const range = useMemo(
    () => autoScale
      ? getAutoRange(samples, sensor1Enabled, sensor2Enabled, unit, customRange)
      : customRange,
    [autoScale, customRange, samples, sensor1Enabled, sensor2Enabled, unit],
  );
  const data = useMemo<ChartDatum[]>(() => {
    if (samples.length === 0) return [];
    const newestTimestamp = samples.at(-1)?.timestamp ?? Date.now();

    return samples.map((sample) => {
      const secondsAgo = Math.min(
        300,
        Math.max(0, Math.round((newestTimestamp - sample.timestamp) / 1_000)),
      );
      const sensor1DisplayEnabled =
        sample.sensor1DisplayEnabled ?? (sample.sensor1C === null || sensor1Enabled);
      const sensor2DisplayEnabled =
        sample.sensor2DisplayEnabled ?? (sample.sensor2C === null || sensor2Enabled);
      const sensor1Raw =
        !sensor1DisplayEnabled || sample.sensor1C === null
          ? null
          : convertFromCelsius(sample.sensor1C, unit);
      const sensor2Raw =
        !sensor2DisplayEnabled || sample.sensor2C === null
          ? null
          : convertFromCelsius(sample.sensor2C, unit);

      return {
        secondsAgo,
        sensor1Raw,
        sensor2Raw,
        sensor1Plot:
          sensor1Raw === null
            ? null
            : Math.min(range.maximum, Math.max(range.minimum, sensor1Raw)),
        sensor2Plot:
          sensor2Raw === null
            ? null
            : Math.min(range.maximum, Math.max(range.minimum, sensor2Raw)),
        sensor1State: getPlotState(sensor1Raw, range),
        sensor2State: getPlotState(sensor2Raw, range),
        sensor1DisplayEnabled,
        sensor2DisplayEnabled,
      };
    });
  }, [range.maximum, range.minimum, samples, sensor1Enabled, sensor2Enabled, unit]);

  const offRanges = useMemo(() => getShadedRanges(
    data,
    (point) => !point.sensor1DisplayEnabled || !point.sensor2DisplayEnabled,
  ), [data]);
  const missingRanges = useMemo(() => getShadedRanges(
    data,
    (point) =>
      (point.sensor1DisplayEnabled && point.sensor1State === "missing") ||
      (point.sensor2DisplayEnabled && point.sensor2State === "missing"),
  ), [data]);
  const validSensor1 = data.filter((point) => point.sensor1Raw !== null).length;
  const validSensor2 = data.filter((point) => point.sensor2Raw !== null).length;
  const offSensor1 = data.filter((point) => !point.sensor1DisplayEnabled).length;
  const offSensor2 = data.filter((point) => !point.sensor2DisplayEnabled).length;

  function updateBoundary(boundary: "minimum" | "maximum", value: string) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return false;
    const valueC = convertToCelsius(parsed, unit);
    if (boundary === "minimum" && valueC >= customRangeC.maximum) return false;
    if (boundary === "maximum" && valueC <= customRangeC.minimum) return false;
    setCustomRangeC((current) => ({ ...current, [boundary]: valueC }));
    return true;
  }

  if (isLoading) {
    return (
      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="animate-pulse">
          <div className="h-6 w-56 rounded bg-slate-200" />
          <div className="mt-3 h-4 w-72 rounded bg-slate-100" />
          <div className="mt-8 h-80 rounded-xl bg-slate-100" />
        </div>
      </section>
    );
  }

  return (
    <section
      id="history"
      aria-labelledby="history-title"
      className="rounded-lg border border-slate-200 bg-white p-4 sm:p-5"
    >
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div className="flex items-baseline gap-2">
          <h2 id="history-title" className="font-semibold text-slate-950">History</h2>
          <span className="text-xs text-slate-500">Last 5 minutes</span>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs font-medium text-slate-600">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-0.5 w-5 bg-blue-600" /> Sensor 1
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-0.5 w-5 bg-orange-500" /> Sensor 2
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-3 w-4 rounded-sm border border-dashed border-slate-400 bg-slate-100" />
            Missing
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-3 w-4 rounded-sm border border-slate-400 bg-slate-300" />
            Display off
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="text-slate-700">▲▼</span> Off-scale
          </span>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
        <div className="inline-flex rounded-md border border-slate-300 bg-white p-0.5 text-xs font-medium">
          <button
            type="button"
            aria-pressed={!autoScale}
            onClick={() => setAutoScale(false)}
            className={`rounded px-2.5 py-1.5 ${
              !autoScale ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            Manual
          </button>
          <button
            type="button"
            aria-pressed={autoScale}
            onClick={() => setAutoScale(true)}
            className={`rounded px-2.5 py-1.5 ${
              autoScale ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            Auto-fit
          </button>
        </div>
        <label className="text-xs font-medium text-slate-600">
          Minimum (°{unit})
          <input
            key={`minimum-${unit}-${customRange.minimum}`}
            type="number"
            step="1"
            defaultValue={Number(customRange.minimum.toFixed(1))}
            disabled={autoScale}
            onBlur={(event) => {
              if (!updateBoundary("minimum", event.currentTarget.value)) {
                event.currentTarget.value = customRange.minimum.toFixed(1);
              }
            }}
            className="mt-1 block w-24 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
          />
        </label>
        <label className="text-xs font-medium text-slate-600">
          Maximum (°{unit})
          <input
            key={`maximum-${unit}-${customRange.maximum}`}
            type="number"
            step="1"
            defaultValue={Number(customRange.maximum.toFixed(1))}
            disabled={autoScale}
            onBlur={(event) => {
              if (!updateBoundary("maximum", event.currentTarget.value)) {
                event.currentTarget.value = customRange.maximum.toFixed(1);
              }
            }}
            className="mt-1 block w-24 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
          />
        </label>
        <span className="pb-1.5 text-xs text-slate-500">
          Showing {range.minimum}° to {range.maximum}°
        </span>
      </div>

      {data.length === 0 ? (
        <div className="mt-4 flex h-72 flex-col items-center justify-center rounded-md border border-dashed border-slate-300 bg-slate-50 px-6 text-center">
          <ChartNoAxesCombined size={32} className="text-slate-400" aria-hidden="true" />
          <h3 className="mt-3 text-sm font-medium text-slate-700">No history</h3>
        </div>
      ) : (
        <div
          className="mt-3 h-[300px] w-full"
          role="img"
          aria-label={`Temperature chart in degrees ${unit === "C" ? "Celsius" : "Fahrenheit"}. Sensor 1 has ${validSensor1} plotted samples and ${offSensor1} display-off samples. Sensor 2 has ${validSensor2} plotted samples and ${offSensor2} display-off samples in the last 300 seconds.`}
        >
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 14, right: 14, bottom: 12, left: 0 }}>
              <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 5" vertical={false} />
              <XAxis
                dataKey="secondsAgo"
                type="number"
                domain={[0, 300]}
                reversed
                ticks={[300, 240, 180, 120, 60, 0]}
                tick={{ fill: "#64748b", fontSize: 12 }}
                axisLine={{ stroke: "#cbd5e1" }}
                tickLine={false}
                label={{
                  value: "Seconds ago",
                  position: "insideBottom",
                  offset: -8,
                  fill: "#64748b",
                  fontSize: 12,
                }}
              />
              <YAxis
                domain={[range.minimum, range.maximum]}
                allowDataOverflow
                width={52}
                tick={{ fill: "#64748b", fontSize: 12 }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(value: number) => `${value}°`}
              />
              <Tooltip
                labelFormatter={(secondsAgo) => `${secondsAgo} seconds ago`}
                formatter={(value, name) => [
                  `${Number(value).toFixed(1)} °${unit}`,
                  name,
                ]}
                contentStyle={{
                  borderRadius: 8,
                  borderColor: "#cbd5e1",
                  boxShadow: "0 8px 24px rgba(15,23,42,0.08)",
                }}
              />
              <Legend wrapperStyle={{ display: "none" }} />
              {missingRanges.map((missingRange, index) => (
                <ReferenceArea
                  key={`missing-${missingRange.start}-${missingRange.end}-${index}`}
                  x1={Math.min(300, missingRange.start + 0.5)}
                  x2={Math.max(0, missingRange.end - 0.5)}
                  fill="#94a3b8"
                  fillOpacity={0.12}
                  stroke="#94a3b8"
                  strokeDasharray="4 4"
                  ifOverflow="hidden"
                />
              ))}
              {offRanges.map((offRange, index) => (
                <ReferenceArea
                  key={`off-${offRange.start}-${offRange.end}-${index}`}
                  x1={Math.min(300, offRange.start + 0.5)}
                  x2={Math.max(0, offRange.end - 0.5)}
                  fill="#94a3b8"
                  fillOpacity={0.3}
                  stroke="#64748b"
                  ifOverflow="hidden"
                />
              ))}
              <Line
                type="monotone"
                dataKey="sensor1Plot"
                name="Sensor 1"
                stroke="#2563eb"
                strokeWidth={2.25}
                connectNulls={false}
                isAnimationActive={false}
                activeDot={{ r: 4, fill: "#2563eb", stroke: "white", strokeWidth: 2 }}
                dot={(props: DotItemDotProps) => (
                  <BoundaryDot
                    {...(props as BoundaryDotProps)}
                    stateKey="sensor1State"
                    color="#2563eb"
                  />
                )}
              />
              <Line
                type="monotone"
                dataKey="sensor2Plot"
                name="Sensor 2"
                stroke="#f97316"
                strokeWidth={2.25}
                connectNulls={false}
                isAnimationActive={false}
                activeDot={{ r: 4, fill: "#f97316", stroke: "white", strokeWidth: 2 }}
                dot={(props: DotItemDotProps) => (
                  <BoundaryDot
                    {...(props as BoundaryDotProps)}
                    stateKey="sensor2State"
                    color="#f97316"
                  />
                )}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

    </section>
  );
}
