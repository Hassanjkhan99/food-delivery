// Prisma client (Prisma 7 + pg driver adapter), lazy-initialized.
// Importing this module is side-effect-free: `next build` imports route modules without a
// DATABASE_URL, so the client/pool are only created on first property access.
// (Pattern proven in the sibling compliance project.)
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client.js";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient; pgPool?: Pool };

let poolInstance: Pool | undefined;
let prismaInstance: PrismaClient | undefined;

function client(): PrismaClient {
  if (prismaInstance) return prismaInstance;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }
  poolInstance = globalForPrisma.pgPool ?? new Pool({ connectionString });
  prismaInstance =
    globalForPrisma.prisma ?? new PrismaClient({ adapter: new PrismaPg(poolInstance) });
  if (process.env.NODE_ENV !== "production") {
    globalForPrisma.prisma = prismaInstance;
    globalForPrisma.pgPool = poolInstance;
  }
  return prismaInstance;
}

export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const c = client() as unknown as Record<string | symbol, unknown>;
    const value = c[prop];
    return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(c) : value;
  },
});

/** Close the Prisma client and the underlying pg pool (tests / graceful shutdown). */
export async function disconnect(): Promise<void> {
  await prismaInstance?.$disconnect().catch(() => {});
  await poolInstance?.end().catch(() => {});
}

/**
 * The GUC (grant unified config) key the RLS policies read to scope rows to one restaurant.
 * Kept in one place so the migration SQL and the app agree on the exact name.
 */
export const TENANT_GUC = "app.current_restaurant_id";

/**
 * A Prisma transaction client — the `tx` handed to `$transaction(async (tx) => …)`.
 * Callers accept this type where they previously accepted `prisma`.
 */
export type TenantClient = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

/**
 * Run restaurant-scoped work inside a transaction with the RLS GUC set transaction-locally
 * (issue #33 — defense-in-depth over the resolver-level RBAC/ownership checks).
 *
 * Every query issued via the provided `tx` client is constrained to `restaurantId` by
 * Postgres Row-Level Security. `set_config(..., true)` scopes the setting to THIS
 * transaction only, so it cannot leak across pooled connections.
 *
 * Once the app connects as the NON-superuser `fd` role (scripts/pg.mjs already creates it as
 * NOSUPERUSER) and the RLS migration is applied, a query issued OUTSIDE withTenant() runs with
 * no GUC set and therefore sees zero rows on the protected tables (default-deny). Until then the
 * wrapper is a functional no-op layered on top of the existing checks — safe to adopt
 * incrementally, resolver by resolver.
 *
 * NOTE (DB offline): this helper and the accompanying migration were authored without a live
 * database. The migration is --create-only and MUST be applied + tested against the embedded
 * dev cluster before RLS is relied on. See the migration SQL header for the manual apply steps.
 */
export function withTenant<T>(
  restaurantId: string,
  fn: (tx: TenantClient) => Promise<T>,
): Promise<T> {
  return client().$transaction(async (tx) => {
    // set_config(key, value, is_local=true) → scoped to this transaction only.
    await tx.$executeRaw`SELECT set_config(${TENANT_GUC}, ${restaurantId}, true)`;
    // Pin the session timezone to UTC for this transaction so a server-set timestamptz is not
    // mis-decoded by the pg driver adapter on a non-UTC host. SET LOCAL is transaction-scoped,
    // so it is safe under transaction-mode connection pooling.
    await tx.$executeRaw`SET LOCAL TIME ZONE 'UTC'`;
    return fn(tx);
  });
}

export type { PrismaClient };
export type { default as PrismaTypes } from "./generated/pothos-types.js";
export { getDatamodel } from "./generated/pothos-types.js";
export * from "./generated/prisma/client.js";
