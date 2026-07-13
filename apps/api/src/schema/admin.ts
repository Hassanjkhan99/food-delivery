// Admin domain: KPI dashboard, approvals + tier, audited order overrides, refund
// workbench (executes money), payout batches, versioned fee config, audit explorer.
import { prisma } from "@fd/db";
import { GraphQLError } from "graphql";
import type { OrderStatus, PolicyMatrixRow, CancellationPolicyConfig } from "@fd/shared";
import { CANCELLATION_POLICY_MATRIX, CANCELLATION_POLICY_CONFIG, formatRs } from "@fd/shared";
import { transition } from "../services/orderService.js";
import { recordCancellation } from "../services/policyService.js";
import { accountBalance, onGoodwillCredit, postLedgerTx } from "../services/ledgerService.js";
import { mockProvider } from "../services/payments/mockProvider.js";
import { recomputeTrustScore } from "../services/riderTrustService.js";
import { missingRequirements } from "../services/riderVerificationService.js";
import { adminMetricsCsv, bucketMetrics } from "../services/csvExport.js";
import { builder } from "./builder.js";

async function audit(
  actorUserId: string | null,
  action: string,
  subjectType: string,
  subjectId: string,
  before: unknown,
  after: unknown,
) {
  await prisma.auditLog.create({
    data: {
      actorUserId,
      actorRole: "admin",
      action,
      subjectType,
      subjectId,
      beforeJson: before as never,
      afterJson: after as never,
    },
  });
}

const DashboardStats = builder.objectRef<{
  ordersToday: number;
  gmvTodayMinor: number;
  activeOrders: number;
  acceptanceSlaPct: number;
  cancellationRatePct: number;
  pendingApprovals: number;
  openTickets: number;
  pendingRefunds: number;
}>("DashboardStats");
DashboardStats.implement({
  fields: (t) => ({
    ordersToday: t.exposeInt("ordersToday"),
    gmvTodayMinor: t.exposeInt("gmvTodayMinor"),
    activeOrders: t.exposeInt("activeOrders"),
    acceptanceSlaPct: t.exposeFloat("acceptanceSlaPct"),
    cancellationRatePct: t.exposeFloat("cancellationRatePct"),
    pendingApprovals: t.exposeInt("pendingApprovals"),
    openTickets: t.exposeInt("openTickets"),
    pendingRefunds: t.exposeInt("pendingRefunds"),
  }),
});

builder.prismaObject("Refund", {
  fields: (t) => ({
    id: t.exposeID("id"),
    status: t.exposeString("status"),
    amountMinor: t.exposeInt("amountMinor"),
    destination: t.exposeString("destination"),
    reason: t.exposeString("reason"),
    createdAt: t.field({ type: "DateTime", resolve: (r) => r.createdAt }),
    order: t.relation("order"),
    // Help tickets that opened this refund (#45) — lets the workbench see the
    // structured intake (attached items) behind the request.
    tickets: t.relation("tickets"),
  }),
});

builder.prismaObject("AuditLog", {
  fields: (t) => ({
    id: t.exposeID("id"),
    action: t.exposeString("action"),
    actorRole: t.exposeString("actorRole", { nullable: true }),
    subjectType: t.exposeString("subjectType"),
    subjectId: t.exposeString("subjectId"),
    beforeJson: t.field({ type: "JSON", nullable: true, resolve: (a) => a.beforeJson }),
    afterJson: t.field({ type: "JSON", nullable: true, resolve: (a) => a.afterJson }),
    createdAt: t.field({ type: "DateTime", resolve: (a) => a.createdAt }),
  }),
});

builder.prismaObject("FeeConfig", {
  fields: (t) => ({
    id: t.exposeID("id"),
    smallBusinessCommissionBps: t.exposeInt("smallBusinessCommissionBps"),
    smallBusinessPlatformFeeMinor: t.exposeInt("smallBusinessPlatformFeeMinor"),
    chainCommissionBps: t.exposeInt("chainCommissionBps"),
    chainPlatformFeeMinor: t.exposeInt("chainPlatformFeeMinor"),
    featuredSlotDailyRateSmallMinor: t.exposeInt("featuredSlotDailyRateSmallMinor"),
    featuredSlotDailyRateChainMinor: t.exposeInt("featuredSlotDailyRateChainMinor"),
    createdAt: t.field({ type: "DateTime", resolve: (f) => f.createdAt }),
  }),
});

const PayoutCandidate = builder.objectRef<{
  restaurantId: string;
  name: string;
  balanceMinor: number;
}>("PayoutCandidate");
PayoutCandidate.implement({
  fields: (t) => ({
    restaurantId: t.exposeString("restaurantId"),
    name: t.exposeString("name"),
    balanceMinor: t.exposeInt("balanceMinor"),
  }),
});

// #30 admin-visible cancellation & refund policy matrix. Static rows from the
// kickoff table + the live tunable config, so ops can see exactly what the engine does.
const CancellationPolicyRow = builder.objectRef<PolicyMatrixRow>("CancellationPolicyRow");
CancellationPolicyRow.implement({
  fields: (t) => ({
    scenario: t.exposeString("scenario"),
    label: t.exposeString("label"),
    customerPays: t.exposeString("customerPays"),
    outcome: t.exposeString("outcome"),
  }),
});

const CancellationPolicyConfigView = builder.objectRef<CancellationPolicyConfig>(
  "CancellationPolicyConfig",
);
CancellationPolicyConfigView.implement({
  fields: (t) => ({
    gracePeriodSeconds: t.exposeInt("gracePeriodSeconds"),
    postAcceptFeeMinor: t.exposeInt("postAcceptFeeMinor"),
    afterPreparedSubtotalBps: t.exposeInt("afterPreparedSubtotalBps"),
    unreachableChargesDeliveryFee: t.exposeBoolean("unreachableChargesDeliveryFee"),
    unreachableWaitSeconds: t.exposeInt("unreachableWaitSeconds"),
  }),
});

const CancellationPolicy = builder.objectRef<{
  rows: PolicyMatrixRow[];
  config: CancellationPolicyConfig;
}>("CancellationPolicy");
CancellationPolicy.implement({
  fields: (t) => ({
    rows: t.field({ type: [CancellationPolicyRow], resolve: (p) => p.rows }),
    config: t.field({ type: CancellationPolicyConfigView, resolve: (p) => p.config }),
  }),
});

builder.queryFields((t) => ({
  cancellationPolicyMatrix: t.field({
    type: CancellationPolicy,
    authScopes: { admin: true },
    resolve: () => ({
      rows: CANCELLATION_POLICY_MATRIX,
      config: CANCELLATION_POLICY_CONFIG,
    }),
  }),

  dashboardStats: t.field({
    type: DashboardStats,
    authScopes: { admin: true },
    resolve: async () => {
      const dayStart = new Date();
      dayStart.setHours(0, 0, 0, 0);
      const [today, delivered, activeOrders, pendingApprovals, openTickets, pendingRefunds] =
        await Promise.all([
          prisma.order.findMany({ where: { placedAt: { gte: dayStart } } }),
          prisma.order.findMany({ where: { placedAt: { gte: dayStart }, status: "delivered" } }),
          prisma.order.count({
            where: {
              status: {
                in: [
                  "pending_acceptance",
                  "accepted",
                  "preparing",
                  "ready_for_pickup",
                  "rider_assigned",
                  "picked_up",
                  "out_for_delivery",
                ],
              },
            },
          }),
          prisma.restaurant.count({ where: { status: "pending_approval" } }),
          prisma.supportTicket.count({ where: { status: { in: ["open", "in_progress"] } } }),
          prisma.refund.count({ where: { status: "refund_pending" } }),
        ]);

      const decided = today.filter(
        (o) => o.acceptedAt || ["rejected", "auto_expired"].includes(o.status),
      );
      const acceptedInSla = decided.filter(
        (o) => o.acceptedAt && o.acceptedAt <= o.acceptDeadlineAt,
      );
      const cancelled = today.filter((o) =>
        ["cancelled", "rejected", "auto_expired"].includes(o.status),
      );

      return {
        ordersToday: today.length,
        gmvTodayMinor: delivered.reduce((s, o) => s + o.grandTotalMinor, 0),
        activeOrders,
        acceptanceSlaPct: decided.length ? (acceptedInSla.length / decided.length) * 100 : 100,
        cancellationRatePct: today.length ? (cancelled.length / today.length) * 100 : 0,
        pendingApprovals,
        openTickets,
        pendingRefunds,
      };
    },
  }),

  restaurantApprovalQueue: t.prismaField({
    type: ["Restaurant"],
    authScopes: { admin: true },
    resolve: (query) =>
      prisma.restaurant.findMany({
        ...query,
        where: { status: "pending_approval" },
        orderBy: { createdAt: "asc" },
      }),
  }),

  allRestaurants: t.prismaField({
    type: ["Restaurant"],
    authScopes: { admin: true },
    resolve: (query) => prisma.restaurant.findMany({ ...query, orderBy: { createdAt: "asc" } }),
  }),

  // Rider verification queue — mirrors restaurantApprovalQueue. Riders awaiting review
  // (verificationStatus = pending), oldest first, with their uploaded docs.
  riderVerificationQueue: t.prismaField({
    type: ["Rider"],
    authScopes: { admin: true },
    resolve: (query) =>
      prisma.rider.findMany({
        ...query,
        where: { verificationStatus: "pending" },
        orderBy: { createdAt: "asc" },
      }),
  }),

  allRiders: t.prismaField({
    type: ["Rider"],
    authScopes: { admin: true },
    resolve: (query) => prisma.rider.findMany({ ...query, orderBy: { createdAt: "asc" } }),
  }),

  // Unmet onboarding requirements for one rider (empty => ready to verify). Lets the
  // admin UI show what's missing before approving a shared/independent rider.
  riderMissingRequirements: t.field({
    type: ["String"],
    authScopes: { admin: true },
    args: { riderId: t.arg.string({ required: true }) },
    resolve: async (_root, args) => {
      const rider = await prisma.rider.findUnique({
        where: { id: args.riderId },
        include: { verificationDocs: true },
      });
      if (!rider)
        throw new GraphQLError("We couldn't find that rider.", {
          extensions: { code: "not_found" },
        });
      return missingRequirements(rider);
    },
  }),

  refundQueue: t.prismaField({
    type: ["Refund"],
    authScopes: { admin: true },
    resolve: (query) =>
      prisma.refund.findMany({
        ...query,
        where: { status: "refund_pending" },
        orderBy: { createdAt: "asc" },
      }),
  }),

  auditLogs: t.prismaField({
    type: ["AuditLog"],
    authScopes: { admin: true },
    args: { take: t.arg.int({ required: false }) },
    resolve: (query, _root, args) =>
      prisma.auditLog.findMany({
        ...query,
        orderBy: { createdAt: "desc" },
        take: Math.min(args.take ?? 50, 200),
      }),
  }),

  currentFeeConfig: t.prismaField({
    type: "FeeConfig",
    nullable: true,
    authScopes: { admin: true },
    resolve: (query) => prisma.feeConfig.findFirst({ ...query, orderBy: { createdAt: "desc" } }),
  }),

  payoutCandidates: t.field({
    type: [PayoutCandidate],
    authScopes: { admin: true },
    resolve: async () => {
      const restaurants = await prisma.restaurant.findMany({ where: { status: "approved" } });
      const out: Array<{ restaurantId: string; name: string; balanceMinor: number }> = [];
      for (const r of restaurants) {
        const balance = await prisma.$transaction((tx) =>
          accountBalance(tx as never, `restaurant:${r.id}:payable`),
        );
        if (balance !== 0) out.push({ restaurantId: r.id, name: r.name, balanceMinor: balance });
      }
      return out.sort((a, b) => b.balanceMinor - a.balanceMinor);
    },
  }),

  // Platform metrics export CSV (#29): orders / GMV / take-rate bucketed per period.
  // GMV = subtotal + tax + delivery over delivered orders; take rate = platform revenue
  // (commission + platform fee) / GMV. Computed live — no stored aggregates.
  adminMetricsCsv: t.string({
    authScopes: { admin: true },
    args: {
      from: t.arg({ type: "DateTime", required: false }),
      to: t.arg({ type: "DateTime", required: false }),
      granularity: t.arg.string({ required: false }),
    },
    resolve: async (_root, args) => {
      const g = (["day", "week", "month"] as const).includes(args.granularity as never)
        ? (args.granularity as "day" | "week" | "month")
        : "day";
      const orders = await prisma.order.findMany({
        where: {
          status: "delivered",
          ...(args.from || args.to
            ? {
                deliveredAt: {
                  ...(args.from ? { gte: args.from } : {}),
                  ...(args.to ? { lte: args.to } : {}),
                },
              }
            : {}),
        },
        select: {
          deliveredAt: true,
          subtotalMinor: true,
          taxTotalMinor: true,
          deliveryFeeMinor: true,
          commissionMinor: true,
          platformFeeMinor: true,
        },
      });
      return adminMetricsCsv(bucketMetrics(orders, g));
    },
  }),
}));

builder.mutationFields((t) => ({
  approveRestaurant: t.prismaField({
    type: "Restaurant",
    authScopes: { admin: true },
    args: { id: t.arg.string({ required: true }) },
    resolve: async (_q, _root, args, ctx) => {
      const before = await prisma.restaurant.findUniqueOrThrow({ where: { id: args.id } });
      const updated = await prisma.restaurant.update({
        where: { id: args.id },
        data: { status: "approved" },
      });
      await audit(
        ctx.userId,
        "restaurant.approve",
        "Restaurant",
        args.id,
        { status: before.status },
        { status: "approved" },
      );
      return updated;
    },
  }),

  suspendRestaurant: t.prismaField({
    type: "Restaurant",
    authScopes: { admin: true },
    args: { id: t.arg.string({ required: true }), reason: t.arg.string({ required: true }) },
    resolve: async (_q, _root, args, ctx) => {
      const before = await prisma.restaurant.findUniqueOrThrow({ where: { id: args.id } });
      const updated = await prisma.restaurant.update({
        where: { id: args.id },
        data: { status: "suspended" },
      });
      await audit(
        ctx.userId,
        "restaurant.suspend",
        "Restaurant",
        args.id,
        { status: before.status },
        { status: "suspended", reason: args.reason },
      );
      return updated;
    },
  }),

  setRestaurantTier: t.prismaField({
    type: "Restaurant",
    authScopes: { admin: true },
    args: { id: t.arg.string({ required: true }), tier: t.arg.string({ required: true }) },
    resolve: async (_q, _root, args, ctx) => {
      if (!["small_business", "chain"].includes(args.tier))
        throw new GraphQLError("Please choose a valid restaurant tier.", {
          extensions: { code: "validation_error" },
        });
      const before = await prisma.restaurant.findUniqueOrThrow({ where: { id: args.id } });
      const updated = await prisma.restaurant.update({
        where: { id: args.id },
        data: { tier: args.tier as never },
      });
      await audit(
        ctx.userId,
        "restaurant.set_tier",
        "Restaurant",
        args.id,
        { tier: before.tier },
        { tier: args.tier },
      );
      return updated;
    },
  }),

  // Approve a rider after docs are reviewed. For shared/independent riders the onboarding
  // requirements must be complete (CNIC + photo + vehicle + plate + training + agreement);
  // restaurant riders have only soft requirements. Audited like restaurant approval.
  approveRider: t.prismaField({
    type: "Rider",
    authScopes: { admin: true },
    args: { id: t.arg.string({ required: true }) },
    resolve: async (_q, _root, args, ctx) => {
      const before = await prisma.rider.findUnique({
        where: { id: args.id },
        include: { verificationDocs: true },
      });
      if (!before)
        throw new GraphQLError("We couldn't find that rider.", {
          extensions: { code: "not_found" },
        });
      const missing = missingRequirements(before);
      if (missing.length > 0) {
        throw new GraphQLError(
          `This rider can't be verified yet. The following is still required: ${missing.join(", ")}.`,
          { extensions: { code: "invalid_state" } },
        );
      }
      const updated = await prisma.rider.update({
        where: { id: args.id },
        data: { verificationStatus: "verified", verifiedAt: new Date(), rejectionReason: null },
      });
      await audit(
        ctx.userId,
        "rider.approve",
        "Rider",
        args.id,
        { verificationStatus: before.verificationStatus },
        { verificationStatus: "verified" },
      );
      return updated;
    },
  }),

  rejectRider: t.prismaField({
    type: "Rider",
    authScopes: { admin: true },
    args: { id: t.arg.string({ required: true }), reason: t.arg.string({ required: true }) },
    resolve: async (_q, _root, args, ctx) => {
      const before = await prisma.rider.findUniqueOrThrow({ where: { id: args.id } });
      const updated = await prisma.rider.update({
        where: { id: args.id },
        // Rejecting also pulls shared eligibility — a rejected rider gets no offers.
        data: {
          verificationStatus: "rejected",
          rejectionReason: args.reason,
          sharedModeEnabled: false,
        },
      });
      await audit(
        ctx.userId,
        "rider.reject",
        "Rider",
        args.id,
        { verificationStatus: before.verificationStatus },
        { verificationStatus: "rejected", reason: args.reason },
      );
      return updated;
    },
  }),

  // Recompute one rider's trust score on demand (the nightly job calls the service for
  // all riders). Auto-disables shared mode when the score falls below threshold.
  recomputeRiderTrust: t.prismaField({
    type: "Rider",
    authScopes: { admin: true },
    args: { id: t.arg.string({ required: true }) },
    resolve: async (query, _root, args, ctx) => {
      const before = await prisma.rider.findUniqueOrThrow({ where: { id: args.id } });
      const breakdown = await recomputeTrustScore(args.id);
      await audit(
        ctx.userId,
        "rider.trust_recompute",
        "Rider",
        args.id,
        { trustScore: before.trustScore },
        { trustScore: breakdown.score },
      );
      return prisma.rider.findUniqueOrThrow({ ...query, where: { id: args.id } });
    },
  }),

  overrideOrderStatus: t.prismaField({
    type: "Order",
    authScopes: { admin: true },
    args: {
      id: t.arg.string({ required: true }),
      toStatus: t.arg.string({ required: true }),
      reason: t.arg.string({ required: true }),
    },
    resolve: async (_q, _root, args, ctx) => {
      const toStatus = args.toStatus as OrderStatus;
      // #30: capture the order before the move so a cancellation policy row can be
      // written against its pre-transition state (grace-window/timing intact).
      const before = ["rejected", "auto_expired", "cancelled"].includes(toStatus)
        ? await prisma.order.findUnique({ where: { id: args.id } })
        : null;
      // transition() audits admin/system actors internally.
      const updated = await transition(
        args.id,
        toStatus,
        { userId: ctx.userId, role: "admin" },
        { reason: args.reason },
      );
      // Admin-driven cancellations still owe a Cancellation audit row (admin_override
      // scenario, full refund by default). Persist it after the transition succeeds.
      if (before) await recordCancellation(before, "admin");
      return updated;
    },
  }),

  decideRefund: t.prismaField({
    type: "Refund",
    authScopes: { admin: true },
    args: {
      id: t.arg.string({ required: true }),
      approve: t.arg.boolean({ required: true }),
      reason: t.arg.string({ required: false }),
    },
    resolve: async (_q, _root, args, ctx) => {
      const refund = await prisma.refund.findUnique({
        where: { id: args.id },
        include: { order: { include: { payment: true, branch: true } } },
      });
      if (!refund)
        throw new GraphQLError("We couldn't find that refund.", {
          extensions: { code: "not_found" },
        });
      if (refund.status !== "refund_pending")
        throw new GraphQLError("This refund has already been decided.", {
          extensions: { code: "invalid_state" },
        });

      if (!args.approve) {
        const updated = await prisma.refund.update({
          where: { id: args.id },
          data: { status: "refund_rejected", decidedByUserId: ctx.userId, decidedAt: new Date() },
        });
        // Reflect the decision on any help ticket that opened this refund so the
        // customer sees the outcome on their ticket thread (#45).
        await prisma.supportTicket.updateMany({
          where: { refundId: refund.id, status: { not: "closed" } },
          data: {
            status: "resolved",
            resolutionNote: args.reason?.trim()
              ? `We reviewed your request and couldn't approve a refund: ${args.reason.trim()}`
              : "We reviewed your request and couldn't approve a refund for this order.",
          },
        });
        await audit(
          ctx.userId,
          "refund.reject",
          "Refund",
          args.id,
          { status: "refund_pending" },
          { status: "refund_rejected", reason: args.reason ?? null },
        );
        return updated;
      }

      const order = refund.order;
      const restaurantId = order.branch.restaurantId;

      const updated = await prisma.$transaction(async (tx) => {
        if (refund.destination === "card" && order.payment?.providerRef) {
          await mockProvider.refund({
            chargeRef: order.payment.providerRef,
            amountMinor: refund.amountMinor,
            reference: order.code,
          });
          await tx.payment.update({
            where: { id: order.payment.id },
            data: {
              refundedMinor: { increment: refund.amountMinor },
              status:
                order.payment.refundedMinor + refund.amountMinor >= order.payment.amountMinor
                  ? "refunded"
                  : "partially_refunded",
            },
          });
          // Restaurant bears the cost (kickoff policy: wrong/missing item), cash leaves platform.
          await postLedgerTx(
            tx,
            `Refund ${order.code} approved (card)`,
            [
              {
                code: `restaurant:${restaurantId}:payable`,
                ownerType: "restaurant",
                ownerId: restaurantId,
                debit: refund.amountMinor,
              },
              { code: "platform:cash", ownerType: "platform", credit: refund.amountMinor },
            ],
            { orderId: order.id, refundId: refund.id },
          );
        } else {
          // Wallet credit: restaurant bears it, customer gains prepaid balance.
          await postLedgerTx(
            tx,
            `Refund ${order.code} approved (wallet credit)`,
            [
              {
                code: `restaurant:${restaurantId}:payable`,
                ownerType: "restaurant",
                ownerId: restaurantId,
                debit: refund.amountMinor,
              },
              {
                code: `customer:${order.customerId}:prepaid`,
                ownerType: "customer",
                ownerId: order.customerId,
                credit: refund.amountMinor,
              },
            ],
            { orderId: order.id, refundId: refund.id },
          );
        }
        const r = await tx.refund.update({
          where: { id: args.id },
          data: { status: "refunded", decidedByUserId: ctx.userId, decidedAt: new Date() },
        });
        // Surface the approved-refund resolution on any linked help ticket (#45).
        const dest = refund.destination === "card" ? "your original payment method" : "your wallet";
        await tx.supportTicket.updateMany({
          where: { refundId: refund.id, status: { not: "closed" } },
          data: {
            status: "resolved",
            resolutionNote: `Refund of ${formatRs(refund.amountMinor)} approved to ${dest}.`,
          },
        });
        return r;
      });
      await audit(
        ctx.userId,
        "refund.approve",
        "Refund",
        args.id,
        { status: "refund_pending" },
        { status: "refunded", amountMinor: refund.amountMinor, destination: refund.destination },
      );
      return updated;
    },
  }),

  updateFeeConfig: t.prismaField({
    type: "FeeConfig",
    authScopes: { admin: true },
    args: {
      smallBusinessCommissionBps: t.arg.int({ required: true }),
      smallBusinessPlatformFeeMinor: t.arg.int({ required: true }),
      chainCommissionBps: t.arg.int({ required: true }),
      chainPlatformFeeMinor: t.arg.int({ required: true }),
      // Featured-slot daily rates (#22). Optional so existing callers keep working;
      // when omitted they carry forward from the current config version.
      featuredSlotDailyRateSmallMinor: t.arg.int({ required: false }),
      featuredSlotDailyRateChainMinor: t.arg.int({ required: false }),
    },
    resolve: async (_q, _root, args, ctx) => {
      for (const [k, v] of Object.entries(args)) {
        if (v != null && (v < 0 || v > 100_000))
          throw new GraphQLError(`Please enter a value between 0 and 100,000 for ${k}.`, {
            extensions: { code: "validation_error" },
          });
      }
      const current = await prisma.feeConfig.findFirst({ orderBy: { createdAt: "desc" } });
      const data = {
        smallBusinessCommissionBps: args.smallBusinessCommissionBps,
        smallBusinessPlatformFeeMinor: args.smallBusinessPlatformFeeMinor,
        chainCommissionBps: args.chainCommissionBps,
        chainPlatformFeeMinor: args.chainPlatformFeeMinor,
        featuredSlotDailyRateSmallMinor:
          args.featuredSlotDailyRateSmallMinor ?? current?.featuredSlotDailyRateSmallMinor ?? 0,
        featuredSlotDailyRateChainMinor:
          args.featuredSlotDailyRateChainMinor ??
          current?.featuredSlotDailyRateChainMinor ??
          50_000,
      };
      const created = await prisma.feeConfig.create({
        data: { ...data, createdByUserId: ctx.userId },
      });
      await audit(ctx.userId, "fees.update", "FeeConfig", created.id, null, data);
      return created;
    },
  }),

  runPayoutBatch: t.prismaField({
    type: ["Payout"],
    authScopes: { admin: true },
    args: { restaurantId: t.arg.string({ required: false }) },
    resolve: async (_q, _root, args, ctx) => {
      const restaurants = await prisma.restaurant.findMany({
        where: { status: "approved", ...(args.restaurantId ? { id: args.restaurantId } : {}) },
      });
      const payouts = [];
      for (const r of restaurants) {
        const payout = await prisma.$transaction(async (tx) => {
          const balance = await accountBalance(tx as never, `restaurant:${r.id}:payable`);
          if (balance <= 0) return null;
          const created = await tx.payout.create({
            data: {
              restaurantId: r.id,
              periodStart: new Date(Date.now() - 7 * 24 * 60 * 60_000),
              periodEnd: new Date(),
              amountMinor: balance,
              status: "paid",
              paidAt: new Date(),
              reference: `PO-${Date.now().toString(36).toUpperCase()}-${r.slug.slice(0, 8)}`,
            },
          });
          const txId = await postLedgerTx(
            tx,
            `Payout ${created.reference} to ${r.name}`,
            [
              {
                code: `restaurant:${r.id}:payable`,
                ownerType: "restaurant",
                ownerId: r.id,
                debit: balance,
              },
              { code: "platform:cash", ownerType: "platform", credit: balance },
            ],
            { payoutId: created.id },
          );
          return tx.payout.update({ where: { id: created.id }, data: { ledgerTxId: txId } });
        });
        if (payout) {
          payouts.push(payout);
          await audit(ctx.userId, "payout.run", "Payout", payout.id, null, {
            restaurantId: r.id,
            amountMinor: payout.amountMinor,
          });
        }
      }
      return payouts;
    },
  }),

  // Settle a restaurant-requested payout (#157): move it out of the per-restaurant
  // payout-clearing account into platform:cash and mark it paid. Pairs with requestPayout.
  markPayoutPaid: t.prismaField({
    type: "Payout",
    authScopes: { admin: true },
    args: { payoutId: t.arg.string({ required: true }) },
    resolve: async (query, _root, args, ctx) => {
      const paid = await prisma.$transaction(async (tx) => {
        const p = await tx.payout.findUnique({ where: { id: args.payoutId } });
        if (!p)
          throw new GraphQLError("We couldn't find that payout.", {
            extensions: { code: "not_found" },
          });
        if (p.status !== "pending")
          throw new GraphQLError("That payout isn't pending.", {
            extensions: { code: "invalid_state" },
          });
        const txId = await postLedgerTx(
          tx,
          `Payout paid ${p.reference}`,
          [
            {
              code: `restaurant:${p.restaurantId}:payout_clearing`,
              ownerType: "restaurant",
              ownerId: p.restaurantId,
              debit: p.amountMinor,
            },
            { code: "platform:cash", ownerType: "platform", credit: p.amountMinor },
          ],
          { payoutId: p.id },
        );
        return tx.payout.update({
          ...query,
          where: { id: p.id },
          data: { status: "paid", paidAt: new Date(), ledgerTxId: txId },
        });
      });
      await audit(ctx.userId, "payout.paid", "Payout", paid.id, null, {
        amountMinor: paid.amountMinor,
      });
      return paid;
    },
  }),

  // Bounded, audited goodwill credit to a customer's wallet (platform:revenue funds it).
  // Returns the customer's new prepaid balance in minor units.
  issueGoodwillCredit: t.field({
    type: "Int",
    authScopes: { admin: true },
    args: {
      customerId: t.arg.string({ required: true }),
      amountMinor: t.arg.int({ required: true }),
      reason: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      // Bound the credit so a mis-click can't mint an unlimited balance (Rs 1 – Rs 50,000).
      if (args.amountMinor < 100 || args.amountMinor > 5_000_000) {
        throw new GraphQLError("Goodwill credit must be between Rs 1 and Rs 50,000.", {
          extensions: { code: "validation_error" },
        });
      }
      const customer = await prisma.user.findUnique({ where: { id: args.customerId } });
      if (!customer)
        throw new GraphQLError("We couldn't find that customer.", {
          extensions: { code: "not_found" },
        });

      const balance = await prisma.$transaction(async (tx) => {
        await onGoodwillCredit(
          tx,
          args.customerId,
          args.amountMinor,
          `Goodwill credit — ${args.reason}`,
        );
        return accountBalance(tx, `customer:${args.customerId}:prepaid`);
      });
      await audit(ctx.userId, "wallet.goodwill_credit", "User", args.customerId, null, {
        amountMinor: args.amountMinor,
        reason: args.reason,
      });
      return balance;
    },
  }),
}));
