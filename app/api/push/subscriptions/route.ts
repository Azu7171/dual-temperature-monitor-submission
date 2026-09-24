import {
  allowPushRequest,
  countPushSubscriptions,
  removePushSubscription,
  savePushSubscription,
} from "@/lib/push-storage";
import type { BrowserPushSubscription } from "@/lib/push-types";

export const runtime = "nodejs";

function requestIdentifier(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}

function isSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

function parseSubscription(value: unknown): BrowserPushSubscription | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<BrowserPushSubscription>;
  if (
    typeof candidate.endpoint !== "string" ||
    !candidate.endpoint.startsWith("https://") ||
    candidate.endpoint.length > 2_000 ||
    typeof candidate.keys?.p256dh !== "string" ||
    typeof candidate.keys?.auth !== "string" ||
    candidate.keys.p256dh.length > 500 ||
    candidate.keys.auth.length > 500
  ) {
    return null;
  }
  return candidate as BrowserPushSubscription;
}

export async function GET() {
  try {
    return Response.json({ registeredDeviceCount: await countPushSubscriptions() });
  } catch (error) {
    console.error("Could not read push subscriptions", error);
    return Response.json(
      { error: "Notification storage is unavailable." },
      { status: 503 },
    );
  }
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return Response.json({ error: "Invalid request origin." }, { status: 403 });
  }

  try {
    if (!(await allowPushRequest(requestIdentifier(request)))) {
      return Response.json({ error: "Too many requests." }, { status: 429 });
    }

    const body = (await request.json()) as {
      subscription?: unknown;
      deviceName?: unknown;
    };
    const subscription = parseSubscription(body.subscription);
    if (!subscription) {
      return Response.json({ error: "Invalid push subscription." }, { status: 400 });
    }

    const deviceName =
      typeof body.deviceName === "string" ? body.deviceName : "Registered device";
    const registeredDeviceCount = await savePushSubscription(subscription, deviceName);
    return Response.json({ registeredDeviceCount });
  } catch (error) {
    console.error("Could not save push subscription", error);
    return Response.json(
      { error: "Could not register this device." },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request) {
  if (!isSameOrigin(request)) {
    return Response.json({ error: "Invalid request origin." }, { status: 403 });
  }

  try {
    const body = (await request.json()) as { endpoint?: unknown };
    if (typeof body.endpoint !== "string" || body.endpoint.length > 2_000) {
      return Response.json({ error: "Invalid endpoint." }, { status: 400 });
    }
    const registeredDeviceCount = await removePushSubscription(body.endpoint);
    return Response.json({ registeredDeviceCount });
  } catch (error) {
    console.error("Could not remove push subscription", error);
    return Response.json({ error: "Could not remove this device." }, { status: 500 });
  }
}
