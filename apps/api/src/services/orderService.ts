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
import { quoteCart } from "./quoteService.js";
import { onOrderDelivered, onOrderMoneyReversal } from "./ledgerService.js";

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

  const quote = await quoteCart(input);
  if (!quote.inRadius) throw new GraphQLError("Delivery address is outside the delivery radius");
  if (!quote.meetsMinimum) throw new GraphQLError("Order is below the restaurant's minimum");

  if (input.paymentMode === "card") {
    // Card checkout lands in M5 (MockProvider charge inside this same flow).
    throw new GraphQLError("Card payment is not enabled yet — use cash on delivery");
  }

  const code = `FD-${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 36).toString(36).toUpperCase()}`;

  try {
    const order = await prisma.$transaction(async (tx) => {
      const created = await tx.order.create({
        data: {
          code,
          customerId,
          branchId: quote.branchId,
          status: "pending_acceptance",
          idempotencyKey,
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

      return created;
    });

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
  opts: { reason?: string; expectedFrom?: OrderStatus; meta?: Record<string, unknown> } = {},
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
    } else if (["rejected", "auto_expired", "cancelled"].includes(to)) {
      await onOrderMoneyReversal(tx, order, to);
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
