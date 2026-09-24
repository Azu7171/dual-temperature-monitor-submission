import { getAdminDatabase } from "@/lib/firebase-admin";

export const runtime = "nodejs";

function json(body: object, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

// Temporary public checkoff control. Add user authentication after checkoff.
export async function POST(request: Request) {
  let body: unknown;
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > 128) {
      return json({ error: "Command is too large." }, 413);
    }
    body = JSON.parse(raw);
  } catch {
    return json({ error: "Command must be valid JSON." }, 400);
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ error: "Command is invalid." }, 400);
  }
  const command = body as Record<string, unknown>;
  if (
    (command.sensor !== 1 && command.sensor !== 2) ||
    typeof command.shown !== "boolean"
  ) {
    return json({ error: "Sensor and on/off state are required." }, 400);
  }

  try {
    const database = getAdminDatabase();
    const current = (await database.ref("devices/third-box/current").get()).val() as {
      timestamp?: unknown;
    } | null;
    if (
      !current ||
      typeof current.timestamp !== "number" ||
      Date.now() - current.timestamp > 10_000
    ) {
      return json({ error: "The box is offline. No command was sent." }, 409);
    }

    const commandRef = database.ref("devices/third-box/control/command");
    const result = await commandRef.transaction((previous: unknown) => {
      const prior = previous as { id?: unknown } | null;
      const priorId = typeof prior?.id === "number" ? prior.id : 0;
      return {
        id: Math.max(Date.now(), priorId + 1),
        sensor: command.sensor,
        shown: command.shown,
        timestamp: Date.now(),
      };
    }, undefined, false);
    const created = result.snapshot.val() as { id: number; timestamp: number };
    return json({
      id: created.id,
      queuedAt: created.timestamp,
      sensor: command.sensor,
      shown: command.shown,
    });
  } catch (error) {
    console.error("Could not queue display command", error);
    return json({ error: "Could not send the command to the box." }, 503);
  }
}

export async function GET(request: Request) {
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!Number.isSafeInteger(id) || id <= 0) {
    return json({ error: "A valid command ID is required." }, 400);
  }

  try {
    const snapshot = await getAdminDatabase()
      .ref("devices/third-box/control/ack")
      .get();
    const ack = snapshot.val() as {
      id?: unknown;
      shown?: unknown;
      timestamp?: unknown;
    } | null;
    return json({
      applied: ack?.id === id,
      shown: ack?.id === id ? ack.shown : null,
      appliedAt: ack?.id === id ? ack.timestamp : null,
    });
  } catch (error) {
    console.error("Could not read display acknowledgement", error);
    return json({ error: "Could not check the box response." }, 503);
  }
}
