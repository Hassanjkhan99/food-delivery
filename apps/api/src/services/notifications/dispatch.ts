// Fan-out dispatcher (#13). Given a userId and a message, deliver it through every
// channel that is currently active. Designed so the default/pre-launch state costs
// essentially nothing: if no channel is active we return before touching the DB.
//
// Contract: fully best-effort. Never throws — order-flow callers wrap us anyway, but
// we also isolate each channel so one provider outage can't starve the others.
import { prisma } from "@fd/db";
import { env } from "../../env.js";
import { logger } from "../../logger.js";
import { emailChannel } from "./channels/email.js";
import { smsChannel } from "./channels/sms.js";
import { webPushChannel } from "./channels/webpush.js";
import { whatsappChannel } from "./channels/whatsapp.js";
import type { NotifyMessage, NotifyRecipient, PushSub } from "./types.js";

const CHANNELS = [webPushChannel, emailChannel, whatsappChannel, smsChannel];

/** Which channels are live right now (flag on + configured). Also used by health checks. */
export function activeChannels(): string[] {
  return CHANNELS.filter((c) => c.isActive()).map((c) => c.name);
}

async function loadRecipient(userId: string): Promise<NotifyRecipient | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      phone: true,
      email: true,
      pushSubs: { select: { endpoint: true, keysJson: true } },
    },
  });
  if (!user) return null;
  const pushSubscriptions: PushSub[] = user.pushSubs.flatMap((s) => {
    const keys = s.keysJson as { p256dh?: string; auth?: string } | null;
    if (!keys?.p256dh || !keys?.auth) return [];
    return [{ endpoint: s.endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } }];
  });
  return { userId: user.id, phone: user.phone, email: user.email, pushSubscriptions };
}

// Prefix a relative inbox linkHref with the public web origin so external channels get
// a clickable absolute URL. Leaves already-absolute links untouched.
function absoluteUrl(linkHref: string | null | undefined): string | null {
  if (!linkHref) return null;
  if (/^https?:\/\//.test(linkHref)) return linkHref;
  return `${env.publicWebUrl.replace(/\/$/, "")}${linkHref.startsWith("/") ? "" : "/"}${linkHref}`;
}

export async function dispatchNotification(
  userId: string,
  message: Omit<NotifyMessage, "url"> & { linkHref?: string | null },
): Promise<void> {
  const active = CHANNELS.filter((c) => c.isActive());
  if (active.length === 0) return; // default/free path — nothing enabled, no DB hit.

  try {
    const recipient = await loadRecipient(userId);
    if (!recipient) return;
    const payload: NotifyMessage = {
      title: message.title,
      body: message.body,
      kind: message.kind,
      url: absoluteUrl(message.linkHref),
    };
    const results = await Promise.allSettled(active.map((c) => c.send(recipient, payload)));
    results.forEach((r, i) => {
      if (r.status === "rejected") {
        logger.warn({ err: r.reason, channel: active[i]?.name, userId }, "notify channel threw");
      }
    });
  } catch (err) {
    logger.error({ err, userId }, "dispatchNotification failed (non-fatal)");
  }
}
