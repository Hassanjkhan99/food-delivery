// Branch opening-hours resolution (#19/#63). Single source of truth for "is this branch
// open right now", shared by Branch.isOpenNow and the placeOrder closed-branch guard.
//
// Precedence: structured BranchHours rows (the new model) win when a branch has any; a
// branch with no rows falls back to the legacy Branch.hoursJson blob, which itself treats
// "no hours" as always-open. This keeps un-migrated (seed) branches working unchanged while
// new branches use the structured model.
import { prisma, type Prisma } from "@fd/db";
import { branchHoursOpenState, branchOpenState, type BranchHours, type OpenState } from "@fd/shared";

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
