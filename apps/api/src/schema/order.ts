// Customer order domain: quoteCart, placeOrder (idempotent), myOrders, order, cancelOrder.
import { prisma } from "@fd/db";
import { placeOrderInputSchema, quoteInputSchema } from "@fd/shared";
import { GraphQLError } from "graphql";
import { placeOrder, transition } from "../services/orderService.js";
import { recordCancellation, evaluateOrderCancellation } from "../services/policyService.js";
import { quoteCart, type QuoteResult } from "../services/quoteService.js";
import { builder } from "./builder.js";

// ── input types ─────────────────────────────────────────────────────────────

const CartLineInput = builder.inputType("CartLineInput", {
  fields: (t) => ({
    menuItemId: t.string({ required: true }),
    qty: t.int({ required: true }),
    modifierOptionIds: t.stringList({ required: false }),
    notes: t.string({ required: false }),
    // "If this item is unavailable" preference (#39). One of remove_item |
    // cancel_order | contact_me; defaults to remove_item when omitted.
    unavailabilityPreference: t.string({ required: false }),
  }),
});

const QuoteCartInput = builder.inputType("QuoteCartInput", {
  fields: (t) => ({
    branchId: t.string({ required: true }),
    lines: t.field({ type: [CartLineInput], required: true }),
    deliveryLat: t.float({ required: true }),
    deliveryLng: t.float({ required: true }),
    tipAmount: t.int({ required: false }),
    voucherCode: t.string({ required: false }),
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
    cutleryRequested: t.boolean({ required: false }),
    voucherCode: t.string({ required: false }),
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
  unavailabilityPreference?: string | null;
}>;
const normalizeLines = (lines: RawLines) =>
  lines.map((l) => ({
    menuItemId: l.menuItemId,
    qty: l.qty,
    modifierOptionIds: l.modifierOptionIds ?? [],
    notes: l.notes ?? undefined,
    // Let the shared zod schema apply the default + enum validation.
    unavailabilityPreference: l.unavailabilityPreference ?? undefined,
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
    discountMinor: t.exposeInt("discountMinor"),
    // The code that was actually applied (normalized), null if none/invalid.
    voucherCode: t.exposeString("voucherCode", { nullable: true }),
    // Stable rejection code (e.g. "expired") when a supplied code failed; null on success.
    voucherError: t.exposeString("voucherError", { nullable: true }),
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
    cutleryRequested: t.exposeBoolean("cutleryRequested"),
    discountMinor: t.exposeInt("discountMinor"),
    grandTotalMinor: t.exposeInt("grandTotalMinor"),
    // Pickup handoff PIN (#25). Visible ONLY to the customer or the branch's restaurant
    // members (who show it to the rider) — never to the rider themselves, who reach this
    // same OrderType via DeliveryTask.order (myJobs). The rider ENTERS the PIN via
    // verifyPickupPin; they must never READ it, or the wrong-rider guard is defeated.
    pickupPin: t.string({
      nullable: true,
      resolve: async (o, _args, ctx) => {
        if (!o.pickupPin) return null;
        if (o.customerId === ctx.userId || ctx.hasRole("admin")) return o.pickupPin;
        // Hybrid account guard: a user can hold BOTH the rider role and a restaurant
        // owner/staff role (roles table allows multiple; inviteRider can add rider to an
        // existing member). If this viewer is the rider assigned to deliver this very
        // order, they must NEVER read its PIN — even via their restaurant membership —
        // or the wrong-rider handoff guard is defeated. Deny before the branch check.
        if (ctx.riderId) {
          const task = await prisma.deliveryTask.findUnique({
            where: { orderId: o.id },
            select: { riderId: true },
          });
          if (task?.riderId === ctx.riderId) return null;
        }
        // Restaurant member of the order's branch. Only pay for the branch lookup when the
        // viewer actually belongs to some restaurant (owner/staff); everyone else — riders
        // included — gets null so they can never read the PIN they're meant to enter.
        if (ctx.restaurantIds.length > 0) {
          const branch = await prisma.branch.findUnique({
            where: { id: o.branchId },
            select: { restaurantId: true },
          });
          if (branch && ctx.restaurantIds.includes(branch.restaurantId)) return o.pickupPin;
        }
        return null;
      },
    }),
    contactPhone: t.exposeString("contactPhone"),
    // Customer's saved name — shown on the vendor board and rider card so staff
    // and riders have someone to ask for. Null until captured at first checkout.
    customerName: t.string({
      nullable: true,
      resolve: async (order) => {
        const customer = await prisma.user.findUnique({
          where: { id: order.customerId },
          select: { name: true },
        });
        return customer?.name ?? null;
      },
    }),
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
          voucherCode: args.input.voucherCode ?? undefined,
          lines: normalizeLines(args.input.lines),
        }),
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
        cutleryRequested: args.input.cutleryRequested ?? undefined,
        voucherCode: args.input.voucherCode ?? undefined,
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
      // #30: evaluate the cancellation policy against the *current* order state
      // (before the transition) so timing/grace-window is assessed correctly, then
      // persist only after the transition succeeds (avoids orphan rows on illegal moves).
      const decision = evaluateOrderCancellation(order, "customer");
      const updated = await transition(
        args.id,
        "cancelled",
        { userId: ctx.userId, role: "customer" },
        {
          reason: args.reason ?? "Customer cancelled",
          // #30: the ledger reversal must honour the policy refund, not blanket-refund
          // the full charge, so a post-grace-window fee is actually collected.
          refundMinor: decision.refundMinor,
          meta: {
            policyScenario: decision.scenario,
            policyOutcome: decision.outcome,
            feeAssessedMinor: decision.feeMinor,
            refundMinor: decision.refundMinor,
            faultParty: decision.faultParty,
          },
        },
      );
      await recordCancellation(order, "customer");
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
