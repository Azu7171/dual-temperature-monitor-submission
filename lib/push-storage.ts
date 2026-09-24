import "server-only";

import { createHash } from "node:crypto";
import { Redis } from "@upstash/redis";

import type { BrowserPushSubscription } from "@/lib/push-types";

const SUBSCRIPTION_KEY = "dual-temperature-monitor:push-subscriptions";
const RATE_LIMIT_PREFIX = "dual-temperature-monitor:push-rate";
const DEDUPE_PREFIX = "dual-temperature-monitor:push-dedupe";

export interface StoredPushSubscription extends BrowserPushSubscription {
  deviceName: string;
  registeredAt: string;
}

let redisClient: Redis | null = null;

function getRedis() {
  if (redisClient) return redisClient;

  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    throw new Error("Push subscription storage is not configured.");
  }

  redisClient = new Redis({ url, token });
  return redisClient;
}

function subscriptionId(endpoint: string) {
  return createHash("sha256").update(endpoint).digest("hex");
}

function parseStoredSubscription(value: unknown): StoredPushSubscription | null {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    if (!parsed || typeof parsed !== "object") return null;
    const record = parsed as Partial<StoredPushSubscription>;
    if (
      typeof record.endpoint !== "string" ||
      typeof record.keys?.p256dh !== "string" ||
      typeof record.keys?.auth !== "string"
    ) {
      return null;
    }
    return {
      endpoint: record.endpoint,
      keys: record.keys,
      deviceName: record.deviceName ?? "Registered device",
      registeredAt: record.registeredAt ?? new Date(0).toISOString(),
    };
  } catch {
    return null;
  }
}

export async function savePushSubscription(
  subscription: BrowserPushSubscription,
  deviceName: string,
) {
  const record: StoredPushSubscription = {
    ...subscription,
    deviceName: deviceName.slice(0, 120) || "Registered device",
    registeredAt: new Date().toISOString(),
  };
  await getRedis().hset(SUBSCRIPTION_KEY, {
    [subscriptionId(subscription.endpoint)]: JSON.stringify(record),
  });
  return countPushSubscriptions();
}

export async function removePushSubscription(endpoint: string) {
  await getRedis().hdel(SUBSCRIPTION_KEY, subscriptionId(endpoint));
  return countPushSubscriptions();
}

export async function removePushSubscriptions(ids: string[]) {
  if (ids.length === 0) return;
  await getRedis().hdel(SUBSCRIPTION_KEY, ...ids);
}

export async function listPushSubscriptions() {
  const rows = await getRedis().hgetall<Record<string, unknown>>(SUBSCRIPTION_KEY);
  if (!rows) return [];

  return Object.entries(rows).flatMap(([id, value]) => {
    const subscription = parseStoredSubscription(value);
    return subscription ? [{ id, subscription }] : [];
  });
}

export async function countPushSubscriptions() {
  return getRedis().hlen(SUBSCRIPTION_KEY);
}

export async function allowPushRequest(identifier: string) {
  const minute = Math.floor(Date.now() / 60_000);
  const key = `${RATE_LIMIT_PREFIX}:${identifier}:${minute}`;
  const count = await getRedis().incr(key);
  if (count === 1) await getRedis().expire(key, 70);
  return count <= 30;
}

export async function claimPushDedupeKey(key: string) {
  const claimed = await getRedis().set(`${DEDUPE_PREFIX}:${key}`, "1", {
    nx: true,
    ex: 30,
  });
  return claimed === "OK";
}
