import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Internal workspace packages ship TS source; Next transpiles them.
  transpilePackages: ["@fd/shared"],
};

export default nextConfig;
