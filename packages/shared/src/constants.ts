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
