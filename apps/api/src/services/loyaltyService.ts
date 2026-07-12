// Loyalty points (FP-07). Append-only LoyaltyLedger is the source of truth; the cached
// LoyaltyAccount.pointsBalance is only ever mutated in the same transaction as a ledger
// row. Earn on delivery, redeem at checkout, reverse on cancellation. Platform-funded —
// there is no money-ledger posting here; the discount is absorbed as a checkout total
// reduction (booked against the platform via the smaller order total).
import type { PrismaClient } from "@fd/db";
import { loyaltyPointsEarned } from "@fd/shared";
import { GraphQLError } from "graphql";

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

/**
 * Append a signed points movement for `userId` inside an existing transaction,
 * creating the account on first touch and keeping the cached balance in lock-step.
 * Returns the new balance. A spend (negative delta) that would overdraw the balance is
 * rejected — two checkouts quoted against the same balance can both reach this path, and
 * silently flooring at 0 would grant a second discount with no points behind it.
 */
export async function postLoyaltyTx(
  tx: Tx,
  userId: string,
  delta: number,
  reason: "earn" | "redeem" | "expire" | "adjust",
  opts: { orderId?: string; memo?: string } = {},
): Promise<number> {
  if (delta === 0) return (await getBalance(tx, userId)) ?? 0;

  const account = await tx.loyaltyAccount.upsert({
    where: { userId },
    update: {},
    create: { userId, pointsBalance: 0 },
  });
  const balanceAfter = account.pointsBalance + delta;
  if (balanceAfter < 0) {
    // Insufficient balance — a concurrent spend already drained the points.
    throw new GraphQLError("You don't have enough loyalty points to redeem.", {
      extensions: { code: "insufficient_loyalty_points" },
    });
  }

  await tx.loyaltyAccount.update({
    where: { userId },
    data: { pointsBalance: balanceAfter },
  });
  await tx.loyaltyLedger.create({
    data: {
      userId,
      orderId: opts.orderId ?? null,
      delta,
      balanceAfter,
      reason,
      memo: opts.memo ?? null,
    },
  });
  return balanceAfter;
}

async function getBalance(tx: Tx, userId: string): Promise<number | null> {
  const acct = await tx.loyaltyAccount.findUnique({ where: { userId } });
  return acct?.pointsBalance ?? null;
}

/**
 * Award points for a delivered order — runs inside the transition transaction, right
 * next to the money settlement. Points come off the SUBTOTAL (not fees/tip) so the
 * reward tracks food spend. No-op when the order redeemed points already (still earns)
 * — earn and redeem are independent movements.
 */
export async function onOrderDeliveredLoyalty(
  tx: Tx,
  order: { id: string; customerId: string; subtotalMinor: number; code: string },
): Promise<void> {
  const points = loyaltyPointsEarned(order.subtotalMinor);
  if (points <= 0) return;
  await postLoyaltyTx(tx, order.customerId, points, "earn", {
    orderId: order.id,
    memo: `Earned on delivery of ${order.code}`,
  });
}

/**
 * Return spent points to the customer when a redeeming order terminates before
 * fulfilment (rejected / auto_expired / cancelled). Idempotent-ish: only refunds when
 * the order actually redeemed points.
 */
export async function onOrderReversalLoyalty(
  tx: Tx,
  order: { id: string; customerId: string; loyaltyPointsRedeemed: number; code: string },
  to: string,
): Promise<void> {
  if (order.loyaltyPointsRedeemed <= 0) return;
  await postLoyaltyTx(tx, order.customerId, order.loyaltyPointsRedeemed, "adjust", {
    orderId: order.id,
    memo: `Points returned — order ${to} (${order.code})`,
  });
}
