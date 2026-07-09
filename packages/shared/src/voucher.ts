// Pure voucher discount math + validation-code taxonomy shared by API and web.
// The DB-touching validation (limits, budgets, first-order) lives in the API's
// voucherService; here we keep only what both sides need: the discount computation
// and the stable error codes the web maps to friendly messages.
import { applyBps } from "./money";

export type VoucherType = "percentage" | "fixed" | "free_delivery";

/** Stable reason codes returned when a voucher can't be applied. */
export type VoucherRejectionCode =
  | "not_found"
  | "inactive"
  | "not_started"
  | "expired"
  | "min_not_met"
  | "already_used"
  | "budget_exhausted"
  | "not_eligible"
  | "wrong_restaurant"
  | "first_order_only";

export const VOUCHER_REJECTION_MESSAGE: Record<VoucherRejectionCode, string> = {
  not_found: "That code isn't valid.",
  inactive: "This voucher is no longer available.",
  not_started: "This voucher isn't active yet.",
  expired: "This voucher has expired.",
  min_not_met: "Your order is below this voucher's minimum.",
  already_used: "You've already used this voucher.",
  budget_exhausted: "This voucher has run out.",
  not_eligible: "You're not eligible for this voucher.",
  wrong_restaurant: "This voucher can't be used at this restaurant.",
  first_order_only: "This voucher is for first orders only.",
};

/** Fields of a voucher needed to compute a discount (subset of the Prisma row). */
export type DiscountableVoucher = {
  type: VoucherType;
  valueBps: number;
  valueMinor: number;
  maxDiscountMinor?: number | null;
};

/**
 * Compute the discount (minor units) a voucher yields for a given order shape.
 * Never returns more than the discountable base (subtotal for %/fixed, delivery fee
 * for free_delivery), so a discount can't drive a component negative.
 */
export function computeVoucherDiscount(
  voucher: DiscountableVoucher,
  order: { subtotalMinor: number; deliveryFeeMinor: number },
): number {
  switch (voucher.type) {
    case "percentage": {
      const raw = applyBps(order.subtotalMinor, voucher.valueBps);
      const capped =
        voucher.maxDiscountMinor != null ? Math.min(raw, voucher.maxDiscountMinor) : raw;
      return Math.max(0, Math.min(capped, order.subtotalMinor));
    }
    case "fixed":
      return Math.max(0, Math.min(voucher.valueMinor, order.subtotalMinor));
    case "free_delivery":
      return Math.max(0, order.deliveryFeeMinor);
    default:
      return 0;
  }
}

/** Normalise a user-entered code (trim + uppercase) for lookup/storage. */
export const normalizeVoucherCode = (code: string): string => code.trim().toUpperCase();
