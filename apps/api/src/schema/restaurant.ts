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

builder.prismaObject("Rider", {
  fields: (t) => ({
    id: t.exposeID("id"),
    riderType: t.exposeString("riderType"),
    verificationStatus: t.exposeString("verificationStatus"),
    user: t.relation("user"),
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
      const updated = await transition(args.id, "accepted", restaurantActor(ctx), {
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
          taskId: (await prisma.deliveryTask.findUniqueOrThrow({ where: { orderId: args.orderId } })).id,
          type: "assigned",
          actorUserId: ctx.userId,
        },
      });
      return transition(args.orderId, "rider_assigned", restaurantActor(ctx), {
        expectedFrom: "ready_for_pickup",
      });
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
      if (!category || category.menuId !== draft.id) throw new GraphQLError("Category not in draft");
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
      if (item.category.menu.status !== "draft") throw new GraphQLError("Only draft items can be deleted");
      await assertBranchMember(ctx, item.category.menu.branchId);
      await prisma.menuItemModifierGroup.deleteMany({ where: { itemId: args.itemId } });
      await prisma.menuItem.delete({ where: { id: args.itemId } });
      return true;
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
      const slugBase = args.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
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
