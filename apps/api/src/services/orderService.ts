// Order creation + the state-machine choke point. ALL status writes flow through
// transition(): optimistic-concurrency guard, append-only OrderEvent, audit for
// privileged actors, money side-effects, and pubsub — one transaction.
import { randomUUID } from "node:crypto";
import { prisma, type Order, type Prisma } from "@fd/db";
import {
  ACCEPTANCE_SLA_SECONDS,
  assertTransition,
  TERMINAL_STATUSES,
  type ActorRole,
  type OrderStatus,
  type PlaceOrderInput,
} from "@fd/shared";
import { GraphQLError } from "graphql";
import { publishOrderChanged } from "../pubsub.js";
import { logger } from "../logger.js";
import { branchOpenNow } from "./branchHours.js";
import { quoteCart } from "./quoteService.js";
import {
  onCardCharged,
  onOrderDelivered,
  onOrderMoneyReversal,
  onWalletCharged,
  walletBalance,
} from "./ledgerService.js";
import {
  postDiscountLedger,
  recordRedemption,
  reverseRedemptionForOrder,
  validateVoucher,
} from "./voucherService.js";
import {
  onOrderDeliveredLoyalty,
  onOrderReversalLoyalty,
  postLoyaltyTx,
} from "./loyaltyService.js";
import { onRefereeOrderDelivered } from "./referralService.js";
import { mockProvider } from "./payments/mockProvider.js";
import { assertOrderVelocity, generatePickupPin } from "./fraudService.js";
import { notifyOrderStatus } from "./notificationService.js";

export type Actor = { userId: string | null; role: ActorRole };
export const SYSTEM_ACTOR: Actor = { userId: null, role: "system" };

const STATUS_TIMESTAMP: Partial<Record<OrderStatus, keyof Order>> = {
  accepted: "acceptedAt",
  ready_for_pickup: "readyAt",
  picked_up: "pickedUpAt",
  delivered: "deliveredAt",
  cancelled: "cancelledAt",
};

/**
 * A 4-digit pickup code that isn't currently in use by another *active* (non-terminal)
 * pickup order at the same branch. Retries a handful of times, then widens to a 6-digit
 * code so it always terminates even in the (practically impossible) fully-saturated case.
 *
 * Runs on the transaction client while the caller holds a per-branch advisory lock, so the
 * read-then-insert is serialized per branch and can't hand two orders the same code.
 */
async function generateUniquePickupCode(
  tx: Prisma.TransactionClient,
  branchId: string,
): Promise<string> {
  // First 10 tries use a friendly 4-digit code; after that widen to 6 digits for headroom on
  // a busy branch. EVERY candidate — including the widened ones — is checked against the
  // branch's active pickups (Codex P3): the widened fallback must not be returned unchecked.
  for (let attempt = 0; attempt < 40; attempt++) {
    const candidate =
      attempt < 10
        ? String(Math.floor(1000 + Math.random() * 9000))
        : String(Math.floor(100000 + Math.random() * 900000));
    const clash = await tx.order.findFirst({
      where: {
        branchId,
        pickupCode: candidate,
        status: { notIn: TERMINAL_STATUSES as OrderStatus[] },
      },
      select: { id: true },
    });
    if (!clash) return candidate;
  }
  // 40 checked attempts across ~900k codes only exhaust if a single branch has an absurd
  // number of simultaneously-active pickups — fail loudly rather than risk a collision.
  throw new GraphQLError("We couldn't set up your pickup code just now. Please try again.", {
    extensions: { code: "pickup_code_allocation_failed" },
  });
}

export async function placeOrder(
  customerId: string,
  input: PlaceOrderInput,
  idempotencyKey: string,
) {
  // Idempotent replay: same key returns the same order (owner-verified).
  const existing = await prisma.order.findUnique({ where: { idempotencyKey } });
  if (existing) {
    if (existing.customerId !== customerId)
      throw new GraphQLError("This looks like a duplicate request — please try again.", {
        extensions: { code: "idempotency_key_conflict" },
      });
    return existing;
  }

  // Velocity limit (#25): a replay of the same idempotency key is handled above, so this
  // only counts distinct orders — genuine scripted spam / cost-abuse, not double-taps.
  await assertOrderVelocity(customerId);

  // Pickup skips the radius check entirely (quoteCart already forces inRadius=true). (#54)
  const quote = await quoteCart(input, customerId);
  if (!quote.inRadius)
    throw new GraphQLError("Sorry, this restaurant doesn't deliver to that address.", {
      extensions: { code: "outside_delivery_radius" },
    });
  if (!quote.meetsMinimum)
    throw new GraphQLError(
      "Your order is below this restaurant's minimum. Please add a bit more.",
      {
        extensions: { code: "below_minimum_order" },
      },
    );
  // A supplied voucher must validate for real at placement — never silently dropped.
  // quoteCart swallows voucher errors for the preview; here we re-throw so checkout fails
  // loudly rather than charging the customer the undiscounted total.
  if (input.voucherCode && quote.voucherError) {
    const { VoucherError } = await import("./voucherService.js");
    throw new VoucherError(quote.voucherError as never);
  }

  const isPickup = input.fulfillmentMode === "pickup";
  // Scheduled orders (#54): validate the slot is in the future. Groundwork only — the
  // acceptance SLA still starts at placement (see acceptDeadlineAt below); shifting the
  // 120s window to `scheduledFor − leadTime` and holding the order out of the board's
  // "New" lane until then is the follow-up that makes scheduling fully functional.
  const scheduledFor = input.scheduledFor ? new Date(input.scheduledFor) : null;
  if (scheduledFor && scheduledFor.getTime() <= Date.now()) {
    throw new GraphQLError("Please choose a scheduled time in the future.", {
      extensions: { code: "scheduled_time_in_past" },
    });
  }

  // Closed-by-hours guard (#63). Reject when the branch isn't open. quoteCart already
  // rejects when isAcceptingOrders is false; here we also honour the opening hours so an
  // order can't be placed after close. branchOpenNow reads the structured BranchHours
  // model (#19) and falls back to the legacy hoursJson. Uses a stable error code the
  // client maps to a friendly "closed" message.
  const branch = await prisma.branch.findUnique({ where: { id: quote.branchId } });
  if (!branch)
    throw new GraphQLError("This restaurant could not be found.", {
      extensions: { code: "branch_not_found" },
    });
  const openNow = (await branchOpenNow(branch)).isOpen;
  if (!branch.isAcceptingOrders || !openNow) {
    throw new GraphQLError("This restaurant is currently closed", {
      extensions: { code: "branch_closed" },
    });
  }

  // Card orders charge at placement (Foodpanda-style): validate the saved method first.
  let cardToken: string | null = null;
  if (input.paymentMode === "card") {
    if (!input.paymentMethodId)
      throw new GraphQLError("Please select a saved card to pay with.", {
        extensions: { code: "payment_method_required" },
      });
    const method = await prisma.paymentMethod.findUnique({
      where: { id: input.paymentMethodId },
    });
    if (!method || method.userId !== customerId)
      throw new GraphQLError("We couldn't find that saved card.", {
        extensions: { code: "payment_method_not_found" },
      });
    cardToken = method.providerToken;
  }

  // Wallet orders debit the prepaid balance at placement. Guard here for a friendly
  // error before creating anything; the authoritative check is re-run inside the
  // placement transaction (balance read + debit) so it can't overspend under a race.
  if (input.paymentMode === "wallet") {
    const balance = await walletBalance(prisma, customerId);
    if (balance < quote.grandTotalMinor) {
      throw new GraphQLError("Insufficient wallet balance", {
        extensions: { code: "insufficient_wallet_balance" },
      });
    }
  }

  const code = `FD-${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 36)
    .toString(36)
    .toUpperCase()}`;

  try {
    const order = await prisma.$transaction(async (tx) => {
      // Short 4-digit code the customer quotes at the counter to collect a pickup order.
      // Assigned inside the txn under a per-branch advisory lock so two concurrent pickups
      // at the same branch can't both read "free" and be handed the same code — the earlier
      // pre-txn check-then-insert wasn't atomic (Codex P2 / follow-up #115).
      let pickupCode: string | null = null;
      if (isPickup) {
        // $executeRaw, not $queryRaw: pg_advisory_xact_lock() returns void, which the
        // Prisma 7 pg driver adapter cannot deserialize as a result column ("Failed to
        // deserialize column of type 'void'"). $executeRaw runs the statement without
        // decoding a row set — same primitive db/index.ts uses for set_config/SET LOCAL.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${quote.branchId})::bigint)`;
        pickupCode = await generateUniquePickupCode(tx, quote.branchId);
      }

      const created = await tx.order.create({
        data: {
          code,
          customerId,
          branchId: quote.branchId,
          status: "pending_acceptance",
          idempotencyKey,
          pickupPin: generatePickupPin(),
          addressSnapshotJson: {
            label: input.addressLabel,
            text: input.addressText,
            lat: input.deliveryLat,
            lng: input.deliveryLng,
          },
          contactPhone: input.contactPhone,
          customerNote: input.customerNote,
          subtotalMinor: quote.subtotalMinor,
          deliveryFeeMinor: quote.deliveryFeeMinor,
          baseDeliveryFeeMinor: quote.baseDeliveryFeeMinor,
          taxTotalMinor: quote.taxTotalMinor,
          platformFeeMinor: quote.platformFeeMinor,
          commissionMinor: quote.commissionMinor,
          commissionBpsSnapshot: quote.commissionBps,
          loyaltyPointsRedeemed: quote.loyaltyPointsRedeemed,
          loyaltyDiscountMinor: quote.loyaltyDiscountMinor,
          tipAmount: quote.tipAmount,
          cutleryRequested: input.cutleryRequested,
          discountMinor: quote.discountMinor,
          voucherId: quote.appliedVoucher?.voucher.id ?? null,
          grandTotalMinor: quote.grandTotalMinor,
          paymentMode: input.paymentMode,
          fulfillmentMode: input.fulfillmentMode,
          scheduledFor,
          pickupCode,
          acceptDeadlineAt: new Date(Date.now() + ACCEPTANCE_SLA_SECONDS * 1_000),
          items: {
            create: quote.lines.map((l) => ({
              // Freeze the line. For a combo (#53) we also freeze the component list so
              // the order never depends on the live combo/menu; kind distinguishes them.
              // Item snapshots also carry the per-line "if unavailable" preference (#39).
              menuSnapshotJson: l.comboId
                ? {
                    kind: "combo",
                    comboId: l.comboId,
                    name: l.name,
                    unitPriceMinor: l.unitPriceMinor,
                    components: l.comboComponents,
                    unavailabilityPreference: l.unavailabilityPreference,
                  }
                : {
                    kind: "item",
                    menuItemId: l.menuItemId,
                    name: l.name,
                    unitPriceMinor: l.unitPriceMinor,
                    modifiers: l.modifiers,
                    unavailabilityPreference: l.unavailabilityPreference,
                  },
              qty: l.qty,
              unitPriceMinor: l.unitPriceMinor,
              lineTotalMinor: l.lineTotalMinor,
              notes: l.notes,
            })),
          },
        },
      });

      await tx.payment.create({
        data: {
          orderId: created.id,
          mode: input.paymentMode,
          status: "pending",
          amountMinor: quote.grandTotalMinor,
          paymentMethodId: input.paymentMethodId ?? null,
        },
      });

      await tx.orderEvent.create({
        data: {
          orderId: created.id,
          fromStatus: null,
          toStatus: "pending_acceptance",
          actorUserId: customerId,
          actorRole: "customer",
        },
      });

      // Voucher redemption (#52): re-validate inside the tx so concurrent redemptions
      // can't blow past the per-user or budget caps, then write the unique redemption
      // row + bump the counters. The unique(voucherId, orderId) index also guards against
      // a double-apply on the same order.
      if (input.voucherCode) {
        const applied = await validateVoucher(
          input.voucherCode,
          {
            userId: customerId,
            restaurantId: branch.restaurantId,
            subtotalMinor: quote.subtotalMinor,
            deliveryFeeMinor: quote.deliveryFeeMinor,
          },
          tx,
        );
        // Guard against a race between the preview discount and the committed one.
        if (applied.discountMinor !== quote.discountMinor) {
          throw new GraphQLError(
            "Your voucher discount changed — please review your order and try again.",
            {
              extensions: { code: "voucher_value_changed" },
            },
          );
        }
        await recordRedemption(tx, applied, created.id, customerId);
      }

      // Spend redeemed loyalty points now (FP-07). quoteCart already clamped this to the
      // live balance, but the deduction is inside the placement tx so the cart's unique
      // idempotency create still arbitrates races. Points are returned if the order is
      // later reversed (see onOrderReversalLoyalty).
      if (quote.loyaltyPointsRedeemed > 0) {
        await postLoyaltyTx(tx, customerId, -quote.loyaltyPointsRedeemed, "redeem", {
          orderId: created.id,
          memo: `Redeemed on ${created.code}`,
        });
      }

      // Wallet: debit prepaid → holding inside the same transaction as the order create.
      // Re-read the balance here so two concurrent orders can't both drain a wallet that
      // only covers one (the serialized ledger writes make the check authoritative). (#55)
      if (input.paymentMode === "wallet") {
        const balance = await walletBalance(tx, customerId);
        if (balance < created.grandTotalMinor) {
          throw new GraphQLError("Insufficient wallet balance", {
            extensions: { code: "insufficient_wallet_balance" },
          });
        }
        await tx.payment.updateMany({
          where: { orderId: created.id },
          data: { status: "captured", capturedAt: new Date() },
        });
        const withMoney = await tx.order.findUniqueOrThrow({
          where: { id: created.id },
          include: { payment: true, branch: true },
        });
        await onWalletCharged(tx, withMoney);
      }

      return created;
    });

    // Charge AFTER the order row exists: the idempotency-unique create is the race
    // arbiter, so a duplicate submit can never double-charge.
    if (input.paymentMode === "card" && cardToken) {
      const result = await mockProvider.charge({
        token: cardToken,
        amountMinor: order.grandTotalMinor,
        reference: order.code,
      });
      if (!result.ok) {
        await prisma.$transaction(async (tx) => {
          await tx.payment.updateMany({
            where: { orderId: order.id },
            data: { status: "failed" },
          });
          await tx.order.update({
            where: { id: order.id },
            data: { status: "cancelled", cancelledAt: new Date() },
          });
          await tx.orderEvent.create({
            data: {
              orderId: order.id,
              fromStatus: "pending_acceptance",
              toStatus: "cancelled",
              actorRole: "system",
              reason: `Payment failed: ${result.declineReason}`,
            },
          });
          // Points were spent inside the placement tx (before the charge attempt). This
          // decline path cancels the order directly instead of via transition(), so it
          // must return the redeemed points itself — otherwise the customer loses points
          // on an order that never succeeded. No-op when nothing was redeemed.
          await onOrderReversalLoyalty(tx, order, "cancelled");
        });
        // Surface the issuer's own reason — it's the most useful, human message for a
        // decline (e.g. "Card declined by issuer"). Falls back to generic copy if absent.
        throw new GraphQLError(
          result.declineReason || "Your card was declined. Please try another card.",
          { extensions: { code: "card_declined", declineReason: result.declineReason } },
        );
      }
      const chargedOrder = await prisma.$transaction(async (tx) => {
        await tx.payment.updateMany({
          where: { orderId: order.id },
          data: { status: "captured", providerRef: result.providerRef, capturedAt: new Date() },
        });
        const withMoney = await tx.order.findUniqueOrThrow({
          where: { id: order.id },
          include: { payment: true, branch: true },
        });
        await onCardCharged(tx, withMoney);
        return withMoney;
      });
      publishOrderChanged({
        orderId: chargedOrder.id,
        branchId: chargedOrder.branchId,
        status: chargedOrder.status,
      });
      // In-app inbox entry (#56). Non-fatal — never rolls back a placed order.
      void notifyOrderStatus(chargedOrder, chargedOrder.status as OrderStatus);
      return chargedOrder;
    }

    publishOrderChanged({ orderId: order.id, branchId: order.branchId, status: order.status });
    void notifyOrderStatus(order, order.status as OrderStatus);
    return order;
  } catch (e) {
    // Unique violation on idempotencyKey: a concurrent duplicate won the race.
    if ((e as { code?: string }).code === "P2002") {
      const winner = await prisma.order.findUnique({ where: { idempotencyKey } });
      if (winner && winner.customerId === customerId) return winner;
    }
    throw e;
  }
}

/**
 * Move an order to `to`. Throws InvalidTransitionError for illegal moves and
 * GraphQLError("Order changed") when a concurrent transition won.
 */
export async function transition(
  orderId: string,
  to: OrderStatus,
  actor: Actor,
  opts: {
    reason?: string;
    expectedFrom?: OrderStatus;
    meta?: Record<string, unknown>;
    /**
     * #30: policy-decided refund (minor units) applied when moving to a reversal
     * state. Omitted => full refund of the captured charge (unchanged behaviour).
     */
    refundMinor?: number;
  } = {},
) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { deliveryTask: true, payment: true, branch: true },
  });
  if (!order)
    throw new GraphQLError("We couldn't find that order.", { extensions: { code: "not_found" } });

  const from = order.status as OrderStatus;
  if (opts.expectedFrom && from !== opts.expectedFrom) {
    throw new GraphQLError("This order has already moved on — please refresh and try again.", {
      extensions: { code: "order_status_changed" },
    });
  }
  assertTransition(from, to, actor.role);

  const timestampField = STATUS_TIMESTAMP[to];

  const updated = await prisma.$transaction(async (tx) => {
    // Optimistic guard: only wins if the status is still `from`.
    const res = await tx.order.updateMany({
      where: { id: orderId, status: from },
      data: {
        status: to,
        ...(timestampField ? { [timestampField]: new Date() } : {}),
      },
    });
    if (res.count === 0)
      throw new GraphQLError("This order has already moved on — please refresh and try again.", {
        extensions: { code: "order_status_changed" },
      });

    await tx.orderEvent.create({
      data: {
        orderId,
        fromStatus: from,
        toStatus: to,
        actorUserId: actor.userId,
        actorRole: actor.role,
        reason: opts.reason,
        metaJson: opts.meta as never,
      },
    });

    if (actor.role === "admin" || actor.role === "system") {
      await tx.auditLog.create({
        data: {
          actorUserId: actor.userId,
          actorRole: actor.role,
          action: `order.transition.${to}`,
          subjectType: "Order",
          subjectId: orderId,
          beforeJson: { status: from },
          afterJson: { status: to, reason: opts.reason ?? null },
        },
      });
    }

    // Money side-effects live in the same transaction as the status change.
    if (to === "delivered") {
      await onOrderDelivered(tx, order);
      // Post the voucher discount as a distinct ledger entry against the funder (#52).
      await postDiscountLedger(tx, order);
      // Earn loyalty points on the delivered order (FP-07 / #57).
      await onOrderDeliveredLoyalty(tx, order);
      // Referral (#58): the referee's first delivered order credits both wallets.
      await onRefereeOrderDelivered(tx, order.customerId, order.id);
    } else if (["rejected", "auto_expired", "cancelled"].includes(to)) {
      await onOrderMoneyReversal(tx, order, to, opts.refundMinor);
      // Free the voucher redemption so it stops counting against the user's limit + budget. (#52)
      await reverseRedemptionForOrder(tx, order.id);
      // Return any redeemed loyalty points and claw back points earned on this order. (#57)
      await onOrderReversalLoyalty(tx, order, to);
    }

    return tx.order.findUniqueOrThrow({ where: { id: orderId } });
  });

  logger.info({ orderId, from, to, role: actor.role }, "order transition");
  publishOrderChanged(
    { orderId, branchId: order.branchId, status: to },
    order.deliveryTask?.riderId,
  );
  // In-app inbox entry (#56) for the customer. Non-fatal.
  void notifyOrderStatus({ id: order.id, customerId: order.customerId, code: order.code }, to);
  return updated;
}

export function newIdempotencyKey(): string {
  return randomUUID();
}
