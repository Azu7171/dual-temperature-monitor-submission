import "server-only";

import webpush, { type WebPushError } from "web-push";

import {
  listPushSubscriptions,
  removePushSubscriptions,
} from "@/lib/push-storage";
import type { PushMessage, PushSendResult } from "@/lib/push-types";

function configureWebPush() {
  const publicKey = process.env.NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY;
  const privateKey = process.env.WEB_PUSH_PRIVATE_KEY;
  const subject = process.env.WEB_PUSH_SUBJECT;

  if (!publicKey || !privateKey || !subject) {
    throw new Error("Web Push is not configured.");
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
}

export async function sendPushToRegisteredDevices(
  message: PushMessage,
): Promise<PushSendResult> {
  configureWebPush();
  const subscriptions = await listPushSubscriptions();
  const staleIds: string[] = [];
  let sentCount = 0;
  let failedCount = 0;

  await Promise.all(
    subscriptions.map(async ({ id, subscription }) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: subscription.keys,
          },
          JSON.stringify(message),
          { timeout: 7_000, TTL: 60 },
        );
        sentCount += 1;
      } catch (error) {
        const statusCode = (error as Partial<WebPushError>)?.statusCode;
        if (statusCode === 404 || statusCode === 410) {
          staleIds.push(id);
        } else {
          failedCount += 1;
          console.error("Web Push delivery failed", error);
        }
      }
    }),
  );

  await removePushSubscriptions(staleIds);

  return {
    subscriptionCount: subscriptions.length,
    sentCount,
    failedCount,
    staleCount: staleIds.length,
  };
}
