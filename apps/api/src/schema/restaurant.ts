// Restaurant console domain: live order board, menu CRUD + publish, riders, wallet,
// onboarding, branch settings. Every resolver verifies branch/restaurant membership.
import { prisma } from "@fd/db";
import { GraphQLError } from "graphql";
import type { AppContext } from "../context.js";
import { transition, type Actor } from "../services/orderService.js";
import { accountBalance } from "../services/ledgerService.js";
import { ensureDraft, publishDraft } from "../services/menuService.js";
import { builder } from "./builder.js";

async function assertBranchMember(ctx: AppContext, branchId: string) {
  const branch = await prisma.branch.findUnique({ where: { id: branchId } });
  if (!branch) throw new GraphQLError("Branch not found");
  if (!ctx.restaurantIds.includes(branch.restaurantId) && !ctx.hasRole("admin")) {
    throw new GraphQLError("Not a member of this restaurant");
  }
  return branch;
}

async function assertOrderBranchMember(ctx: AppContext, orderId: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { branch: true },
  });
  if (!order) throw new GraphQLError("Order not found");
  if (!ctx.restaurantIds.includes(order.branch.restaurantId) && !ctx.hasRole("admin")) {
    throw new GraphQLError("Not a member of this restaurant");
  }
  return order;
}

function restaurantActor(ctx: AppContext): Actor {
  return {
    userId: ctx.userId,
    role: ctx.hasRole("restaurant_owner") ? "restaurant_owner" : "restaurant_staff",
  };
}

// One open window for setBranchHours: minutes are since-midnight (PKT), 0..1439.
// closeMinute <= openMinute means the window spans midnight (see branchHoursOpenState).
const BranchHoursInput = builder.inputType("BranchHoursInput", {
  fields: (t) => ({
    dayOfWeek: t.int({ required: true }),
    openMinute: t.int({ required: true }),
    closeMinute: t.int({ required: true }),
  }),
});

builder.prismaObject("RiderVerificationDoc", {
  fields: (t) => ({
    id: t.exposeID("id"),
    kind: t.exposeString("kind"),
    createdAt: t.field({ type: "DateTime", resolve: (d) => d.createdAt }),
    asset: t.relation("asset"),
  }),
});

builder.prismaObject("Rider", {
  fields: (t) => ({
    id: t.exposeID("id"),
    riderType: t.exposeString("riderType"),
    verificationStatus: t.exposeString("verificationStatus"),
    trustScore: t.exposeInt("trustScore"),
    vehicleType: t.exposeString("vehicleType", { nullable: true }),
    vehiclePlate: t.exposeString("vehiclePlate", { nullable: true }),
    trainingCompleted: t.exposeBoolean("trainingCompleted"),
    agreementAccepted: t.exposeBoolean("agreementAccepted"),
    sharedModeEnabled: t.exposeBoolean("sharedModeEnabled"),
    verifiedAt: t.field({ type: "DateTime", nullable: true, resolve: (r) => r.verifiedAt }),
    rejectionReason: t.exposeString("rejectionReason", { nullable: true }),
    user: t.relation("user"),
    // Identity documents (CNIC/photo) are the admin review queue's concern only. The
    // restaurant roster (branchRiders) shares this Rider type but must never expose these
    // URLs to restaurant owners/staff, so gate the field to admins.
    verificationDocs: t.relation("verificationDocs", { authScopes: { admin: true } }),
    isOnline: t.boolean({
      resolve: async (rider) => {
        const a = await prisma.riderAvailability.findUnique({ where: { riderId: rider.id } });
        return a?.isOnline ?? false;
      },
    }),
  }),
});

const LedgerEntryType = builder.prismaObject("LedgerEntry", {
  fields: (t) => ({
    id: t.exposeID("id"),
    txId: t.exposeString("txId"),
    debitMinor: t.exposeInt("debitMinor"),
    creditMinor: t.exposeInt("creditMinor"),
    memo: t.exposeString("memo"),
    createdAt: t.field({ type: "DateTime", resolve: (e) => e.createdAt }),
  }),
});

builder.prismaObject("Payout", {
  fields: (t) => ({
    id: t.exposeID("id"),
    amountMinor: t.exposeInt("amountMinor"),
    status: t.exposeString("status"),
    reference: t.exposeString("reference", { nullable: true }),
    periodStart: t.field({ type: "DateTime", resolve: (p) => p.periodStart }),
    periodEnd: t.field({ type: "DateTime", resolve: (p) => p.periodEnd }),
    paidAt: t.field({ type: "DateTime", nullable: true, resolve: (p) => p.paidAt }),
  }),
});

// Owner analytics (#21): a top-selling item, tallied by snapshot name (see popularItems
// for why name, not id) with its units sold and gross revenue over the window.
const AnalyticsTopItem = builder.objectRef<{
  name: string;
  qty: number;
  revenueMinor: number;
}>("AnalyticsTopItem");
AnalyticsTopItem.implement({
  fields: (t) => ({
    name: t.exposeString("name"),
    qty: t.exposeInt("qty"),
    revenueMinor: t.exposeInt("revenueMinor"),
  }),
});

// Read-only sales summary over a trailing window, computed from delivered orders.
// ordersByDayOfWeek is indexed 0=Sunday…6=Saturday; ordersByHour is 0…23. Both are
// bucketed in PKT so they line up with the branch's opening hours.
type AnalyticsResult = {
  totalOrders: number;
  totalRevenueMinor: number;
  avgOrderValueMinor: number;
  ordersByDayOfWeek: number[];
  ordersByHour: number[];
  topItems: Array<{ name: string; qty: number; revenueMinor: number }>;
};
const RestaurantAnalytics = builder.objectRef<AnalyticsResult>("RestaurantAnalytics");
RestaurantAnalytics.implement({
  fields: (t) => ({
    totalOrders: t.exposeInt("totalOrders"),
    totalRevenueMinor: t.exposeInt("totalRevenueMinor"),
    avgOrderValueMinor: t.exposeInt("avgOrderValueMinor"),
    ordersByDayOfWeek: t.field({ type: ["Int"], resolve: (a) => a.ordersByDayOfWeek }),
    ordersByHour: t.field({ type: ["Int"], resolve: (a) => a.ordersByHour }),
    topItems: t.field({ type: [AnalyticsTopItem], resolve: (a) => a.topItems }),
  }),
});

const PKT_OFFSET_MS = 5 * 60 * 60_000;

// ── queries ─────────────────────────────────────────────────────────────────

builder.queryFields((t) => ({
  myRestaurants: t.prismaField({
    type: ["Restaurant"],
    authScopes: { restaurantMember: true },
    resolve: (query, _root, _args, ctx) =>
      prisma.restaurant.findMany({ ...query, where: { id: { in: ctx.restaurantIds } } }),
  }),

  boardOrders: t.prismaField({
    type: ["Order"],
    authScopes: { restaurantMember: true },
    args: {
      branchId: t.arg.string({ required: true }),
      statuses: t.arg.stringList({ required: false }),
    },
    resolve: async (query, _root, args, ctx) => {
      await assertBranchMember(ctx, args.branchId);
      return prisma.order.findMany({
        ...query,
        where: {
          branchId: args.branchId,
          ...(args.statuses && args.statuses.length > 0
            ? { status: { in: args.statuses as never } }
            : {}),
        },
        orderBy: { placedAt: "desc" },
        take: 100,
      });
    },
  }),

  draftMenu: t.prismaField({
    type: "Menu",
    authScopes: { restaurantMember: true },
    args: { branchId: t.arg.string({ required: true }) },
    resolve: async (query, _root, args, ctx) => {
      await assertBranchMember(ctx, args.branchId);
      const draft = await ensureDraft(args.branchId);
      return prisma.menu.findUniqueOrThrow({ ...query, where: { id: draft.id } });
    },
  }),

  branchRiders: t.prismaField({
    type: ["Rider"],
    authScopes: { restaurantMember: true },
    args: { branchId: t.arg.string({ required: true }) },
    resolve: async (query, _root, args, ctx) => {
      const branch = await assertBranchMember(ctx, args.branchId);
      return prisma.rider.findMany({
        ...query,
        where: { restaurantId: branch.restaurantId },
      });
    },
  }),

  walletBalance: t.int({
    authScopes: { restaurantMember: true },
    args: { restaurantId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      if (!ctx.restaurantIds.includes(args.restaurantId) && !ctx.hasRole("admin")) {
        throw new GraphQLError("Not a member of this restaurant");
      }
      return prisma.$transaction((tx) =>
        accountBalance(tx as never, `restaurant:${args.restaurantId}:payable`),
      );
    },
  }),

  walletStatement: t.prismaField({
    type: [LedgerEntryType],
    authScopes: { restaurantMember: true },
    args: { restaurantId: t.arg.string({ required: true }) },
    resolve: async (query, _root, args, ctx) => {
      if (!ctx.restaurantIds.includes(args.restaurantId) && !ctx.hasRole("admin")) {
        throw new GraphQLError("Not a member of this restaurant");
      }
      return prisma.ledgerEntry.findMany({
        ...query,
        where: { account: { code: `restaurant:${args.restaurantId}:payable` } },
        orderBy: { createdAt: "desc" },
        take: 100,
      });
    },
  }),

  payoutHistory: t.prismaField({
    type: ["Payout"],
    authScopes: { restaurantMember: true },
    args: { restaurantId: t.arg.string({ required: true }) },
    resolve: async (query, _root, args, ctx) => {
      if (!ctx.restaurantIds.includes(args.restaurantId) && !ctx.hasRole("admin")) {
        throw new GraphQLError("Not a member of this restaurant");
      }
      return prisma.payout.findMany({
        ...query,
        where: { restaurantId: args.restaurantId },
        orderBy: { createdAt: "desc" },
      });
    },
  }),

  // Owner sales analytics for a branch over a trailing window (#21). Read-only, computed
  // live from delivered Order/OrderItem rows — no schema change, no stored aggregates.
  restaurantAnalytics: t.field({
    type: RestaurantAnalytics,
    authScopes: { restaurantMember: true },
    args: {
      branchId: t.arg.string({ required: true }),
      days: t.arg.int({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      await assertBranchMember(ctx, args.branchId);
      const days = Math.min(Math.max(args.days ?? 30, 1), 365);
      const since = new Date(Date.now() - days * 24 * 60 * 60_000);
      const orders = await prisma.order.findMany({
        where: { branchId: args.branchId, status: "delivered", placedAt: { gte: since } },
        select: {
          grandTotalMinor: true,
          placedAt: true,
          items: { select: { qty: true, lineTotalMinor: true, menuSnapshotJson: true } },
        },
      });

      const ordersByDayOfWeek = Array<number>(7).fill(0);
      const ordersByHour = Array<number>(24).fill(0);
      const tally = new Map<string, { qty: number; revenueMinor: number }>();
      let totalRevenueMinor = 0;

      for (const o of orders) {
        totalRevenueMinor += o.grandTotalMinor;
        // Bucket in PKT wall-clock (read UTC getters on the shifted instant).
        const pkt = new Date(o.placedAt.getTime() + PKT_OFFSET_MS);
        const dow = pkt.getUTCDay();
        const hour = pkt.getUTCHours();
        ordersByDayOfWeek[dow] = (ordersByDayOfWeek[dow] ?? 0) + 1;
        ordersByHour[hour] = (ordersByHour[hour] ?? 0) + 1;
        for (const it of o.items) {
          const snap = it.menuSnapshotJson as { name?: string } | null;
          const name = snap?.name;
          if (!name) continue;
          const agg = tally.get(name) ?? { qty: 0, revenueMinor: 0 };
          agg.qty += it.qty;
          agg.revenueMinor += it.lineTotalMinor;
          tally.set(name, agg);
        }
      }

      const topItems = [...tally.entries()]
        .map(([name, v]) => ({ name, qty: v.qty, revenueMinor: v.revenueMinor }))
        .sort((a, b) => b.qty - a.qty)
        .slice(0, 10);

      const totalOrders = orders.length;
      return {
        totalOrders,
        totalRevenueMinor,
        avgOrderValueMinor: totalOrders ? Math.round(totalRevenueMinor / totalOrders) : 0,
        ordersByDayOfWeek,
        ordersByHour,
        topItems,
      };
    },
  }),
}));

// ── order actions ───────────────────────────────────────────────────────────

builder.mutationFields((t) => ({
  acceptOrder: t.prismaField({
    type: "Order",
    authScopes: { restaurantMember: true },
    args: {
      id: t.arg.string({ required: true }),
      prepEtaMinutes: t.arg.int({ required: true }),
    },
    resolve: async (_q, _root, args, ctx) => {
      await assertOrderBranchMember(ctx, args.id);
      await transition(args.id, "accepted", restaurantActor(ctx), {
        expectedFrom: "pending_acceptance",
      });
      return prisma.order.update({
        where: { id: args.id },
        data: { prepEtaMinutes: args.prepEtaMinutes },
      });
    },
  }),

  rejectOrder: t.prismaField({
    type: "Order",
    authScopes: { restaurantMember: true },
    args: {
      id: t.arg.string({ required: true }),
      reason: t.arg.string({ required: true }),
    },
    resolve: async (_q, _root, args, ctx) => {
      await assertOrderBranchMember(ctx, args.id);
      if (!args.reason.trim()) throw new GraphQLError("A rejection reason is required");
      return transition(args.id, "rejected", restaurantActor(ctx), { reason: args.reason });
    },
  }),

  startPreparing: t.prismaField({
    type: "Order",
    authScopes: { restaurantMember: true },
    args: { id: t.arg.string({ required: true }) },
    resolve: async (_q, _root, args, ctx) => {
      await assertOrderBranchMember(ctx, args.id);
      return transition(args.id, "preparing", restaurantActor(ctx));
    },
  }),

  updatePrepEta: t.prismaField({
    type: "Order",
    authScopes: { restaurantMember: true },
    args: {
      id: t.arg.string({ required: true }),
      prepEtaMinutes: t.arg.int({ required: true }),
    },
    resolve: async (_q, _root, args, ctx) => {
      await assertOrderBranchMember(ctx, args.id);
      return prisma.order.update({
        where: { id: args.id },
        data: { prepEtaMinutes: args.prepEtaMinutes },
      });
    },
  }),

  markReady: t.prismaField({
    type: "Order",
    authScopes: { restaurantMember: true },
    args: { id: t.arg.string({ required: true }) },
    resolve: async (_q, _root, args, ctx) => {
      await assertOrderBranchMember(ctx, args.id);
      return transition(args.id, "ready_for_pickup", restaurantActor(ctx));
    },
  }),

  assignRider: t.prismaField({
    type: "Order",
    authScopes: { restaurantMember: true },
    args: {
      orderId: t.arg.string({ required: true }),
      riderId: t.arg.string({ required: true }),
    },
    resolve: async (_q, _root, args, ctx) => {
      const order = await assertOrderBranchMember(ctx, args.orderId);
      const rider = await prisma.rider.findUnique({ where: { id: args.riderId } });
      if (!rider || rider.restaurantId !== order.branch.restaurantId) {
        throw new GraphQLError("Rider is not on this restaurant's roster");
      }
      if (rider.verificationStatus === "rejected") {
        throw new GraphQLError("Rider has been rejected and cannot be assigned jobs");
      }
      await prisma.deliveryTask.upsert({
        where: { orderId: args.orderId },
        update: { riderId: args.riderId, status: "assigned", assignedAt: new Date() },
        create: {
          orderId: args.orderId,
          riderId: args.riderId,
          status: "assigned",
          assignedAt: new Date(),
          codAmountMinor: order.paymentMode === "cod" ? order.grandTotalMinor : 0,
        },
      });
      await prisma.deliveryEvent.create({
        data: {
          taskId: (
            await prisma.deliveryTask.findUniqueOrThrow({ where: { orderId: args.orderId } })
          ).id,
          type: "assigned",
          actorUserId: ctx.userId,
        },
      });
      return transition(args.orderId, "rider_assigned", restaurantActor(ctx), {
        expectedFrom: "ready_for_pickup",
      });
    },
  }),

  // Offer a job to a rider for swipe-to-accept (additive alternative to assignRider,
  // which hard-assigns). Creates/updates the DeliveryTask in `offered` state with the
  // rider attached so it surfaces in that rider's myJobs; the order itself stays
  // ready_for_pickup until the rider accepts (acceptTask promotes it to rider_assigned).
  offerTask: t.prismaField({
    type: "DeliveryTask",
    authScopes: { restaurantMember: true },
    args: {
      orderId: t.arg.string({ required: true }),
      riderId: t.arg.string({ required: true }),
    },
    resolve: async (query, _root, args, ctx) => {
      const order = await assertOrderBranchMember(ctx, args.orderId);
      const rider = await prisma.rider.findUnique({ where: { id: args.riderId } });
      if (!rider || rider.restaurantId !== order.branch.restaurantId) {
        throw new GraphQLError("Rider is not on this restaurant's roster");
      }
      if (rider.verificationStatus === "rejected") {
        throw new GraphQLError("Rider has been rejected and cannot be offered jobs");
      }
      const task = await prisma.deliveryTask.upsert({
        where: { orderId: args.orderId },
        update: {
          riderId: args.riderId,
          status: "offered",
          offeredAt: new Date(),
          acceptedAt: null,
          assignedAt: null,
          declineReason: null,
        },
        create: {
          orderId: args.orderId,
          riderId: args.riderId,
          status: "offered",
          offeredAt: new Date(),
          codAmountMinor: order.paymentMode === "cod" ? order.grandTotalMinor : 0,
        },
      });
      await prisma.deliveryEvent.create({
        data: { taskId: task.id, type: "offered", actorUserId: ctx.userId },
      });
      return prisma.deliveryTask.findUniqueOrThrow({ ...query, where: { id: task.id } });
    },
  }),

  setAcceptingOrders: t.prismaField({
    type: "Branch",
    authScopes: { restaurantMember: true },
    args: {
      branchId: t.arg.string({ required: true }),
      accepting: t.arg.boolean({ required: true }),
    },
    resolve: async (_q, _root, args, ctx) => {
      await assertBranchMember(ctx, args.branchId);
      return prisma.branch.update({
        where: { id: args.branchId },
        data: { isAcceptingOrders: args.accepting },
      });
    },
  }),

  // Replace a branch's structured opening hours (#19) with the provided set (a full
  // overwrite — pass [] to clear, which reverts isOpenNow to the always-open fallback).
  // Once any rows exist they take precedence over the legacy hoursJson everywhere.
  setBranchHours: t.prismaField({
    type: "Branch",
    authScopes: { restaurantMember: true },
    args: {
      branchId: t.arg.string({ required: true }),
      hours: t.arg({ type: [BranchHoursInput], required: true }),
    },
    resolve: async (_q, _root, args, ctx) => {
      await assertBranchMember(ctx, args.branchId);
      for (const h of args.hours) {
        if (h.dayOfWeek < 0 || h.dayOfWeek > 6) throw new GraphQLError("dayOfWeek must be 0-6");
        if (h.openMinute < 0 || h.openMinute > 1439 || h.closeMinute < 0 || h.closeMinute > 1439) {
          throw new GraphQLError("Minutes must be within a day (0-1439)");
        }
      }
      await prisma.$transaction(async (tx) => {
        await tx.branchHours.deleteMany({ where: { branchId: args.branchId } });
        if (args.hours.length > 0) {
          await tx.branchHours.createMany({
            data: args.hours.map((h) => ({
              branchId: args.branchId,
              dayOfWeek: h.dayOfWeek,
              openMinute: h.openMinute,
              closeMinute: h.closeMinute,
            })),
          });
        }
      });
      return prisma.branch.findUniqueOrThrow({ where: { id: args.branchId } });
    },
  }),

  inviteRider: t.prismaField({
    type: "Rider",
    authScopes: { restaurantMember: true },
    args: {
      branchId: t.arg.string({ required: true }),
      phone: t.arg.string({ required: true }),
      name: t.arg.string({ required: true }),
    },
    resolve: async (_q, _root, args, ctx) => {
      const branch = await assertBranchMember(ctx, args.branchId);
      if (!/^\+92\d{10}$/.test(args.phone)) throw new GraphQLError("Invalid phone");
      const user = await prisma.user.upsert({
        where: { phone: args.phone },
        update: {},
        create: { phone: args.phone, name: args.name },
      });
      const existingRider = await prisma.rider.findUnique({ where: { userId: user.id } });
      if (existingRider) throw new GraphQLError("This person is already a rider");
      const hasRole = await prisma.userRole.findFirst({
        where: { userId: user.id, role: "rider" },
      });
      if (!hasRole) {
        await prisma.userRole.create({ data: { userId: user.id, role: "rider" } });
      }
      return prisma.rider.create({
        data: {
          userId: user.id,
          riderType: "restaurant",
          restaurantId: branch.restaurantId,
          verificationStatus: "verified",
        },
      });
    },
  }),

  // ── menu CRUD (operates on the draft) ─────────────────────────────────────

  upsertCategory: t.prismaField({
    type: "MenuCategory",
    authScopes: { restaurantMember: true },
    args: {
      branchId: t.arg.string({ required: true }),
      id: t.arg.string({ required: false }),
      name: t.arg.string({ required: true }),
      description: t.arg.string({ required: false }),
      sortOrder: t.arg.int({ required: false }),
    },
    resolve: async (_q, _root, args, ctx) => {
      await assertBranchMember(ctx, args.branchId);
      const draft = await ensureDraft(args.branchId);
      if (args.id) {
        const cat = await prisma.menuCategory.findUnique({ where: { id: args.id } });
        if (!cat || cat.menuId !== draft.id) throw new GraphQLError("Category not in draft");
        return prisma.menuCategory.update({
          where: { id: args.id },
          data: {
            name: args.name,
            description: args.description,
            sortOrder: args.sortOrder ?? cat.sortOrder,
          },
        });
      }
      const count = await prisma.menuCategory.count({ where: { menuId: draft.id } });
      return prisma.menuCategory.create({
        data: {
          menuId: draft.id,
          name: args.name,
          description: args.description,
          sortOrder: args.sortOrder ?? count,
        },
      });
    },
  }),

  upsertMenuItem: t.prismaField({
    type: "MenuItem",
    authScopes: { restaurantMember: true },
    args: {
      branchId: t.arg.string({ required: true }),
      categoryId: t.arg.string({ required: true }),
      id: t.arg.string({ required: false }),
      name: t.arg.string({ required: true }),
      description: t.arg.string({ required: false }),
      priceMinor: t.arg.int({ required: true }),
      badges: t.arg.stringList({ required: false }),
    },
    resolve: async (_q, _root, args, ctx) => {
      await assertBranchMember(ctx, args.branchId);
      const draft = await ensureDraft(args.branchId);
      const category = await prisma.menuCategory.findUnique({ where: { id: args.categoryId } });
      if (!category || category.menuId !== draft.id)
        throw new GraphQLError("Category not in draft");
      if (args.priceMinor <= 0) throw new GraphQLError("Price must be positive");
      const data = {
        categoryId: args.categoryId,
        name: args.name,
        description: args.description,
        priceMinor: args.priceMinor,
        badges: args.badges ?? [],
      };
      if (args.id) {
        const item = await prisma.menuItem.findUnique({
          where: { id: args.id },
          include: { category: true },
        });
        if (!item || item.category.menuId !== draft.id) throw new GraphQLError("Item not in draft");
        return prisma.menuItem.update({ where: { id: args.id }, data });
      }
      return prisma.menuItem.create({ data });
    },
  }),

  setItemAvailability: t.prismaField({
    type: "MenuItem",
    authScopes: { restaurantMember: true },
    args: {
      itemId: t.arg.string({ required: true }),
      available: t.arg.boolean({ required: true }),
    },
    resolve: async (_q, _root, args, ctx) => {
      const item = await prisma.menuItem.findUnique({
        where: { id: args.itemId },
        include: { category: { include: { menu: true } } },
      });
      if (!item) throw new GraphQLError("Item not found");
      await assertBranchMember(ctx, item.category.menu.branchId);
      // Availability applies to BOTH the live menu item and the draft twin (by name) —
      // stock-outs must hit customers immediately, not on next publish.
      return prisma.menuItem.update({
        where: { id: args.itemId },
        data: { isAvailable: args.available },
      });
    },
  }),

  deleteMenuItem: t.field({
    type: "Boolean",
    authScopes: { restaurantMember: true },
    args: { itemId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      const item = await prisma.menuItem.findUnique({
        where: { id: args.itemId },
        include: { category: { include: { menu: true } } },
      });
      if (!item) throw new GraphQLError("Item not found");
      if (item.category.menu.status !== "draft")
        throw new GraphQLError("Only draft items can be deleted");
      await assertBranchMember(ctx, item.category.menu.branchId);
      await prisma.menuItemModifierGroup.deleteMany({ where: { itemId: args.itemId } });
      await prisma.menuItem.delete({ where: { id: args.itemId } });
      return true;
    },
  }),

  // ── modifier group / option CRUD (#20, operates on the draft) ─────────────
  // Modifier groups are menu-scoped (ModifierGroup.menuId) and attached to items via
  // the MenuItemModifierGroup join. All mutations below only touch the branch draft —
  // published menus are immutable and orders freeze a menuSnapshotJson, so live orders
  // are never affected. `required` is derived as minSelect >= 1 (no separate column).

  upsertModifierGroup: t.prismaField({
    type: "ModifierGroup",
    authScopes: { restaurantMember: true },
    args: {
      branchId: t.arg.string({ required: true }),
      id: t.arg.string({ required: false }),
      name: t.arg.string({ required: true }),
      minSelect: t.arg.int({ required: true }),
      maxSelect: t.arg.int({ required: true }),
      // When provided, ensures this draft item is linked to the group (idempotent).
      itemId: t.arg.string({ required: false }),
    },
    resolve: async (_q, _root, args, ctx) => {
      await assertBranchMember(ctx, args.branchId);
      const draft = await ensureDraft(args.branchId);
      if (!args.name.trim()) throw new GraphQLError("Group name is required");
      if (args.minSelect < 0 || args.maxSelect < 1 || args.minSelect > args.maxSelect) {
        throw new GraphQLError("Invalid min/max selection");
      }
      if (args.itemId) {
        const item = await prisma.menuItem.findUnique({
          where: { id: args.itemId },
          include: { category: true },
        });
        if (!item || item.category.menuId !== draft.id)
          throw new GraphQLError("Item not in draft");
      }
      let group;
      if (args.id) {
        const existing = await prisma.modifierGroup.findUnique({ where: { id: args.id } });
        if (!existing || existing.menuId !== draft.id)
          throw new GraphQLError("Group not in draft");
        group = await prisma.modifierGroup.update({
          where: { id: args.id },
          data: { name: args.name, minSelect: args.minSelect, maxSelect: args.maxSelect },
        });
      } else {
        group = await prisma.modifierGroup.create({
          data: {
            menuId: draft.id,
            name: args.name,
            minSelect: args.minSelect,
            maxSelect: args.maxSelect,
          },
        });
      }
      if (args.itemId) {
        const sortOrder = await prisma.menuItemModifierGroup.count({
          where: { itemId: args.itemId },
        });
        await prisma.menuItemModifierGroup.upsert({
          where: { itemId_groupId: { itemId: args.itemId, groupId: group.id } },
          update: {},
          create: { itemId: args.itemId, groupId: group.id, sortOrder },
        });
      }
      return group;
    },
  }),

  deleteModifierGroup: t.field({
    type: "Boolean",
    authScopes: { restaurantMember: true },
    args: { id: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      const group = await prisma.modifierGroup.findUnique({
        where: { id: args.id },
        include: { menu: true },
      });
      if (!group) throw new GraphQLError("Group not found");
      if (group.menu.status !== "draft")
        throw new GraphQLError("Only draft modifier groups can be deleted");
      await assertBranchMember(ctx, group.menu.branchId);
      await prisma.$transaction(async (tx) => {
        await tx.menuItemModifierGroup.deleteMany({ where: { groupId: args.id } });
        await tx.modifierOption.deleteMany({ where: { groupId: args.id } });
        await tx.modifierGroup.delete({ where: { id: args.id } });
      });
      return true;
    },
  }),

  upsertModifierOption: t.prismaField({
    type: "ModifierOption",
    authScopes: { restaurantMember: true },
    args: {
      groupId: t.arg.string({ required: true }),
      id: t.arg.string({ required: false }),
      name: t.arg.string({ required: true }),
      priceDeltaMinor: t.arg.int({ required: true }),
      isAvailable: t.arg.boolean({ required: false }),
    },
    resolve: async (_q, _root, args, ctx) => {
      const group = await prisma.modifierGroup.findUnique({
        where: { id: args.groupId },
        include: { menu: true },
      });
      if (!group) throw new GraphQLError("Group not found");
      if (group.menu.status !== "draft")
        throw new GraphQLError("Only draft modifier options can be edited");
      await assertBranchMember(ctx, group.menu.branchId);
      if (!args.name.trim()) throw new GraphQLError("Option name is required");
      if (args.priceDeltaMinor < 0) throw new GraphQLError("Price delta cannot be negative");
      const data = {
        name: args.name,
        priceDeltaMinor: args.priceDeltaMinor,
        isAvailable: args.isAvailable ?? true,
      };
      if (args.id) {
        const existing = await prisma.modifierOption.findUnique({ where: { id: args.id } });
        if (!existing || existing.groupId !== args.groupId)
          throw new GraphQLError("Option not in group");
        return prisma.modifierOption.update({ where: { id: args.id }, data });
      }
      const sortOrder = await prisma.modifierOption.count({ where: { groupId: args.groupId } });
      return prisma.modifierOption.create({
        data: { groupId: args.groupId, ...data, sortOrder },
      });
    },
  }),

  deleteModifierOption: t.field({
    type: "Boolean",
    authScopes: { restaurantMember: true },
    args: { id: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      const option = await prisma.modifierOption.findUnique({
        where: { id: args.id },
        include: { group: { include: { menu: true } } },
      });
      if (!option) throw new GraphQLError("Option not found");
      if (option.group.menu.status !== "draft")
        throw new GraphQLError("Only draft modifier options can be deleted");
      await assertBranchMember(ctx, option.group.menu.branchId);
      await prisma.modifierOption.delete({ where: { id: args.id } });
      return true;
    },
  }),

  // ── menu item photo (#50 image pipeline reuse) ────────────────────────────
  // Set or clear a draft item's uploaded photo. Reuses the presign/finalize/MediaAsset
  // flow (media.ts): the client uploads via presignUpload+finalizeUpload, then passes the
  // finalized assetId here. Pass mediaId:null to clear. Item.imageUrl reads it back.
  setMenuItemPhoto: t.prismaField({
    type: "MenuItem",
    authScopes: { restaurantMember: true },
    args: {
      menuItemId: t.arg.string({ required: true }),
      mediaId: t.arg.string({ required: false }),
    },
    resolve: async (_q, _root, args, ctx) => {
      const item = await prisma.menuItem.findUnique({
        where: { id: args.menuItemId },
        include: { category: { include: { menu: true } } },
      });
      if (!item) throw new GraphQLError("Item not found");
      if (item.category.menu.status !== "draft")
        throw new GraphQLError("Only draft items can be edited");
      await assertBranchMember(ctx, item.category.menu.branchId);
      if (args.mediaId) {
        const asset = await prisma.mediaAsset.findUnique({ where: { id: args.mediaId } });
        if (!asset || asset.status !== "finalized")
          throw new GraphQLError("Asset not finalized");
      }
      return prisma.menuItem.update({
        where: { id: args.menuItemId },
        data: { imageAssetId: args.mediaId ?? null },
      });
    },
  }),

  publishMenu: t.prismaField({
    type: "Menu",
    authScopes: { restaurantMember: true },
    args: { branchId: t.arg.string({ required: true }) },
    resolve: async (_q, _root, args, ctx) => {
      await assertBranchMember(ctx, args.branchId);
      return publishDraft(args.branchId);
    },
  }),

  // ── onboarding ────────────────────────────────────────────────────────────

  submitOnboarding: t.prismaField({
    type: "Restaurant",
    authScopes: { loggedIn: true },
    args: {
      name: t.arg.string({ required: true }),
      addressText: t.arg.string({ required: true }),
      lat: t.arg.float({ required: true }),
      lng: t.arg.float({ required: true }),
      minOrderMinor: t.arg.int({ required: true }),
      deliveryFeeMinor: t.arg.int({ required: true }),
      deliveryRadiusM: t.arg.int({ required: true }),
    },
    resolve: async (_q, _root, args, ctx) => {
      const slugBase = args.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
      const slug = `${slugBase}-${Math.random().toString(36).slice(2, 6)}`;
      const taxProfile = await prisma.taxProfile.findFirstOrThrow();
      const restaurant = await prisma.restaurant.create({
        data: {
          name: args.name,
          slug,
          status: "pending_approval",
          ownerId: ctx.userId!,
          branches: {
            create: {
              name: "Main Branch",
              addressText: args.addressText,
              lat: args.lat as never,
              lng: args.lng as never,
              minOrderMinor: args.minOrderMinor,
              deliveryFeeMinor: args.deliveryFeeMinor,
              deliveryRadiusM: args.deliveryRadiusM,
              taxProfileId: taxProfile.id,
            },
          },
        },
      });
      await prisma.userRole.create({
        data: { userId: ctx.userId!, role: "restaurant_owner", restaurantId: restaurant.id },
      });
      return restaurant;
    },
  }),
}));
