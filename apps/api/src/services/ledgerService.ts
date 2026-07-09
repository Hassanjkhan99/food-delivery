// Double-entry ledger: the ONLY writer of LedgerEntry rows. Every tx's legs must
// balance (SUM(debit) == SUM(credit)) — enforced here, verified by tests/checks.
// Account codes: platform:cash, platform:revenue, restaurant:{id}:payable,
// customer:{id}:prepaid. M5 wires card charges/refunds via the PaymentProvider;
// until then COD settlements post and card paths are unreachable.
import { randomUUID } from "node:crypto";
import type { LedgerOwnerType, Order, Payment, PrismaClient } from "@fd/db";

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

type OrderWithMoney = Order & { payment: Payment | null; branch: { restaurantId: string } };

// Holding account for wallet-paid orders: prepaid balance moves here at placement and
// only leaves on settlement (to restaurant/platform) or reversal (back to prepaid).
export const WALLET_HOLDING = "platform:wallet_holding";

/** The customer's spendable wallet balance in minor units (prepaid ledger account). */
export async function walletBalance(tx: Tx, customerId: string): Promise<number> {
  return accountBalance(tx, `customer:${customerId}:prepaid`);
}

export type Leg = {
  code: string;
  ownerType: LedgerOwnerType;
  ownerId?: string | null;
  debit?: number;
  credit?: number;
};

export async function postLedgerTx(
  tx: Tx,
  memo: string,
  legs: Leg[],
  refs: { orderId?: string; payoutId?: string; refundId?: string } = {},
): Promise<string> {
  const debit = legs.reduce((s, l) => s + (l.debit ?? 0), 0);
  const credit = legs.reduce((s, l) => s + (l.credit ?? 0), 0);
  if (debit !== credit) {
    throw new Error(`Unbalanced ledger tx "${memo}": debit ${debit} != credit ${credit}`);
  }
  const txId = randomUUID();
  for (const leg of legs) {
    const account = await tx.ledgerAccount.upsert({
      where: { code: leg.code },
      update: {},
      create: { code: leg.code, ownerType: leg.ownerType, ownerId: leg.ownerId ?? null },
    });
    await tx.ledgerEntry.create({
      data: {
        txId,
        accountId: account.id,
        debitMinor: leg.debit ?? 0,
        creditMinor: leg.credit ?? 0,
        memo,
        ...refs,
      },
    });
  }
  return txId;
}

export async function accountBalance(tx: Tx, code: string): Promise<number> {
  const account = await tx.ledgerAccount.findUnique({ where: { code } });
  if (!account) return 0;
  const agg = await tx.ledgerEntry.aggregate({
    where: { accountId: account.id },
    _sum: { debitMinor: true, creditMinor: true },
  });
  return (agg._sum.creditMinor ?? 0) - (agg._sum.debitMinor ?? 0);
}

/** Settlement when an order is delivered — runs inside the transition transaction. */
export async function onOrderDelivered(tx: Tx, order: OrderWithMoney): Promise<void> {
  const restaurantId = order.branch.restaurantId;
  const fees = order.commissionMinor + order.platformFeeMinor;
  const restaurantShare =
    order.subtotalMinor + order.taxTotalMinor + order.deliveryFeeMinor - order.commissionMinor;

  if (order.paymentMode === "card") {
    // Platform holds the customer's money; release restaurant share, keep fees.
    await postLedgerTx(
      tx,
      `Settlement ${order.code} (card)`,
      [
        {
          code: `customer:${order.customerId}:prepaid`,
          ownerType: "customer",
          ownerId: order.customerId,
          debit: order.grandTotalMinor,
        },
        {
          code: `restaurant:${restaurantId}:payable`,
          ownerType: "restaurant",
          ownerId: restaurantId,
          credit: restaurantShare,
        },
        { code: "platform:revenue", ownerType: "platform", credit: fees },
      ],
      { orderId: order.id },
    );
  } else if (order.paymentMode === "wallet") {
    // The grand total is sitting in platform:wallet_holding (moved out of the customer's
    // prepaid balance at placement). Release restaurant share + keep fees — identical to
    // the card economics, only the source leg differs.
    await postLedgerTx(
      tx,
      `Settlement ${order.code} (wallet)`,
      [
        { code: WALLET_HOLDING, ownerType: "platform", debit: order.grandTotalMinor },
        {
          code: `restaurant:${restaurantId}:payable`,
          ownerType: "restaurant",
          ownerId: restaurantId,
          credit: restaurantShare,
        },
        { code: "platform:revenue", ownerType: "platform", credit: fees },
      ],
      { orderId: order.id },
    );
  } else {
    // COD: cash went to the restaurant; platform books its cut as a receivable.
    await postLedgerTx(
      tx,
      `Settlement ${order.code} (COD receivable)`,
      [
        {
          code: `restaurant:${restaurantId}:payable`,
          ownerType: "restaurant",
          ownerId: restaurantId,
          debit: fees,
        },
        { code: "platform:revenue", ownerType: "platform", credit: fees },
      ],
      { orderId: order.id },
    );
  }

  // COD payment is captured on delivery.
  await tx.payment.updateMany({
    where: { orderId: order.id, status: "pending" },
    data: { status: "captured", capturedAt: new Date() },
  });
}

/**
 * Money reversal when an order terminates before fulfilment
 * (rejected / auto_expired / cancelled).
 *
 * Card path calls the provider inside the transition transaction — fine for the
 * in-process mock; a real PSP moves this to an outbox/worker so a network call
 * never sits inside a DB transaction.
 */
export async function onOrderMoneyReversal(
  tx: Tx,
  order: OrderWithMoney,
  to: string,
): Promise<void> {
  if (order.paymentMode === "cod") {
    // Nothing was collected; void the pending payment.
    await tx.payment.updateMany({
      where: { orderId: order.id, status: "pending" },
      data: { status: "failed" },
    });
    return;
  }

  if (order.paymentMode === "wallet") {
    // The grand total is parked in wallet_holding; return it to the customer's prepaid
    // balance. No provider call — the money never left the platform.
    if (!order.payment || order.payment.status !== "captured") return;
    await tx.payment.update({
      where: { id: order.payment.id },
      data: { status: "refunded", refundedMinor: order.payment.amountMinor },
    });
    const refund = await tx.refund.create({
      data: {
        orderId: order.id,
        status: "refunded",
        amountMinor: order.payment.amountMinor,
        destination: "wallet",
        reason: `Automatic refund — order ${to}`,
        decidedAt: new Date(),
      },
    });
    await postLedgerTx(
      tx,
      `Refund ${order.code} (${to}, wallet)`,
      [
        { code: WALLET_HOLDING, ownerType: "platform", debit: order.payment.amountMinor },
        {
          code: `customer:${order.customerId}:prepaid`,
          ownerType: "customer",
          ownerId: order.customerId,
          credit: order.payment.amountMinor,
        },
      ],
      { orderId: order.id, refundId: refund.id },
    );
    return;
  }

  // Card: refund the captured charge in full.
  if (!order.payment || order.payment.status !== "captured" || !order.payment.providerRef) return;

  const { mockProvider } = await import("./payments/mockProvider.js");
  await mockProvider.refund({
    chargeRef: order.payment.providerRef,
    amountMinor: order.payment.amountMinor,
    reference: order.code,
  });

  await tx.payment.update({
    where: { id: order.payment.id },
    data: { status: "refunded", refundedMinor: order.payment.amountMinor },
  });

  const refund = await tx.refund.create({
    data: {
      orderId: order.id,
      status: "refunded",
      amountMinor: order.payment.amountMinor,
      destination: "card",
      reason: `Automatic refund — order ${to}`,
      decidedAt: new Date(),
    },
  });

  await postLedgerTx(
    tx,
    `Refund ${order.code} (${to})`,
    [
      {
        code: `customer:${order.customerId}:prepaid`,
        ownerType: "customer",
        ownerId: order.customerId,
        debit: order.payment.amountMinor,
      },
      { code: "platform:cash", ownerType: "platform", credit: order.payment.amountMinor },
    ],
    { orderId: order.id, refundId: refund.id },
  );
}

/** Post the charge legs after a successful card capture. */
export async function onCardCharged(tx: Tx, order: OrderWithMoney): Promise<void> {
  await postLedgerTx(
    tx,
    `Card charge ${order.code}`,
    [
      { code: "platform:cash", ownerType: "platform", debit: order.grandTotalMinor },
      {
        code: `customer:${order.customerId}:prepaid`,
        ownerType: "customer",
        ownerId: order.customerId,
        credit: order.grandTotalMinor,
      },
    ],
    { orderId: order.id },
  );
}

/**
 * Credit the customer's wallet after a successful card top-up charge. Mirrors an
 * order charge: real cash enters the platform, the customer's prepaid balance grows.
 */
export async function onWalletToppedUp(
  tx: Tx,
  customerId: string,
  amountMinor: number,
): Promise<void> {
  await postLedgerTx(tx, `Wallet top-up`, [
    { code: "platform:cash", ownerType: "platform", debit: amountMinor },
    {
      code: `customer:${customerId}:prepaid`,
      ownerType: "customer",
      ownerId: customerId,
      credit: amountMinor,
    },
  ]);
}

/**
 * Move a wallet-paid order's grand total out of the customer's prepaid balance into
 * the holding account at placement — settlement/reversal draw from there. Called
 * inside the placeOrder transaction after the balance check passes.
 */
export async function onWalletCharged(tx: Tx, order: OrderWithMoney): Promise<void> {
  await postLedgerTx(
    tx,
    `Wallet charge ${order.code}`,
    [
      {
        code: `customer:${order.customerId}:prepaid`,
        ownerType: "customer",
        ownerId: order.customerId,
        debit: order.grandTotalMinor,
      },
      { code: WALLET_HOLDING, ownerType: "platform", credit: order.grandTotalMinor },
    ],
    { orderId: order.id },
  );
}

/**
 * Admin goodwill credit: the platform funds a bounded credit to the customer's wallet
 * (platform:revenue bears it). Refs left empty — not tied to an order/refund row.
 */
export async function onGoodwillCredit(
  tx: Tx,
  customerId: string,
  amountMinor: number,
  memo: string,
): Promise<void> {
  await postLedgerTx(tx, memo, [
    { code: "platform:revenue", ownerType: "platform", debit: amountMinor },
    {
      code: `customer:${customerId}:prepaid`,
      ownerType: "customer",
      ownerId: customerId,
      credit: amountMinor,
    },
  ]);
}
