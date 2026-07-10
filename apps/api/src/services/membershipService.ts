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

// Subscribe to a plan (or renew/reactivate an existing subscription). Idempotent-ish:
// an already-active subscription is returned untouched rather than double-charged.
export async function subscribe(userId: string, planId: string, paymentMethodId: string) {
  const plan = await prisma.membershipPlan.findFirst({ where: { id: planId, isActive: true } });
  if (!plan) throw new GraphQLError("Membership plan not available");

  const existing = await currentMembership(userId);
  if (existing && existing.status === "active" && existing.currentPeriodEnd > new Date()) {
    return existing;
  }

  const chargeRef = await chargePlan(userId, plan.priceMinor, paymentMethodId);
  const now = new Date();
  const periodEnd = new Date(now.getTime() + plan.billingPeriodDays * DAY_MS);

  const data: Prisma.SubscriptionUncheckedCreateInput = {
    userId,
    planId: plan.id,
    status: "active",
    currentPeriodStart: now,
    currentPeriodEnd: periodEnd,
    autoRenew: true,
    paymentMethodId,
    lastChargeRef: chargeRef,
  };

  // Reuse the row if the user had a lapsed/cancelled subscription, else create one.
  if (existing) {
    return prisma.subscription.update({
      where: { id: existing.id },
      data: { ...data, cancelledAt: null },
      include: { plan: true },
    });
  }
  return prisma.subscription.create({ data, include: { plan: true } });
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
