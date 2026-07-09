// Customer order domain: quoteCart, placeOrder (idempotent), myOrders, order, cancelOrder.
import { prisma } from "@fd/db";
import { placeOrderInputSchema, quoteInputSchema } from "@fd/shared";
import { GraphQLError } from "graphql";
import { placeOrder, transition } from "../services/orderService.js";
import { quoteCart, type QuoteResult } from "../services/quoteService.js";
import { builder } from "./builder.js";

// ── input types ─────────────────────────────────────────────────────────────

const CartLineInput = builder.inputType("CartLineInput", {
  fields: (t) => ({
    menuItemId: t.string({ required: true }),
    qty: t.int({ required: true }),
    modifierOptionIds: t.stringList({ required: false }),
    notes: t.string({ required: false }),
  }),
});

const QuoteCartInput = builder.inputType("QuoteCartInput", {
  fields: (t) => ({
    branchId: t.string({ required: true }),
    lines: t.field({ type: [CartLineInput], required: true }),
    deliveryLat: t.float({ required: true }),
    deliveryLng: t.float({ required: true }),
    tipAmount: t.int({ required: false }),
    redeemPoints: t.int({ required: false }),
  }),
});

const PlaceOrderInputType = builder.inputType("PlaceOrderInput", {
  fields: (t) => ({
    branchId: t.string({ required: true }),
    lines: t.field({ type: [CartLineInput], required: true }),
    deliveryLat: t.float({ required: true }),
    deliveryLng: t.float({ required: true }),
    addressText: t.string({ required: true }),
    addressLabel: t.string({ required: false }),
    contactPhone: t.string({ required: true }),
    customerNote: t.string({ required: false }),
    paymentMode: t.string({ required: true }),
    paymentMethodId: t.string({ required: false }),
    tipAmount: t.int({ required: false }),
    redeemPoints: t.int({ required: false }),
    cutleryRequested: t.boolean({ required: false }),
  }),
});

const SaveAddressInput = builder.inputType("SaveAddressInput", {
  fields: (t) => ({
    label: t.string({ required: true }),
    text: t.string({ required: true }),
    lat: t.float({ required: true }),
    lng: t.float({ required: true }),
    phone: t.string({ required: false }),
    notes: t.string({ required: false }),
    isDefault: t.boolean({ required: false }),
  }),
});

// All fields optional: only the provided ones are patched onto the address.
const UpdateAddressInput = builder.inputType("UpdateAddressInput", {
  fields: (t) => ({
    label: t.string({ required: false }),
    text: t.string({ required: false }),
    lat: t.float({ required: false }),
    lng: t.float({ required: false }),
    phone: t.string({ required: false }),
    notes: t.string({ required: false }),
    isDefault: t.boolean({ required: false }),
  }),
});

type RawLines = Array<{
  menuItemId: string;
  qty: number;
  modifierOptionIds?: string[] | null;
  notes?: string | null;
}>;
const normalizeLines = (lines: RawLines) =>
  lines.map((l) => ({
    menuItemId: l.menuItemId,
    qty: l.qty,
    modifierOptionIds: l.modifierOptionIds ?? [],
    notes: l.notes ?? undefined,
  }));

// ── output types ────────────────────────────────────────────────────────────

const QuoteLineType = builder.objectRef<QuoteResult["lines"][number]>("QuoteLine");
QuoteLineType.implement({
  fields: (t) => ({
    menuItemId: t.exposeString("menuItemId"),
    name: t.exposeString("name"),
    qty: t.exposeInt("qty"),
    unitPriceMinor: t.exposeInt("unitPriceMinor"),
    lineTotalMinor: t.exposeInt("lineTotalMinor"),
  }),
});

const QuoteType = builder.objectRef<QuoteResult>("Quote");
QuoteType.implement({
  fields: (t) => ({
    branchId: t.exposeString("branchId"),
    subtotalMinor: t.exposeInt("subtotalMinor"),
    deliveryFeeMinor: t.exposeInt("deliveryFeeMinor"),
    taxTotalMinor: t.exposeInt("taxTotalMinor"),
    platformFeeMinor: t.exposeInt("platformFeeMinor"),
    tipAmount: t.exposeInt("tipAmount"),
    loyaltyPointsRedeemed: t.exposeInt("loyaltyPointsRedeemed"),
    loyaltyDiscountMinor: t.exposeInt("loyaltyDiscountMinor"),
    loyaltyPointsBalance: t.exposeInt("loyaltyPointsBalance"),
    grandTotalMinor: t.exposeInt("grandTotalMinor"),
    minOrderMinor: t.exposeInt("minOrderMinor"),
    meetsMinimum: t.exposeBoolean("meetsMinimum"),
    inRadius: t.exposeBoolean("inRadius"),
    distanceM: t.exposeInt("distanceM"),
    lines: t.field({ type: [QuoteLineType], resolve: (q) => q.lines }),
  }),
});

export const OrderType = builder.prismaObject("Order", {
  fields: (t) => ({
    id: t.exposeID("id"),
    code: t.exposeString("code"),
    status: t.exposeString("status"),
    paymentMode: t.exposeString("paymentMode"),
    subtotalMinor: t.exposeInt("subtotalMinor"),
    deliveryFeeMinor: t.exposeInt("deliveryFeeMinor"),
    taxTotalMinor: t.exposeInt("taxTotalMinor"),
    platformFeeMinor: t.exposeInt("platformFeeMinor"),
    tipAmount: t.exposeInt("tipAmount"),
    loyaltyPointsRedeemed: t.exposeInt("loyaltyPointsRedeemed"),
    loyaltyDiscountMinor: t.exposeInt("loyaltyDiscountMinor"),
    cutleryRequested: t.exposeBoolean("cutleryRequested"),
    grandTotalMinor: t.exposeInt("grandTotalMinor"),
    contactPhone: t.exposeString("contactPhone"),
    customerNote: t.exposeString("customerNote", { nullable: true }),
    addressSnapshotJson: t.field({ type: "JSON", resolve: (o) => o.addressSnapshotJson }),
    acceptDeadlineAt: t.field({ type: "DateTime", resolve: (o) => o.acceptDeadlineAt }),
    prepEtaMinutes: t.exposeInt("prepEtaMinutes", { nullable: true }),
    placedAt: t.field({ type: "DateTime", resolve: (o) => o.placedAt }),
    deliveredAt: t.field({ type: "DateTime", nullable: true, resolve: (o) => o.deliveredAt }),
    branch: t.relation("branch"),
    items: t.relation("items"),
    events: t.relation("events", { query: { orderBy: { createdAt: "asc" } } }),
  }),
});

builder.prismaObject("OrderItem", {
  fields: (t) => ({
    id: t.exposeID("id"),
    qty: t.exposeInt("qty"),
    unitPriceMinor: t.exposeInt("unitPriceMinor"),
    lineTotalMinor: t.exposeInt("lineTotalMinor"),
    notes: t.exposeString("notes", { nullable: true }),
    menuSnapshotJson: t.field({ type: "JSON", resolve: (i) => i.menuSnapshotJson }),
  }),
});

builder.prismaObject("OrderEvent", {
  fields: (t) => ({
    id: t.exposeID("id"),
    fromStatus: t.exposeString("fromStatus", { nullable: true }),
    toStatus: t.exposeString("toStatus"),
    actorRole: t.exposeString("actorRole", { nullable: true }),
    reason: t.exposeString("reason", { nullable: true }),
    createdAt: t.field({ type: "DateTime", resolve: (e) => e.createdAt }),
  }),
});

// Saved delivery address in the customer's address book.
builder.prismaObject("Address", {
  fields: (t) => ({
    id: t.exposeID("id"),
    label: t.exposeString("label"),
    text: t.exposeString("text"),
    lat: t.float({ resolve: (a) => Number(a.lat) }),
    lng: t.float({ resolve: (a) => Number(a.lng) }),
    phone: t.exposeString("phone", { nullable: true }),
    notes: t.exposeString("notes", { nullable: true }),
    isDefault: t.exposeBoolean("isDefault"),
    createdAt: t.field({ type: "DateTime", resolve: (a) => a.createdAt }),
  }),
});

// Loyalty wallet + append-only ledger (FP-07).
builder.prismaObject("LoyaltyAccount", {
  fields: (t) => ({
    id: t.exposeID("id"),
    pointsBalance: t.exposeInt("pointsBalance"),
    updatedAt: t.field({ type: "DateTime", resolve: (a) => a.updatedAt }),
  }),
});

builder.prismaObject("LoyaltyLedger", {
  fields: (t) => ({
    id: t.exposeID("id"),
    delta: t.exposeInt("delta"),
    balanceAfter: t.exposeInt("balanceAfter"),
    reason: t.exposeString("reason"),
    memo: t.exposeString("memo", { nullable: true }),
    createdAt: t.field({ type: "DateTime", resolve: (e) => e.createdAt }),
  }),
});

// ── queries ─────────────────────────────────────────────────────────────────

builder.queryFields((t) => ({
  myOrders: t.prismaField({
    type: ["Order"],
    authScopes: { loggedIn: true },
    resolve: (query, _root, _args, ctx) =>
      prisma.order.findMany({
        ...query,
        where: { customerId: ctx.userId! },
        orderBy: { placedAt: "desc" },
        take: 50,
      }),
  }),

  // The signed-in customer's saved address book (default first, then newest).
  myAddresses: t.prismaField({
    type: ["Address"],
    authScopes: { loggedIn: true },
    resolve: (query, _root, _args, ctx) =>
      prisma.address.findMany({
        ...query,
        where: { userId: ctx.userId! },
        orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
      }),
  }),

  // The signed-in customer's loyalty wallet (FP-07). Read-only view: returns null with
  // a 0 balance implied when the customer has never earned points, so the UI can render
  // "0 pts" without a write. The account row is created lazily on first earn/redeem.
  loyaltyAccount: t.prismaField({
    type: "LoyaltyAccount",
    nullable: true,
    authScopes: { loggedIn: true },
    resolve: (query, _root, _args, ctx) =>
      prisma.loyaltyAccount.findUnique({ ...query, where: { userId: ctx.userId! } }),
  }),

  // Recent loyalty points history (earn/redeem/adjust), newest first.
  loyaltyLedger: t.prismaField({
    type: ["LoyaltyLedger"],
    authScopes: { loggedIn: true },
    resolve: (query, _root, _args, ctx) =>
      prisma.loyaltyLedger.findMany({
        ...query,
        where: { userId: ctx.userId! },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
  }),

  order: t.prismaField({
    type: "Order",
    nullable: true,
    authScopes: { loggedIn: true },
    args: { id: t.arg.string({ required: true }) },
    resolve: async (query, _root, args, ctx) => {
      const order = await prisma.order.findUnique({ ...query, where: { id: args.id } });
      if (!order) return null;
      // Owner or staff of the branch's restaurant or admin.
      if (order.customerId === ctx.userId || ctx.hasRole("admin")) return order;
      const branch = await prisma.branch.findUnique({ where: { id: order.branchId } });
      if (branch && ctx.restaurantIds.includes(branch.restaurantId)) return order;
      throw new GraphQLError("Not authorized to view this order");
    },
  }),
}));

// ── mutations ───────────────────────────────────────────────────────────────

builder.mutationFields((t) => ({
  quoteCart: t.field({
    type: QuoteType,
    args: { input: t.arg({ type: QuoteCartInput, required: true }) },
    resolve: (_root, args, ctx) =>
      quoteCart(
        quoteInputSchema.parse({
          ...args.input,
          tipAmount: args.input.tipAmount ?? undefined,
          redeemPoints: args.input.redeemPoints ?? undefined,
          lines: normalizeLines(args.input.lines),
        }),
        // Anonymous quotes still price the cart; redemption only kicks in when signed in.
        ctx.userId,
      ),
  }),

  placeOrder: t.prismaField({
    type: "Order",
    authScopes: { loggedIn: true },
    args: {
      input: t.arg({ type: PlaceOrderInputType, required: true }),
      idempotencyKey: t.arg.string({ required: true }),
    },
    resolve: async (_query, _root, args, ctx) => {
      const input = placeOrderInputSchema.parse({
        ...args.input,
        addressLabel: args.input.addressLabel ?? "Home",
        customerNote: args.input.customerNote ?? undefined,
        paymentMethodId: args.input.paymentMethodId ?? undefined,
        tipAmount: args.input.tipAmount ?? undefined,
        redeemPoints: args.input.redeemPoints ?? undefined,
        cutleryRequested: args.input.cutleryRequested ?? undefined,
        lines: normalizeLines(args.input.lines),
      });
      return placeOrder(ctx.userId!, input, args.idempotencyKey);
    },
  }),

  cancelOrder: t.prismaField({
    type: "Order",
    authScopes: { loggedIn: true },
    args: {
      id: t.arg.string({ required: true }),
      reason: t.arg.string({ required: false }),
    },
    resolve: async (_query, _root, args, ctx) => {
      const order = await prisma.order.findUnique({ where: { id: args.id } });
      if (!order || order.customerId !== ctx.userId) {
        throw new GraphQLError("Order not found");
      }
      const updated = await transition(
        args.id,
        "cancelled",
        { userId: ctx.userId, role: "customer" },
        { reason: args.reason ?? "Customer cancelled" },
      );
      await prisma.cancellation.create({
        data: {
          orderId: args.id,
          cancelledBy: "customer",
          reasonCode: args.reason ?? "customer_cancelled",
        },
      });
      return updated;
    },
  }),

  // Add a new address to the signed-in customer's book. Passing isDefault:true (or
  // saving the very first address) makes it the default and clears the flag on the rest.
  saveAddress: t.prismaField({
    type: "Address",
    authScopes: { loggedIn: true },
    args: { input: t.arg({ type: SaveAddressInput, required: true }) },
    resolve: async (query, _root, args, ctx) => {
      const userId = ctx.userId!;
      const isFirst = (await prisma.address.count({ where: { userId } })) === 0;
      const makeDefault = args.input.isDefault ?? isFirst;
      return prisma.$transaction(async (tx) => {
        if (makeDefault) {
          await tx.address.updateMany({ where: { userId }, data: { isDefault: false } });
        }
        return tx.address.create({
          ...query,
          data: {
            userId,
            label: args.input.label,
            text: args.input.text,
            lat: args.input.lat,
            lng: args.input.lng,
            phone: args.input.phone ?? null,
            notes: args.input.notes ?? null,
            isDefault: makeDefault,
          },
        });
      });
    },
  }),

  // Patch a saved address the customer owns. Only provided fields change; setting
  // isDefault:true clears the flag on the customer's other addresses in the same tx.
  updateAddress: t.prismaField({
    type: "Address",
    authScopes: { loggedIn: true },
    args: {
      id: t.arg.string({ required: true }),
      input: t.arg({ type: UpdateAddressInput, required: true }),
    },
    resolve: async (query, _root, args, ctx) => {
      const userId = ctx.userId!;
      const existing = await prisma.address.findFirst({ where: { id: args.id, userId } });
      if (!existing) throw new GraphQLError("Address not found");
      const { input } = args;
      return prisma.$transaction(async (tx) => {
        if (input.isDefault === true) {
          await tx.address.updateMany({ where: { userId }, data: { isDefault: false } });
        }
        return tx.address.update({
          ...query,
          where: { id: args.id },
          data: {
            ...(input.label != null ? { label: input.label } : {}),
            ...(input.text != null ? { text: input.text } : {}),
            ...(input.lat != null ? { lat: input.lat } : {}),
            ...(input.lng != null ? { lng: input.lng } : {}),
            ...(input.phone !== undefined ? { phone: input.phone } : {}),
            ...(input.notes !== undefined ? { notes: input.notes } : {}),
            ...(input.isDefault != null ? { isDefault: input.isDefault } : {}),
          },
        });
      });
    },
  }),

  // Delete a saved address the customer owns. Returns true on success.
  deleteAddress: t.field({
    type: "Boolean",
    authScopes: { loggedIn: true },
    args: { id: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      const existing = await prisma.address.findFirst({
        where: { id: args.id, userId: ctx.userId! },
      });
      if (!existing) throw new GraphQLError("Address not found");
      await prisma.address.delete({ where: { id: args.id } });
      return true;
    },
  }),
}));
