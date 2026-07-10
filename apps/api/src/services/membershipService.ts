// Pandapro-style membership (#59). Subscribe/renew/cancel with mock billing.
// Billing is simulated: the sign-up (and renewal) charge runs through the same mock
// payment provider used for orders. Real recurring billing / dunning is a PSP concern
// tracked in #17 — there is no scheduler here; renewal is on-demand (renewMembership).
import { prisma, type Prisma } from "@fd/db";
import { GraphQLError } from "graphql";
import { mockProvider } from "./payments/mockProvider.js";

const DAY_MS = 24 * 60 * 60 * 1000;

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
  if (!method || method.userId !== userId) throw new GraphQLError("Card not found");
  const result = await mockProvider.charge({
    token: method.providerToken,
    amountMinor: planPriceMinor,
    reference: `sub_${userId.slice(0, 8)}`,
  });
  if (!result.ok) throw new GraphQLError(result.declineReason);
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
  if (!plan) throw new GraphQLError("Membership plan not available");

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

  // Step 1 — atomically claim the slot. Whichever caller wins gets a row id and proceeds
  // to charge; losers fall through and only report success once the winner has settled.
  let claimedId: string | null = null;
  if (existing) {
    // Reclaim the existing (non-settled — the settled fast-path above already returned) row
    // via optimistic concurrency: match on the currentPeriodStart we observed, and the claim
    // advances it to `now`. Exactly one concurrent caller wins; the rest see 0 rows updated.
    // Because the single-winner guarantee comes from the CAS token (not the row's status), it
    // recovers ANY stuck state — a lapsed active row (no expiry job), a cancelled row, AND a
    // stale unpaid claim left by a crashed/hung charge (active + future + lastChargeRef null),
    // which a status/period guard would refuse to reclaim forever (Codex P1 + P2).
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
    // Lost the race. Only report success if the winner has actually finished charging
    // (settled); otherwise the winner could still decline and roll back, so ask the caller
    // to retry rather than handing back an unpaid "active" membership (Codex P2).
    const current = await currentMembership(userId);
    if (isSettled(current)) return current!;
    throw new GraphQLError("Membership is being set up — please retry in a moment", {
      extensions: { code: "membership_pending" },
    });
  }

  // Step 2 — charge exactly once. Roll the claim back if the card is declined.
  try {
    const chargeRef = await chargePlan(userId, plan.priceMinor, paymentMethodId);
    return await prisma.subscription.update({
      where: { id: claimedId },
      data: { lastChargeRef: chargeRef },
      include: { plan: true },
    });
  } catch (err) {
    await prisma.subscription
      .update({
        where: { id: claimedId },
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
  if (!sub) throw new GraphQLError("No active membership to cancel");
  return prisma.subscription.update({
    where: { id: sub.id },
    data: { autoRenew: false, cancelledAt: new Date() },
    include: { plan: true },
  });
}
