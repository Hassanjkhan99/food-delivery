// Branch opening-hours resolution (#19/#63). Single source of truth for "is this branch
// open right now", shared by Branch.isOpenNow and the placeOrder closed-branch guard.
//
// Precedence: structured BranchHours rows (the new model) win when a branch has any; a
// branch with no rows falls back to the legacy Branch.hoursJson blob, which itself treats
// "no hours" as always-open. This keeps un-migrated (seed) branches working unchanged while
// new branches use the structured model.
import { prisma, type Prisma } from "@fd/db";
import {
  branchHoursOpenState,
  branchOpenState,
  type BranchHours,
  type OpenState,
} from "@fd/shared";

type BranchLike = { id: string; hoursJson: Prisma.JsonValue };

/** Evaluate a branch's open/closed state at `nowMs`, loading its structured hours. */
export async function branchOpenNow(branch: BranchLike, nowMs = Date.now()): Promise<OpenState> {
  const rows = await prisma.branchHours.findMany({
    where: { branchId: branch.id },
    select: { dayOfWeek: true, openMinute: true, closeMinute: true },
  });
  if (rows.length > 0) return branchHoursOpenState(rows, nowMs);
  return branchOpenState(branch.hoursJson as BranchHours, nowMs);
}

/**
 * Request-scoped memoized `branchOpenNow` (#207). Open-state is deterministic per
 * (branchId, minute), so a per-request cache keyed on both dedupes the isOpenNow +
 * opensAtLabel field resolvers (and the N-orders-share-a-branch case in myOrders) down to
 * one query per distinct branch/minute — with no cross-request staleness.
 */
export function branchOpenNowCached(
  ctx: { openStateCache: Map<string, Promise<OpenState>> },
  branch: BranchLike,
  nowMs = Date.now(),
): Promise<OpenState> {
  const key = `${branch.id}:${Math.floor(nowMs / 60000)}`;
  const hit = ctx.openStateCache.get(key);
  if (hit) return hit;
  const pending = branchOpenNow(branch, nowMs);
  ctx.openStateCache.set(key, pending);
  // Don't pin a rejected lookup for the rest of the request — let the next call retry.
  pending.catch(() => ctx.openStateCache.delete(key));
  return pending;
}
