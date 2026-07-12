// Matrix-driven cancellation & refund policy (#30). Pure, dependency-free so both the
// API (orderService/resolvers) and the admin UI can import it. The engine maps
// (order state, actor, timing) -> fee + fault party + refund outcome. Money math is
// intentionally kept out of here: this decides *policy*, the ledger executes it.
import type { OrderStatus } from "./orderStateMachine";

/** Who is being charged / who bears the cost of a cancellation. */
export type FaultParty = "customer" | "restaurant" | "rider" | "dispatch" | "platform" | "none";

/** Coarse policy outcome persisted on Cancellation.policyOutcome and shown to admins. */
export type PolicyOutcome =
  "full_refund" | "partial_refund" | "fee_charged" | "no_charge" | "support_review";

/** How the fee is derived. Percentages are of the order subtotal (food cost). */
export type FeeBasis = "none" | "flat" | "subtotal_pct" | "delivery_fee";

/** Stable identifiers for each matrix row — used as reason codes and in the admin matrix. */
export type CancellationScenario =
  | "restaurant_reject_pre_sla"
  | "customer_pre_acceptance"
  | "customer_post_accept_pre_prep"
  | "customer_after_prepared"
  | "rider_no_show_spoilage"
  | "wrong_or_missing_item"
  | "customer_unreachable_at_drop"
  | "auto_expired"
  | "admin_override";

/** Who initiated the cancellation. `system` covers auto-expiry sweeps. */
export type CancellationActor = "customer" | "restaurant" | "rider" | "admin" | "system";

/**
 * Tunable policy config (product policy, not legal facts). Minor units = paisa/cents.
 * These are the kickoff defaults; the versioned FeeConfig can override them later.
 */
export const CANCELLATION_POLICY_CONFIG = {
  /** Free-cancel window after acceptance, before prep begins (issue: "configurable grace window"). */
  gracePeriodSeconds: 5 * 60,
  /** Small fee for cancelling post-accept but inside/around the grace window. */
  postAcceptFeeMinor: 5000,
  /** Fraction (bps) of subtotal charged when cancelling after food is prepared. */
  afterPreparedSubtotalBps: 5000, // 50%
  /** At-drop unreachable: customer forfeits the delivery fee only. */
  unreachableChargesDeliveryFee: true,
  /** Rider wait before an unreachable timeout may be declared. */
  unreachableWaitSeconds: 5 * 60,
} as const;

export type CancellationPolicyConfig = typeof CANCELLATION_POLICY_CONFIG;

/** Minimal order shape the engine needs — a structural subset of the Prisma Order. */
export interface PolicyOrderInput {
  status: OrderStatus;
  subtotalMinor: number;
  deliveryFeeMinor: number;
  grandTotalMinor: number;
  /** When the restaurant accepted, if it has. Drives the grace-window timer. */
  acceptedAt?: Date | string | null;
  /** When prep started (order moved to `preparing`), if it has. */
  preparingStartedAt?: Date | string | null;
  branchId?: string;
}

/** Contextual timing for the decision. `now` defaults to wall-clock at call time. */
export interface PolicyTiming {
  now?: Date;
  /** True once the kitchen has begun/finished prep (status preparing or later). */
  foodPrepared?: boolean;
  /** Explicit override for the fault-classified scenarios (wrong item, rider no-show). */
  scenario?: CancellationScenario;
}

export interface CancellationDecision {
  scenario: CancellationScenario;
  outcome: PolicyOutcome;
  faultParty: FaultParty;
  feeBasis: FeeBasis;
  /** Fee charged to the customer (minor units), already computed from basis + order. */
  feeMinor: number;
  /** Amount refunded to the customer (minor units) = grandTotal - fee, floored at 0. */
  refundMinor: number;
  /** Whether this cancellation should increment a branch ranking-penalty counter. */
  ranksPenalty: boolean;
  /** Human-readable rationale, surfaced to admins and stored on the OrderEvent meta. */
  note: string;
  reasonCode: CancellationScenario;
}

function toDate(v: Date | string | null | undefined): Date | null {
  if (!v) return null;
  return v instanceof Date ? v : new Date(v);
}

function secondsSince(from: Date | null, now: Date): number | null {
  if (!from) return null;
  return (now.getTime() - from.getTime()) / 1000;
}

/**
 * The heart of #30. Given the order, who is cancelling and the timing, return the
 * fee/fault/refund decision. Deterministic and side-effect free.
 */
export function evaluateCancellation(
  order: PolicyOrderInput,
  actor: CancellationActor,
  timing: PolicyTiming = {},
  config: CancellationPolicyConfig = CANCELLATION_POLICY_CONFIG,
): CancellationDecision {
  const now = timing.now ?? new Date();
  const total = order.grandTotalMinor;

  const decide = (
    scenario: CancellationScenario,
    outcome: PolicyOutcome,
    faultParty: FaultParty,
    feeBasis: FeeBasis,
    feeMinor: number,
    ranksPenalty: boolean,
    note: string,
  ): CancellationDecision => {
    const clampedFee = Math.max(0, Math.min(feeMinor, total));
    return {
      scenario,
      outcome,
      faultParty,
      feeBasis,
      feeMinor: clampedFee,
      refundMinor: Math.max(0, total - clampedFee),
      ranksPenalty,
      note,
      reasonCode: scenario,
    };
  };

  // Explicit fault scenarios take precedence — these are driven by the calling flow
  // (rider no-show, wrong/missing item, unreachable) rather than inferred from state.
  switch (timing.scenario) {
    case "rider_no_show_spoilage":
      return decide(
        "rider_no_show_spoilage",
        "full_refund",
        "dispatch",
        "none",
        0,
        false,
        "Rider no-show caused spoilage; undelivered. Full refund, dispatch bears the cost.",
      );
    case "wrong_or_missing_item":
      return decide(
        "wrong_or_missing_item",
        "support_review",
        "restaurant",
        "none",
        0,
        true,
        "Wrong/missing item — customer protected. Partial/full refund from restaurant via admin workbench.",
      );
    case "customer_unreachable_at_drop":
      return decide(
        "customer_unreachable_at_drop",
        "partial_refund",
        "customer",
        config.unreachableChargesDeliveryFee ? "delivery_fee" : "none",
        config.unreachableChargesDeliveryFee ? order.deliveryFeeMinor : 0,
        false,
        `Customer unreachable at drop after ${config.unreachableWaitSeconds / 60}-min wait; delivery fee forfeited.`,
      );
    default:
      break;
  }

  // Auto-expiry (SLA breach) — restaurant never responded.
  if (actor === "system" || order.status === "auto_expired") {
    return decide(
      "auto_expired",
      "full_refund",
      "restaurant",
      "none",
      0,
      true,
      "Order auto-expired: restaurant did not respond within the acceptance SLA. Full refund.",
    );
  }

  // Restaurant-initiated rejection/cancel.
  if (actor === "restaurant") {
    return decide(
      "restaurant_reject_pre_sla",
      "full_refund",
      "restaurant",
      "none",
      0,
      true,
      "Restaurant rejected/cancelled the order. Full refund + apology; ranking penalty.",
    );
  }

  // Admin overrides get a clean full refund by default; admins can still run the
  // refund workbench for bespoke amounts.
  if (actor === "admin") {
    return decide(
      "admin_override",
      "full_refund",
      "platform",
      "none",
      0,
      false,
      "Admin-initiated cancellation. Full refund by default; adjust via the refund workbench.",
    );
  }

  // ---- Customer-initiated: the timing-sensitive rows. ----
  const acceptedAt = toDate(order.acceptedAt);
  const foodPrepared =
    timing.foodPrepared ??
    [
      "preparing",
      "ready_for_pickup",
      "rider_assigned",
      "reassigning",
      "picked_up",
      "out_for_delivery",
    ].includes(order.status);

  // Pre-acceptance: always free.
  if (!acceptedAt && order.status === "pending_acceptance") {
    return decide(
      "customer_pre_acceptance",
      "full_refund",
      "none",
      "none",
      0,
      false,
      "Customer cancelled before the restaurant accepted. Free — full refund.",
    );
  }

  // After food prepared: charge food cost (partial), route to support.
  if (foodPrepared) {
    const fee = Math.round((order.subtotalMinor * config.afterPreparedSubtotalBps) / 10_000);
    return decide(
      "customer_after_prepared",
      "support_review",
      "customer",
      "subtotal_pct",
      fee,
      false,
      "Customer cancelled after food was prepared. Food-cost fee applies; support may review.",
    );
  }

  // Post-accept, pre-prep: free inside the grace window, small fee after.
  const sinceAccept = secondsSince(acceptedAt, now);
  const withinGrace = sinceAccept === null || sinceAccept <= config.gracePeriodSeconds;
  if (withinGrace) {
    return decide(
      "customer_post_accept_pre_prep",
      "full_refund",
      "none",
      "none",
      0,
      false,
      `Customer cancelled within the ${config.gracePeriodSeconds / 60}-min grace window. Free — full refund.`,
    );
  }
  return decide(
    "customer_post_accept_pre_prep",
    "fee_charged",
    "customer",
    "flat",
    config.postAcceptFeeMinor,
    false,
    "Customer cancelled after the grace window (pre-prep). Small cancellation fee applies.",
  );
}

/** Static, human-readable matrix for the admin surface (mirrors the kickoff table). */
export interface PolicyMatrixRow {
  scenario: CancellationScenario;
  label: string;
  customerPays: string;
  outcome: string;
}

export const CANCELLATION_POLICY_MATRIX: PolicyMatrixRow[] = [
  {
    scenario: "restaurant_reject_pre_sla",
    label: "Restaurant rejects (pre-SLA)",
    customerPays: "Nothing",
    outcome: "Auto-cancel + apology; ranking penalty",
  },
  {
    scenario: "customer_pre_acceptance",
    label: "Customer cancels pre-acceptance",
    customerPays: "Nothing",
    outcome: "Free — full refund",
  },
  {
    scenario: "customer_post_accept_pre_prep",
    label: "Customer cancels post-accept, pre-prep",
    customerPays: "Optional small fee",
    outcome: "Configurable grace window",
  },
  {
    scenario: "customer_after_prepared",
    label: "Customer cancels after food prepared",
    customerPays: "Food cost or partial",
    outcome: "Support review",
  },
  {
    scenario: "rider_no_show_spoilage",
    label: "Rider no-show causing spoilage",
    customerPays: "Nothing (if undelivered)",
    outcome: "Refund customer; dispatch policy bears",
  },
  {
    scenario: "wrong_or_missing_item",
    label: "Wrong / missing item",
    customerPays: "Protected",
    outcome: "Partial/full refund from restaurant (admin flow)",
  },
  {
    scenario: "customer_unreachable_at_drop",
    label: "Customer unreachable at drop",
    customerPays: "Delivery fee only (config)",
    outcome: "Attempt + 5-min wait + timeout policy",
  },
];
