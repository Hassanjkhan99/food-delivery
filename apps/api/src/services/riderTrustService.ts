// Rider trust-score lifecycle. The score (0–100) is recomputed from delivery outcomes
// and gates COD handling + shared-offer eligibility. Recompute is intended to run
// nightly (see recomputeAllTrustScores) but is also callable on-demand by admin.
//
// MVP inputs — derived live from DeliveryTask/DeliveryEvent + COD-mismatch tickets;
// there is no dedicated metrics table yet, so this is a computed approximation:
//   • on-time pickup rate   — accepted→arrived_pickup without decline churn (proxy)
//   • delivery breach rate  — failed tasks / total tasks
//   • cash variance         — COD-mismatch incident tickets
//   • incident count        — rider "incident" delivery events
import { prisma } from "@fd/db";
import {
  RIDER_TRUST_START,
  RIDER_TRUST_SHARED_MIN,
} from "@fd/shared";

export type TrustBreakdown = {
  riderId: string;
  score: number;
  deliveredCount: number;
  failedCount: number;
  declinedCount: number;
  incidentCount: number;
  cashMismatchCount: number;
};

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

/**
 * Compute (but do not persist) a rider's trust score from their outcomes.
 * Neutral start (RIDER_TRUST_START) with additive/subtractive weights. A rider with no
 * history keeps the neutral seed so new riders aren't punished.
 */
export async function computeTrustScore(riderId: string): Promise<TrustBreakdown> {
  const tasks = await prisma.deliveryTask.findMany({
    where: { riderId },
    include: { order: true, events: true },
  });

  const deliveredCount = tasks.filter((t) => t.status === "delivered").length;
  const failedCount = tasks.filter((t) => t.status === "failed").length;
  const totalTerminal = deliveredCount + failedCount;

  // Declines are attributed to the rider who declined, not the task's current owner:
  // declineTask clears DeliveryTask.riderId, so counting declined events on currently-owned
  // tasks would never penalize the decliner and would mis-charge a later assignee. Count by
  // the declining user's own decline events instead (actorUserId set at decline time).
  const rider = await prisma.rider.findUnique({
    where: { id: riderId },
    select: { userId: true },
  });
  const declinedCount = rider
    ? await prisma.deliveryEvent.count({
        where: { type: "declined", actorUserId: rider.userId },
      })
    : 0;
  const incidentCount = tasks.reduce(
    (n, t) => n + t.events.filter((e) => e.type === "incident").length,
    0,
  );

  // Cash variance: COD-mismatch tickets raised against this rider's delivered orders.
  const orderIds = tasks.map((t) => t.orderId);
  const cashMismatchCount = orderIds.length
    ? await prisma.supportTicket.count({
        where: { orderId: { in: orderIds }, category: "cash_mismatch" },
      })
    : 0;

  let score = RIDER_TRUST_START;
  // Reliable completion lifts the score; breaches, incidents and cash issues cut it.
  if (totalTerminal > 0) {
    const breachRate = failedCount / totalTerminal;
    score += (1 - breachRate) * 20; // up to +20 for a clean completion record
    score -= breachRate * 40; // breaches hurt more than clean deliveries help
  }
  score -= incidentCount * 5;
  score -= cashMismatchCount * 8;
  score -= declinedCount * 1; // mild: churn signal, not a hard fault

  return {
    riderId,
    score: clamp(score),
    deliveredCount,
    failedCount,
    declinedCount,
    incidentCount,
    cashMismatchCount,
  };
}

/**
 * Recompute + persist one rider's trust score. Auto-disables shared mode when the score
 * falls below the shared-eligibility threshold (breach risk), mirroring the kickoff rule.
 * Returns the persisted breakdown.
 */
export async function recomputeTrustScore(riderId: string): Promise<TrustBreakdown> {
  const breakdown = await computeTrustScore(riderId);
  const rider = await prisma.rider.findUnique({ where: { id: riderId } });
  const autoDisableShared =
    rider?.sharedModeEnabled && breakdown.score < RIDER_TRUST_SHARED_MIN;
  await prisma.rider.update({
    where: { id: riderId },
    data: {
      trustScore: breakdown.score,
      ...(autoDisableShared ? { sharedModeEnabled: false } : {}),
    },
  });
  return breakdown;
}

/** Nightly job entry point: recompute every rider. Returns the count processed. */
export async function recomputeAllTrustScores(): Promise<number> {
  const riders = await prisma.rider.findMany({ select: { id: true } });
  for (const r of riders) {
    await recomputeTrustScore(r.id);
  }
  return riders.length;
}
