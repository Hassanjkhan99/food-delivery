// Nightly rider trust-score recompute. Every RIDER_TRUST_RECOMPUTE_INTERVAL_MS the
// service recomputes each rider's score from delivery outcomes and auto-disables shared
// mode on breach risk (see riderTrustService). Interval is coarse (hourly) rather than a
// true midnight cron — single-instance assumption, same as the expiry sweeper; pg-boss
// is the multi-instance path.
import { recomputeAllTrustScores } from "../services/riderTrustService.js";
import { logger } from "../logger.js";

const RIDER_TRUST_RECOMPUTE_INTERVAL_MS = 60 * 60_000; // hourly

export function startRiderTrustJob(): NodeJS.Timeout {
  const timer = setInterval(async () => {
    try {
      const count = await recomputeAllTrustScores();
      logger.info({ count }, "rider trust recompute complete");
    } catch (e) {
      logger.error({ err: e }, "rider trust recompute failed");
    }
  }, RIDER_TRUST_RECOMPUTE_INTERVAL_MS);
  timer.unref();
  return timer;
}
