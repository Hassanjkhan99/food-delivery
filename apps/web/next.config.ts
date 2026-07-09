import type { NextConfig } from "next";
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";

// Single .env at the repo root feeds every process (api, db scripts, web).
loadEnv({ path: resolve(__dirname, "../../.env"), quiet: true });

const nextConfig: NextConfig = {
  // Internal workspace packages ship TS source; Next transpiles them.
  transpilePackages: ["@fd/shared"],
};

export default nextConfig;
