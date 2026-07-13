// Web Push (#13) browser glue. Turns a VAPID public key + the registered service
// worker into a PushSubscription and normalises it to the shape our savePushSubscription
// mutation expects. The control that uses this only renders when the public key is set
// (NEXT_PUBLIC_VAPID_PUBLIC_KEY), so pre-launch (no key) it's inert.
//
// Note: the SW only registers in production (see PwaSetup), so push opt-in is a
// production capability — in dev pushSupported() is true but there's no active worker.

export const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

export type BrowserPushSub = { endpoint: string; p256dh: string; auth: string };

export function pushConfigured(): boolean {
  return VAPID_PUBLIC_KEY.length > 0;
}

export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

// VAPID keys are base64url; the Push API wants a Uint8Array application server key.
function urlB64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalized);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function toSub(sub: PushSubscription): BrowserPushSub | null {
  const json = sub.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return null;
  return { endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth };
}

/** Request permission (if needed) and subscribe. Returns the subscription to persist, or null. */
export async function subscribeBrowser(): Promise<BrowserPushSub | null> {
  if (!pushSupported() || !pushConfigured()) return null;
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return null;
  const reg = await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  const sub =
    existing ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      // Cast: our Uint8Array is ArrayBuffer-backed, but the lib's BufferSource type
      // narrows tighter than the generic Uint8Array<ArrayBufferLike> we produce.
      applicationServerKey: urlB64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
    }));
  return toSub(sub);
}

/** Tear down the local subscription. Returns the endpoint that was removed (to unregister server-side). */
export async function unsubscribeBrowser(): Promise<string | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return null;
  const endpoint = sub.endpoint;
  await sub.unsubscribe();
  return endpoint;
}

/** Current subscription endpoint if one already exists, else null. */
export async function currentEndpoint(): Promise<string | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  return sub?.endpoint ?? null;
}
