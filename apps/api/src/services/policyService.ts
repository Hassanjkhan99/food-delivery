// #30 cancellation & refund policy engine — API glue around the pure matrix in
// @fd/shared. Given an order + actor + timing it computes the fee/fault/refund
// decision, persists a Cancellation row, and updates per-branch ranking penalties.
// The pure decision lives in shared so the admin UI can render the same matrix.
import { prisma, type Order } from "@fd/db";
import {
  evaluateCancellation,
  type CancellationActor,
  type CancellationDecision,
  type PolicyTiming,
} from "@fd/shared";
import type { PrismaClient } from "@fd/db";
import { logger } from "../logger.js";

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0] | typeof prisma;

/** Re-export so callers can `import { evaluateCancellation } from policyService`. */
export { evaluateCancellation };

/** Pure evaluation for a Prisma Order — no DB writes. Use to preview the decision. */
export function evaluateOrderCancellation(
  order: Order,
  actor: CancellationActor,
  timing: PolicyTiming = {},
): CancellationDecision {
  return toDecision(order, actor, timing);
}

function toDecision(order: Order, actor: CancellationActor, timing: PolicyTiming): CancellationDecision {
  return evaluateCancellation(
    {
      status: order.status,
      subtotalMinor: order.subtotalMinor,
      deliveryFeeMinor: order.deliveryFeeMinor,
      grandTotalMinor: order.grandTotalMinor,
      acceptedAt: order.acceptedAt,
      branchId: order.branchId,
    },
    actor,
    timing,
  );
}

/**
 * Evaluate + persist a cancellation. Writes the Cancellation row (idempotent per
 * order via the unique orderId) and bumps branch penalty counters when the scenario
 * carries fault against the branch. Runs inside the caller's transaction when given.
 */
export async function recordCancellation(
  order: Order,
  actor: CancellationActor,
  timing: PolicyTiming = {},
  tx: Tx = prisma,
): Promise<CancellationDecision> {
  const decision = toDecision(order, actor, timing);

  await tx.cancellation.upsert({
    where: { orderId: order.id },
    create: {
      orderId: order.id,
      cancelledBy: actor,
      reasonCode: decision.reasonCode,
      feeAssessedMinor: decision.feeMinor,
      policyOutcome: decision.outcome,
      faultParty: decision.faultParty,
      refundMinor: decision.refundMinor,
      policyNote: decision.note,
    },
    update: {
      reasonCode: decision.reasonCode,
      feeAssessedMinor: decision.feeMinor,
      policyOutcome: decision.outcome,
      faultParty: decision.faultParty,
      refundMinor: decision.refundMinor,
      policyNote: decision.note,
    },
  });

  if (decision.ranksPenalty && decision.faultParty === "restaurant") {
    const isReject = decision.scenario === "restaurant_reject_pre_sla";
    const isExpiry = decision.scenario === "auto_expired";
    await tx.branchCancellationStat.upsert({
      where: { branchId: order.branchId },
      create: {
        branchId: order.branchId,
        penaltyPoints: 1,
        rejectCount: isReject ? 1 : 0,
        expiredCount: isExpiry ? 1 : 0,
        faultCount: 1,
      },
      update: {
        penaltyPoints: { increment: 1 },
        rejectCount: { increment: isReject ? 1 : 0 },
        expiredCount: { increment: isExpiry ? 1 : 0 },
        faultCount: { increment: 1 },
      },
    });
  }

  logger.info(
    {
      orderId: order.id,
      scenario: decision.scenario,
      outcome: decision.outcome,
      faultParty: decision.faultParty,
      feeMinor: decision.feeMinor,
    },
    "cancellation policy evaluated",
  );

  return decision;
}
