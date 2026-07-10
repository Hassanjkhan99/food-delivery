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
    where: { userId, status: "active", currentPeriodEnd: { gt: new Date() } },
  });
  return sub !== null;
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
  if (existing && existing.status === "active" && existing.currentPeriodEnd > new Date()) {
    return existing;
  }

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
    // lastChargeRef is filled in only after the charge succeeds below.
  };

  // Step 1 — atomically claim the slot. Whichever caller wins gets a row id and proceeds
  // to charge; losers see no claim and return the now-active membership without charging.
  let claimedId: string | null = null;
  if (existing) {
    // Reactivate a lapsed/cancelled row, but only if it isn't already active — the
    // `status: { not: "active" }` guard means exactly one concurrent caller flips it.
    const flipped = await prisma.subscription.updateMany({
      where: { id: existing.id, status: { not: "active" } },
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
    // Lost the race — another concurrent call already claimed & is charging. Return the
    // active membership rather than charging a second time.
    const active = await currentMembership(userId);
    if (active) return active;
    throw new GraphQLError("Could not create membership, please retry");
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
