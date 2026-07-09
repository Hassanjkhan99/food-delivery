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
  // Optional. When absent, the Google Places photo tier is skipped and the image
  // pipeline degrades to the typography fallback (dev/CI stay green without a key).
  get googlePlacesApiKey(): string | null {
    return process.env.GOOGLE_PLACES_API_KEY ?? null;
  },
  get isProduction(): boolean {
    return process.env.NODE_ENV === "production";
  },
};
