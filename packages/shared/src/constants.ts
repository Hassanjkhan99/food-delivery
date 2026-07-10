/** Policy timers from the kickoff report (product policy, not legal facts). */
export const ACCEPTANCE_SLA_SECONDS = 120;
export const EXPIRY_SWEEP_INTERVAL_MS = 5_000;
export const OTP_TTL_SECONDS = 5 * 60;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RATE_LIMIT_PER_HOUR = 5;
export const SESSION_TTL_DAYS = 30;
export const SESSION_COOKIE_NAME = "fd_session";

// ───────────────────────── fraud & abuse controls (#25) ─────────────────────────
// Product policy, not legal facts — tuned conservatively for the beta.

/** Digits in the order-scoped pickup handoff PIN (customer/restaurant shows, rider enters). */
export const PICKUP_PIN_LENGTH = 4;

/**
 * Order velocity limit: max orders one customer may PLACE inside the rolling window.
 * Guards against cost-abuse / scripted duplicate spam beyond simple idempotency.
 */
export const ORDER_VELOCITY_LIMIT = 8;
export const ORDER_VELOCITY_WINDOW_MINUTES = 60;

/**
 * Cash-variance abuse: rolling window over a rider's recent COD drops. If the sum of
 * absolute short/over remittance across the window crosses the threshold, the rider is
 * auto-flagged and COD is disabled pending review.
 */
export const CASH_VARIANCE_WINDOW_DAYS = 7;
export const CASH_VARIANCE_DISABLE_THRESHOLD_MINOR = 200_000; // Rs 2,000 net variance

/**
 * GPS anomaly (teleport / mock-location) detection. Two consecutive rider location
 * heartbeats implying travel faster than this are flagged. Heartbeats older than the
 * stale window are ignored (rider was offline / app backgrounded), so a legitimate gap
 * doesn't read as a teleport.
 */
export const GPS_ANOMALY_MAX_SPEED_KMH = 150;
export const RIDER_LOCATION_STALE_SECONDS = 90;

/**
 * Rider trust-score policy (kickoff: rider verification & trust lifecycle).
 * Score is 0–100; new riders start neutral. Thresholds gate risk-sensitive work.
 */
export const RIDER_TRUST_START = 70;
/** Below this, COD orders should not be dispatched to the rider. */
export const RIDER_TRUST_COD_MIN = 50;
/** Below this, shared/independent offers are withheld and shared mode auto-disables. */
export const RIDER_TRUST_SHARED_MIN = 60;

/** Max quantity for a single cart line. Enforced client-side (merge cap) and by the server schema. (#39) */
export const MAX_CART_LINE_QTY = 50;

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

/**
 * Support playbooks from the kickoff research (issue #14). Each ticket category
 * has a first-owner, a first-response target, and a resolution target — both in
 * minutes — used by the agent queue to compute SLA breach state. `firstResponse`
 * is measured from ticket creation → firstRespondedAt (or now if unanswered);
 * `resolution` is creation → resolvedAt (or now if open). Categories not listed
 * fall back to DEFAULT_TICKET_PLAYBOOK.
 */
export const TICKET_PLAYBOOKS = [
  {
    category: "restaurant_unresponsive",
    label: "Restaurant not responding",
    owner: "Ops",
    firstResponseMin: 2,
    resolutionMin: 10,
    action: "Call branch, auto-reject if unresolved",
  },
  {
    category: "rider_late",
    label: "Rider late but moving",
    owner: "Support",
    firstResponseMin: 3,
    resolutionMin: 10,
    action: "Update ETA, monitor",
  },
  {
    category: "wrong_item",
    label: "Wrong / missing item",
    owner: "Restaurant desk",
    firstResponseMin: 5,
    resolutionMin: 60 * 12,
    action: "Re-deliver or refund via merchant",
  },
  {
    category: "cash_mismatch",
    label: "COD dispute",
    owner: "Finance ops",
    firstResponseMin: 10,
    resolutionMin: 60 * 24,
    action: "Compare declaration vs store records",
  },
  {
    category: "rider_incident",
    label: "Rider incident",
    owner: "Dispatch ops",
    firstResponseMin: 10,
    resolutionMin: 60 * 24,
    action: "Review evidence bundle",
  },
] as const;

export type TicketPlaybook = (typeof TICKET_PLAYBOOKS)[number];

/** Fallback playbook for any category without a specific entry. */
export const DEFAULT_TICKET_PLAYBOOK = {
  category: "other",
  label: "General enquiry",
  owner: "Support",
  firstResponseMin: 5,
  resolutionMin: 60 * 24,
  action: "Triage and route",
} as const;

/**
 * Legacy/producer category names that map onto a canonical playbook category.
 * Keeps older seeded/persisted tickets (e.g. `missing_item`) on the right desk
 * flow without a data migration.
 */
const TICKET_CATEGORY_ALIASES: Record<string, TicketPlaybook["category"]> = {
  missing_item: "wrong_item",
};

/** Resolve the playbook for a ticket category (never throws). */
export const ticketPlaybook = (category: string): TicketPlaybook | typeof DEFAULT_TICKET_PLAYBOOK => {
  const canonical = TICKET_CATEGORY_ALIASES[category] ?? category;
  return TICKET_PLAYBOOKS.find((p) => p.category === canonical) ?? DEFAULT_TICKET_PLAYBOOK;
};

/**
 * Expand a canonical category to every stored value that maps to it, so a
 * queue filter on `wrong_item` also matches legacy `missing_item` rows.
 */
export const ticketCategoryFilterValues = (category: string): string[] => {
  const aliases = Object.entries(TICKET_CATEGORY_ALIASES)
    .filter(([, canonical]) => canonical === category)
    .map(([alias]) => alias);
  return [category, ...aliases];
};

/** Resolution codes an agent can close a ticket with (audited on the ticket). */
export const TICKET_RESOLUTION_CODES = [
  "resolved_customer",
  "refunded",
  "redelivered",
  "auto_rejected",
  "no_action_needed",
  "escalated",
  "duplicate",
] as const;

export type TicketResolutionCode = (typeof TICKET_RESOLUTION_CODES)[number];

/**
 * Per-line "if this item is unavailable" preference (UX-04 / #39). Captured on the
 * cart line, snapshotted onto the OrderItem, and honored by the vendor flow. Default
 * is `remove_item`.
 */
export const UNAVAILABILITY_PREFERENCES = [
  { value: "remove_item", label: "Remove it from my order", short: "Remove item" },
  { value: "cancel_order", label: "Cancel the whole order", short: "Cancel order" },
  { value: "contact_me", label: "Call me", short: "Call customer" },
] as const;

export type UnavailabilityPreference = (typeof UNAVAILABILITY_PREFERENCES)[number]["value"];

export const DEFAULT_UNAVAILABILITY_PREFERENCE: UnavailabilityPreference = "remove_item";

/** Map a stored preference value to its short operator-facing label. */
export const unavailabilityPreferenceLabel = (value: string): string =>
  UNAVAILABILITY_PREFERENCES.find((p) => p.value === value)?.short ?? value;

/**
 * Help-center issue categories, mapped to the kickoff playbook. `value` is what's
 * stored on SupportTicket.category; `label` is the customer-facing string.
 * `needsItems` marks categories whose structured intake is a checkbox list of the
 * order's items (so the refund workbench can prefill amounts from item lineTotals).
 * `autoRefund` marks categories that open a pending Refund on the selected items.
 */
export const HELP_CATEGORIES = [
  {
    value: "missing_items",
    label: "Missing items",
    blurb: "Some items didn't arrive",
    needsItems: true,
    autoRefund: true,
  },
  {
    value: "wrong_items",
    label: "Wrong items",
    blurb: "I got the wrong items",
    needsItems: true,
    autoRefund: true,
  },
  {
    value: "quality",
    label: "Food quality",
    blurb: "Cold, spilled, or poor quality",
    needsItems: true,
    autoRefund: false,
  },
  {
    value: "late",
    label: "Late order",
    blurb: "My order is taking too long",
    needsItems: false,
    autoRefund: false,
  },
  {
    value: "rider",
    label: "Rider issue",
    blurb: "A problem with the rider",
    needsItems: false,
    autoRefund: false,
  },
  {
    value: "payment",
    label: "Payment or receipt",
    blurb: "Charge, receipt, or refund question",
    needsItems: false,
    autoRefund: false,
  },
  {
    value: "other",
    label: "Something else",
    blurb: "Any other problem",
    needsItems: false,
    autoRefund: false,
  },
] as const;

export type HelpCategoryValue = (typeof HELP_CATEGORIES)[number]["value"];

/** Look up a help category descriptor by its stored value. */
export const helpCategory = (value: string) =>
  HELP_CATEGORIES.find((c) => c.value === value);

/** Map a stored help category value to its display label (falls back to the raw value). */
export const helpCategoryLabel = (value: string): string =>
  helpCategory(value)?.label ?? value;

/**
 * Generic FAQ tree shown behind the order-contextual help. Plain data so both the
 * server and the client can render it without a round-trip.
 */
export const HELP_FAQ = [
  {
    q: "Where is my order?",
    a: "Open the order from Your orders to see live tracking. Once the restaurant accepts, you'll see prep and delivery stages update in real time.",
  },
  {
    q: "How do refunds work?",
    a: "Approved refunds go back to your original payment method for card orders, or as wallet credit. You'll see the resolution on your help ticket without needing to contact anyone.",
  },
  {
    q: "Can I cancel an order?",
    a: "You can cancel free of charge while the order is still waiting for the restaurant to accept. After it's accepted, open help on the order to request a cancellation.",
  },
  {
    q: "My items were missing or wrong",
    a: "Open help on the specific order and pick 'Missing items' or 'Wrong items'. Select the affected items and we'll start a refund for exactly those items.",
  },
  {
    q: "How do I contact the rider?",
    a: "While your order is out for delivery, a Call rider button appears on the tracking page when the rider's contact is available.",
  },
] as const;

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

/**
 * Referral rewards (#58), in minor units (paisa). Both sides are credited to their
 * customer wallet when the referee's first order is delivered (the qualifying event).
 * Product policy, not legal facts — tune freely.
 */
export const REFERRAL_REFERRER_REWARD_MINOR = 15_000; // PKR 150 to the inviter
export const REFERRAL_REFEREE_REWARD_MINOR = 10_000; // PKR 100 to the new friend

/** Human-readable share code: 6 chars, unambiguous alphabet (no 0/O/1/I). */
export const REFERRAL_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const REFERRAL_CODE_LENGTH = 6;
