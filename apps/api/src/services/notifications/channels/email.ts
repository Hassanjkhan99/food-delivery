// Email channel via Resend's REST API (no SDK dependency — just fetch). Active when
// NOTIFY_EMAIL=on and RESEND_API_KEY is set; skipped per-recipient when they have no
// email on file. Resend's free tier covers pre-launch volumes.
import { env } from "../../../env.js";
import { logger } from "../../../logger.js";
import type { NotificationChannel } from "../types.js";

export const emailChannel: NotificationChannel = {
  name: "email",

  isActive() {
    return env.notify.email && Boolean(env.resend.apiKey);
  },

  async send(recipient, message) {
    if (!recipient.email) return;
    const link = message.url ? `<p><a href="${message.url}">Open in Herald Eats</a></p>` : "";
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.resend.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: env.resend.from,
        to: [recipient.email],
        subject: message.title,
        html: `<h2>${message.title}</h2><p>${message.body}</p>${link}`,
      }),
    });
    if (!res.ok) {
      logger.warn({ userId: recipient.userId, status: res.status }, "resend email send failed");
    }
  },
};
