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

export type { PrismaClient };
export * from "./generated/prisma/client.js";
