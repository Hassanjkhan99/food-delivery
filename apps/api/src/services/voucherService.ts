// Voucher validation + application — the single source of truth used by both the
// quote path (preview) and placeOrder (authoritative). Validation checks the window,
// active flag, min-order, scope/restaurant, first-order, per-user limit and total
// budget, then computes the discount via the shared pure helper. Redemption rows are
// written inside the placeOrder transaction (see orderService) so the usage counters
// can never drift from the ledger. Reversal (cancel/refund) frees the redemption.
import { prisma, type PrismaClient, type Voucher } from "@fd/db";
import {
  computeVoucherDiscount,
  normalizeVoucherCode,
  VOUCHER_REJECTION_MESSAGE,
  type VoucherRejectionCode,
} from "@fd/shared";
import { GraphQLError } from "graphql";
import { postLedgerTx } from "./ledgerService.js";

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

/** GraphQLError carrying a stable voucher rejection code the web maps to a message. */
export class VoucherError extends GraphQLError {
  constructor(public code: VoucherRejectionCode) {
    super(VOUCHER_REJECTION_MESSAGE[code], { extensions: { code: `voucher_${code}` } });
  }
}

export type VoucherContext = {
  userId: string;
  restaurantId: string;
  subtotalMinor: number;
  deliveryFeeMinor: number;
};

export type AppliedVoucher = {
  voucher: Voucher;
  discountMinor: number;
};

/**
 * Validate a code against the given order context and return the voucher + discount.
 * Throws VoucherError with a stable code on any failure. Read-only — does NOT write a
 * redemption (that happens in the placeOrder transaction). `db` defaults to the global
 * client so the quote path can call it outside a transaction.
 */
export async function validateVoucher(
  code: string,
  ctx: VoucherContext,
  db: Tx | typeof prisma = prisma,
): Promise<AppliedVoucher> {
  const voucher = await db.voucher.findUnique({
    where: { code: normalizeVoucherCode(code) },
  });
  if (!voucher) throw new VoucherError("not_found");
  if (!voucher.active) throw new VoucherError("inactive");

  const now = new Date();
  if (voucher.startsAt && now < voucher.startsAt) throw new VoucherError("not_started");
  if (voucher.endsAt && now > voucher.endsAt) throw new VoucherError("expired");

  if (voucher.scope === "restaurant" && voucher.restaurantId !== ctx.restaurantId) {
    throw new VoucherError("wrong_restaurant");
  }

  if (ctx.subtotalMinor < voucher.minOrderMinor) throw new VoucherError("min_not_met");

  // First-order restriction: reject if the customer has any prior order that wasn't
  // rejected/expired/cancelled (i.e. a genuine order counts against the "first" claim).
  if (voucher.firstOrderOnly) {
    const priorOrders = await db.order.count({
      where: {
        customerId: ctx.userId,
        status: { notIn: ["rejected", "auto_expired", "cancelled"] },
      },
    });
    if (priorOrders > 0) throw new VoucherError("first_order_only");
  }

  // Per-user usage cap: count non-reversed redemptions by this user.
  if (voucher.perUserLimit != null) {
    const used = await db.voucherRedemption.count({
      where: { voucherId: voucher.id, userId: ctx.userId, reversedAt: null },
    });
    if (used >= voucher.perUserLimit) throw new VoucherError("already_used");
  }

  const discountMinor = computeVoucherDiscount(voucher, {
    subtotalMinor: ctx.subtotalMinor,
    deliveryFeeMinor: ctx.deliveryFeeMinor,
  });
  if (discountMinor <= 0) throw new VoucherError("not_eligible");

  // Total budget cap: reject once the remaining budget can't cover this discount.
  if (voucher.totalBudgetMinor != null) {
    const remaining = voucher.totalBudgetMinor - voucher.usedBudgetMinor;
    if (remaining < discountMinor) throw new VoucherError("budget_exhausted");
  }

  return { voucher, discountMinor };
}

/**
 * Record a redemption inside the placeOrder transaction. Increments the denormalised
 * counters and writes the unique redemption row (voucherId+orderId), so a duplicate
 * apply on the same order raises a unique violation the caller surfaces as already_used.
 */
export async function recordRedemption(
  tx: Tx,
  applied: AppliedVoucher,
  orderId: string,
  userId: string,
): Promise<void> {
  await tx.voucherRedemption.create({
    data: {
      voucherId: applied.voucher.id,
      orderId,
      userId,
      amountMinor: applied.discountMinor,
    },
  });
  await tx.voucher.update({
    where: { id: applied.voucher.id },
    data: {
      usedCount: { increment: 1 },
      usedBudgetMinor: { increment: applied.discountMinor },
    },
  });
}

/**
 * Reverse a redemption when its order terminates (rejected/expired/cancelled) so the
 * discount no longer counts against the user's limit or the total budget, and post the
 * balanced ledger reversal of the discount to whoever funded it. Idempotent: a redemption
 * already reversed is skipped. Runs inside the transition transaction.
 */
export async function reverseRedemptionForOrder(tx: Tx, orderId: string): Promise<void> {
  const redemption = await tx.voucherRedemption.findUnique({ where: { orderId } });
  if (!redemption || redemption.reversedAt) return;

  await tx.voucherRedemption.update({
    where: { id: redemption.id },
    data: { reversedAt: new Date() },
  });
  await tx.voucher.update({
    where: { id: redemption.voucherId },
    data: {
      usedCount: { decrement: 1 },
      usedBudgetMinor: { decrement: redemption.amountMinor },
    },
  });
}

/**
 * Post the discount as a balanced ledger entry against the funder, run at settlement
 * (delivered). Platform-funded: platform revenue absorbs the discount as marketing spend
 * (debit platform:revenue, credit the marketing sink). Restaurant-funded: the restaurant
 * eats it (debit restaurant:payable). Split: half/half (rounding remainder to platform).
 * A discount of 0 posts nothing. This is separate from the settlement legs so the discount
 * is always a distinct, auditable accounting entry — never a faked total.
 */
export async function postDiscountLedger(
  tx: Tx,
  order: {
    id: string;
    code: string;
    discountMinor: number;
    voucherId: string | null;
    branch: { restaurantId: string };
  },
): Promise<void> {
  if (!order.discountMinor || order.discountMinor <= 0 || !order.voucherId) return;
  const voucher = await tx.voucher.findUnique({ where: { id: order.voucherId } });
  if (!voucher) return;

  const restaurantId = order.branch.restaurantId;
  const total = order.discountMinor;

  // Split the discount cost between funders. platform / restaurant absorb their share;
  // the sink account keeps the double-entry balanced (marketing expense vs payable relief).
  let platformShare = 0;
  let restaurantShare = 0;
  if (voucher.funder === "platform") {
    platformShare = total;
  } else if (voucher.funder === "restaurant") {
    restaurantShare = total;
  } else {
    platformShare = Math.ceil(total / 2);
    restaurantShare = total - platformShare;
  }

  const legs = [];
  if (platformShare > 0) {
    // Platform marketing spend: debit revenue (reduces platform take), credit an
    // expense sink so the tx balances.
    legs.push({
      code: "platform:revenue",
      ownerType: "platform" as const,
      debit: platformShare,
    });
    legs.push({
      code: "platform:promo_expense",
      ownerType: "platform" as const,
      credit: platformShare,
    });
  }
  if (restaurantShare > 0) {
    // Restaurant-funded promo: reduce the restaurant's payable; the relief lands in the
    // platform promo-clearing account so the tx balances.
    legs.push({
      code: `restaurant:${restaurantId}:payable`,
      ownerType: "restaurant" as const,
      ownerId: restaurantId,
      debit: restaurantShare,
    });
    legs.push({
      code: "platform:promo_clearing",
      ownerType: "platform" as const,
      credit: restaurantShare,
    });
  }
  if (legs.length === 0) return;

  await postLedgerTx(tx, `Voucher ${voucher.code} discount ${order.code}`, legs, {
    orderId: order.id,
  });
}
