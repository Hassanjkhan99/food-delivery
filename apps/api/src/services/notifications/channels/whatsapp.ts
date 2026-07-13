// WhatsApp channel via Meta's Cloud API. Active when NOTIFY_WHATSAPP=on and a token +
// phone-number id are configured. Highest reach in the PK market, but note: outside a
// 24h customer-service window Meta only delivers *approved template* messages. This
// sends a plain text body, which works inside the service window and in test mode; at
// launch, register templates and switch the `text` payload for a `template` one.
import { env } from "../../../env.js";
import { logger } from "../../../logger.js";
import type { NotificationChannel } from "../types.js";

// Normalise a stored PK number to E.164 digits (no +). Local "03xx…" → "923xx…".
function toWaNumber(phone: string): string {
  const digits = phone.replace(/[^\d]/g, "");
  if (digits.startsWith("0")) return `92${digits.slice(1)}`;
  return digits;
}

export const whatsappChannel: NotificationChannel = {
  name: "whatsapp",

  isActive() {
    return (
      env.notify.whatsapp && Boolean(env.whatsappCloud.token && env.whatsappCloud.phoneNumberId)
    );
  },

  async send(recipient, message) {
    if (!recipient.phone) return;
    const body = message.url ? `${message.body}\n${message.url}` : message.body;
    const res = await fetch(
      `https://graph.facebook.com/v21.0/${env.whatsappCloud.phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${env.whatsappCloud.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: toWaNumber(recipient.phone),
          type: "text",
          text: { body: `*${message.title}*\n${body}` },
        }),
      },
    );
    if (!res.ok) {
      logger.warn({ userId: recipient.userId, status: res.status }, "whatsapp send failed");
    }
  },
};
