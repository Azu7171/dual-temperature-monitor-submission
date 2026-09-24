import { getAdminDatabase } from "@/lib/firebase-admin";
import {
  createFirebaseReading,
  hasValidDeviceKey,
  MAX_READING_BODY_BYTES,
  parseDeviceReading,
} from "@/lib/readings";

export const runtime = "nodejs";

function json(body: object, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request) {
  if (!hasValidDeviceKey(request.headers.get("x-device-key"))) {
    return json({ error: "Invalid device credentials." }, 401);
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    return json({ error: "Content-Type must be application/json." }, 415);
  }

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_READING_BODY_BYTES) {
    return json({ error: "Reading payload is too large." }, 413);
  }

  let body: unknown;
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > MAX_READING_BODY_BYTES) {
      return json({ error: "Reading payload is too large." }, 413);
    }
    body = JSON.parse(raw);
  } catch {
    return json({ error: "Reading payload must be valid JSON." }, 400);
  }

  const reading = parseDeviceReading(body);
  if (!reading) {
    return json({ error: "Reading payload is invalid." }, 400);
  }

  try {
    const timestamp = Date.now();
    const { current, sample, sampleId, sampleTimestamp } = createFirebaseReading(
      reading,
      timestamp,
    );
    await getAdminDatabase().ref("devices/third-box").update({
      current,
      [`samples/${sampleId}`]: sample,
    });
    return json({ accepted: true, timestamp, sampleTimestamp });
  } catch (error) {
    console.error("Could not store device reading", error);
    return json({ error: "Reading storage is unavailable." }, 503);
  }
}

// The ESP32 polls on its background network task. Acknowledgements are sent
// only after the main display loop has applied the requested state.
export async function PUT(request: Request) {
  if (!hasValidDeviceKey(request.headers.get("x-device-key"))) {
    return json({ error: "Invalid device credentials." }, 401);
  }

  let ack = 0;
  let shown = false;
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > 128) {
      return json({ error: "Control payload is too large." }, 413);
    }
    const body = JSON.parse(raw) as Record<string, unknown>;
    if (
      !body ||
      typeof body.ack !== "number" ||
      !Number.isSafeInteger(body.ack) ||
      body.ack < 0 ||
      typeof body.shown !== "boolean"
    ) {
      return json({ error: "Control payload is invalid." }, 400);
    }
    ack = body.ack;
    shown = body.shown;
  } catch {
    return json({ error: "Control payload must be valid JSON." }, 400);
  }

  try {
    const control = getAdminDatabase().ref("devices/third-box/control");
    if (ack > 0) {
      await control.child("ack").set({ id: ack, shown, timestamp: Date.now() });
    }
    const snapshot = await control.child("command").get();
    const command = snapshot.val() as {
      id?: unknown;
      sensor?: unknown;
      shown?: unknown;
      timestamp?: unknown;
    } | null;
    const recent =
      command &&
      typeof command.timestamp === "number" &&
      Date.now() - command.timestamp < 10_000;
    const valid =
      recent &&
      typeof command.id === "number" &&
      Number.isSafeInteger(command.id) &&
      (command.sensor === 1 || command.sensor === 2) &&
      typeof command.shown === "boolean";

    return new Response(
      valid
        ? `${command.id} ${command.sensor} ${command.shown ? 1 : 0}\n`
        : "0 0 0\n",
      {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    console.error("Could not deliver display command", error);
    return json({ error: "Control channel is unavailable." }, 503);
  }
}
