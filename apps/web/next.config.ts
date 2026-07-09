import type { NextConfig } from "next";
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";

// Single .env at the repo root feeds every process (api, db scripts, web).
loadEnv({ path: resolve(__dirname, "../../.env"), quiet: true });

const nextConfig: NextConfig = {
  // Internal workspace packages ship TS source; Next transpiles them.
  transpilePackages: ["@fd/shared"],
  images: {
    // Image pipeline (#50). Uploaded assets are served by the API's /files route
    // (S3/CDN in prod, see #15). Google Places photos resolve to a keyless
    // googleusercontent URL — rendered `unoptimized` so Next never caches their
    // bytes (Google ToS), but the host still needs allowlisting.
    remotePatterns: [
      { protocol: "http", hostname: "localhost", port: "4000", pathname: "/files/**" },
      { protocol: "https", hostname: "**.googleusercontent.com" },
    ],
  },
  turbopack: {
    // Monorepo root (otherwise Next infers a wrong root from stray lockfiles above the repo).
    root: resolve(__dirname, "../.."),
  },
};

export default nextConfig;
