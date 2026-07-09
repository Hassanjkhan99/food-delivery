// Prisma 7 config: the connection URL lives here (not in schema.prisma).
// dotenv-cli already injects DATABASE_URL for package scripts; the fallback path
// covers running prisma directly from packages/db.
import { config } from "dotenv";
import { resolve } from "node:path";
import { defineConfig } from "prisma/config";

if (!process.env.DATABASE_URL) {
  config({ path: resolve(import.meta.dirname, "../../.env"), quiet: true });
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
