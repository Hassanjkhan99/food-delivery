// Out-of-app notification pipeline (#13). The in-app inbox (notificationService) is
// the source of truth; this layer fans the same message out to real delivery channels
// (web push / email / WhatsApp / SMS). Every channel is off unless its env flag is on
// AND its credentials are present, so the default (and pre-launch) state is a no-op.

export type NotifyMessage = {
  title: string;
  body: string;
  // Absolute deep link (channels can't use relative hrefs). Optional.
  url?: string | null;
  kind: "transactional" | "promo";
};

export type PushSub = {
  endpoint: string;
  // { p256dh, auth } — the browser's PushSubscription keys, stored as JSON.
  keys: { p256dh: string; auth: string };
};

export type NotifyRecipient = {
  userId: string;
  phone: string | null;
  email: string | null;
  pushSubscriptions: PushSub[];
};

export interface NotificationChannel {
  readonly name: string;
  /** True only when this channel is both flagged on and fully configured. */
  isActive(): boolean;
  /** Best-effort delivery. Throws on hard failure; the dispatcher isolates it. */
  send(recipient: NotifyRecipient, message: NotifyMessage): Promise<void>;
}
