// Pandapro-style membership (#59). Subscribe/renew/cancel with mock billing.
// Billing is simulated: the sign-up (and renewal) charge runs through the same mock
// payment provider used for orders. Real recurring billing / dunning is a PSP concern
// tracked in #17 — there is no scheduler here; renewal is on-demand (renewMembership).
import { prisma, type Prisma } from "@fd/db";
import { GraphQLError } from "graphql";
import { mockProvider } from "./payments/mockProvider.js";

const DAY_MS = 24 * 60 * 60 * 1000;
// How long an unpaid claim is considered "in-flight" (a sibling subscribe still charging)
// before it's treated as abandoned and reclaimable. The mock charge is synchronous, so this
// only matters for crash/hang recovery; a real async PSP would use idempotency keys (#17).
const CLAIM_LEASE_MS = 60 * 1000;

// The signed-in customer's current membership (active first, else most recent).
export async function currentMembership(userId: string) {
  return prisma.subscription.findFirst({
    where: { userId },
    include: { plan: true },
    orderBy: [{ status: "asc" }, { currentPeriodEnd: "desc" }],
  });
}

// True when the user has an active, unexpired subscription right now.
export async function hasActiveMembership(userId: string): Promise<boolean> {
  const sub = await prisma.subscription.findFirst({
    // lastChargeRef requirement (Codex P2): a slot claimed by a concurrent subscribe that
    // hasn't finished charging is active+future but unpaid — it must not grant benefits.
    where: {
      userId,
      status: "active",
      currentPeriodEnd: { gt: new Date() },
      lastChargeRef: { not: null },
    },
  });
  return sub !== null;
}

// A subscription is "settled" only when it is active, unexpired, AND actually paid for the
// current period (lastChargeRef set). A row that is active+future but has no charge ref is a
// slot claimed by a concurrent caller still mid-charge — not yet a real success.
type SettleableSub = { status: string; currentPeriodEnd: Date; lastChargeRef: string | null };
// NB: a `false` result does NOT imply null — a lapsed-but-still-"active" row is unsettled but
// present — so this stays a plain boolean (not a type guard, which would over-narrow callers).
function isSettled(sub: SettleableSub | null): boolean {
  return (
    sub !== null &&
    sub.status === "active" &&
    sub.currentPeriodEnd > new Date() &&
    sub.lastChargeRef !== null
  );
}

// Charge the sign-up fee via the mock provider using a saved card. COD isn't offered
// for a subscription (nothing to collect on delivery), so a card is required.
async function chargePlan(userId: string, planPriceMinor: number, paymentMethodId: string) {
  const method = await prisma.paymentMethod.findUnique({ where: { id: paymentMethodId } });
  if (!method || method.userId !== userId)
    throw new GraphQLError("We couldn't find that saved card.", {
      extensions: { code: "not_found" },
    });
  const result = await mockProvider.charge({
    token: method.providerToken,
    amountMinor: planPriceMinor,
    reference: `sub_${userId.slice(0, 8)}`,
  });
  if (!result.ok)
    throw new GraphQLError(result.declineReason, { extensions: { code: "payment_declined" } });
  return result.providerRef;
}

// Subscribe to a plan (or renew/reactivate an existing subscription).
//
// Concurrency-safe (follow-up #123): a naive check-then-charge lets two concurrent calls
// (double-click / two tabs / retry) both pass the "already active?" check and both run the
// card charge — double-charging for one membership. Instead we *claim* the single
// subscription slot atomically (guarded by the @@unique([userId]) index and a conditional
// status flip) BEFORE charging, so exactly one caller reaches chargePlan. On charge failure
// the claim is rolled back so the user isn't left with an unpaid "active" membership.
export async function subscribe(userId: string, planId: string, paymentMethodId: string) {
  const plan = await prisma.membershipPlan.findFirst({ where: { id: planId, isActive: true } });
  if (!plan)
    throw new GraphQLError("That membership plan isn't available right now.", {
      extensions: { code: "not_found" },
    });

  const existing = await currentMembership(userId);
  if (isSettled(existing)) return existing!;

  const now = new Date();
  const periodEnd = new Date(now.getTime() + plan.billingPeriodDays * DAY_MS);
  const claim: Prisma.SubscriptionUncheckedCreateInput = {
    userId,
    planId: plan.id,
    status: "active",
    currentPeriodStart: now,
    currentPeriodEnd: periodEnd,
    autoRenew: true,
    paymentMethodId,
    // Cleared on every claim and re-set only after the charge succeeds, so lastChargeRef
    // is a reliable "paid for THIS period" signal for isSettled() (Codex P2).
    lastChargeRef: null,
  };

  const pending = () =>
    new GraphQLError("Your membership is being set up. Please try again in a moment.", {
      extensions: { code: "membership_pending" },
    });

  // A recent unpaid claim (active, no charge ref, claimed within the lease window) is a
  // sibling subscribe still mid-charge. Don't reclaim it — that's how a staggered second
  // call would steal an in-flight claim and double-charge (Codex P1). Only an unpaid claim
  // older than the lease is treated as abandoned (crash/hang) and reclaimable below.
  const leaseFloor = new Date(now.getTime() - CLAIM_LEASE_MS);
  if (
    existing &&
    existing.status === "active" &&
    existing.lastChargeRef === null &&
    existing.currentPeriodStart > leaseFloor
  ) {
    throw pending();
  }

  // Step 1 — atomically claim the slot via optimistic CAS on the observed currentPeriodStart;
  // the claim advances it to `now`, which doubles as this claim's lease stamp. Exactly one of
  // N simultaneous callers wins (the rest see 0 rows). Since the single-winner guarantee comes
  // from the CAS token — not the row's status — it also recovers a lapsed active row (no expiry
  // job), a cancelled row, and a *stale* (past-lease) unpaid claim.
  let claimedId: string | null = null;
  if (existing) {
    const flipped = await prisma.subscription.updateMany({
      where: { id: existing.id, currentPeriodStart: existing.currentPeriodStart },
      data: { ...claim, cancelledAt: null },
    });
    if (flipped.count === 1) claimedId = existing.id;
  } else {
    // First-time subscribe: the @@unique([userId]) index rejects the loser's create.
    try {
      const created = await prisma.subscription.create({ data: claim });
      claimedId = created.id;
    } catch (err) {
      if ((err as { code?: string }).code !== "P2002") throw err;
    }
  }

  if (claimedId === null) {
    // Lost the race. Only report success if the winner has actually settled (charged);
    // otherwise ask the caller to retry rather than hand back an unpaid claim (Codex P2).
    const current = await currentMembership(userId);
    if (isSettled(current)) return current!;
    throw pending();
  }

  // Step 2 — charge exactly once, then settle. Settlement and rollback are BOTH guarded by the
  // claim token (`currentPeriodStart === now` and still unpaid), so if this claim was superseded
  // by a later reclaim after the lease expired (e.g. a genuinely hung charge), we neither clobber
  // the new owner's row nor cancel it out from under them (Codex P1). Bulletproof exactly-once
  // billing across a slow/async PSP is #17's concern — here the mock charge is synchronous.
  try {
    const chargeRef = await chargePlan(userId, plan.priceMinor, paymentMethodId);
    const settled = await prisma.subscription.updateMany({
      where: { id: claimedId, currentPeriodStart: now, lastChargeRef: null },
      data: { lastChargeRef: chargeRef },
    });
    if (settled.count === 0) {
      // Superseded while charging (only reachable past the lease window). Hand back the
      // current owner's membership if it's settled; the orphaned mock charge is a #17 concern.
      const current = await currentMembership(userId);
      if (isSettled(current)) return current!;
      throw pending();
    }
    return prisma.subscription.findUniqueOrThrow({
      where: { id: claimedId },
      include: { plan: true },
    });
  } catch (err) {
    await prisma.subscription
      .updateMany({
        where: { id: claimedId, currentPeriodStart: now, lastChargeRef: null },
        data: { status: "cancelled", cancelledAt: new Date() },
      })
      .catch(() => {});
    throw err;
  }
}

// Cancel: stop auto-renew. The member keeps the benefit until currentPeriodEnd
// (Foodpanda-style — no pro-rated refund in this phase).
export async function cancel(userId: string) {
  const sub = await prisma.subscription.findFirst({
    where: { userId, status: "active" },
    orderBy: { currentPeriodEnd: "desc" },
  });
  if (!sub)
    throw new GraphQLError("You don't have an active membership to cancel.", {
      extensions: { code: "not_found" },
    });
  return prisma.subscription.update({
    where: { id: sub.id },
    data: { autoRenew: false, cancelledAt: new Date() },
    include: { plan: true },
  });
}
