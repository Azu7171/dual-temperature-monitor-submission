"use client";

import type {
  BrowserPushSubscription,
  PushClientSummary,
  PushMessage,
  PushSendResult,
} from "@/lib/push-types";

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  return Uint8Array.from(rawData, (character) => character.charCodeAt(0));
}

async function readJson<T>(response: Response): Promise<T> {
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || "Notification request failed.");
  return body;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string) {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function getRegistration(timeoutMs = 10_000) {
  const startError = "Notification service could not start. Close and reopen the dashboard, then try again.";
  const registration = await withTimeout(
    navigator.serviceWorker.getRegistration("/").then(
      (existing) => existing ?? navigator.serviceWorker.register("/sw.js", { scope: "/" }),
    ),
    timeoutMs,
    startError,
  );

  if (registration.active) return registration;

  const worker = registration.installing ?? registration.waiting;
  if (worker) {
    await withTimeout(
      new Promise<void>((resolve, reject) => {
        const handleStateChange = () => {
          if (worker.state === "activated") {
            worker.removeEventListener("statechange", handleStateChange);
            resolve();
          } else if (worker.state === "redundant") {
            worker.removeEventListener("statechange", handleStateChange);
            reject(new Error(startError));
          }
        };

        worker.addEventListener("statechange", handleStateChange);
        handleStateChange();
      }),
      timeoutMs,
      "Notification service is still starting. Close and reopen the dashboard, then try again.",
    );
  }

  const readyRegistration = await withTimeout(
    navigator.serviceWorker.ready,
    timeoutMs,
    "Notification service is not ready. Close and reopen the dashboard, then try again.",
  );
  if (!readyRegistration.active) throw new Error(startError);
  return readyRegistration;
}

function serializeSubscription(subscription: PushSubscription) {
  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    throw new Error("The browser returned an invalid notification subscription.");
  }
  return {
    endpoint: json.endpoint,
    keys: {
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
    },
  } satisfies BrowserPushSubscription;
}

async function saveSubscription(subscription: PushSubscription) {
  return readJson<{ registeredDeviceCount: number }>(
    await fetch("/api/push/subscriptions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subscription: serializeSubscription(subscription),
        deviceName: navigator.userAgent,
      }),
    }),
  );
}

export async function getRegisteredDeviceCount() {
  const result = await readJson<{ registeredDeviceCount: number }>(
    await fetch("/api/push/subscriptions", { cache: "no-store" }),
  );
  return result.registeredDeviceCount;
}

export async function inspectPushRegistration(): Promise<PushClientSummary> {
  let registeredDeviceCount = 0;
  try {
    registeredDeviceCount = await getRegisteredDeviceCount();
  } catch {
    return {
      status: "error",
      registeredDeviceCount: 0,
      error: "Notification storage is unavailable.",
    };
  }

  if (
    !("serviceWorker" in navigator) ||
    !("PushManager" in window) ||
    !("Notification" in window)
  ) {
    return { status: "unsupported", registeredDeviceCount };
  }
  if (Notification.permission === "denied") {
    return { status: "blocked", registeredDeviceCount };
  }
  if (Notification.permission !== "granted") {
    return { status: "not-enabled", registeredDeviceCount };
  }

  try {
    const registration = await getRegistration();
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return { status: "not-enabled", registeredDeviceCount };
    const saved = await saveSubscription(subscription);
    return { status: "ready", registeredDeviceCount: saved.registeredDeviceCount };
  } catch (error) {
    return {
      status: "error",
      registeredDeviceCount,
      error: error instanceof Error ? error.message : "Could not check notifications.",
    };
  }
}

export async function enablePushOnThisDevice(): Promise<PushClientSummary> {
  if (
    !("serviceWorker" in navigator) ||
    !("PushManager" in window) ||
    !("Notification" in window)
  ) {
    return { status: "unsupported", registeredDeviceCount: 0 };
  }

  const publicKey = process.env.NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY;
  if (!publicKey) throw new Error("Web Push is not configured.");

  const permission = await Notification.requestPermission();
  if (permission === "denied") {
    return {
      status: "blocked",
      registeredDeviceCount: await getRegisteredDeviceCount(),
    };
  }
  if (permission !== "granted") {
    return {
      status: "not-enabled",
      registeredDeviceCount: await getRegisteredDeviceCount(),
    };
  }

  const registration = await getRegistration();
  let subscription = await registration.pushManager.getSubscription();
  subscription ??= await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });
  const saved = await saveSubscription(subscription);
  return { status: "ready", registeredDeviceCount: saved.registeredDeviceCount };
}

export async function sendPushMessage(message: PushMessage) {
  return readJson<PushSendResult>(
    await fetch("/api/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message),
    }),
  );
}
