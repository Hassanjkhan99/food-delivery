// Cart/checkout validation shared by the web forms and API resolvers.
import { z } from "zod";
import { MAX_CART_LINE_QTY, UNAVAILABILITY_PREFERENCES } from "../constants";

const unavailabilityPreferenceValues = UNAVAILABILITY_PREFERENCES.map((p) => p.value) as [
  "remove_item",
  "cancel_order",
  "contact_me",
];

export const cartLineSchema = z.object({
  menuItemId: z.string().min(1),
  qty: z.number().int().min(1).max(MAX_CART_LINE_QTY),
  // Selected modifier option ids, validated server-side against group min/max.
  modifierOptionIds: z.array(z.string()).default([]),
  notes: z.string().max(300).optional(),
  // What the customer wants done if this item turns out to be unavailable (#39).
  unavailabilityPreference: z.enum(unavailabilityPreferenceValues).default("remove_item"),
});

export const quoteInputSchema = z.object({
  branchId: z.string().min(1),
  lines: z.array(cartLineSchema).min(1).max(50),
  deliveryLat: z.number().gte(-90).lte(90),
  deliveryLng: z.number().gte(-180).lte(180),
  // Optional rider tip in minor units; folded into the grand total. Capped to a sane
  // ceiling so a fat-fingered client can't book an absurd total.
  tipAmount: z.number().int().min(0).max(1_000_000).default(0),
});

export const placeOrderInputSchema = quoteInputSchema.extend({
  addressText: z.string().min(5).max(500),
  addressLabel: z.string().max(50).default("Home"),
  contactPhone: z.string().regex(/^\+92\d{10}$/, "Phone must be in +92XXXXXXXXXX format"),
  customerNote: z.string().max(500).optional(),
  paymentMode: z.enum(["cod", "card"]),
  paymentMethodId: z.string().optional(),
  // Include cutlery/napkins with the order; defaults to true (opt-out).
  cutleryRequested: z.boolean().default(true),
});

export type CartLineInput = z.infer<typeof cartLineSchema>;
export type QuoteInput = z.infer<typeof quoteInputSchema>;
export type PlaceOrderInput = z.infer<typeof placeOrderInputSchema>;
