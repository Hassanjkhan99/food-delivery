// Shared embedded-postgres helpers for local dev (no Docker, no admin rights).
// Adapted from the sibling `compliance` project's proven setup.
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import { existsSync } from "node:fs";

export const APP_DB = "fooddelivery";
export const APP_USER = "fd";
export const APP_PASSWORD = "fd";
export const PORT = 5455; // distinct from compliance's 5432 so both dev DBs can run

export function createEmbeddedPg({ port, dataDir, persistent = true, quiet = true }) {
  return new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "postgres",
    password: "postgres",
    port,
    persistent,
    onLog: quiet ? () => {} : (m) => console.log("[pg]", String(m).trim()),
    onError: (e) => {
      const s = typeof e === "string" ? e.trim() : e;
      if (s) console.error("[pg stderr]", s);
    },
  });
}

export async function startCluster({ port, dataDir, persistent = true, quiet = true }) {
  const cluster = createEmbeddedPg({ port, dataDir, persistent, quiet });
  if (!existsSync(`${dataDir}/PG_VERSION`)) {
    await cluster.initialise();
  }
  await cluster.start();
  return cluster;
}

/** Idempotently ensure the app role + database (owned by it) exist. Runs as superuser. */
export async function bootstrapRoleAndDb({ port }) {
  const admin = new pg.Client({
    host: "localhost",
    port,
    user: "postgres",
    password: "postgres",
    database: "postgres",
  });
  await admin.connect();
  try {
    const role = await admin.query("select 1 from pg_roles where rolname = $1", [APP_USER]);
    if (role.rowCount === 0) {
      // CREATEDB is dev-only: `prisma migrate dev` needs a shadow database.
      await admin.query(
        `CREATE ROLE ${APP_USER} LOGIN PASSWORD '${APP_PASSWORD}' NOSUPERUSER CREATEDB NOCREATEROLE`,
      );
    }
    await admin.query(`ALTER ROLE ${APP_USER} CREATEDB`);
    const db = await admin.query("select 1 from pg_database where datname = $1", [APP_DB]);
    if (db.rowCount === 0) {
      await admin.query(`CREATE DATABASE ${APP_DB} OWNER ${APP_USER}`);
    }
  } finally {
    await admin.end();
  }

  const appdb = new pg.Client({
    host: "localhost",
    port,
    user: "postgres",
    password: "postgres",
    database: APP_DB,
  });
  await appdb.connect();
  try {
    await appdb.query(`ALTER SCHEMA public OWNER TO ${APP_USER}`);
    await appdb.query(`GRANT ALL ON SCHEMA public TO ${APP_USER}`);
    await appdb.query(`GRANT ALL ON DATABASE ${APP_DB} TO ${APP_USER}`);
  } finally {
    await appdb.end();
  }
}
