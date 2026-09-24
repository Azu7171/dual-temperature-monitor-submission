import type { TemperatureState, TemperatureUnit } from "@/lib/types";

export const GRAPH_RANGE_C = { minimum: 10, maximum: 50 } as const;

export function celsiusToFahrenheit(celsius: number): number {
  return (celsius * 9) / 5 + 32;
}

export function fahrenheitToCelsius(fahrenheit: number): number {
  return ((fahrenheit - 32) * 5) / 9;
}

export function convertFromCelsius(
  celsius: number,
  unit: TemperatureUnit,
): number {
  return unit === "C" ? celsius : celsiusToFahrenheit(celsius);
}

export function convertToCelsius(
  value: number,
  unit: TemperatureUnit,
): number {
  return unit === "C" ? value : fahrenheitToCelsius(value);
}

export function formatTemperature(
  celsius: number,
  unit: TemperatureUnit,
  includeUnit = true,
): string {
  const value = convertFromCelsius(celsius, unit);
  return `${value.toFixed(1)}${includeUnit ? ` °${unit}` : ""}`;
}

export function getGraphRange(unit: TemperatureUnit) {
  if (unit === "C") {
    return { minimum: GRAPH_RANGE_C.minimum, maximum: GRAPH_RANGE_C.maximum };
  }

  return {
    minimum: celsiusToFahrenheit(GRAPH_RANGE_C.minimum),
    maximum: celsiusToFahrenheit(GRAPH_RANGE_C.maximum),
  };
}

export function getTemperatureState(
  temperatureC: number | null,
): TemperatureState {
  if (temperatureC === null) return "missing";
  if (temperatureC > GRAPH_RANGE_C.maximum) return "above-range";
  if (temperatureC < GRAPH_RANGE_C.minimum) return "below-range";
  return "valid";
}

export function formatClockTime(timestamp: number): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
    timeZone: "America/Chicago",
  }).format(timestamp);
}
