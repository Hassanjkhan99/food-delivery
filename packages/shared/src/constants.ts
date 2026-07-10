/** Policy timers from the kickoff report (product policy, not legal facts). */
export const ACCEPTANCE_SLA_SECONDS = 120;
export const EXPIRY_SWEEP_INTERVAL_MS = 5_000;
export const OTP_TTL_SECONDS = 5 * 60;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RATE_LIMIT_PER_HOUR = 5;
export const SESSION_TTL_DAYS = 30;
export const SESSION_COOKIE_NAME = "fd_session";

/** Max quantity for a single cart line. Enforced client-side (merge cap) and by the server schema. */
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
