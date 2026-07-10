// Promoted deals / featured placements (#22).
//
// Campaigns let a restaurant pay for visibility: a `featured_slot` boosts its branches
// into a "Promoted" rail above organic results, and a `deal_badge` paints a badge on its
// cards. Pricing mirrors commission tiering — small-business is lenient (Rs 0 by seed),
// chains pay the full daily rate — read from the latest FeeConfig.
//
// The daily accrual job debits `restaurant:{id}:payable` and credits `platform:revenue`
// through postLedgerTx, once per UTC day per active campaign (lastAccruedAt guards against
// double-charging). It is idempotent and safe to run repeatedly; there is no cron
// infrastructure in this MVP, so it is triggered from an admin mutation (runCampaignAccrual),
// exactly like runPayoutBatch.
import { prisma } from "@fd/db";
import type { CampaignType, PrismaClient, RestaurantTier } from "@fd/db";
import { accountBalance, postLedgerTx } from "./ledgerService.js";

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

/** UTC midnight of the given instant — the accrual bucketing key. */
export function utcDayStart(d = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Daily rate for a tier + campaign type from the latest FeeConfig (minor units).
 *  Only featured_slot is metered today; deal_badge rides along free (a promo lever the
 *  founder can start charging for later by adding a second rate pair). */
export async function dailyRateFor(tier: RestaurantTier, type: CampaignType): Promise<number> {
  if (type !== "featured_slot") return 0;
  const cfg = await prisma.feeConfig.findFirst({ orderBy: { createdAt: "desc" } });
  return tier === "chain"
    ? (cfg?.featuredSlotDailyRateChainMinor ?? 50_000)
    : (cfg?.featuredSlotDailyRateSmallMinor ?? 0);
}

/** Campaigns are "live" when active and within their window (null bounds = open-ended). */
export function campaignWindowContains(
  c: { startsAt: Date | null; endsAt: Date | null },
  at: Date,
): boolean {
  if (c.startsAt && c.startsAt > at) return false;
  if (c.endsAt && c.endsAt < at) return false;
  return true;
}

/**
 * Debit today's fee for every active, in-window campaign that hasn't accrued yet today.
 * Also ends campaigns whose window has closed. Returns a per-campaign summary.
 *
 * Each campaign is its own transaction so one bad row can't roll back the batch; a Rs 0
 * rate (small-business / deal_badge) still stamps lastAccruedAt but posts no ledger legs.
 */
export async function accrueCampaigns(now = new Date()): Promise<
  Array<{ campaignId: string; restaurantId: string; amountMinor: number; ended: boolean }>
> {
  const today = utcDayStart(now);
  // Only bill campaigns whose restaurant can still be shown to customers. A suspended /
  // non-approved restaurant is hidden from the promoted rail (featuredBranches), so
  // continuing to debit it charges for placement that never renders.
  const active = await prisma.campaign.findMany({
    where: { status: "active", restaurant: { status: "approved" } },
    include: { restaurant: true },
  });

  const out: Array<{
    campaignId: string;
    restaurantId: string;
    amountMinor: number;
    ended: boolean;
  }> = [];

  for (const c of active) {
    // Retire finished campaigns first (no charge on the closing day past endsAt).
    if (c.endsAt && c.endsAt < now) {
      await prisma.campaign.update({ where: { id: c.id }, data: { status: "ended" } });
      out.push({ campaignId: c.id, restaurantId: c.restaurantId, amountMinor: 0, ended: true });
      continue;
    }
    // Not started, or already accrued today → skip.
    if (!campaignWindowContains(c, now)) continue;
    if (c.lastAccruedAt && utcDayStart(c.lastAccruedAt).getTime() >= today.getTime()) continue;

    const amount = c.dailyRateMinor;
    const posted = await prisma.$transaction(async (tx: Tx) => {
      // Idempotency guard: claim today inside the transaction with a conditional write so
      // two concurrent accrual runs can't both post a ledger leg for the same UTC day.
      // updateMany returns the number of rows matched; if another run already stamped a
      // lastAccruedAt in today's bucket, we match nothing and skip posting.
      const claim = await tx.campaign.updateMany({
        where: {
          id: c.id,
          OR: [{ lastAccruedAt: null }, { lastAccruedAt: { lt: today } }],
        },
        data: { lastAccruedAt: now },
      });
      if (claim.count === 0) return false;

      if (amount > 0) {
        // Re-check the wallet each day: the submit-time check only proved one day of
        // balance at approval, so a multi-day campaign could otherwise run negative. If
        // the restaurant can't cover today's fee, end the campaign instead of debiting
        // into unbacked debt (it can be recreated + resubmitted after a top-up). There is
        // no `paused` status in the MVP enum, so `ended` is the stop state.
        const balance = await accountBalance(tx, `restaurant:${c.restaurantId}:payable`);
        if (balance < amount) {
          await tx.campaign.update({
            where: { id: c.id },
            data: { status: "ended", lastAccruedAt: c.lastAccruedAt },
          });
          return "stopped";
        }
        await postLedgerTx(tx, `Campaign ${c.id} daily fee`, [
          {
            code: `restaurant:${c.restaurantId}:payable`,
            ownerType: "restaurant",
            ownerId: c.restaurantId,
            debit: amount,
          },
          { code: "platform:revenue", ownerType: "platform", credit: amount },
        ]);
      }
      return true;
    });
    if (posted === false) continue; // lost the idempotency race — already accrued today.
    if (posted === "stopped") {
      // Ended for insufficient balance: report as ended, no charge posted.
      out.push({ campaignId: c.id, restaurantId: c.restaurantId, amountMinor: 0, ended: true });
      continue;
    }
    out.push({ campaignId: c.id, restaurantId: c.restaurantId, amountMinor: amount, ended: false });
  }

  return out;
}
