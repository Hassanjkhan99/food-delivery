// Double-entry ledger: the ONLY writer of LedgerEntry rows. Every tx's legs must
// balance (SUM(debit) == SUM(credit)) — enforced here, verified by tests/checks.
// Account codes: platform:cash, platform:revenue, restaurant:{id}:payable,
// customer:{id}:prepaid. M5 wires card charges/refunds via the PaymentProvider;
// until then COD settlements post and card paths are unreachable.
import { randomUUID } from "node:crypto";
import type { LedgerOwnerType, Order, Payment, PrismaClient } from "@fd/db";

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

type OrderWithMoney = Order & {
  payment: Payment | null;
  branch: { restaurantId: string };
  deliveryTask?: { riderId: string | null } | null;
};

// Holding account for wallet-paid orders: prepaid balance moves here at placement and
// only leaves on settlement (to restaurant/platform) or reversal (back to prepaid).
export const WALLET_HOLDING = "platform:wallet_holding";

// Escrow account for CARD-paid orders (Codex #116 P1). A captured card charge is held here
// from placement until settlement/refund — NOT in `customer:{id}:prepaid`, which is the
// customer's *spendable* wallet. Keeping card escrow out of prepaid stops an in-flight card
// order's amount from showing up as spendable balance in myWallet / the wallet-checkout guard
// / referral walletBalanceMinor (which all read prepaid).
const cardEscrow = (customerId: string) => `customer:${customerId}:card_escrow`;

// Liability account for rider tips collected at checkout. The tip rides inside
// grandTotalMinor but is neither restaurant share nor platform revenue, so on
// settlement it parks here (owed to riders) instead of inflating platform:revenue.
// The rider payout split draws from this later (not yet wired — see rider.ts).
export const RIDER_TIPS = "platform:rider_tips";

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
  // Rider tip (#21): the tip is part of grandTotalMinor and must be released so the legs
  // balance — credit it to the assigned rider's payable (platform pays it out with the
  // delivery earnings). Falls back to platform:payable if no rider is attached, keeping
  // the tip owed rather than dropping it. Shared by the card + wallet branches below.
  const tip = order.tipAmount;
  const riderId = order.deliveryTask?.riderId ?? null;
  const riderTipLegs: Leg[] =
    tip > 0
      ? [
          riderId
            ? {
                code: `rider:${riderId}:payable`,
                ownerType: "rider",
                ownerId: riderId,
                credit: tip,
              }
            : { code: "platform:payable", ownerType: "platform", credit: tip },
        ]
      : [];

  // Loyalty is platform-funded (FP-07 / #57): the customer only prepaid the discounted
  // grandTotal, but the restaurant is owed the full (undiscounted) share. The platform
  // absorbs the gap (debit platform:revenue) so the legs balance and the restaurant is
  // never shortchanged. Applies to both prepaid (card) and wallet settlements.
  const loyaltyLegs: Leg[] =
    order.loyaltyDiscountMinor > 0
      ? [{ code: "platform:revenue", ownerType: "platform", debit: order.loyaltyDiscountMinor }]
      : [];

  // COD variant of the loyalty reimbursement (#57 / follow-up #121): under COD the
  // restaurant physically collected the *discounted* grandTotal in cash, so debiting
  // platform:revenue alone would leave the restaurant short by the discount. We also
  // credit the restaurant's payable so its net obligation is (fees − discount) — mirroring
  // the card/wallet economics where the restaurant always nets its full undiscounted share.
  const codLoyaltyLegs: Leg[] =
    order.loyaltyDiscountMinor > 0
      ? [
          {
            code: `restaurant:${restaurantId}:payable`,
            ownerType: "restaurant",
            ownerId: restaurantId,
            credit: order.loyaltyDiscountMinor,
          },
          { code: "platform:revenue", ownerType: "platform", debit: order.loyaltyDiscountMinor },
        ]
      : [];

  if (order.paymentMode === "card") {
    // Platform holds the customer's money; release restaurant share, keep fees, pay tip.
    await postLedgerTx(
      tx,
      `Settlement ${order.code} (card)`,
      [
        {
          // Release the card escrow held since placement (#116 P1), not the spendable wallet.
          code: cardEscrow(order.customerId),
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
        ...riderTipLegs,
        ...loyaltyLegs,
      ],
      { orderId: order.id },
    );
  } else if (order.paymentMode === "wallet") {
    // The grand total is sitting in platform:wallet_holding (moved out of the customer's
    // prepaid balance at placement). Release restaurant share + keep fees + pay tip —
    // identical to the card economics, only the source leg differs. (#55 + #21 + #57)
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
        ...riderTipLegs,
        ...loyaltyLegs,
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
        ...codLoyaltyLegs,
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
  /**
   * #30: the policy-decided refund amount (minor units). When omitted the whole
   * captured charge is returned (the historical full-refund behaviour). When the
   * cancellation policy assesses a fee, the caller passes `grandTotal - fee` here
   * so the customer keeps only the refundable remainder and the fee is retained.
   */
  refundMinor?: number,
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
    // The grand total is parked in wallet_holding; return the still-held remainder to the
    // customer's prepaid balance. No provider call — the money never left the platform (#55).
    // Accept partially_refunded too (an item was removed pre-cancel, #111) and only refund
    // what's left — amountMinor − already-refunded — so we don't over-credit or strand funds.
    if (
      !order.payment ||
      (order.payment.status !== "captured" && order.payment.status !== "partially_refunded")
    )
      return;
    const remaining = order.payment.amountMinor - order.payment.refundedMinor;
    if (remaining <= 0) return;
    await tx.payment.update({
      where: { id: order.payment.id },
      data: { status: "refunded", refundedMinor: order.payment.amountMinor },
    });
    const refund = await tx.refund.create({
      data: {
        orderId: order.id,
        status: "refunded",
        amountMinor: remaining,
        destination: "wallet",
        reason: `Automatic refund — order ${to}`,
        decidedAt: new Date(),
      },
    });
    await postLedgerTx(
      tx,
      `Refund ${order.code} (${to}, wallet)`,
      [
        { code: WALLET_HOLDING, ownerType: "platform", debit: remaining },
        {
          code: `customer:${order.customerId}:prepaid`,
          ownerType: "customer",
          ownerId: order.customerId,
          credit: remaining,
        },
      ],
      { orderId: order.id, refundId: refund.id },
    );
    return;
  }

  // Card: refund the captured charge (in full, or the policy amount when given). (#30)
  // Accept partially_refunded too (item removed pre-cancel, #111).
  if (
    !order.payment ||
    (order.payment.status !== "captured" && order.payment.status !== "partially_refunded") ||
    !order.payment.providerRef
  )
    return;

  // Only the un-refunded remainder is refundable. Clamp the policy amount into [0, remaining];
  // default to refunding the whole remainder.
  const captured = order.payment.amountMinor;
  const alreadyRefunded = order.payment.refundedMinor;
  const remaining = captured - alreadyRefunded;
  if (remaining <= 0) return;
  const amount =
    refundMinor === undefined ? remaining : Math.max(0, Math.min(refundMinor, remaining));

  // A fully-forfeited refund (fee == total) collects the whole charge: no money moves
  // back to the customer, and the payment stays captured rather than flipping to refunded.
  if (amount === 0) return;

  const { mockProvider } = await import("./payments/mockProvider.js");
  await mockProvider.refund({
    chargeRef: order.payment.providerRef,
    amountMinor: amount,
    reference: order.code,
  });

  const totalRefunded = alreadyRefunded + amount;
  await tx.payment.update({
    where: { id: order.payment.id },
    data: {
      status: totalRefunded >= captured ? "refunded" : "partially_refunded",
      refundedMinor: totalRefunded,
    },
  });

  const refund = await tx.refund.create({
    data: {
      orderId: order.id,
      status: "refunded",
      amountMinor: amount,
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
        // Reverse the card escrow (#116 P1) — the captured charge was held here, not in
        // the customer's spendable prepaid balance.
        code: cardEscrow(order.customerId),
        ownerType: "customer",
        ownerId: order.customerId,
        debit: amount,
      },
      { code: "platform:cash", ownerType: "platform", credit: amount },
    ],
    { orderId: order.id, refundId: refund.id },
  );
}

/**
 * Partial refund when a single line item is removed from an order before fulfilment
 * (#111). Unlike onOrderMoneyReversal this does NOT terminate the order — it returns
 * `refundMinor` to the customer and leaves the (recomputed) order live. COD is handled by
 * the caller (it reduces the cash the rider collects; no money has moved yet), so this only
 * covers the prepaid modes. Returns the Refund id, or null when nothing was refundable.
 */
export async function postItemRemovalRefund(
  tx: Tx,
  order: OrderWithMoney,
  refundMinor: number,
): Promise<string | null> {
  if (refundMinor <= 0) return null;
  if (!order.payment || order.payment.status === "pending") return null;

  if (order.paymentMode === "wallet") {
    if (order.payment.status !== "captured" && order.payment.status !== "partially_refunded")
      return null;
    const refund = await tx.refund.create({
      data: {
        orderId: order.id,
        status: "refunded",
        amountMinor: refundMinor,
        destination: "wallet",
        reason: `Item removed from order ${order.code}`,
        decidedAt: new Date(),
      },
    });
    await tx.payment.update({
      where: { id: order.payment.id },
      data: { status: "partially_refunded", refundedMinor: { increment: refundMinor } },
    });
    await postLedgerTx(
      tx,
      `Item refund ${order.code} (wallet)`,
      [
        { code: WALLET_HOLDING, ownerType: "platform", debit: refundMinor },
        {
          code: `customer:${order.customerId}:prepaid`,
          ownerType: "customer",
          ownerId: order.customerId,
          credit: refundMinor,
        },
      ],
      { orderId: order.id, refundId: refund.id },
    );
    return refund.id;
  }

  // Card: refund the captured charge partially, drawing from the card escrow (#116 P1).
  if (order.paymentMode === "card") {
    if (!order.payment.providerRef) return null;
    const { mockProvider } = await import("./payments/mockProvider.js");
    await mockProvider.refund({
      chargeRef: order.payment.providerRef,
      amountMinor: refundMinor,
      reference: order.code,
    });
    const refund = await tx.refund.create({
      data: {
        orderId: order.id,
        status: "refunded",
        amountMinor: refundMinor,
        destination: "card",
        reason: `Item removed from order ${order.code}`,
        decidedAt: new Date(),
      },
    });
    await tx.payment.update({
      where: { id: order.payment.id },
      data: { status: "partially_refunded", refundedMinor: { increment: refundMinor } },
    });
    await postLedgerTx(
      tx,
      `Item refund ${order.code} (card)`,
      [
        {
          code: cardEscrow(order.customerId),
          ownerType: "customer",
          ownerId: order.customerId,
          debit: refundMinor,
        },
        { code: "platform:cash", ownerType: "platform", credit: refundMinor },
      ],
      { orderId: order.id, refundId: refund.id },
    );
    return refund.id;
  }

  return null;
}

/** Post the charge legs after a successful card capture. */
export async function onCardCharged(tx: Tx, order: OrderWithMoney): Promise<void> {
  await postLedgerTx(
    tx,
    `Card charge ${order.code}`,
    [
      { code: "platform:cash", ownerType: "platform", debit: order.grandTotalMinor },
      {
        // Hold the captured charge in card escrow, NOT the spendable prepaid wallet (#116 P1).
        code: cardEscrow(order.customerId),
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
