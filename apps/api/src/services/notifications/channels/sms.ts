// SMS channel via Twilio's REST API (Basic auth + form-encoded body, no SDK). Active
// when NOTIFY_SMS=on and account SID / auth token / from-number are configured. Costs
// per message, so it stays off until launch and is best reserved as a fallback.
import { env } from "../../../env.js";
import { logger } from "../../../logger.js";
import type { NotificationChannel } from "../types.js";

function toE164(phone: string): string {
  const digits = phone.replace(/[^\d]/g, "");
  if (phone.trim().startsWith("+")) return `+${digits}`;
  if (digits.startsWith("0")) return `+92${digits.slice(1)}`;
  return `+${digits}`;
}

export const smsChannel: NotificationChannel = {
  name: "sms",

  isActive() {
    const { accountSid, authToken, from } = env.twilio;
    return env.notify.sms && Boolean(accountSid && authToken && from);
  },

  async send(recipient, message) {
    if (!recipient.phone) return;
    const { accountSid, authToken, from } = env.twilio;
    const text = message.url
      ? `${message.title}: ${message.body} ${message.url}`
      : `${message.title}: ${message.body}`;
    const form = new URLSearchParams({
      To: toE164(recipient.phone),
      From: from,
      Body: text,
    });
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: "POST",
        headers: {
          authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: form.toString(),
      },
    );
    if (!res.ok) {
      logger.warn({ userId: recipient.userId, status: res.status }, "sms send failed");
    }
  },
};
