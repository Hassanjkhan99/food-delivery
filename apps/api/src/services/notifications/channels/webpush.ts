// Web Push (VAPID) channel — free, works with the PWA service worker. Active when
// NOTIFY_WEBPUSH=on and a VAPID keypair is configured. Stale subscriptions (404/410)
// are pruned so we don't keep pushing to dead endpoints.
import { prisma } from "@fd/db";
import webpush from "web-push";
import { env } from "../../../env.js";
import { logger } from "../../../logger.js";
import type { NotificationChannel } from "../types.js";

let configured = false;
function ensureConfigured(): boolean {
  const { publicKey, privateKey, subject } = env.vapid;
  if (!publicKey || !privateKey) return false;
  if (!configured) {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    configured = true;
  }
  return true;
}

export const webPushChannel: NotificationChannel = {
  name: "webpush",

  isActive() {
    return env.notify.webpush && Boolean(env.vapid.publicKey && env.vapid.privateKey);
  },

  async send(recipient, message) {
    if (!ensureConfigured() || recipient.pushSubscriptions.length === 0) return;
    const payload = JSON.stringify({
      title: message.title,
      body: message.body,
      url: message.url ?? "/",
    });

    await Promise.all(
      recipient.pushSubscriptions.map(async (sub) => {
        try {
          await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, payload);
        } catch (err) {
          const statusCode = (err as { statusCode?: number }).statusCode;
          if (statusCode === 404 || statusCode === 410) {
            // Subscription is gone — drop it so it stops costing us on every send.
            await prisma.pushSubscription
              .deleteMany({ where: { endpoint: sub.endpoint } })
              .catch(() => {});
          } else {
            logger.warn({ err, userId: recipient.userId }, "web push send failed");
          }
        }
      }),
    );
  },
};
