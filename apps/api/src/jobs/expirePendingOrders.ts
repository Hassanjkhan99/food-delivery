// 120s acceptance-SLA sweeper. Every 5s: any pending_acceptance order past its
// server-authoritative acceptDeadlineAt is auto-expired. transition()'s optimistic
// guard makes this race-safe against a concurrent acceptOrder — exactly one wins.
// Single-instance assumption documented; pg-boss is the multi-instance path.
import { prisma } from "@fd/db";
import { EXPIRY_SWEEP_INTERVAL_MS } from "@fd/shared";
import { logger } from "../logger.js";
import { SYSTEM_ACTOR, transition } from "../services/orderService.js";
import { recordCancellation } from "../services/policyService.js";

// One sweep pass. Extracted so both the in-process interval (standalone API) and a
// serverless cron endpoint (collapsed web deploy) can drive it. Returns the count expired.
export async function sweepExpiredOrders(): Promise<number> {
  const stale = await prisma.order.findMany({
    where: { status: "pending_acceptance", acceptDeadlineAt: { lt: new Date() } },
  });
  let expired = 0;
  for (const order of stale) {
    try {
      await transition(order.id, "auto_expired", SYSTEM_ACTOR, {
        reason: "Acceptance SLA (120s) exceeded",
      });
      // #30: full refund + restaurant ranking penalty for the SLA breach.
      await recordCancellation(order, "system");
      expired++;
    } catch {
      // Lost the race to an accept/reject — that's the desired outcome.
    }
  }
  return expired;
}

export function startExpirySweeper(): NodeJS.Timeout {
  const timer = setInterval(() => {
    sweepExpiredOrders().catch((e) => logger.error({ err: e }, "expiry sweeper tick failed"));
  }, EXPIRY_SWEEP_INTERVAL_MS);
  timer.unref();
  return timer;
}
