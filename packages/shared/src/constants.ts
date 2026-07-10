/** Policy timers from the kickoff report (product policy, not legal facts). */
export const ACCEPTANCE_SLA_SECONDS = 120;
export const EXPIRY_SWEEP_INTERVAL_MS = 5_000;
export const OTP_TTL_SECONDS = 5 * 60;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RATE_LIMIT_PER_HOUR = 5;
export const SESSION_TTL_DAYS = 30;
export const SESSION_COOKIE_NAME = "fd_session";

/**
 * Canonical post-delivery review tags (Foodpanda-style quick chips). Shown on the
 * rating form and rendered as pills on the reviews page. `value` is what's stored
 * on Rating.tags[]; `label` is the human string.
 */
export const REVIEW_TAGS = [
  { value: "on-time", label: "On time" },
  { value: "tasty", label: "Tasty" },
  { value: "hot", label: "Hot & fresh" },
  { value: "packaging", label: "Good packaging" },
  { value: "value", label: "Great value" },
] as const;

export type ReviewTagValue = (typeof REVIEW_TAGS)[number]["value"];

/** Map a stored tag value back to its display label (falls back to the raw value). */
export const reviewTagLabel = (value: string): string =>
  REVIEW_TAGS.find((t) => t.value === value)?.label ?? value;

// ───────────────────────────── loyalty / rewards (FP-07) ─────────────────────────────
// Founder call: keep it dead simple + configurable. Earn 1 point per Rs of the order
// SUBTOTAL on delivered orders (platform-funded); redeem points for a checkout discount
// worth LOYALTY_POINT_VALUE_MINOR paisa each, in whole steps of LOYALTY_REDEEM_STEP,
// from a floor of LOYALTY_MIN_REDEEM_POINTS. No expiry this phase (LoyaltyReason.expire
// reserved for when it lands). All rates live here so tuning never needs a migration.

/** Points earned per whole Rupee of order subtotal on delivery. */
export const LOYALTY_EARN_POINTS_PER_RUPEE = 1;
/** Cash value of one point when redeemed, in minor units (paisa). 10 = Rs 0.10/pt. */
export const LOYALTY_POINT_VALUE_MINOR = 10;
/** Fewest points a customer may redeem in one order. */
export const LOYALTY_MIN_REDEEM_POINTS = 100;
/** Points must be redeemed in whole multiples of this step. */
export const LOYALTY_REDEEM_STEP = 100;
/**
 * Upper bound on a single redeem request. The client sends this as a "redeem all I'm
 * allowed" sentinel and the server clamps it down to the live balance + subtotal ceiling
 * (see resolveLoyaltyRedemption). Both the checkout client and the quote/place-order zod
 * schema use this value so a redeem-all request can never fail input validation.
 */
export const LOYALTY_MAX_REDEEM_POINTS = 10_000_000;

/** Points earned for a delivered order, from its subtotal (minor units). */
export function loyaltyPointsEarned(subtotalMinor: number): number {
  return Math.floor(subtotalMinor / 100) * LOYALTY_EARN_POINTS_PER_RUPEE;
}

/** Minor-unit discount for redeeming `points`. */
export function loyaltyPointsToDiscountMinor(points: number): number {
  return points * LOYALTY_POINT_VALUE_MINOR;
}

/**
 * Normalise a requested redemption against balance + the order's redeemable ceiling.
 * Redemption may not exceed the balance, the step/minimum rules, or `redeemableMinor`
 * (the part of the bill points are allowed to cover — subtotal, so fees/tip stay owed).
 * Returns the whole-step points actually applied and their discount, or zero if the
 * request can't clear the minimum.
 */
export function resolveLoyaltyRedemption(
  requestedPoints: number,
  pointsBalance: number,
  redeemableMinor: number,
): { points: number; discountMinor: number } {
  const none = { points: 0, discountMinor: 0 };
  if (requestedPoints <= 0 || pointsBalance <= 0 || redeemableMinor <= 0) return none;

  // Cap by balance and by the discount the redeemable amount can absorb.
  const maxByCash = Math.floor(redeemableMinor / LOYALTY_POINT_VALUE_MINOR);
  let points = Math.min(requestedPoints, pointsBalance, maxByCash);
  // Snap down to a whole step.
  points = Math.floor(points / LOYALTY_REDEEM_STEP) * LOYALTY_REDEEM_STEP;
  if (points < LOYALTY_MIN_REDEEM_POINTS) return none;

  return { points, discountMinor: loyaltyPointsToDiscountMinor(points) };
}
