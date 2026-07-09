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
