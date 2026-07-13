// Shared-rider dispatch engine foundation (#21).
//
// A restaurant can lend idle rider capacity to nearby restaurants. The key artifact is a
// *delivery offer* (DeliveryOffer), separate from the order/task: the engine shortlists
// nearby available riders, scores them, and emits short-lived offers to the top candidates.
// The first valid accept locks the DeliveryTask to that rider (see acceptSharedOffer in the
// rider resolver) and the ledger-split hook books the seller / lender / rider / platform legs.
//
// This is a FOUNDATION — it deliberately uses cheap approximations where a production build
// would call a route matrix:
//   * shortlist by haversine ("as the crow flies") FIRST, then keep only the top few — a real
//     build would call a route matrix (billed per element) for that final <=10 set. We expose
//     a `routeMatrix` seam (estimateEta/estimateDiversion) that currently derives everything
//     from haversine so the scoring shape is already route-matrix-ready.
//   * incremental delay to a committed customer is estimated, not simulated.
//
// Founder-style defaults picked here (noted in the PR): a fixed straight-line speed for ETA,
// scoring weights inlined as constants, dispatch-fee split percentages as constants. All are
// single-source here so tuning later is one edit.
import { haversineMeters } from "@fd/shared";
import type { PrismaClient, Rider, RiderAvailability, SharedRiderPolicy } from "@fd/db";
import { postLedgerTx, type Leg } from "./ledgerService.js";

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

// ─────────────────────────── tuning constants ───────────────────────────

/** Assumed straight-line rider speed for ETA estimates (m/s ≈ 18 km/h urban). */
const RIDER_SPEED_MPS = 5;

/** Offer accept window — the research spec says 15–20s; beta uses 20s. */
export const OFFER_TTL_SECONDS = 20;

/** Only route the top-N haversine candidates (route matrix is billed per element). */
export const SHORTLIST_SIZE = 10;

/**
 * Score assigned to a candidate that fails a hard constraint. Kept FINITE (not -Infinity) so
 * it survives GraphQL's non-null `Float` serialisation — a non-finite float makes the whole
 * `sharedRiderCandidates`/`generateSharedOffers` response fail. Large-negative so rejected
 * riders always sort below any eligible one while still carrying their `rejectReason`.
 */
const REJECTED_SCORE = -1_000_000;

/** Scoring weights (research-provided function). Positive terms reward, negative penalise. */
const WEIGHTS = {
  reliability: 40, // * rider_reliability   (trustScore/100, 0..1)
  zoneFamiliarity: 15, // * zone_match       (1 if same restaurant zone else 0)
  etaToPickup: 0.02, // - eta_to_pickup_sec
  diversion: 0.005, // - incremental_distance_m
  delayPenalty: 0.03, // - incremental_delay_to_existing_orders_sec
  cashRisk: 30, // - cash_risk_score        (0..1)
} as const;

/** Beta constraint fallbacks used when the lender has no explicit policy row. */
const DEFAULTS = {
  maxPickupMeters: 1500,
  maxActiveJobs: 1,
  maxIncrementalDelaySec: 300,
  codTrustThreshold: 70,
} as const;

// Dispatch fee + split percentages (of the delivery fee) for the ledger-split hook. A real
// build reads these from a contract; the beta inlines them. All in basis points of the
// delivery fee so they compose cleanly.
const SPLIT_BPS = {
  platformDispatchFee: 1000, // 10% platform dispatch fee
  lenderShare: 2000, // 20% to the lender restaurant when the rider is theirs
  riderBonus: 500, // 5% per-job rider bonus payable
} as const;

// ─────────────────────────── geo / route seam ───────────────────────────

export type LatLng = { lat: number; lng: number };

/**
 * ETA to pickup in seconds. Route-matrix seam: derived from haversine + a fixed speed for
 * now; swap the body for a real matrix call on the shortlisted candidates without touching
 * the scorer.
 */
export function estimateEtaSec(from: LatLng, to: LatLng): number {
  const meters = haversineMeters(from.lat, from.lng, to.lat, to.lng);
  return Math.round(meters / RIDER_SPEED_MPS);
}

/**
 * Extra distance (metres) a detour to the new pickup adds versus the rider going straight to
 * their committed dropoff. With no committed job it's just the pickup distance. Approximation
 * of the on-route "extra distance <20%" test.
 */
export function estimateDiversionMeters(
  riderAt: LatLng,
  newPickup: LatLng,
  committedDropoff: LatLng | null,
): number {
  if (!committedDropoff) {
    return haversineMeters(riderAt.lat, riderAt.lng, newPickup.lat, newPickup.lng);
  }
  const direct = haversineMeters(
    riderAt.lat,
    riderAt.lng,
    committedDropoff.lat,
    committedDropoff.lng,
  );
  const viaPickup =
    haversineMeters(riderAt.lat, riderAt.lng, newPickup.lat, newPickup.lng) +
    haversineMeters(newPickup.lat, newPickup.lng, committedDropoff.lat, committedDropoff.lng);
  return Math.max(0, viaPickup - direct);
}

// ─────────────────────────── candidate model ───────────────────────────

export type RiderCandidate = {
  rider: Rider & { availability: RiderAvailability | null };
  isSharedRider: boolean; // rider belongs to a DIFFERENT restaurant (lent capacity)
  activeJobCount: number;
  // The dropoff of the rider's ALREADY-committed job, if any — the reference point for the
  // diversion estimate (how far the new pickup detours them from where they're already
  // headed). null for an idle rider: there's no committed customer to delay, so diversion
  // is just the pickup distance (Codex #126 P2). NOT the new order's dropoff.
  committedDropoff: LatLng | null;
};

export type ScoredCandidate = {
  riderId: string;
  isSharedRider: boolean;
  score: number;
  pickupMeters: number;
  etaToPickupSec: number;
  diversionMeters: number;
  incrementalDelaySec: number;
  cashRiskScore: number;
  eligible: boolean;
  rejectReason?: string;
};

type ScoreContext = {
  pickup: LatLng; // source-branch location (where the food is)
  sourceRestaurantId: string;
  isCod: boolean;
  policy: SharedRiderPolicy | null; // lender policy governing shared riders
};

/**
 * Hard constraints + scoring for one candidate. A candidate that fails any hard constraint
 * is returned with eligible=false and a reason (kept for fairness analytics), never silently
 * dropped. The lender's OWN riders bypass the shared-only guards (their orders always win).
 */
export function scoreCandidate(cand: RiderCandidate, ctx: ScoreContext): ScoredCandidate {
  const avail = cand.rider.availability;
  const riderAt: LatLng | null =
    avail?.lat != null && avail?.lng != null
      ? { lat: Number(avail.lat), lng: Number(avail.lng) }
      : null;

  const pickupMeters = riderAt
    ? haversineMeters(riderAt.lat, riderAt.lng, ctx.pickup.lat, ctx.pickup.lng)
    : Number.POSITIVE_INFINITY;
  const etaToPickupSec = riderAt ? estimateEtaSec(riderAt, ctx.pickup) : Number.POSITIVE_INFINITY;
  const diversionMeters = riderAt
    ? estimateDiversionMeters(riderAt, ctx.pickup, cand.committedDropoff)
    : Number.POSITIVE_INFINITY;
  // Incremental delay estimate: the detour distance turned back into seconds.
  const incrementalDelaySec = Number.isFinite(diversionMeters)
    ? Math.round(diversionMeters / RIDER_SPEED_MPS)
    : Number.POSITIVE_INFINITY;

  const trust = clamp01(cand.rider.trustScore / 100);
  // Cash risk only applies to COD carried by SHARED riders below the trust threshold.
  const codThreshold = ctx.policy?.codTrustThreshold ?? DEFAULTS.codTrustThreshold;
  const cashRiskScore =
    ctx.isCod && cand.isSharedRider && cand.rider.trustScore < codThreshold ? 1 : 0;

  const zoneMatch = cand.rider.restaurantId === ctx.sourceRestaurantId ? 1 : 0;

  const base: Omit<ScoredCandidate, "eligible" | "rejectReason" | "score"> = {
    riderId: cand.rider.id,
    isSharedRider: cand.isSharedRider,
    pickupMeters: Number.isFinite(pickupMeters) ? pickupMeters : -1,
    etaToPickupSec: Number.isFinite(etaToPickupSec) ? etaToPickupSec : -1,
    diversionMeters: Number.isFinite(diversionMeters) ? diversionMeters : -1,
    incrementalDelaySec: Number.isFinite(incrementalDelaySec) ? incrementalDelaySec : -1,
    cashRiskScore,
  };

  const reject = (rejectReason: string): ScoredCandidate => ({
    ...base,
    score: REJECTED_SCORE,
    eligible: false,
    rejectReason,
  });

  // ── hard constraints ──
  if (!avail?.isOnline) return reject("rider offline");
  if (!riderAt) return reject("rider location unknown");

  const maxPickup = ctx.policy?.maxPickupMeters ?? DEFAULTS.maxPickupMeters;
  const maxActive = ctx.policy?.maxActiveJobs ?? DEFAULTS.maxActiveJobs;
  const maxDelay = ctx.policy?.maxIncrementalDelaySec ?? DEFAULTS.maxIncrementalDelaySec;

  if (cand.isSharedRider) {
    // Shared-only guards. Own riders skip these.
    if (!cand.rider.sharedOptIn) return reject("rider not opted into shared work");
    if (!ctx.policy || !ctx.policy.sharingEnabled) return reject("source restaurant not sharing");
    if (ctx.policy.vetoActive) return reject("lender veto active");
    // Trust-gated active-job ceiling: only trusted riders may hold >1 committed job.
    const jobCeiling =
      cand.rider.trustScore >= (ctx.policy.codTrustThreshold ?? 70) ? maxActive : 1;
    if (cand.activeJobCount >= jobCeiling) return reject("rider at active-job ceiling");
    if (pickupMeters > maxPickup) return reject("pickup beyond distance ceiling");
    if (incrementalDelaySec > maxDelay) return reject("incremental delay over cap");
    // Cash rule: shared rider may only carry COD above the trust threshold.
    if (cashRiskScore > 0) return reject("COD blocked: rider below cash-trust threshold");
  } else {
    // Own rider: still respect the basic active-job ceiling (1 pre-pickup commit by default).
    if (cand.activeJobCount >= Math.max(1, maxActive)) return reject("rider at active-job ceiling");
  }

  const score =
    WEIGHTS.reliability * trust +
    WEIGHTS.zoneFamiliarity * zoneMatch -
    WEIGHTS.etaToPickup * etaToPickupSec -
    WEIGHTS.diversion * diversionMeters -
    WEIGHTS.delayPenalty * incrementalDelaySec -
    WEIGHTS.cashRisk * cashRiskScore;

  return { ...base, score, eligible: true };
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

// ─────────────────────────── shortlist + offer generation ───────────────────────────

/** Rank eligible candidates, best score first, truncated to the shortlist size. */
export function rankCandidates(scored: ScoredCandidate[]): ScoredCandidate[] {
  return scored
    .filter((c) => c.eligible)
    .sort((a, b) => b.score - a.score)
    .slice(0, SHORTLIST_SIZE);
}

// ─────────────────────────── ledger split hook ───────────────────────────

export type DispatchSplitInput = {
  orderId: string;
  orderCode: string;
  deliveryFeeMinor: number;
  sourceRestaurantId: string; // the seller
  lenderRestaurantId: string | null; // rider's home restaurant, if a shared rider
  riderId: string;
};

export type DispatchSplit = {
  platformDispatchFeeMinor: number;
  lenderShareMinor: number;
  riderBonusMinor: number;
};

/** Deterministic split math (no I/O) — used by the ledger hook and testable on its own. */
export function computeDispatchSplit(deliveryFeeMinor: number, hasLender: boolean): DispatchSplit {
  const bps = (v: number) => Math.round((deliveryFeeMinor * v) / 10_000);
  return {
    platformDispatchFeeMinor: bps(SPLIT_BPS.platformDispatchFee),
    lenderShareMinor: hasLender ? bps(SPLIT_BPS.lenderShare) : 0,
    riderBonusMinor: bps(SPLIT_BPS.riderBonus),
  };
}

// Memo prefix for shared-dispatch ledger txs; also the idempotency probe key (per order).
const DISPATCH_SPLIT_MEMO_PREFIX = "Shared dispatch";

/**
 * Post the shared-dispatch ledger legs for a delivered SHARED job. Runs inside a caller tx.
 *
 * Funding (Codex #126): the split REALLOCATES the delivery fee the seller actually received
 * at settlement — onOrderDelivered credits the whole delivery fee into the seller's payable
 * (restaurantShare includes order.deliveryFeeMinor). For a shared job the seller owes a cut
 * for using someone else's rider, so we DEBIT the seller's payable and credit the platform
 * dispatch-fee revenue, the lender restaurant's payable, and the rider's bonus payable. This
 * moves real money instead of minting it from an empty `platform:delivery_fees` pool that
 * nothing ever credits.
 *
 * No-lender short-circuit (Codex #126): a seller-owned rider is NOT a shared dispatch — there
 * is no lender to pay and no cut to skim — so this is a no-op (returns null) when
 * lenderRestaurantId is null. The seller keeps the full delivery fee via normal settlement.
 *
 * Idempotent (Codex #126): a shared-dispatch tx is posted at most once per order. A replay
 * (retry / double-call) detects the prior tx by (orderId, memo prefix) and returns null
 * rather than double-paying the lender + rider.
 */
export async function postDispatchSplit(tx: Tx, input: DispatchSplitInput): Promise<string | null> {
  // Seller-owned rider → not a shared dispatch, nothing to split.
  if (input.lenderRestaurantId === null) return null;

  // Idempotency guard: bail if a shared-dispatch tx already exists for this order.
  const existing = await tx.ledgerEntry.findFirst({
    where: { orderId: input.orderId, memo: { startsWith: DISPATCH_SPLIT_MEMO_PREFIX } },
    select: { id: true },
  });
  if (existing) return null;

  const split = computeDispatchSplit(input.deliveryFeeMinor, true);
  const distributed =
    split.platformDispatchFeeMinor + split.lenderShareMinor + split.riderBonusMinor;
  if (distributed <= 0) return null;

  const legs: Leg[] = [
    // Source of funds: the delivery fee the seller received at settlement funds the split.
    {
      code: `restaurant:${input.sourceRestaurantId}:payable`,
      ownerType: "restaurant",
      ownerId: input.sourceRestaurantId,
      debit: distributed,
    },
    {
      code: "platform:dispatch_revenue",
      ownerType: "platform",
      credit: split.platformDispatchFeeMinor,
    },
    {
      code: `rider:${input.riderId}:payable`,
      ownerType: "rider",
      ownerId: input.riderId,
      credit: split.riderBonusMinor,
    },
    {
      code: `restaurant:${input.lenderRestaurantId}:payable`,
      ownerType: "restaurant",
      ownerId: input.lenderRestaurantId,
      credit: split.lenderShareMinor,
    },
  ];

  return postLedgerTx(tx, `${DISPATCH_SPLIT_MEMO_PREFIX} ${input.orderCode}`, legs, {
    orderId: input.orderId,
  });
}
