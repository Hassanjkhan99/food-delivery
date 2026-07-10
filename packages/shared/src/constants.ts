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
