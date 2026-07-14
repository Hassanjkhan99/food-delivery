// Scheduled-order promotion sweeper (#199). Sibling of the acceptance-SLA sweeper
// (expirePendingOrders.ts): every tick it finds scheduled ("pre-order") orders whose prep
// window has opened (promoteAt = scheduledFor − leadTime) and surfaces them in the kitchen's
// "New" lane so staff accept them in time to honour the promised slot.
//
// Until promotion a scheduled order sits in the board's "Scheduled" prep-planning lane
// (status pending_acceptance + scheduledFor set + scheduledPromotedAt null) and does NOT trip
// the new-order alarm. Promotion:
//   1. stamps scheduledPromotedAt (moves it into the "New" lane on the board),
//   2. refreshes acceptDeadlineAt so the 120s acceptance SLA starts NOW (at promotion), not at
//      booking time — otherwise every pre-order would auto-expire the instant it surfaced,
//   3. fires branchOrderFeed so the live board updates + the alarm sounds,
//   4. sends the customer a "sent to the kitchen" notification via the existing pipeline.
//
// Idempotency: promotion is a single guarded updateMany on scheduledPromotedAt IS NULL, so a
// re-run (overlapping ticks, or the standalone interval racing the serverless cron) can promote
// each order at most once — the loser's updateMany matches 0 rows and is skipped.
//
// Closed-branch behaviour (documented decision): we PROMOTE REGARDLESS of whether the branch is
// currently open/accepting. Holding a due pre-order back until the branch reopens risks blowing
// past the promised time entirely (the customer already committed to a slot). Surfacing it in
// the New lane keeps staff aware; the notification "flags" it, and the branch's own accept/reject
// (or the 120s auto-expiry) then resolves it exactly as for a live order. We log a warning when
// the branch is closed at promotion so ops can spot chronically-closed pre-order branches.
import { prisma } from "@fd/db";
import {
  ACCEPTANCE_SLA_SECONDS,
  computeScheduledPromoteAt,
  SCHEDULED_PROMOTE_SWEEP_INTERVAL_MS,
  scheduledPromoteLeadMinutes,
} from "@fd/shared";
import { logger } from "../logger.js";
import { branchOpenNow } from "../services/branchHours.js";
import { notifyScheduledOrderPromoted } from "../services/notificationService.js";
import { publishOrderChanged } from "../pubsub.js";

// One sweep pass. Extracted so both the in-process interval (standalone API) and a serverless
// cron endpoint (collapsed web deploy) can drive it. Returns the count promoted this pass.
export async function promoteScheduledOrders(): Promise<number> {
  const now = new Date();

  // Candidate window: still awaiting acceptance, has a future-booked slot, not yet promoted.
  // We can't compute promoteAt in SQL (it depends on the branch's live prep buffer), so pull
  // the small set of un-promoted scheduled orders and decide per-branch below. In practice this
  // is a handful of rows — pre-orders are rare relative to live traffic — and the
  // (status, scheduledFor) index keeps the scan tight.
  const candidates = await prisma.order.findMany({
    where: {
      status: "pending_acceptance",
      scheduledFor: { not: null },
      scheduledPromotedAt: null,
    },
    include: { branch: true },
  });

  let promoted = 0;
  for (const order of candidates) {
    if (!order.scheduledFor) continue; // narrow the type; the filter already guarantees it
    const leadMinutes = scheduledPromoteLeadMinutes(order.branch.prepBufferMinutes);
    const promoteAt = computeScheduledPromoteAt(order.scheduledFor, leadMinutes);
    if (promoteAt.getTime() > now.getTime()) continue; // not due yet

    // Idempotent, race-safe promotion: only the tick that flips scheduledPromotedAt from NULL
    // wins. A concurrent accept/reject/cancel would have moved status off pending_acceptance,
    // so the guard also skips orders the kitchen already actioned early from the Scheduled lane.
    const { count } = await prisma.order.updateMany({
      where: {
        id: order.id,
        status: "pending_acceptance",
        scheduledPromotedAt: null,
      },
      data: {
        scheduledPromotedAt: now,
        // Start the acceptance SLA at promotion, not at booking (issue requirement).
        acceptDeadlineAt: new Date(now.getTime() + ACCEPTANCE_SLA_SECONDS * 1_000),
      },
    });
    if (count === 0) continue; // lost the race / already actioned — nothing to do

    // Closed-branch flag: still promoted (see file header), just logged for ops visibility.
    try {
      const open = (await branchOpenNow(order.branch)).isOpen && order.branch.isAcceptingOrders;
      if (!open) {
        logger.warn(
          { orderId: order.id, branchId: order.branchId, scheduledFor: order.scheduledFor },
          "scheduled order promoted while branch closed/not accepting",
        );
      }
    } catch (err) {
      // Never let the open-check block a promotion that already committed.
      logger.error({ err, orderId: order.id }, "branchOpenNow check failed during promotion");
    }

    // Live board update (fires the new-order alarm) + customer notification. Both non-fatal.
    publishOrderChanged({
      orderId: order.id,
      branchId: order.branchId,
      status: "pending_acceptance",
    });
    void notifyScheduledOrderPromoted({
      id: order.id,
      customerId: order.customerId,
      code: order.code,
    });

    logger.info(
      { orderId: order.id, branchId: order.branchId, leadMinutes },
      "scheduled order promoted to kitchen queue",
    );
    promoted++;
  }

  return promoted;
}

// In-process interval for the standalone/persistent API, mirroring startExpirySweeper. The
// collapsed Vercel deploy drives promoteScheduledOrders() via /api/cron/promote-scheduled
// instead; running both is harmless (each pass is idempotent + race-guarded).
export function startScheduledPromotionSweeper(): NodeJS.Timeout {
  const timer = setInterval(() => {
    promoteScheduledOrders().catch((e) =>
      logger.error({ err: e }, "scheduled-promotion sweeper tick failed"),
    );
  }, SCHEDULED_PROMOTE_SWEEP_INTERVAL_MS);
  timer.unref();
  return timer;
}
