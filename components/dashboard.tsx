"use client";

import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import {
  CircleAlert,
  CloudOff,
  FlaskConical,
  Radio,
  Settings,
  Wifi,
} from "lucide-react";
import clsx from "clsx";

import { ActivityFeed } from "@/components/activity-feed";
import { AlertsDrawer } from "@/components/alerts-drawer";
import { DemoControls } from "@/components/demo-controls";
import { SensorCard } from "@/components/sensor-card";
import { TemperatureChart } from "@/components/temperature-chart";
import {
  createInitialAlertSettings,
  createInitialEvents,
  createInitialSensors,
  createInitialSystem,
  createMockHistory,
} from "@/lib/mock-data";
import {
  subscribeToLiveMonitor,
  type LiveMonitorData,
} from "@/lib/firebase-live";
import {
  enablePushOnThisDevice,
  inspectPushRegistration,
  sendPushMessage,
} from "@/lib/push-client";
import { formatClockTime, getTemperatureState } from "@/lib/temperature";
import type { PushClientSummary } from "@/lib/push-types";
import type {
  AlertSettings,
  MonitorEvent,
  PreviewMode,
  Sensor,
  SensorConnectionStatus,
  SystemConnection,
  SystemPower,
  SystemStatus,
  TemperatureSample,
  TemperatureUnit,
} from "@/lib/types";

interface DashboardProps {
  initialTimestamp: number;
}

interface MonitorState {
  system: SystemStatus;
  sensors: Sensor[];
  samples: TemperatureSample[];
  settings: AlertSettings[];
  events: MonitorEvent[];
}

type AlertZone = "normal" | "high" | "low";

const initialAlertZones: Record<Sensor["id"], AlertZone> = {
  "sensor-1": "normal",
  "sensor-2": "normal",
};

function getAlertZone(
  temperatureC: number,
  settings: AlertSettings,
  previous: AlertZone,
): AlertZone {
  const hysteresisC = 0.5;
  if (previous === "high" && temperatureC > settings.maximumC - hysteresisC) {
    return "high";
  }
  if (previous === "low" && temperatureC < settings.minimumC + hysteresisC) {
    return "low";
  }
  if (temperatureC > settings.maximumC) return "high";
  if (temperatureC < settings.minimumC) return "low";
  return "normal";
}

type MonitorAction =
  | { type: "tick"; timestamp: number }
  | { type: "enter-demo"; timestamp: number }
  | {
      type: "replace-live-data";
      data: LiveMonitorData;
      receivedAt: number;
    }
  | { type: "mark-live-stale"; timestamp: number }
  | { type: "set-power"; power: SystemPower; timestamp: number }
  | {
      type: "set-connection";
      connection: SystemConnection;
      timestamp: number;
    }
  | {
      type: "set-sensor-status";
      sensorId: Sensor["id"];
      status: SensorConnectionStatus;
      timestamp: number;
    }
  | {
      type: "toggle-box-display";
      sensorId: Sensor["id"];
      timestamp: number;
    }
  | {
      type: "set-box-display";
      sensorId: Sensor["id"];
      shown: boolean;
      timestamp: number;
    }
  | {
      type: "set-temperature";
      sensorId: Sensor["id"];
      temperatureC: number;
      timestamp: number;
    }
  | { type: "save-settings"; settings: AlertSettings[] }
  | { type: "push-event"; event: MonitorEvent }
  | { type: "insert-missing"; timestamp: number }
  | { type: "normalize"; timestamp: number }
  | { type: "clear-events" }
  | { type: "reset"; timestamp: number };

function createMonitorState(timestamp: number): MonitorState {
  return {
    system: createInitialSystem(timestamp),
    sensors: createInitialSensors(timestamp),
    samples: createMockHistory(timestamp),
    settings: createInitialAlertSettings(),
    events: createInitialEvents(timestamp),
  };
}

function appendMissingSamples(
  samples: TemperatureSample[],
  timestamp: number,
): TemperatureSample[] {
  if (samples.length === 0) return samples;
  const newestSecond = Math.floor(timestamp / 1_000);
  const lastSecond = Math.floor((samples.at(-1)?.timestamp ?? timestamp) / 1_000);
  if (lastSecond >= newestSecond) return samples;

  const additions: TemperatureSample[] = [];
  const firstSecond = Math.max(lastSecond + 1, newestSecond - 299);
  for (let second = firstSecond; second <= newestSecond; second += 1) {
    additions.push({
      timestamp: second * 1_000,
      sensor1C: null,
      sensor2C: null,
      sensor1State: "missing",
      sensor2State: "missing",
    });
  }
  return [...samples, ...additions].slice(-300);
}

function withEvent(state: MonitorState, event: MonitorEvent): MonitorState {
  return { ...state, events: [event, ...state.events].slice(0, 50) };
}

function createEvent(
  state: MonitorState,
  timestamp: number,
  event: Omit<MonitorEvent, "id" | "timestamp">,
): MonitorEvent {
  return {
    ...event,
    timestamp,
    id: `${event.type}-${event.sensorId}-${timestamp}-${state.events.length}`,
  };
}

function monitorReducer(state: MonitorState, action: MonitorAction): MonitorState {
  switch (action.type) {
    case "replace-live-data": {
      const { current, samples } = action.data;
      if (!current) {
        return {
          ...state,
          system: { power: "off", connection: "offline", lastUpdated: 0 },
          sensors: state.sensors.map((sensor) => ({
            ...sensor,
            connectionStatus: "unplugged",
            lastUpdated: 0,
          })),
          samples,
          events: [],
        };
      }

      const fresh = action.receivedAt - current.timestamp <= 10_000;
      const liveValues = [
        {
          temperatureC: current.sensor1C,
          connectionStatus: current.sensor1State,
          boxDisplayEnabled: current.sensor1DisplayEnabled,
        },
        {
          temperatureC: current.sensor2C,
          connectionStatus: current.sensor2State,
          boxDisplayEnabled: current.sensor2DisplayEnabled,
        },
      ];

      return {
        ...state,
        system: {
          power: fresh ? current.power : "off",
          connection: fresh ? current.connection : "offline",
          lastUpdated: current.timestamp,
        },
        sensors: state.sensors.map((sensor, index) => ({
          ...sensor,
          temperatureC: liveValues[index].temperatureC ?? sensor.temperatureC,
          connectionStatus: liveValues[index].connectionStatus,
          boxDisplayEnabled: liveValues[index].boxDisplayEnabled,
          lastUpdated: current.timestamp,
        })),
        samples,
        events: [],
      };
    }
    case "mark-live-stale":
      if (
        state.system.lastUpdated === 0 ||
        action.timestamp - state.system.lastUpdated <= 10_000
      ) {
        return state;
      }
      return {
        ...state,
        system: { ...state.system, power: "off", connection: "offline" },
        samples: appendMissingSamples(state.samples, action.timestamp),
      };
    case "enter-demo": {
      // Live data has usually overwritten samples by now, so give the demo a
      // full 300-second history to draw. Alert settings and the event log are
      // the user's own, so they carry over untouched.
      return {
        ...state,
        system: createInitialSystem(action.timestamp),
        sensors: createInitialSensors(action.timestamp),
        samples: createMockHistory(action.timestamp),
      };
    }
    case "tick": {
      const available =
        state.system.power === "on" && state.system.connection === "online";
      const sensors = state.sensors.map((sensor, index) => {
        if (!available || sensor.connectionStatus !== "connected") return sensor;
        const drift = Math.sin(action.timestamp / 7_500 + index * 1.7) * 0.035;
        return {
          ...sensor,
          temperatureC: Math.max(-10, Math.min(63, sensor.temperatureC + drift)),
          lastUpdated: action.timestamp,
        };
      });
      const sensor1 = sensors[0];
      const sensor2 = sensors[1];
      const sensor1C =
        available && sensor1.connectionStatus === "connected"
          ? sensor1.temperatureC
          : null;
      const sensor2C =
        available && sensor2.connectionStatus === "connected"
          ? sensor2.temperatureC
          : null;
      const sample: TemperatureSample = {
        timestamp: action.timestamp,
        sensor1C,
        sensor2C,
        sensor1State: getTemperatureState(sensor1C),
        sensor2State: getTemperatureState(sensor2C),
        sensor1DisplayEnabled: sensor1.boxDisplayEnabled,
        sensor2DisplayEnabled: sensor2.boxDisplayEnabled,
      };

      return {
        ...state,
        system: available
          ? { ...state.system, lastUpdated: action.timestamp }
          : state.system,
        sensors,
        samples: [...state.samples, sample].slice(-300),
      };
    }
    case "set-power": {
      if (action.power === state.system.power) return state;
      const next = {
        ...state,
        system: { ...state.system, power: action.power },
      };
      return withEvent(
        next,
        createEvent(next, action.timestamp, {
          sensorId: "system",
          type: action.power === "on" ? "third-box-online" : "third-box-offline",
          message:
            action.power === "on"
              ? "Third box powered on; waiting for current data"
              : "Third box powered off; data is unavailable",
          severity: action.power === "on" ? "success" : "warning",
        }),
      );
    }
    case "set-connection": {
      if (action.connection === state.system.connection) return state;
      const next = {
        ...state,
        system: { ...state.system, connection: action.connection },
      };
      return withEvent(
        next,
        createEvent(next, action.timestamp, {
          sensorId: "system",
          type:
            action.connection === "online"
              ? "third-box-online"
              : "third-box-offline",
          message:
            action.connection === "online"
              ? "Network link restored"
              : "Network link interrupted",
          severity: action.connection === "online" ? "success" : "warning",
        }),
      );
    }
    case "set-sensor-status": {
      const previous = state.sensors.find((sensor) => sensor.id === action.sensorId);
      if (!previous || previous.connectionStatus === action.status) return state;
      const sensors = state.sensors.map((sensor) =>
        sensor.id === action.sensorId
          ? { ...sensor, connectionStatus: action.status, lastUpdated: action.timestamp }
          : sensor,
      );
      const next = { ...state, sensors };
      const sensorName = previous.name;
      const eventDetails =
        action.status === "connected"
          ? {
              type: "sensor-reconnected" as const,
              message: `${sensorName} reconnected and resumed sampling`,
              severity: "success" as const,
            }
          : action.status === "fault"
            ? {
                type: "sensor-fault" as const,
                message: `${sensorName} reported a simulated fault`,
                severity: "critical" as const,
              }
            : {
                type: "sensor-unplugged" as const,
                message: `${sensorName} was unplugged`,
                severity: "warning" as const,
              };
      return withEvent(
        next,
        createEvent(next, action.timestamp, {
          sensorId: action.sensorId,
          ...eventDetails,
        }),
      );
    }
    case "toggle-box-display": {
      const current = state.sensors.find((sensor) => sensor.id === action.sensorId);
      if (!current) return state;
      const nextEnabled = !current.boxDisplayEnabled;
      const sensors = state.sensors.map((sensor) =>
        sensor.id === action.sensorId
          ? { ...sensor, boxDisplayEnabled: nextEnabled }
          : sensor,
      );
      const next = { ...state, sensors };
      return withEvent(
        next,
        createEvent(next, action.timestamp, {
          sensorId: action.sensorId,
          type: "display-toggled",
          message: `Remote box display turned ${nextEnabled ? "on" : "off"}`,
          severity: "info",
        }),
      );
    }
    case "set-box-display": {
      const sensors = state.sensors.map((sensor) =>
        sensor.id === action.sensorId
          ? { ...sensor, boxDisplayEnabled: action.shown }
          : sensor,
      );
      const next = { ...state, sensors };
      return withEvent(
        next,
        createEvent(next, action.timestamp, {
          sensorId: action.sensorId,
          type: "display-toggled",
          message: `Website turned box display ${action.shown ? "on" : "off"}`,
          severity: "info",
        }),
      );
    }
    case "set-temperature":
      return {
        ...state,
        sensors: state.sensors.map((sensor) =>
          sensor.id === action.sensorId
            ? {
                ...sensor,
                temperatureC: Math.max(-10, Math.min(63, action.temperatureC)),
                lastUpdated: action.timestamp,
              }
            : sensor,
        ),
      };
    case "save-settings":
      return {
        ...state,
        settings: action.settings,
        sensors: state.sensors.map((sensor) => {
          const updated = action.settings.find((item) => item.sensorId === sensor.id);
          return updated
            ? {
                ...sensor,
                minimumThresholdC: updated.minimumC,
                maximumThresholdC: updated.maximumC,
              }
            : sensor;
        }),
      };
    case "push-event":
      return withEvent(state, action.event);
    case "insert-missing":
      return {
        ...state,
        samples: state.samples.map((sample, index, allSamples) =>
          index >= allSamples.length - 12
            ? {
                ...sample,
                sensor1C: null,
                sensor2C: null,
                sensor1State: "missing",
                sensor2State: "missing",
              }
            : sample,
        ),
      };
    case "normalize":
      return {
        ...state,
        system: { ...state.system, power: "on", connection: "online" },
        sensors: state.sensors.map((sensor, index) => ({
          ...sensor,
          temperatureC: index === 0 ? 22.4 : 23.1,
          connectionStatus: "connected",
          lastUpdated: action.timestamp,
        })),
      };
    case "clear-events":
      return { ...state, events: [] };
    case "reset":
      return createMonitorState(action.timestamp);
  }
}

function SystemStatusBadge({ system }: { system: SystemStatus }) {
  const noData = system.power === "off";
  const offline = !noData && system.connection === "offline";
  const label = noData ? "No Data" : offline ? "Offline" : "Online";
  const Icon = noData ? CircleAlert : offline ? CloudOff : Wifi;

  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 text-sm font-medium",
        noData
          ? "text-slate-600"
          : offline
            ? "text-amber-700"
            : "text-emerald-700",
      )}
    >
      <Icon size={15} aria-hidden="true" />
      {label}
    </span>
  );
}

export function Dashboard({ initialTimestamp }: DashboardProps) {
  const [state, dispatch] = useReducer(
    monitorReducer,
    initialTimestamp,
    createMonitorState,
  );
  const [unit, setUnit] = useState<TemperatureUnit>("C");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [syncingSensor, setSyncingSensor] = useState<Sensor["id"] | null>(null);
  const [previewMode, setPreviewMode] = useState<PreviewMode>("normal");
  const [toast, setToast] = useState<string | null>(null);
  const [pushSummary, setPushSummary] = useState<PushClientSummary>({
    status: "checking",
    registeredDeviceCount: 0,
  });
  const [pushBusy, setPushBusy] = useState(false);
  const [liveStatus, setLiveStatus] = useState<
    "connecting" | "waiting" | "live" | "error"
  >("connecting");
  const [demoMode, setDemoMode] = useState(false);
  const [demoPush, setDemoPush] = useState(false);
  const demoModeRef = useRef(false);
  const demoAutoEnabled = useRef(false);
  const latestLive = useRef<LiveMonitorData | null>(null);
  const syncTimer = useRef<number | null>(null);
  const toastTimer = useRef<number | null>(null);
  const alertZones = useRef<Record<Sensor["id"], AlertZone>>({
    ...initialAlertZones,
  });

  useEffect(() => {
    demoModeRef.current = demoMode;
  }, [demoMode]);

  useEffect(() => {
    try {
      return subscribeToLiveMonitor(
        (data) => {
          latestLive.current = data;
          setLiveStatus(data.current ? "live" : "waiting");

          // Demo mode owns the dashboard state while it is on. Applying live
          // readings here would overwrite every demo control on the next tick.
          if (demoModeRef.current) return;

          // No hardware reporting yet: turn the demo on once so the controls
          // are there by default, without ever overriding a later user choice.
          if (!data.current && !demoAutoEnabled.current) {
            demoAutoEnabled.current = true;
            setDemoMode(true);
            return;
          }

          dispatch({
            type: "replace-live-data",
            data,
            receivedAt: Date.now(),
          });
        },
        (error) => {
          console.error("Firebase live-data subscription failed", error);
          setLiveStatus("error");
          if (!demoAutoEnabled.current) {
            demoAutoEnabled.current = true;
            setDemoMode(true);
          }
        },
      );
    } catch (error) {
      console.error("Firebase live-data setup failed", error);
      setLiveStatus("error");
      if (!demoAutoEnabled.current) {
        demoAutoEnabled.current = true;
        setDemoMode(true);
      }
      return undefined;
    }
  }, []);

  useEffect(() => {
    if (demoMode) return;
    const interval = window.setInterval(() => {
      dispatch({ type: "mark-live-stale", timestamp: Date.now() });
    }, 1_000);
    return () => window.clearInterval(interval);
  }, [demoMode]);

  // Nothing feeds the chart while live data is paused, so the demo drives its
  // own one-second sample clock.
  useEffect(() => {
    if (!demoMode) return;
    const interval = window.setInterval(() => {
      dispatch({ type: "tick", timestamp: Date.now() });
    }, 1_000);
    return () => window.clearInterval(interval);
  }, [demoMode]);

  useEffect(
    () => () => {
      if (syncTimer.current !== null) window.clearTimeout(syncTimer.current);
      if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    },
    [],
  );

  useEffect(() => {
    let active = true;
    inspectPushRegistration()
      .then((summary) => {
        if (active) setPushSummary(summary);
      })
      .catch((error) => {
        if (!active) return;
        setPushSummary({
          status: "error",
          registeredDeviceCount: 0,
          error: error instanceof Error ? error.message : "Could not check notifications.",
        });
      });
    return () => {
      active = false;
    };
  }, []);

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3_200);
  }, []);

  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  const systemAvailable =
    state.system.power === "on" && state.system.connection === "online";
  const isLoading = previewMode === "loading" || liveStatus === "connecting";
  const visibleSamples = previewMode === "empty" ? [] : state.samples;
  const visibleEvents = previewMode === "empty" ? [] : state.events;
  const dataLabel = demoMode
    ? "Demo mode - live paused"
    : liveStatus === "connecting"
        ? "Connecting to Firebase"
        : liveStatus === "error"
          ? "Firebase unavailable"
          : liveStatus === "waiting" || !systemAvailable
            ? "Waiting for ESP32"
            : "Live data";

  const deliverThresholdAlert = useCallback(
    async (
      sensor: Sensor,
      settings: AlertSettings,
      direction: "high" | "low",
    ) => {
      const timestamp = Date.now();
      const configuredMessage =
        direction === "high" ? settings.highMessage : settings.lowMessage;
      const reading = `${sensor.temperatureC.toFixed(1)} °C`;

      // A demo alert reaches real devices only when the demo's own
      // notification opt-in is on. Otherwise record it in the activity feed
      // so the flow stays visible, and stop before the push request.
      if (demoMode && !demoPush) {
        const deliveryMessage = "Demo alert - no push sent.";
        dispatch({
          type: "push-event",
          event: {
            id: `${direction}-temperature-${sensor.id}-${timestamp}`,
            timestamp,
            sensorId: sensor.id,
            type: direction === "high" ? "high-temperature" : "low-temperature",
            message: `${configuredMessage} ${deliveryMessage}`,
            temperatureC: sensor.temperatureC,
            severity: "critical",
          },
        });
        showToast(deliveryMessage);
        return;
      }

      try {
        const result = await sendPushMessage({
          title: `${sensor.name} ${direction === "high" ? "high" : "low"} temperature`,
          body: `${configuredMessage} Current reading: ${reading}`,
          url: "/#activity",
          tag: `${sensor.id}-${direction}`,
          dedupeKey: `${sensor.id}:${direction}`,
        });
        if (result.deduplicated) return;

        setPushSummary((current) => ({
          ...current,
          registeredDeviceCount: Math.max(
            0,
            result.subscriptionCount - result.staleCount,
          ),
        }));
        const deliveryMessage =
          result.sentCount > 0
            ? `Push sent to ${result.sentCount} device${result.sentCount === 1 ? "" : "s"}.`
            : result.subscriptionCount === 0
              ? "No notification device is registered."
              : "Push delivery failed.";
        dispatch({
          type: "push-event",
          event: {
            id: `${direction}-temperature-${sensor.id}-${timestamp}`,
            timestamp,
            sensorId: sensor.id,
            type: direction === "high" ? "high-temperature" : "low-temperature",
            message: `${configuredMessage} ${deliveryMessage}`,
            temperatureC: sensor.temperatureC,
            severity: "critical",
          },
        });
        showToast(deliveryMessage);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Push delivery failed.";
        dispatch({
          type: "push-event",
          event: {
            id: `${direction}-temperature-${sensor.id}-${timestamp}`,
            timestamp,
            sensorId: sensor.id,
            type: direction === "high" ? "high-temperature" : "low-temperature",
            message: `${configuredMessage} ${message}`,
            temperatureC: sensor.temperatureC,
            severity: "critical",
          },
        });
        showToast(message);
      }
    },
    [demoMode, demoPush, showToast],
  );

  useEffect(() => {
    if (!systemAvailable) {
      alertZones.current = { ...initialAlertZones };
      return;
    }

    state.sensors.forEach((sensor) => {
      const settings = state.settings.find((item) => item.sensorId === sensor.id);
      if (!settings?.enabled || sensor.connectionStatus !== "connected") {
        alertZones.current[sensor.id] = "normal";
        return;
      }

      const previous = alertZones.current[sensor.id];
      const next = getAlertZone(sensor.temperatureC, settings, previous);
      alertZones.current[sensor.id] = next;
      if (next !== "normal" && next !== previous) {
        void deliverThresholdAlert(sensor, settings, next);
      }
    });
  }, [deliverThresholdAlert, state.sensors, state.settings, systemAvailable]);

  async function toggleBoxDisplay(sensorId: Sensor["id"]) {
    if (syncingSensor) return;
    const sensor = state.sensors.find((item) => item.id === sensorId);
    if (!sensor) return;
    const shown = !sensor.boxDisplayEnabled;
    setSyncingSensor(sensorId);
    if (demoMode || liveStatus !== "live") {
      if (syncTimer.current !== null) window.clearTimeout(syncTimer.current);
      syncTimer.current = window.setTimeout(() => {
        dispatch({ type: "toggle-box-display", sensorId, timestamp: Date.now() });
        setSyncingSensor(null);
        showToast("Demo box display state updated.");
      }, 480);
      return;
    }

    try {
      const response = await fetch("/api/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sensor: sensorId === "sensor-1" ? 1 : 2, shown }),
      });
      const queued = await response.json() as { id?: number; error?: string };
      if (!response.ok || !queued.id) {
        throw new Error(queued.error ?? "Could not send the display command.");
      }

      let applied = false;
      for (let attempt = 0; attempt < 20; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 250));
        const statusResponse = await fetch(`/api/control?id=${queued.id}`, {
          cache: "no-store",
        });
        if (!statusResponse.ok) continue;
        const status = await statusResponse.json() as {
          applied?: boolean;
          shown?: boolean;
        };
        if (status.applied && status.shown === shown) {
          applied = true;
          break;
        }
      }
      if (!applied) {
        throw new Error("The box did not confirm the display change. Check its Wi-Fi connection.");
      }

      dispatch({ type: "set-box-display", sensorId, shown, timestamp: Date.now() });
      showToast(`${sensor.name} box display turned ${shown ? "on" : "off"}.`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Display command failed.");
    } finally {
      setSyncingSensor(null);
    }
  }

  function setPower(power: SystemPower) {
    dispatch({ type: "set-power", power, timestamp: Date.now() });
    setPreviewMode("normal");
  }

  function setConnection(connection: SystemConnection) {
    dispatch({ type: "set-connection", connection, timestamp: Date.now() });
    setPreviewMode("normal");
  }

  function setSensorStatus(sensorId: Sensor["id"], status: SensorConnectionStatus) {
    dispatch({
      type: "set-sensor-status",
      sensorId,
      status,
      timestamp: Date.now(),
    });
    setPreviewMode("normal");
  }

  function triggerExtreme(sensorId: Sensor["id"], direction: "high" | "low") {
    const settings = state.settings.find((item) => item.sensorId === sensorId);
    const sensor = state.sensors.find((item) => item.id === sensorId);
    if (!settings || !sensor) return;
    const timestamp = Date.now();
    const temperatureC =
      direction === "high" ? settings.maximumC + 4.5 : settings.minimumC - 4.5;
    dispatch({
      type: "set-sensor-status",
      sensorId,
      status: "connected",
      timestamp,
    });
    dispatch({ type: "set-temperature", sensorId, temperatureC, timestamp });
    setPreviewMode("normal");
    showToast(`${direction === "high" ? "High" : "Low"} condition triggered.`);
  }

  function saveSettings(settings: AlertSettings[]) {
    dispatch({ type: "save-settings", settings });
    showToast("Alert settings saved.");
  }

  async function enablePush() {
    setPushBusy(true);
    setPushSummary((current) => ({
      ...current,
      status: "checking",
      error: undefined,
    }));
    try {
      const summary = await enablePushOnThisDevice();
      setPushSummary(summary);
      showToast(
        summary.status === "ready"
          ? "This device is registered for notifications."
          : "Notifications were not enabled.",
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not register this device.";
      setPushSummary((current) => ({ ...current, status: "error", error: message }));
      showToast(message);
    } finally {
      setPushBusy(false);
    }
  }

  async function testAlert(settings: AlertSettings) {
    const sensor = state.sensors.find((item) => item.id === settings.sensorId);
    if (!sensor) return;
    const timestamp = Date.now();
    setPushBusy(true);
    try {
      const result = await sendPushMessage({
        title: `${sensor.name} test notification`,
        body: `${settings.highMessage} Current reading: ${sensor.temperatureC.toFixed(1)} °C`,
        url: "/#activity",
        tag: `test-${sensor.id}`,
        dedupeKey: `test:${sensor.id}:${timestamp}`,
      });
      setPushSummary((current) => ({
        ...current,
        registeredDeviceCount: Math.max(
          0,
          result.subscriptionCount - result.staleCount,
        ),
      }));
      const message =
        result.sentCount > 0
          ? `Test notification sent to ${result.sentCount} device${result.sentCount === 1 ? "" : "s"}.`
          : "No registered device received the test notification.";
      dispatch({
        type: "push-event",
        event: {
          id: `test-notification-${settings.sensorId}-${timestamp}`,
          timestamp,
          sensorId: settings.sensorId,
          type: "test-notification",
          message,
          temperatureC: sensor.temperatureC,
          severity: result.sentCount > 0 ? "success" : "warning",
        },
      });
      showToast(message);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Test notification failed.";
      showToast(message);
    } finally {
      setPushBusy(false);
    }
  }

  function toggleDemoMode() {
    const next = !demoMode;
    demoAutoEnabled.current = true;
    setDemoMode(next);
    setPreviewMode("normal");
    // Sending real pushes is always a deliberate, per-session choice.
    setDemoPush(false);

    if (next) {
      dispatch({ type: "enter-demo", timestamp: Date.now() });
      showToast("Demo mode on. Live readings are paused.");
      return;
    }

    const live = latestLive.current;
    if (live) {
      dispatch({ type: "replace-live-data", data: live, receivedAt: Date.now() });
      showToast("Demo mode off. Live readings resumed.");
      return;
    }

    dispatch({ type: "reset", timestamp: Date.now() });
    alertZones.current = { ...initialAlertZones };
    showToast("Demo mode off. Waiting for live readings.");
  }

  function resetDemo() {
    const timestamp = Date.now();
    dispatch({ type: "reset", timestamp });
    alertZones.current = { ...initialAlertZones };
    setPreviewMode("normal");
    setDemoPush(false);
    setUnit("C");
    showToast("Demo restored to its default state.");
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6 lg:px-8">
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold tracking-tight text-slate-950 sm:text-lg">
              Dual Temperature Monitor
            </h1>
            <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
              <SystemStatusBadge system={state.system} />
              <span aria-hidden="true">·</span>
              <span>
                {state.system.lastUpdated > 0
                  ? `Updated ${formatClockTime(state.system.lastUpdated)}`
                  : "No readings received"}
              </span>
              <span aria-hidden="true">·</span>
              <span>{dataLabel}</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div
              className="flex items-center rounded-lg border border-slate-300 bg-white p-0.5"
              aria-label="Temperature unit"
            >
              {(["C", "F"] as const).map((temperatureUnit) => (
                <button
                  key={temperatureUnit}
                  type="button"
                  aria-pressed={unit === temperatureUnit}
                  onClick={() => setUnit(temperatureUnit)}
                  className={clsx(
                    "rounded-md px-3 py-1.5 text-xs font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600",
                    unit === temperatureUnit
                      ? "bg-slate-900 text-white"
                      : "text-slate-500 hover:text-slate-900",
                  )}
                >
                  °{temperatureUnit}
                </button>
              ))}
            </div>
            <button
              type="button"
              aria-pressed={demoMode}
              onClick={toggleDemoMode}
              title={
                demoMode
                  ? "Demo mode is on. Live readings are paused."
                  : "Turn on demo mode to drive the dashboard by hand."
              }
              className={clsx(
                "inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600",
                demoMode
                  ? "border-amber-300 bg-amber-100 text-amber-900 hover:bg-amber-200"
                  : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
              )}
            >
              <FlaskConical size={17} aria-hidden="true" />
              <span className="hidden sm:inline">Demo</span>
              <span
                className={clsx(
                  "rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                  demoMode
                    ? "bg-amber-900 text-amber-50"
                    : "bg-slate-200 text-slate-600",
                )}
              >
                {demoMode ? "On" : "Off"}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
            >
              <Settings size={17} aria-hidden="true" />
              <span className="hidden sm:inline">Settings</span>
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
        <section id="overview" aria-label="Current temperatures">
          {!systemAvailable && (
            <div
              role="status"
              className={clsx(
                "mb-4 flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm",
                state.system.power === "off"
                  ? "border-slate-300 bg-slate-100 text-slate-700"
                  : "border-amber-300 bg-amber-50 text-amber-900",
              )}
            >
              {state.system.power === "off" ? (
                <CircleAlert size={20} className="mt-0.5 shrink-0" aria-hidden="true" />
              ) : (
                <CloudOff size={20} className="mt-0.5 shrink-0" aria-hidden="true" />
              )}
              <p className="font-medium">
                {state.system.power === "off" ? "No data available" : "Third box offline"}
              </p>
            </div>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            {state.sensors.map((sensor, index) => (
              <SensorCard
                key={sensor.id}
                sensor={sensor}
                settings={state.settings[index]}
                unit={unit}
                systemAvailable={systemAvailable}
                boxControlEnabled={demoMode || liveStatus === "live"}
                syncing={syncingSensor === sensor.id}
                isLoading={isLoading}
                onToggleBoxDisplay={toggleBoxDisplay}
              />
            ))}
          </div>
        </section>

        <div className="mt-4">
          <TemperatureChart
            samples={visibleSamples}
            displayEnabled={[
              state.sensors[0].boxDisplayEnabled,
              state.sensors[1].boxDisplayEnabled,
            ]}
            unit={unit}
            isLoading={isLoading}
          />
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <ActivityFeed
            events={visibleEvents}
            unit={unit}
            isLoading={isLoading}
            onClear={() => dispatch({ type: "clear-events" })}
          />
          <div className="space-y-4">
            {demoMode ? (
              <DemoControls
                system={state.system}
                sensors={state.sensors}
                unit={unit}
                previewMode={previewMode}
                onSetPower={setPower}
                onSetConnection={setConnection}
                onSetSensorStatus={setSensorStatus}
                onSetTemperature={(sensorId, temperatureC) =>
                  dispatch({
                    type: "set-temperature",
                    sensorId,
                    temperatureC,
                    timestamp: Date.now(),
                  })
                }
                onNormalize={() => dispatch({ type: "normalize", timestamp: Date.now() })}
                onTriggerExtreme={triggerExtreme}
                onInsertMissing={() => {
                  dispatch({ type: "insert-missing", timestamp: Date.now() });
                  setPreviewMode("normal");
                  showToast("12-second data gap added.");
                }}
                onSetPreviewMode={setPreviewMode}
                demoPush={demoPush}
                onSetDemoPush={(enabled) => {
                  setDemoPush(enabled);
                  showToast(
                    enabled
                      ? "Demo alerts will now push to registered devices."
                      : "Demo alerts are logged on screen only.",
                  );
                }}
                onReset={resetDemo}
              />
            ) : null}
          </div>
        </div>
      </main>

      {settingsOpen ? (
        <AlertsDrawer
          settings={state.settings}
          sensors={state.sensors}
          unit={unit}
          pushSummary={pushSummary}
          pushBusy={pushBusy}
          onClose={closeSettings}
          onSave={saveSettings}
          onTestAlert={testAlert}
          onEnablePush={enablePush}
        />
      ) : null}

      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-5 left-1/2 z-[60] flex w-[calc(100%-2rem)] max-w-md -translate-x-1/2 items-start gap-2 rounded-lg bg-slate-950 px-4 py-3 text-sm font-medium text-white shadow-lg"
        >
          <Radio size={17} className="mt-0.5 shrink-0 text-blue-300" aria-hidden="true" />
          {toast}
        </div>
      )}
    </div>
  );
}
