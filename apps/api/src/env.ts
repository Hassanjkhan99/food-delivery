// Load the single root .env before anything else reads process.env.
// The api process runs with cwd = apps/api (turbo runs package scripts in the package dir).
import { config } from "dotenv";
import { resolve } from "node:path";

config({ path: resolve(process.cwd(), "../../.env"), quiet: true });

export const env = {
  get apiPort(): number {
    return Number(process.env.API_PORT ?? 4000);
  },
  get webOrigin(): string {
    return process.env.WEB_ORIGIN ?? "http://localhost:3000";
  },
  get sessionSecret(): string {
    const s = process.env.SESSION_SECRET;
    if (!s) throw new Error("SESSION_SECRET is not set");
    return s;
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
};
