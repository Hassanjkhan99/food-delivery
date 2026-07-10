// Referrals (#58): mint a share code per user, let a new user apply someone's code,
// and — when that new user's first order is delivered — credit both sides to their
// customer wallet via the double-entry ledger. Rewards are mocked money, so the
// referral flips straight from `pending` to `qualified` at credit time.
import { randomInt } from "node:crypto";
import type { PrismaClient } from "@fd/db";
import {
  REFERRAL_CODE_ALPHABET,
  REFERRAL_CODE_LENGTH,
  REFERRAL_REFEREE_REWARD_MINOR,
  REFERRAL_REFERRER_REWARD_MINOR,
} from "@fd/shared";
import { GraphQLError } from "graphql";
import { prisma } from "@fd/db";
import { postLedgerTx } from "./ledgerService.js";

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

function randomCode(): string {
  let out = "";
  for (let i = 0; i < REFERRAL_CODE_LENGTH; i++) {
    out += REFERRAL_CODE_ALPHABET[randomInt(REFERRAL_CODE_ALPHABET.length)];
  }
  return out;
}

/** Get (or lazily mint) the caller's personal referral code. Idempotent. */
export async function getOrCreateReferralCode(userId: string): Promise<string> {
  const existing = await prisma.referralCode.findUnique({ where: { userId } });
  if (existing) return existing.code;

  // Retry on the rare code collision (unique index guards correctness).
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const created = await prisma.referralCode.create({
        data: { userId, code: randomCode() },
      });
      return created.code;
    } catch (e) {
      if ((e as { code?: string }).code === "P2002") {
        // Either the code clashed or a concurrent request minted ours first.
        const now = await prisma.referralCode.findUnique({ where: { userId } });
        if (now) return now.code;
        continue;
      }
      throw e;
    }
  }
  throw new GraphQLError("Could not generate a referral code — please retry");
}

/**
 * Apply a referral code to the caller (the referee). Creates a `pending` Referral.
 * Anti-abuse: code must exist, no self-referral, referee must be brand-new
 * (no orders yet) and not already referred.
 */
export async function applyReferralCode(userId: string, rawCode: string) {
  const code = rawCode.trim().toUpperCase();
  const owner = await prisma.referralCode.findUnique({ where: { code } });
  if (!owner) throw new GraphQLError("That referral code is not valid");
  if (owner.userId === userId) throw new GraphQLError("You can't use your own referral code");

  const already = await prisma.referral.findUnique({ where: { refereeId: userId } });
  if (already) throw new GraphQLError("A referral code has already been applied to your account");

  // First-order-only qualification: a code can't be applied once you've ordered.
  const priorOrders = await prisma.order.count({ where: { customerId: userId } });
  if (priorOrders > 0) {
    throw new GraphQLError("Referral codes only apply before your first order");
  }

  return prisma.referral.create({
    data: {
      referrerId: owner.userId,
      refereeId: userId,
      code,
      status: "pending",
      refereeRewardMinor: REFERRAL_REFEREE_REWARD_MINOR,
      referrerRewardMinor: REFERRAL_REFERRER_REWARD_MINOR,
    },
  });
}

/**
 * Qualify a pending referral when the referee's first order is delivered. Runs
 * INSIDE the order-transition transaction (`tx`). Credits both wallets in one
 * balanced ledger tx (platform:referral_expense is debited for the payout).
 * No-op when there's no pending referral for this customer.
 */
export async function onRefereeOrderDelivered(
  tx: Tx,
  customerId: string,
  orderId: string,
): Promise<void> {
  const referral = await tx.referral.findUnique({ where: { refereeId: customerId } });
  if (!referral || referral.status !== "pending") return;

  // Atomically claim the referral before paying so two concurrent delivery
  // transitions for the same referee can't both post rewards (double credit).
  // The `status: "pending"` guard means only one transaction flips the row
  // (count 1) and proceeds; the loser sees count 0 and bails. If the ledger
  // post below throws, the whole `tx` rolls back — including this claim.
  const claimed = await tx.referral.updateMany({
    where: { id: referral.id, status: "pending" },
    data: {
      status: "qualified",
      qualifiedAt: new Date(),
      qualifyingOrderId: orderId,
    },
  });
  if (claimed.count === 0) return;

  const total = referral.refereeRewardMinor + referral.referrerRewardMinor;
  const txId = await postLedgerTx(
    tx,
    `Referral reward ${referral.code}`,
    [
      { code: "platform:referral_expense", ownerType: "platform", debit: total },
      {
        code: `customer:${referral.refereeId}:prepaid`,
        ownerType: "customer",
        ownerId: referral.refereeId,
        credit: referral.refereeRewardMinor,
      },
      {
        code: `customer:${referral.referrerId}:prepaid`,
        ownerType: "customer",
        ownerId: referral.referrerId,
        credit: referral.referrerRewardMinor,
      },
    ],
  );

  // Record the balanced ledger tx on the now-qualified referral.
  await tx.referral.update({
    where: { id: referral.id },
    data: { ledgerTxId: txId },
  });
}
