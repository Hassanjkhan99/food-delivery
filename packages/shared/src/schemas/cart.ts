// Cart/checkout validation shared by the web forms and API resolvers.
import { z } from "zod";

export const cartLineSchema = z.object({
  menuItemId: z.string().min(1),
  qty: z.number().int().min(1).max(50),
  // Selected modifier option ids, validated server-side against group min/max.
  modifierOptionIds: z.array(z.string()).default([]),
  notes: z.string().max(300).optional(),
});

export const quoteInputSchema = z.object({
  branchId: z.string().min(1),
  lines: z.array(cartLineSchema).min(1).max(50),
  deliveryLat: z.number().gte(-90).lte(90),
  deliveryLng: z.number().gte(-180).lte(180),
  // Optional rider tip in minor units; folded into the grand total. Capped to a sane
  // ceiling so a fat-fingered client can't book an absurd total.
  tipAmount: z.number().int().min(0).max(1_000_000).default(0),
  // Fulfillment mode (#54). `pickup` zeroes the delivery fee and skips the radius
  // check; the coordinates are still required (they're used for the distance readout).
  fulfillmentMode: z.enum(["delivery", "pickup"]).default("delivery"),
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
  // Optional future slot for scheduled orders (#54). ISO datetime; must be in the
  // future when provided. Groundwork — the acceptance-SLA rescheduling is a follow-up.
  scheduledFor: z.string().datetime().optional(),
});

export type CartLineInput = z.infer<typeof cartLineSchema>;
export type QuoteInput = z.infer<typeof quoteInputSchema>;
export type PlaceOrderInput = z.infer<typeof placeOrderInputSchema>;
