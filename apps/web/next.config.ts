import type { NextConfig } from "next";
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";

// Single .env at the repo root feeds every process (api, db scripts, web).
loadEnv({ path: resolve(__dirname, "../../.env"), quiet: true });

const nextConfig: NextConfig = {
  // Allow an isolated build/output dir via env, so a parallel preview server can build
  // without colliding with a running `next dev` that holds the default ".next". Default ".next".
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  // Internal workspace packages ship TS source; Next transpiles them. @fd/api + @fd/db are
  // bundled into the server route handlers (the GraphQL/uploads/cron endpoints).
  transpilePackages: ["@fd/shared", "@fd/api", "@fd/db"],
  // @prisma/* + pg are Node-only and ship their own runtime files; leave them external so
  // the bundler doesn't try to pull the driver/engine into the serverless bundle.
  serverExternalPackages: ["@prisma/client", "@prisma/adapter-pg", "pg"],
  images: {
    // Image pipeline (#50). Uploaded assets are served same-origin by the /files route now
    // (relative URLs → local images, no allowlist needed). The localhost:4000 pattern stays
    // for standalone-API dev. Google Places photos resolve to a keyless googleusercontent
    // URL — rendered `unoptimized` so Next never caches their bytes (Google ToS).
    remotePatterns: [
      { protocol: "http", hostname: "localhost", port: "4000", pathname: "/files/**" },
      { protocol: "https", hostname: "**.googleusercontent.com" },
    ],
  },
  turbopack: {
    // Monorepo root (otherwise Next infers a wrong root from stray lockfiles above the repo).
    root: resolve(__dirname, "../.."),
    // @fd/api and @fd/db import sibling modules with explicit ".js" specifiers (NodeNext
    // style) that actually point at ".ts"/generated sources. Teach the resolver to try the
    // TS extensions when a ".js" file doesn't exist.
    resolveExtensions: [".ts", ".tsx", ".mts", ".js", ".jsx", ".mjs", ".json"],
  },
  // Same mapping for the webpack path used by `next build`.
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js", ".jsx"],
      ".mjs": [".mts", ".mjs"],
    };
    return config;
  },
};

export default nextConfig;
