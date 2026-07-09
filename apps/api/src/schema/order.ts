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
    resolve: (_root, args) =>
      quoteCart(
        quoteInputSchema.parse({ ...args.input, lines: normalizeLines(args.input.lines) }),
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
}));
