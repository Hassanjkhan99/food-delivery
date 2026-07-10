// Membership domain (#59): browse plans, view/subscribe/cancel a pandapro-style
// membership that waives or discounts delivery. Billing is mock-charged (see
// membershipService) — real recurring billing is #17.
import { prisma } from "@fd/db";
import { cancel, currentMembership, subscribe } from "../services/membershipService.js";
import { builder } from "./builder.js";

builder.prismaObject("MembershipPlan", {
  fields: (t) => ({
    id: t.exposeID("id"),
    name: t.exposeString("name"),
    priceMinor: t.exposeInt("priceMinor"),
    freeDeliveryThresholdMinor: t.exposeInt("freeDeliveryThresholdMinor"),
    deliveryDiscountBps: t.exposeInt("deliveryDiscountBps"),
    billingPeriodDays: t.exposeInt("billingPeriodDays"),
    isActive: t.exposeBoolean("isActive"),
  }),
});

// Named "Membership" in the GraphQL API: the root operation type is already called
// "Subscription" (graphql-sse), so the Prisma Subscription model gets a distinct name.
builder.prismaObject("Subscription", {
  name: "Membership",
  fields: (t) => ({
    id: t.exposeID("id"),
    status: t.exposeString("status"),
    autoRenew: t.exposeBoolean("autoRenew"),
    currentPeriodStart: t.field({ type: "DateTime", resolve: (s) => s.currentPeriodStart }),
    currentPeriodEnd: t.field({ type: "DateTime", resolve: (s) => s.currentPeriodEnd }),
    cancelledAt: t.field({ type: "DateTime", nullable: true, resolve: (s) => s.cancelledAt }),
    // Derived: still an active member right now (status active and not yet expired).
    isActive: t.boolean({
      resolve: (s) => s.status === "active" && s.currentPeriodEnd > new Date(),
    }),
    plan: t.relation("plan"),
  }),
});

builder.queryFields((t) => ({
  // Active, purchasable plans (cheapest first).
  membershipPlans: t.prismaField({
    type: ["MembershipPlan"],
    resolve: (query) =>
      prisma.membershipPlan.findMany({
        ...query,
        where: { isActive: true },
        orderBy: { priceMinor: "asc" },
      }),
  }),

  // The signed-in customer's membership, or null if they've never subscribed.
  myMembership: t.prismaField({
    type: "Subscription",
    nullable: true,
    authScopes: { loggedIn: true },
    resolve: (_query, _root, _args, ctx) => currentMembership(ctx.userId!),
  }),
}));

builder.mutationFields((t) => ({
  // Subscribe (or renew a lapsed membership). Mock-charges the saved card.
  subscribeMembership: t.prismaField({
    type: "Subscription",
    authScopes: { loggedIn: true },
    args: {
      planId: t.arg.string({ required: true }),
      paymentMethodId: t.arg.string({ required: true }),
    },
    resolve: (_query, _root, args, ctx) =>
      subscribe(ctx.userId!, args.planId, args.paymentMethodId),
  }),

  // Cancel auto-renew; benefit stays until the current period ends.
  cancelMembership: t.prismaField({
    type: "Subscription",
    authScopes: { loggedIn: true },
    resolve: (_query, _root, _args, ctx) => cancel(ctx.userId!),
  }),
}));
