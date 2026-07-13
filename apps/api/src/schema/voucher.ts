// Voucher / promo-code domain (#52): admin CRUD + budget/usage exposure, and a
// customer-facing "available offers" list for the checkout sheet. Validation/pricing
// lives in services/voucherService; this module is the GraphQL surface only.
import { prisma } from "@fd/db";
import { normalizeVoucherCode } from "@fd/shared";
import { GraphQLError } from "graphql";
import type { AppContext } from "../context.js";
import { builder } from "./builder.js";

// Owner guard for restaurant-scoped voucher management (#159).
function assertOwnsRestaurant(ctx: AppContext, restaurantId: string) {
  if (!ctx.restaurantIds.includes(restaurantId) && !ctx.hasRole("admin")) {
    throw new GraphQLError("You don't have access to this restaurant.", {
      extensions: { code: "forbidden" },
    });
  }
}

const VOUCHER_TYPES = ["percentage", "fixed", "free_delivery"] as const;
const VOUCHER_SCOPES = ["platform", "restaurant"] as const;
const VOUCHER_FUNDERS = ["platform", "restaurant", "split"] as const;

builder.prismaObject("Voucher", {
  fields: (t) => ({
    id: t.exposeID("id"),
    code: t.exposeString("code"),
    description: t.exposeString("description", { nullable: true }),
    type: t.exposeString("type"),
    scope: t.exposeString("scope"),
    funder: t.exposeString("funder"),
    valueBps: t.exposeInt("valueBps"),
    valueMinor: t.exposeInt("valueMinor"),
    maxDiscountMinor: t.exposeInt("maxDiscountMinor", { nullable: true }),
    minOrderMinor: t.exposeInt("minOrderMinor"),
    firstOrderOnly: t.exposeBoolean("firstOrderOnly"),
    perUserLimit: t.exposeInt("perUserLimit", { nullable: true }),
    totalBudgetMinor: t.exposeInt("totalBudgetMinor", { nullable: true }),
    usedBudgetMinor: t.exposeInt("usedBudgetMinor"),
    usedCount: t.exposeInt("usedCount"),
    restaurantId: t.exposeString("restaurantId", { nullable: true }),
    active: t.exposeBoolean("active"),
    startsAt: t.field({ type: "DateTime", nullable: true, resolve: (v) => v.startsAt }),
    endsAt: t.field({ type: "DateTime", nullable: true, resolve: (v) => v.endsAt }),
    createdAt: t.field({ type: "DateTime", resolve: (v) => v.createdAt }),
    // Remaining budget (null = unbudgeted), for the admin usage dashboard.
    remainingBudgetMinor: t.int({
      nullable: true,
      resolve: (v) => (v.totalBudgetMinor == null ? null : v.totalBudgetMinor - v.usedBudgetMinor),
    }),
  }),
});

const VoucherInput = builder.inputType("VoucherInput", {
  fields: (t) => ({
    code: t.string({ required: true }),
    description: t.string({ required: false }),
    type: t.string({ required: true }),
    scope: t.string({ required: false }),
    funder: t.string({ required: false }),
    valueBps: t.int({ required: false }),
    valueMinor: t.int({ required: false }),
    maxDiscountMinor: t.int({ required: false }),
    minOrderMinor: t.int({ required: false }),
    firstOrderOnly: t.boolean({ required: false }),
    perUserLimit: t.int({ required: false }),
    totalBudgetMinor: t.int({ required: false }),
    restaurantId: t.string({ required: false }),
    startsAt: t.field({ type: "DateTime", required: false }),
    endsAt: t.field({ type: "DateTime", required: false }),
    active: t.boolean({ required: false }),
  }),
});

async function auditVoucher(
  actorUserId: string | null,
  action: string,
  subjectId: string,
  before: unknown,
  after: unknown,
) {
  await prisma.auditLog.create({
    data: {
      actorUserId,
      actorRole: "admin",
      action,
      subjectType: "Voucher",
      subjectId,
      beforeJson: before as never,
      afterJson: after as never,
    },
  });
}

// Validate a create/update payload; throws a GraphQLError on any inconsistency so bad
// vouchers can't be saved (e.g. a percentage with no bps, or scope=restaurant with no id).
function validatePayload(input: {
  type: string;
  scope?: string | null;
  funder?: string | null;
  valueBps?: number | null;
  valueMinor?: number | null;
  restaurantId?: string | null;
}) {
  if (!VOUCHER_TYPES.includes(input.type as never))
    throw new GraphQLError("Please choose a valid voucher type.", {
      extensions: { code: "validation_error" },
    });
  if (input.scope && !VOUCHER_SCOPES.includes(input.scope as never)) {
    throw new GraphQLError("Please choose a valid voucher scope.", {
      extensions: { code: "validation_error" },
    });
  }
  if (input.funder && !VOUCHER_FUNDERS.includes(input.funder as never)) {
    throw new GraphQLError("Please choose a valid voucher funder.", {
      extensions: { code: "validation_error" },
    });
  }
  if (input.type === "percentage" && !(input.valueBps && input.valueBps > 0)) {
    throw new GraphQLError("Percentage vouchers need a discount value greater than zero.", {
      extensions: { code: "validation_error" },
    });
  }
  if (input.type === "fixed" && !(input.valueMinor && input.valueMinor > 0)) {
    throw new GraphQLError("Fixed vouchers need a discount amount greater than zero.", {
      extensions: { code: "validation_error" },
    });
  }
  if ((input.scope ?? "platform") === "restaurant" && !input.restaurantId) {
    throw new GraphQLError("Restaurant-scoped vouchers need a restaurant to be selected.", {
      extensions: { code: "validation_error" },
    });
  }
}

builder.queryFields((t) => ({
  // Admin: every voucher, newest first (usage dashboard + CRUD list).
  vouchers: t.prismaField({
    type: ["Voucher"],
    authScopes: { admin: true },
    resolve: (query) => prisma.voucher.findMany({ ...query, orderBy: { createdAt: "desc" } }),
  }),

  voucher: t.prismaField({
    type: "Voucher",
    nullable: true,
    authScopes: { admin: true },
    args: { id: t.arg.string({ required: true }) },
    resolve: (query, _root, args) =>
      prisma.voucher.findUnique({ ...query, where: { id: args.id } }),
  }),

  // Customer: the platform-wide (or this-restaurant) active offers, for the checkout
  // "available offers" sheet. Deliberately loose — final eligibility is decided when the
  // code is applied; this is just the discoverable list. Restaurant scope is optional.
  availableVouchers: t.prismaField({
    type: ["Voucher"],
    authScopes: { loggedIn: true },
    args: { restaurantId: t.arg.string({ required: false }) },
    resolve: (query, _root, args) => {
      const now = new Date();
      return prisma.voucher.findMany({
        ...query,
        where: {
          active: true,
          AND: [
            { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
            { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
            {
              OR: [
                { scope: "platform" },
                ...(args.restaurantId
                  ? [{ scope: "restaurant" as const, restaurantId: args.restaurantId }]
                  : []),
              ],
            },
          ],
        },
        orderBy: { createdAt: "desc" },
        take: 20,
      });
    },
  }),

  // Owner: this restaurant's own promo codes (management list + redemption counts). (#159)
  restaurantVouchers: t.prismaField({
    type: ["Voucher"],
    authScopes: { restaurantMember: true },
    args: { restaurantId: t.arg.string({ required: true }) },
    resolve: (query, _root, args, ctx) => {
      assertOwnsRestaurant(ctx, args.restaurantId);
      return prisma.voucher.findMany({
        ...query,
        where: { scope: "restaurant", restaurantId: args.restaurantId },
        orderBy: { createdAt: "desc" },
      });
    },
  }),
}));

builder.mutationFields((t) => ({
  createVoucher: t.prismaField({
    type: "Voucher",
    authScopes: { admin: true },
    args: { input: t.arg({ type: VoucherInput, required: true }) },
    resolve: async (query, _root, args, ctx) => {
      const { input } = args;
      validatePayload(input);
      const code = normalizeVoucherCode(input.code);
      if (!code)
        throw new GraphQLError("Please enter a voucher code.", {
          extensions: { code: "validation_error" },
        });
      const existing = await prisma.voucher.findUnique({ where: { code } });
      if (existing)
        throw new GraphQLError("A voucher with that code already exists.", {
          extensions: { code: "already_exists" },
        });

      const created = await prisma.voucher.create({
        ...query,
        data: {
          code,
          description: input.description ?? null,
          type: input.type as never,
          scope: (input.scope ?? "platform") as never,
          funder: (input.funder ?? "platform") as never,
          valueBps: input.valueBps ?? 0,
          valueMinor: input.valueMinor ?? 0,
          maxDiscountMinor: input.maxDiscountMinor ?? null,
          minOrderMinor: input.minOrderMinor ?? 0,
          firstOrderOnly: input.firstOrderOnly ?? false,
          perUserLimit: input.perUserLimit ?? null,
          totalBudgetMinor: input.totalBudgetMinor ?? null,
          restaurantId: input.restaurantId ?? null,
          startsAt: input.startsAt ?? null,
          endsAt: input.endsAt ?? null,
          active: input.active ?? true,
          createdByUserId: ctx.userId,
        },
      });
      await auditVoucher(ctx.userId, "voucher.create", created.id, null, { code });
      return created;
    },
  }),

  // Owner: create a promo code scoped + funded by their own restaurant (#159). Scope/funder
  // are forced to "restaurant" so an owner can never mint a platform-funded discount.
  createRestaurantVoucher: t.prismaField({
    type: "Voucher",
    authScopes: { restaurantMember: true },
    args: {
      restaurantId: t.arg.string({ required: true }),
      code: t.arg.string({ required: true }),
      description: t.arg.string({ required: false }),
      type: t.arg.string({ required: true }),
      valueBps: t.arg.int({ required: false }),
      valueMinor: t.arg.int({ required: false }),
      maxDiscountMinor: t.arg.int({ required: false }),
      minOrderMinor: t.arg.int({ required: false }),
      perUserLimit: t.arg.int({ required: false }),
      totalBudgetMinor: t.arg.int({ required: false }),
      startsAt: t.arg({ type: "DateTime", required: false }),
      endsAt: t.arg({ type: "DateTime", required: false }),
    },
    resolve: async (query, _root, args, ctx) => {
      assertOwnsRestaurant(ctx, args.restaurantId);
      if (!(VOUCHER_TYPES as readonly string[]).includes(args.type))
        throw new GraphQLError("Please choose a valid discount type.", {
          extensions: { code: "validation_error" },
        });
      if (args.type === "percentage" && !(args.valueBps && args.valueBps > 0))
        throw new GraphQLError("Percentage codes need a discount value greater than zero.", {
          extensions: { code: "validation_error" },
        });
      if (args.type === "fixed" && !(args.valueMinor && args.valueMinor > 0))
        throw new GraphQLError("Fixed codes need a discount amount greater than zero.", {
          extensions: { code: "validation_error" },
        });
      const code = normalizeVoucherCode(args.code);
      if (!code)
        throw new GraphQLError("Please enter a voucher code.", {
          extensions: { code: "validation_error" },
        });
      const existing = await prisma.voucher.findUnique({ where: { code } });
      if (existing)
        throw new GraphQLError("A voucher with that code already exists.", {
          extensions: { code: "already_exists" },
        });
      const created = await prisma.voucher.create({
        ...query,
        data: {
          code,
          description: args.description ?? null,
          type: args.type as never,
          scope: "restaurant" as never,
          funder: "restaurant" as never,
          valueBps: args.valueBps ?? 0,
          valueMinor: args.valueMinor ?? 0,
          maxDiscountMinor: args.maxDiscountMinor ?? null,
          minOrderMinor: args.minOrderMinor ?? 0,
          firstOrderOnly: false,
          perUserLimit: args.perUserLimit ?? null,
          totalBudgetMinor: args.totalBudgetMinor ?? null,
          restaurantId: args.restaurantId,
          startsAt: args.startsAt ?? null,
          endsAt: args.endsAt ?? null,
          active: true,
          createdByUserId: ctx.userId,
        },
      });
      await auditVoucher(ctx.userId, "voucher.create", created.id, null, {
        code,
        restaurantId: args.restaurantId,
      });
      return created;
    },
  }),

  // Owner: enable/disable one of their own restaurant-scoped codes. (#159)
  setRestaurantVoucherActive: t.prismaField({
    type: "Voucher",
    authScopes: { restaurantMember: true },
    args: { id: t.arg.string({ required: true }), active: t.arg.boolean({ required: true }) },
    resolve: async (query, _root, args, ctx) => {
      const v = await prisma.voucher.findUnique({ where: { id: args.id } });
      if (!v || v.scope !== "restaurant" || !v.restaurantId)
        throw new GraphQLError("We couldn't find that voucher.", {
          extensions: { code: "not_found" },
        });
      assertOwnsRestaurant(ctx, v.restaurantId);
      return prisma.voucher.update({
        ...query,
        where: { id: args.id },
        data: { active: args.active },
      });
    },
  }),

  updateVoucher: t.prismaField({
    type: "Voucher",
    authScopes: { admin: true },
    args: {
      id: t.arg.string({ required: true }),
      input: t.arg({ type: VoucherInput, required: true }),
    },
    resolve: async (query, _root, args, ctx) => {
      const before = await prisma.voucher.findUnique({ where: { id: args.id } });
      if (!before)
        throw new GraphQLError("We couldn't find that voucher.", {
          extensions: { code: "not_found" },
        });
      const { input } = args;
      // Merge for validation so partial edits are checked against the resulting state.
      validatePayload({
        type: input.type ?? before.type,
        scope: input.scope ?? before.scope,
        funder: input.funder ?? before.funder,
        valueBps: input.valueBps ?? before.valueBps,
        valueMinor: input.valueMinor ?? before.valueMinor,
        restaurantId: input.restaurantId ?? before.restaurantId,
      });
      const code = normalizeVoucherCode(input.code);
      if (code !== before.code) {
        const clash = await prisma.voucher.findUnique({ where: { code } });
        if (clash)
          throw new GraphQLError("A voucher with that code already exists.", {
            extensions: { code: "already_exists" },
          });
      }
      const updated = await prisma.voucher.update({
        ...query,
        where: { id: args.id },
        data: {
          code,
          description: input.description ?? null,
          type: input.type as never,
          scope: (input.scope ?? "platform") as never,
          funder: (input.funder ?? "platform") as never,
          valueBps: input.valueBps ?? 0,
          valueMinor: input.valueMinor ?? 0,
          maxDiscountMinor: input.maxDiscountMinor ?? null,
          minOrderMinor: input.minOrderMinor ?? 0,
          firstOrderOnly: input.firstOrderOnly ?? false,
          perUserLimit: input.perUserLimit ?? null,
          totalBudgetMinor: input.totalBudgetMinor ?? null,
          restaurantId: input.restaurantId ?? null,
          startsAt: input.startsAt ?? null,
          endsAt: input.endsAt ?? null,
          active: input.active ?? true,
        },
      });
      await auditVoucher(
        ctx.userId,
        "voucher.update",
        args.id,
        { code: before.code, active: before.active },
        { code: updated.code, active: updated.active },
      );
      return updated;
    },
  }),

  // Soft toggle — expiring/pausing a voucher never deletes its redemption history.
  setVoucherActive: t.prismaField({
    type: "Voucher",
    authScopes: { admin: true },
    args: { id: t.arg.string({ required: true }), active: t.arg.boolean({ required: true }) },
    resolve: async (query, _root, args, ctx) => {
      const before = await prisma.voucher.findUnique({ where: { id: args.id } });
      if (!before)
        throw new GraphQLError("We couldn't find that voucher.", {
          extensions: { code: "not_found" },
        });
      const updated = await prisma.voucher.update({
        ...query,
        where: { id: args.id },
        data: { active: args.active },
      });
      await auditVoucher(
        ctx.userId,
        args.active ? "voucher.activate" : "voucher.expire",
        args.id,
        { active: before.active },
        { active: args.active },
      );
      return updated;
    },
  }),
}));
