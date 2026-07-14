// Customer order domain: quoteCart, placeOrder (idempotent), myOrders, order, cancelOrder.
import { prisma } from "@fd/db";
import { placeOrderInputSchema, quoteInputSchema } from "@fd/shared";
import { GraphQLError } from "graphql";
import { placeOrder, transition } from "../services/orderService.js";
import { recordCancellation, evaluateOrderCancellation } from "../services/policyService.js";
import { quoteCart, type DeliveryOption, type QuoteResult } from "../services/quoteService.js";
import { builder } from "./builder.js";

// ── input types ─────────────────────────────────────────────────────────────

// A cart line is either a menu item (menuItemId) or a combo/meal deal (comboId, #53).
// Exactly one must be set — enforced by cartLineSchema server-side.
const CartLineInput = builder.inputType("CartLineInput", {
  fields: (t) => ({
    menuItemId: t.string({ required: false }),
    comboId: t.string({ required: false }),
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
    // "delivery" (default) | "pickup" — pickup zeroes the delivery fee (#54).
    fulfillmentMode: t.string({ required: false }),
    redeemPoints: t.int({ required: false }),
    // Delivery service preference (#98): "standard" (default) | "scheduled". The server
    // validates + prices this; unknown/unavailable keys fall back to standard.
    deliveryOption: t.string({ required: false }),
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
    voucherCode: t.string({ required: false }),
    // Fulfillment (#54): "delivery" (default) | "pickup"; optional future slot ISO string.
    fulfillmentMode: t.string({ required: false }),
    scheduledFor: t.string({ required: false }),
    // Selected delivery option (#98): "standard" (default) | "scheduled". Re-validated at
    // placement via quoteCart; an unavailable key falls back to standard.
    deliveryOption: t.string({ required: false }),
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
  menuItemId?: string | null;
  comboId?: string | null;
  qty: number;
  modifierOptionIds?: string[] | null;
  notes?: string | null;
  unavailabilityPreference?: string | null;
}>;
const normalizeLines = (lines: RawLines) =>
  lines.map((l) => ({
    menuItemId: l.menuItemId ?? undefined,
    comboId: l.comboId ?? undefined,
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
    menuItemId: t.exposeString("menuItemId", { nullable: true }),
    comboId: t.exposeString("comboId", { nullable: true }),
    name: t.exposeString("name"),
    qty: t.exposeInt("qty"),
    unitPriceMinor: t.exposeInt("unitPriceMinor"),
    lineTotalMinor: t.exposeInt("lineTotalMinor"),
    // Per-line tax breakdown (#146). taxableMinor = pre-tax base, taxMinor = allocated tax.
    taxableMinor: t.exposeInt("taxableMinor"),
    taxMinor: t.exposeInt("taxMinor"),
  }),
});

// A single server-priced delivery choice for the checkout selector (#98). See
// DeliveryOption in quoteService for field semantics.
const DeliveryOptionType = builder.objectRef<DeliveryOption>("DeliveryOption");
DeliveryOptionType.implement({
  fields: (t) => ({
    key: t.exposeString("key"),
    label: t.exposeString("label"),
    description: t.exposeString("description"),
    priceMinor: t.exposeInt("priceMinor"),
    etaMinutes: t.exposeInt("etaMinutes", { nullable: true }),
    etaLabel: t.exposeString("etaLabel"),
    available: t.exposeBoolean("available"),
    recommended: t.exposeBoolean("recommended"),
  }),
});

const QuoteType = builder.objectRef<QuoteResult>("Quote");
QuoteType.implement({
  fields: (t) => ({
    branchId: t.exposeString("branchId"),
    subtotalMinor: t.exposeInt("subtotalMinor"),
    deliveryFeeMinor: t.exposeInt("deliveryFeeMinor"),
    baseDeliveryFeeMinor: t.exposeInt("baseDeliveryFeeMinor"),
    membershipDeliverySavingMinor: t.exposeInt("membershipDeliverySavingMinor"),
    membershipApplied: t.exposeBoolean("membershipApplied"),
    taxTotalMinor: t.exposeInt("taxTotalMinor"),
    // Tax presentation (#146). The client renders the breakdown + toggles inclusive/exclusive
    // DISPLAY only; grandTotalMinor already accounts for tax, so never add taxTotalMinor to it.
    taxRateBps: t.exposeInt("taxRateBps"),
    taxLabel: t.exposeString("taxLabel"),
    taxInclusive: t.exposeBoolean("taxInclusive"),
    taxResponsibility: t.exposeString("taxResponsibility"),
    platformFeeMinor: t.exposeInt("platformFeeMinor"),
    tipAmount: t.exposeInt("tipAmount"),
    discountMinor: t.exposeInt("discountMinor"),
    // The code that was actually applied (normalized), null if none/invalid.
    voucherCode: t.exposeString("voucherCode", { nullable: true }),
    // Stable rejection code (e.g. "expired") when a supplied code failed; null on success.
    voucherError: t.exposeString("voucherError", { nullable: true }),
    loyaltyPointsRedeemed: t.exposeInt("loyaltyPointsRedeemed"),
    loyaltyDiscountMinor: t.exposeInt("loyaltyDiscountMinor"),
    loyaltyPointsBalance: t.exposeInt("loyaltyPointsBalance"),
    grandTotalMinor: t.exposeInt("grandTotalMinor"),
    minOrderMinor: t.exposeInt("minOrderMinor"),
    meetsMinimum: t.exposeBoolean("meetsMinimum"),
    inRadius: t.exposeBoolean("inRadius"),
    distanceM: t.exposeInt("distanceM"),
    // Delivery-option catalogue + the selected key (#98). Empty for pickup.
    deliveryOptions: t.field({
      type: [DeliveryOptionType],
      resolve: (q) => q.deliveryOptions,
    }),
    deliveryOption: t.exposeString("deliveryOption"),
    lines: t.field({ type: [QuoteLineType], resolve: (q) => q.lines }),
  }),
});

// Assigned-rider view for customer live tracking (#162). Identity (name/phone) plus the
// last GPS fix, exposed ONLY to the order's own customer while the order is actively out
// for delivery. `isStale` reflects whether the last location ping is fresh enough to trust.
type AssignedRiderInfo = {
  name: string | null;
  phone: string;
  lat: number | null;
  lng: number | null;
  lastLocationAt: Date | null;
  isStale: boolean;
};

// Statuses at which the rider is en route and the customer may see them + their position.
// Before rider_assigned there is no rider to show; after delivery the leg is done.
const RIDER_TRACKING_STATUSES = [
  "rider_assigned",
  "picked_up",
  "out_for_delivery",
  "failed_delivery_attempt",
];
// A location fix older than this is considered stale (rider app pings every ~20s).
const RIDER_LOCATION_STALE_MS = 60_000;

const AssignedRiderType = builder.objectRef<AssignedRiderInfo>("AssignedRider").implement({
  fields: (t) => ({
    name: t.exposeString("name", { nullable: true }),
    phone: t.exposeString("phone"),
    lat: t.float({ nullable: true, resolve: (r) => r.lat }),
    lng: t.float({ nullable: true, resolve: (r) => r.lng }),
    lastLocationAt: t.field({
      type: "DateTime",
      nullable: true,
      resolve: (r) => r.lastLocationAt,
    }),
    // True when we have no fresh fix — the customer UI shows "locating…" instead of a
    // stale marker.
    isStale: t.exposeBoolean("isStale"),
  }),
});

export const OrderType = builder.prismaObject("Order", {
  fields: (t) => ({
    id: t.exposeID("id"),
    code: t.exposeString("code"),
    status: t.exposeString("status"),
    paymentMode: t.exposeString("paymentMode"),
    fulfillmentMode: t.exposeString("fulfillmentMode"),
    pickupCode: t.exposeString("pickupCode", { nullable: true }),
    scheduledFor: t.field({
      type: "DateTime",
      nullable: true,
      resolve: (o) => o.scheduledFor,
    }),
    subtotalMinor: t.exposeInt("subtotalMinor"),
    deliveryFeeMinor: t.exposeInt("deliveryFeeMinor"),
    taxTotalMinor: t.exposeInt("taxTotalMinor"),
    // Tax snapshot frozen at placement (#146) — drives the receipt's legal tax line. Null on
    // orders placed before this shipped (render a plain "Tax" line as a fallback).
    taxRateBpsSnapshot: t.exposeInt("taxRateBpsSnapshot", { nullable: true }),
    taxInclusiveSnapshot: t.exposeBoolean("taxInclusiveSnapshot", { nullable: true }),
    taxLabelSnapshot: t.exposeString("taxLabelSnapshot", { nullable: true }),
    taxResponsibilitySnapshot: t.exposeString("taxResponsibilitySnapshot", { nullable: true }),
    platformFeeMinor: t.exposeInt("platformFeeMinor"),
    tipAmount: t.exposeInt("tipAmount"),
    loyaltyPointsRedeemed: t.exposeInt("loyaltyPointsRedeemed"),
    loyaltyDiscountMinor: t.exposeInt("loyaltyDiscountMinor"),
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
    // Assigned rider for live tracking (#162). Scoped to the order's own customer (or
    // admin) — the restaurant board and the rider themselves must never read this here.
    // Returns null before a rider is en route; coordinates are withheld outside the
    // active-delivery window even when a rider exists.
    assignedRider: t.field({
      type: AssignedRiderType,
      nullable: true,
      resolve: async (o, _args, ctx) => {
        if (o.customerId !== ctx.userId && !ctx.hasRole("admin")) return null;
        if (!RIDER_TRACKING_STATUSES.includes(o.status)) return null;
        const task = await prisma.deliveryTask.findUnique({
          where: { orderId: o.id },
          include: { rider: { include: { user: true, availability: true } } },
        });
        const rider = task?.rider;
        if (!rider) return null;
        const avail = rider.availability;
        const lastLocationAt = avail?.lastLocationAt ?? null;
        const isStale =
          !lastLocationAt || Date.now() - lastLocationAt.getTime() > RIDER_LOCATION_STALE_MS;
        return {
          name: rider.user.name,
          phone: rider.user.phone,
          lat: avail?.lat != null ? Number(avail.lat) : null,
          lng: avail?.lng != null ? Number(avail.lng) : null,
          lastLocationAt,
          isStale,
        };
      },
    }),
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
    // Immutable per-line tax snapshot (#146); null on items created before this shipped.
    taxableMinor: t.exposeInt("taxableMinor", { nullable: true }),
    taxMinor: t.exposeInt("taxMinor", { nullable: true }),
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
      throw new GraphQLError("You don't have permission to view this order.", {
        extensions: { code: "forbidden" },
      });
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
          fulfillmentMode: args.input.fulfillmentMode ?? undefined,
          redeemPoints: args.input.redeemPoints ?? undefined,
          deliveryOption: args.input.deliveryOption ?? undefined,
          lines: normalizeLines(args.input.lines),
        }),
        // Anonymous quotes still price the cart; voucher/loyalty redemption (#52/#57) and
        // membership delivery benefit (#59) only kick in when signed in.
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
        voucherCode: args.input.voucherCode ?? undefined,
        fulfillmentMode: args.input.fulfillmentMode ?? undefined,
        scheduledFor: args.input.scheduledFor ?? undefined,
        deliveryOption: args.input.deliveryOption ?? undefined,
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
        throw new GraphQLError("We couldn't find that order.", {
          extensions: { code: "not_found" },
        });
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
      if (!existing)
        throw new GraphQLError("We couldn't find that saved address.", {
          extensions: { code: "not_found" },
        });
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
      if (!existing)
        throw new GraphQLError("We couldn't find that saved address.", {
          extensions: { code: "not_found" },
        });
      await prisma.address.delete({ where: { id: args.id } });
      return true;
    },
  }),
}));
