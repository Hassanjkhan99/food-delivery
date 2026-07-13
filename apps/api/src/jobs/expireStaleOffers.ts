// Offer-expiry sweeper (#168). Offer auto-decline was previously client-only (the 60s
// countdown in the rider app's AssignmentAlert), so an offer left open with the app closed
// stayed `offered` forever and the restaurant had to notice and re-assign by hand. This
// runs server-side, independent of any client.
//
// Two offer shapes reach DeliveryTask.status === "offered":
//   a) restaurant `offerTask` (single rider, swipe-to-accept): task offered + riderId,
//      offeredAt set, NO DeliveryOffer row and NO expiresAt. Released after a grace TTL
//      measured from offeredAt (the client shows a 60s countdown, so we give 90s).
//   b) shared-rider fan-out (dispatch `offerSharedTask`): one DeliveryOffer row per
//      candidate, each with its own expiresAt (OFFER_TTL_SECONDS). Released as soon as
//      none of its offers are still pending — each offer already carried its own TTL.
import { prisma } from "@fd/db";
import { logger } from "../logger.js";

// Grace window for the single-rider offerTask path, measured from offeredAt. Kept above the
// client's 60s AssignmentAlert countdown (+30s for clock skew / slow networks) so the server
// never reclaims a task the rider is still deciding on.
const OFFERED_TASK_RELEASE_SECONDS = 90;

// One sweep pass. Extracted so both an in-process interval and a serverless cron endpoint can
// drive it. Idempotent and race-safe: every mutation is guarded so a concurrent accept wins.
export async function sweepExpiredOffers(): Promise<{
  offersExpired: number;
  tasksReleased: number;
}> {
  const now = new Date();

  // 1) Expire individual shared-rider offers past their own TTL, so acceptSharedOffer's
  //    "still pending?" guard stays clean and the task can be recognised as fully resolved.
  const { count: offersExpired } = await prisma.deliveryOffer.updateMany({
    where: { status: "pending", expiresAt: { lt: now } },
    data: { status: "expired", respondedAt: now },
  });

  // 2) Return stuck `offered` tasks to the dispatch queue.
  const ttlCutoff = new Date(now.getTime() - OFFERED_TASK_RELEASE_SECONDS * 1000);
  const candidates = await prisma.deliveryTask.findMany({
    where: {
      status: "offered",
      OR: [
        // shared path: had offers, none still pending (all expired/declined/withdrawn)
        { offers: { some: {}, none: { status: "pending" } } },
        // single offerTask path: no offer rows at all, and past the grace TTL
        { offers: { none: {} }, offeredAt: { lt: ttlCutoff } },
      ],
    },
    select: { id: true },
  });

  let tasksReleased = 0;
  for (const task of candidates) {
    // Race guard: only release if STILL offered with no pending offer — a concurrent
    // accept (task → assigned) or a fresh re-offer loses cleanly here.
    const { count } = await prisma.deliveryTask.updateMany({
      where: { id: task.id, status: "offered", offers: { none: { status: "pending" } } },
      data: {
        status: "unassigned",
        riderId: null,
        offeredAt: null,
        declineReason: "offer_expired",
      },
    });
    if (count === 0) continue;
    // Reuse the `declined` event type — an expiry is an auto-decline — with a note that
    // distinguishes it (no `expired` value in DeliveryEventType, and adding one would need a
    // migration this change doesn't otherwise require).
    await prisma.deliveryEvent.create({
      data: {
        taskId: task.id,
        type: "declined",
        note: "Offer expired — returned to dispatch queue",
      },
    });
    tasksReleased++;
  }

  if (offersExpired > 0 || tasksReleased > 0) {
    logger.info({ offersExpired, tasksReleased }, "offer-expiry sweep");
  }
  return { offersExpired, tasksReleased };
}
