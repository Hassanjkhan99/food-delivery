// Local dev database: a persistent embedded PostgreSQL cluster on :5455.
// Run in a dedicated terminal: `pnpm db` (leave it running while you develop).
// Data persists in ./.pgdata. Ctrl-C stops the cluster cleanly.
import { startCluster, bootstrapRoleAndDb, APP_DB, APP_USER, PORT } from "./pg.mjs";

const DATA_DIR = "./.pgdata";

const cluster = await startCluster({
  port: PORT,
  dataDir: DATA_DIR,
  persistent: true,
  quiet: true,
});
await bootstrapRoleAndDb({ port: PORT });

console.log(`\n  Food Delivery dev Postgres is up`);
console.log(`  port:     ${PORT}`);
console.log(`  database: ${APP_DB} (owner: ${APP_USER})`);
console.log(`  app URL:  postgresql://${APP_USER}:${APP_USER}@localhost:${PORT}/${APP_DB}`);
console.log(`\n  Leave this running. Ctrl-C to stop.\n`);

let stopping = false;
const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  console.log("\nstopping dev Postgres...");
  try {
    await cluster.stop();
  } catch {}
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

setInterval(() => {}, 1 << 30);
