// Ephemeral Postgres for E2E/CI: boots an embedded PG cluster (headless, no
// Docker), applies migrations, and seeds the deterministic demo world. Leaves
// the cluster running until killed so the CI job can start the dev servers and
// run Playwright against it.
//
// Reuses the repo's proven pg helpers (scripts/pg.mjs). Unlike `pnpm db`, this
// uses a throwaway data dir so runs never collide with a developer's .pgdata.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import {
  startCluster,
  bootstrapRoleAndDb,
  APP_DB,
  APP_USER,
  APP_PASSWORD,
  PORT,
} from "../../scripts/pg.mjs";

const DATA_DIR = mkdtempSync(join(tmpdir(), "fd-e2e-pg-"));
const DATABASE_URL = `postgresql://${APP_USER}:${APP_PASSWORD}@localhost:${PORT}/${APP_DB}`;

const cluster = await startCluster({
  port: PORT,
  dataDir: DATA_DIR,
  persistent: false,
  quiet: true,
});
await bootstrapRoleAndDb({ port: PORT });

const env = { ...process.env, DATABASE_URL };
const run = (cmd, args) =>
  execFileSync(cmd, args, { stdio: "inherit", env, cwd: join(import.meta.dirname, "../..") });

console.log("[e2e-db] applying migrations...");
run("pnpm", ["--filter", "@fd/db", "exec", "prisma", "migrate", "deploy"]);

console.log("[e2e-db] seeding demo world...");
run("pnpm", ["--filter", "@fd/db", "exec", "tsx", "prisma/seed.ts"]);

console.log(`\n[e2e-db] ready — DATABASE_URL=${DATABASE_URL}\n`);

// Keep the cluster alive for the duration of the CI job.
const shutdown = async () => {
  try {
    await cluster.stop();
  } catch {}
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
setInterval(() => {}, 1 << 30);
