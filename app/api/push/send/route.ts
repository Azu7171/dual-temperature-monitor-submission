import {
  allowPushRequest,
  claimPushDedupeKey,
} from "@/lib/push-storage";
import type { PushMessage } from "@/lib/push-types";
import { sendPushToRegisteredDevices } from "@/lib/web-push-server";

export const runtime = "nodejs";

function requestIdentifier(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}

function isSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

function parseMessage(value: unknown): PushMessage | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<PushMessage>;
  if (
    typeof candidate.title !== "string" ||
    !candidate.title.trim() ||
    candidate.title.length > 80 ||
    typeof candidate.body !== "string" ||
    !candidate.body.trim() ||
    candidate.body.length > 300
  ) {
    return null;
  }

  const url = candidate.url ?? "/";
  if (!url.startsWith("/") || url.startsWith("//") || url.length > 300) return null;
  if (candidate.tag && candidate.tag.length > 100) return null;
  if (candidate.dedupeKey && !/^[a-zA-Z0-9:_-]{1,100}$/.test(candidate.dedupeKey)) {
    return null;
  }

  return {
    title: candidate.title.trim(),
    body: candidate.body.trim(),
    url,
    tag: candidate.tag,
    dedupeKey: candidate.dedupeKey,
  };
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return Response.json({ error: "Invalid request origin." }, { status: 403 });
  }

  try {
    if (!(await allowPushRequest(requestIdentifier(request)))) {
      return Response.json({ error: "Too many notification requests." }, { status: 429 });
    }

    const message = parseMessage(await request.json());
    if (!message) {
      return Response.json({ error: "Invalid notification." }, { status: 400 });
    }

    if (message.dedupeKey && !(await claimPushDedupeKey(message.dedupeKey))) {
      return Response.json({
        subscriptionCount: 0,
        sentCount: 0,
        failedCount: 0,
        staleCount: 0,
        deduplicated: true,
      });
    }

    return Response.json(await sendPushToRegisteredDevices(message));
  } catch (error) {
    console.error("Could not send Web Push notification", error);
    return Response.json(
      { error: "Notification delivery is unavailable." },
      { status: 500 },
    );
  }
}
