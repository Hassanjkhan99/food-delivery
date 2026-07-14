// Cart/checkout validation shared by the web forms and API resolvers.
import { z } from "zod";
import {
  LOYALTY_MAX_REDEEM_POINTS,
  MAX_CART_LINE_QTY,
  UNAVAILABILITY_PREFERENCES,
} from "../constants";

const unavailabilityPreferenceValues = UNAVAILABILITY_PREFERENCES.map((p) => p.value) as [
  "remove_item",
  "cancel_order",
  "contact_me",
];

// A cart line is EITHER a single menu item (with modifiers) OR a combo/meal deal (#53).
// comboId, when present, takes precedence and the modifier fields are ignored — a combo
// is priced and snapshotted server-side as one bundled line. Exactly one of
// menuItemId / comboId must be set; validated by the refinement below.
export const cartLineSchema = z
  .object({
    menuItemId: z.string().min(1).optional(),
    comboId: z.string().min(1).optional(),
    qty: z.number().int().min(1).max(MAX_CART_LINE_QTY),
    // Selected modifier option ids, validated server-side against group min/max.
    modifierOptionIds: z.array(z.string()).default([]),
    notes: z.string().max(300).optional(),
    // What the customer wants done if this line turns out to be unavailable (#39).
    unavailabilityPreference: z.enum(unavailabilityPreferenceValues).default("remove_item"),
  })
  .refine((l) => Boolean(l.menuItemId) !== Boolean(l.comboId), {
    message: "Each cart line must reference exactly one of a menu item or a combo",
  });

export const quoteInputSchema = z.object({
  branchId: z.string().min(1),
  lines: z.array(cartLineSchema).min(1).max(50),
  deliveryLat: z.number().gte(-90).lte(90),
  deliveryLng: z.number().gte(-180).lte(180),
  // Optional rider tip in minor units; folded into the grand total. Capped to a sane
  // ceiling so a fat-fingered client can't book an absurd total.
  tipAmount: z.number().int().min(0).max(1_000_000).default(0),
  // Optional promo code (#52). Validated + priced server-side; never trusted from the
  // client for the discount amount, only the code string.
  voucherCode: z.string().trim().min(1).max(40).optional(),
  // Fulfillment mode (#54). `pickup` zeroes the delivery fee and skips the radius
  // check; the coordinates are still required (they're used for the distance readout).
  fulfillmentMode: z.enum(["delivery", "pickup"]).default("delivery"),
  // Delivery service preference (#98, epic #97). Deliberately a free string, NOT an enum:
  // the server is the source of truth for which options exist, and quoteCart clamps an
  // unknown/unavailable key back to "standard". Validating an enum here would instead
  // hard-reject a stale/experimental client (e.g. one sending "priority" or a future
  // #99–#106 key) before it ever reaches that fallback. Foundation keys today are
  // "standard" (existing delivery, unchanged) and "scheduled" (reuses scheduledFor
  // groundwork, no new pricing). Defaults to "standard" so an untouched checkout is unchanged.
  deliveryOption: z.string().trim().min(1).max(40).default("standard"),
  // Loyalty points the customer wants to redeem (FP-07). Server clamps this to the
  // balance + redemption rules and recomputes the discount; the client value is only a
  // request. 0 = redeem nothing.
  redeemPoints: z.number().int().min(0).max(LOYALTY_MAX_REDEEM_POINTS).default(0),
});

export const placeOrderInputSchema = quoteInputSchema.extend({
  addressText: z.string().min(5).max(500),
  addressLabel: z.string().max(50).default("Home"),
  contactPhone: z.string().regex(/^\+92\d{10}$/, "Phone must be in +92XXXXXXXXXX format"),
  customerNote: z.string().max(500).optional(),
  paymentMode: z.enum(["cod", "card", "wallet"]),
  paymentMethodId: z.string().optional(),
  // Include cutlery/napkins with the order; defaults to true (opt-out).
  cutleryRequested: z.boolean().default(true),
  // Optional future slot for scheduled orders (#54). ISO datetime; must be in the
  // future when provided. Groundwork — the acceptance-SLA rescheduling is a follow-up.
  scheduledFor: z.string().datetime().optional(),
});

export type CartLineInput = z.infer<typeof cartLineSchema>;
export type QuoteInput = z.infer<typeof quoteInputSchema>;
export type PlaceOrderInput = z.infer<typeof placeOrderInputSchema>;
