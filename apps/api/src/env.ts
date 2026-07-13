// Load the single root .env before anything else reads process.env.
// The api process runs with cwd = apps/api (turbo runs package scripts in the package dir).
import { config } from "dotenv";
import { resolve } from "node:path";

config({ path: resolve(process.cwd(), "../../.env"), quiet: true });

export const env = {
  get apiPort(): number {
    // PORT is what most persistent hosts (Render/Railway/Fly) inject; honour it so the
    // standalone API binds correctly there, falling back to API_PORT then the dev default.
    return Number(process.env.API_PORT ?? process.env.PORT ?? 4000);
  },
  get webOrigin(): string {
    return process.env.WEB_ORIGIN ?? "http://localhost:3000";
  },
  get sessionSecret(): string {
    const s = process.env.SESSION_SECRET;
    if (!s) throw new Error("SESSION_SECRET is not set");
    return s;
  },
  // ── Session cookie scope (needed to split the API onto its own origin) ────
  // When the API and web app live on sibling subdomains of a shared parent
  // (e.g. api. + app.heraldeats.com), set this to the bare parent "heraldeats.com"
  // so the ONE session cookie is readable by both the API and the web edge proxy.
  // Unset = host-only cookie (collapsed same-origin deploy + localhost).
  get sessionCookieDomain(): string | null {
    const d = process.env.SESSION_COOKIE_DOMAIN;
    if (!d) return null;
    // A bare Domain (RFC 6265) already covers all subdomains; the cookie library rejects a
    // leading dot, so strip it defensively — "heraldeats.com" and ".heraldeats.com" both work.
    return d.replace(/^\./, "");
  },
  // "lax" (default, correct for same-origin and shared-parent-subdomain setups),
  // or "none" for a genuinely cross-site split (forces Secure; note browsers block
  // such third-party cookies, so a shared parent domain is strongly preferred).
  get sessionCookieSameSite(): "lax" | "none" | "strict" {
    const v = process.env.SESSION_COOKIE_SAMESITE;
    return v === "none" || v === "strict" ? v : "lax";
  },
  get storageDir(): string {
    return process.env.STORAGE_DIR ?? "./.storage";
  },
  // Origin the object-store PUT/GET URLs are built against. Empty string = same-origin
  // relative URLs, which is what the collapsed web deploy wants (uploads are served by
  // the web app's own /api/uploads + /files routes). The standalone API sets this to its
  // own absolute origin (e.g. http://localhost:4000) so cross-origin dev keeps working.
  get objectStoreBaseUrl(): string {
    return process.env.OBJECT_STORE_BASE_URL ?? "";
  },
  // Optional. When absent, the Google Places photo tier is skipped and the image
  // pipeline degrades to the typography fallback (dev/CI stay green without a key).
  get googlePlacesApiKey(): string | null {
    return process.env.GOOGLE_PLACES_API_KEY ?? null;
  },
  get isProduction(): boolean {
    return process.env.NODE_ENV === "production";
  },

  // ── Realtime scale-out (#11/#26) ──────────────────────────────────────────
  // When set (e.g. rediss://…@upstash), the GraphQL pubsub fans events out through
  // Redis so SSE works across multiple API instances / serverless invocations.
  // Absent = in-memory pubsub (single-instance dev + the collapsed Vercel deploy).
  get redisUrl(): string | null {
    return process.env.REDIS_URL || null;
  },

  // ── Object storage (#142) ─────────────────────────────────────────────────
  // "local" (default) = disk served by this API; "r2" = Cloudflare R2 / any
  // S3-compatible bucket (persistent, production). Selected in storage/store.ts.
  get storageDriver(): "local" | "r2" {
    return process.env.STORAGE_DRIVER === "r2" ? "r2" : "local";
  },
  get r2(): {
    endpoint: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
    publicBaseUrl: string;
  } {
    return {
      endpoint: process.env.R2_ENDPOINT ?? "",
      bucket: process.env.R2_BUCKET ?? "",
      accessKeyId: process.env.R2_ACCESS_KEY_ID ?? "",
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? "",
      // Public read URL base (R2 custom domain or r2.dev). Objects are read here,
      // never proxied through the API.
      publicBaseUrl: process.env.R2_PUBLIC_BASE_URL ?? "",
    };
  },

  // ── Out-of-app notifications (#13) ────────────────────────────────────────
  // Every channel is off by default so nothing costs money or fires until launch.
  // A channel is only *active* when its flag is on AND its credentials are present
  // (enforced per-channel), so flipping a flag without keys is a safe no-op.
  get notify(): {
    webpush: boolean;
    email: boolean;
    whatsapp: boolean;
    sms: boolean;
  } {
    const on = (v: string | undefined) => v === "on" || v === "true" || v === "1";
    return {
      webpush: on(process.env.NOTIFY_WEBPUSH),
      email: on(process.env.NOTIFY_EMAIL),
      whatsapp: on(process.env.NOTIFY_WHATSAPP),
      sms: on(process.env.NOTIFY_SMS),
    };
  },
  get vapid(): { publicKey: string; privateKey: string; subject: string } {
    return {
      publicKey: process.env.VAPID_PUBLIC_KEY ?? "",
      privateKey: process.env.VAPID_PRIVATE_KEY ?? "",
      // mailto: or https: contact required by the web-push spec.
      subject: process.env.VAPID_SUBJECT ?? "mailto:ops@heraldeats.app",
    };
  },
  get resend(): { apiKey: string; from: string } {
    return {
      apiKey: process.env.RESEND_API_KEY ?? "",
      from: process.env.EMAIL_FROM ?? "Herald Eats <orders@heraldeats.app>",
    };
  },
  get whatsappCloud(): { token: string; phoneNumberId: string } {
    return {
      token: process.env.WHATSAPP_TOKEN ?? "",
      phoneNumberId: process.env.WHATSAPP_PHONE_ID ?? "",
    };
  },
  get twilio(): { accountSid: string; authToken: string; from: string } {
    return {
      accountSid: process.env.TWILIO_ACCOUNT_SID ?? "",
      authToken: process.env.TWILIO_AUTH_TOKEN ?? "",
      from: process.env.TWILIO_FROM ?? "",
    };
  },
  // Absolute origin used to build deep links in outbound messages (email/SMS/WA
  // can't use relative hrefs). Falls back to the web origin.
  get publicWebUrl(): string {
    return process.env.PUBLIC_WEB_URL ?? process.env.WEB_ORIGIN ?? "http://localhost:3000";
  },
};
