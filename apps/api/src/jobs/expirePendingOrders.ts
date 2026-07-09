// 120s acceptance-SLA sweeper. Every 5s: any pending_acceptance order past its
// server-authoritative acceptDeadlineAt is auto-expired. transition()'s optimistic
// guard makes this race-safe against a concurrent acceptOrder — exactly one wins.
// Single-instance assumption documented; pg-boss is the multi-instance path.
import { prisma } from "@fd/db";
import { EXPIRY_SWEEP_INTERVAL_MS } from "@fd/shared";
import { logger } from "../logger.js";
import { SYSTEM_ACTOR, transition } from "../services/orderService.js";

export function startExpirySweeper(): NodeJS.Timeout {
  const timer = setInterval(async () => {
    try {
      const stale = await prisma.order.findMany({
        where: { status: "pending_acceptance", acceptDeadlineAt: { lt: new Date() } },
        select: { id: true },
      });
      for (const { id } of stale) {
        try {
          await transition(id, "auto_expired", SYSTEM_ACTOR, {
            reason: "Acceptance SLA (120s) exceeded",
          });
        } catch {
          // Lost the race to an accept/reject — that's the desired outcome.
        }
      }
    } catch (e) {
      logger.error({ err: e }, "expiry sweeper tick failed");
    }
  }, EXPIRY_SWEEP_INTERVAL_MS);
  timer.unref();
  return timer;
}
