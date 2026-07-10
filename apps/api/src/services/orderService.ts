// Order creation + the state-machine choke point. ALL status writes flow through
// transition(): optimistic-concurrency guard, append-only OrderEvent, audit for
// privileged actors, money side-effects, and pubsub — one transaction.
import { randomUUID } from "node:crypto";
import { prisma, type Order } from "@fd/db";
import {
  ACCEPTANCE_SLA_SECONDS,
  assertTransition,
  type ActorRole,
  type OrderStatus,
  type PlaceOrderInput,
} from "@fd/shared";
import { GraphQLError } from "graphql";
import { publishOrderChanged } from "../pubsub.js";
import { logger } from "../logger.js";
import { branchOpenNow } from "./branchHours.js";
import { quoteCart } from "./quoteService.js";
import { onCardCharged, onOrderDelivered, onOrderMoneyReversal } from "./ledgerService.js";
import {
  postDiscountLedger,
  recordRedemption,
  reverseRedemptionForOrder,
  validateVoucher,
} from "./voucherService.js";
import { mockProvider } from "./payments/mockProvider.js";
import { assertOrderVelocity, generatePickupPin } from "./fraudService.js";

export type Actor = { userId: string | null; role: ActorRole };
export const SYSTEM_ACTOR: Actor = { userId: null, role: "system" };

const STATUS_TIMESTAMP: Partial<Record<OrderStatus, keyof Order>> = {
  accepted: "acceptedAt",
  ready_for_pickup: "readyAt",
  picked_up: "pickedUpAt",
  delivered: "deliveredAt",
  cancelled: "cancelledAt",
};

export async function placeOrder(
  customerId: string,
  input: PlaceOrderInput,
  idempotencyKey: string,
) {
  // Idempotent replay: same key returns the same order (owner-verified).
  const existing = await prisma.order.findUnique({ where: { idempotencyKey } });
  if (existing) {
    if (existing.customerId !== customerId) throw new GraphQLError("Idempotency key conflict");
    return existing;
  }

  // Velocity limit (#25): a replay of the same idempotency key is handled above, so this
  // only counts distinct orders — genuine scripted spam / cost-abuse, not double-taps.
  await assertOrderVelocity(customerId);

  const quote = await quoteCart(input, customerId);
  if (!quote.inRadius) throw new GraphQLError("Delivery address is outside the delivery radius");
  if (!quote.meetsMinimum) throw new GraphQLError("Order is below the restaurant's minimum");
  // A supplied voucher must validate for real at placement — never silently dropped.
  // quoteCart swallows voucher errors for the preview; here we re-throw so checkout fails
  // loudly rather than charging the customer the undiscounted total.
  if (input.voucherCode && quote.voucherError) {
    const { VoucherError } = await import("./voucherService.js");
    throw new VoucherError(quote.voucherError as never);
  }

  // Closed-by-hours guard (#63). Reject when the branch isn't open. quoteCart already
  // rejects when isAcceptingOrders is false; here we also honour the opening hours so an
  // order can't be placed after close. branchOpenNow reads the structured BranchHours
  // model (#19) and falls back to the legacy hoursJson. Uses a stable error code the
  // client maps to a friendly "closed" message.
  const branch = await prisma.branch.findUnique({ where: { id: quote.branchId } });
  if (!branch) throw new GraphQLError("Restaurant not available");
  const openNow = (await branchOpenNow(branch)).isOpen;
  if (!branch.isAcceptingOrders || !openNow) {
    throw new GraphQLError("This restaurant is currently closed", {
      extensions: { code: "branch_closed" },
    });
  }

  // Card orders charge at placement (Foodpanda-style): validate the saved method first.
  let cardToken: string | null = null;
  if (input.paymentMode === "card") {
    if (!input.paymentMethodId) throw new GraphQLError("Select a saved card");
    const method = await prisma.paymentMethod.findUnique({
      where: { id: input.paymentMethodId },
    });
    if (!method || method.userId !== customerId) throw new GraphQLError("Card not found");
    cardToken = method.providerToken;
  }

  const code = `FD-${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 36)
    .toString(36)
    .toUpperCase()}`;

  try {
    const order = await prisma.$transaction(async (tx) => {
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
          taxTotalMinor: quote.taxTotalMinor,
          platformFeeMinor: quote.platformFeeMinor,
          commissionMinor: quote.commissionMinor,
          commissionBpsSnapshot: quote.commissionBps,
          tipAmount: quote.tipAmount,
          cutleryRequested: input.cutleryRequested,
          discountMinor: quote.discountMinor,
          voucherId: quote.appliedVoucher?.voucher.id ?? null,
          grandTotalMinor: quote.grandTotalMinor,
          paymentMode: input.paymentMode,
          acceptDeadlineAt: new Date(Date.now() + ACCEPTANCE_SLA_SECONDS * 1_000),
          items: {
            create: quote.lines.map((l) => ({
              menuSnapshotJson: {
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
          throw new GraphQLError("Voucher value changed — please review your order");
        }
        await recordRedemption(tx, applied, created.id, customerId);
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
        });
        throw new GraphQLError(result.declineReason);
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
      return chargedOrder;
    }

    publishOrderChanged({ orderId: order.id, branchId: order.branchId, status: order.status });
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
  if (!order) throw new GraphQLError("Order not found");

  const from = order.status as OrderStatus;
  if (opts.expectedFrom && from !== opts.expectedFrom) {
    throw new GraphQLError(`Order is no longer '${opts.expectedFrom}'`);
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
    if (res.count === 0) throw new GraphQLError("Order changed — refresh and retry");

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
    } else if (["rejected", "auto_expired", "cancelled"].includes(to)) {
      await onOrderMoneyReversal(tx, order, to, opts.refundMinor);
      // Free the redemption so it stops counting against the user's limit + budget. (#52)
      await reverseRedemptionForOrder(tx, order.id);
    }

    return tx.order.findUniqueOrThrow({ where: { id: orderId } });
  });

  logger.info({ orderId, from, to, role: actor.role }, "order transition");
  publishOrderChanged(
    { orderId, branchId: order.branchId, status: to },
    order.deliveryTask?.riderId,
  );
  return updated;
}

export function newIdempotencyKey(): string {
  return randomUUID();
}
