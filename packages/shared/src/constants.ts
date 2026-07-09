/** Policy timers from the kickoff report (product policy, not legal facts). */
export const ACCEPTANCE_SLA_SECONDS = 120;
export const EXPIRY_SWEEP_INTERVAL_MS = 5_000;
export const OTP_TTL_SECONDS = 5 * 60;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RATE_LIMIT_PER_HOUR = 5;
export const SESSION_TTL_DAYS = 30;
export const SESSION_COOKIE_NAME = "fd_session";

/**
 * Rider trust-score policy (kickoff: rider verification & trust lifecycle).
 * Score is 0–100; new riders start neutral. Thresholds gate risk-sensitive work.
 */
export const RIDER_TRUST_START = 70;
/** Below this, COD orders should not be dispatched to the rider. */
export const RIDER_TRUST_COD_MIN = 50;
/** Below this, shared/independent offers are withheld and shared mode auto-disables. */
export const RIDER_TRUST_SHARED_MIN = 60;

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
