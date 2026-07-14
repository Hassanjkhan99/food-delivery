// In-app notification / offers inbox (#56). The single writer for the `notifications`
// table. Two entry points:
//   - notifyOrderStatus(): transactional order-lifecycle updates, deep-linked to the
//     order. Always delivered (order updates are never opt-outable).
//   - blastPromo(): admin-composed marketing to a simple segment. Suppressed for users
//     who set marketingOptOut.
// Every write also publishes an updated unread count on the userNotifications topic so
// the bell badge updates live (mirrors the existing order pubsub). All calls are wrapped
// by callers in try/catch — creating a notification must never break the order flow.
import { prisma } from "@fd/db";
import type { OrderStatus } from "@fd/shared";
import { logger } from "../logger.js";
import { publishNotification } from "../pubsub.js";
import { dispatchNotification } from "./notifications/dispatch.js";

// Customer-facing copy for each status that warrants an inbox entry. Statuses not in
// this map (e.g. reassigning, failed_delivery_attempt) don't create a notification.
const STATUS_COPY: Partial<Record<OrderStatus, { title: string; body: string }>> = {
  pending_acceptance: {
    title: "Order placed",
    body: "We've sent your order to the restaurant. Hang tight!",
  },
  accepted: { title: "Order accepted", body: "The restaurant is getting started on your order." },
  preparing: { title: "Preparing your food", body: "Your order is being prepared." },
  ready_for_pickup: {
    title: "Ready for pickup",
    body: "Your order is ready and waiting for a rider.",
  },
  rider_assigned: { title: "Rider assigned", body: "A rider is heading to the restaurant." },
  picked_up: { title: "On the way", body: "Your rider has picked up your order." },
  out_for_delivery: { title: "Out for delivery", body: "Your order is on its way to you." },
  delivered: { title: "Delivered — enjoy!", body: "Your order has been delivered. Bon appétit!" },
  rejected: { title: "Order not accepted", body: "The restaurant couldn't accept your order." },
  auto_expired: {
    // Card orders are captured up front and refunded on auto-expiry, so avoid claiming
    // the customer was never charged — cover both the cash and refunded-card cases.
    title: "Order not accepted in time",
    body: "The restaurant didn't respond in time. Any payment has been refunded.",
  },
  cancelled: { title: "Order cancelled", body: "Your order was cancelled." },
};

// Run an async task over items in fixed-size batches so a production-sized promo blast
// can't open thousands of simultaneous DB queries / provider calls at once (#120). Each
// batch settles before the next starts; failures are isolated (allSettled).
const BLAST_FANOUT_CONCURRENCY = 25;
async function forEachLimited<T>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<unknown>,
): Promise<void> {
  for (let i = 0; i < items.length; i += limit) {
    await Promise.allSettled(items.slice(i, i + limit).map(task));
  }
}

// Recompute and broadcast a user's unread count so the header bell badge updates live.
// Exported so read mutations (mark one / mark all) can refresh the badge too.
export async function publishUnread(userId: string) {
  const unreadCount = await prisma.notification.count({ where: { userId, readAt: null } });
  publishNotification({ userId, unreadCount });
}

// Create an order-status inbox entry for the customer. Non-fatal by contract: swallows
// its own errors so a notification hiccup can't roll back an order transition.
export async function notifyOrderStatus(
  order: { id: string; customerId: string; code: string },
  status: OrderStatus,
): Promise<void> {
  const copy = STATUS_COPY[status];
  if (!copy) return;
  const body = `${copy.body} (${order.code})`;
  const linkHref = `/orders/${order.id}`;
  try {
    await prisma.notification.create({
      data: {
        userId: order.customerId,
        kind: "transactional",
        title: copy.title,
        body,
        linkHref,
        orderId: order.id,
      },
    });
    await publishUnread(order.customerId);
    // Out-of-app fan-out (#13). No-op unless a channel is enabled; never throws.
    await dispatchNotification(order.customerId, {
      kind: "transactional",
      title: copy.title,
      body,
      linkHref,
    });
  } catch (err) {
    logger.error({ err, orderId: order.id, status }, "notifyOrderStatus failed (non-fatal)");
  }
}

// Scheduled/pre-order promotion (#199). Not an order-status change (the order stays
// pending_acceptance), so it doesn't belong in STATUS_COPY — it's a distinct "your pre-order
// is now with the restaurant" beat. Same non-fatal contract as notifyOrderStatus.
export async function notifyScheduledOrderPromoted(order: {
  id: string;
  customerId: string;
  code: string;
}): Promise<void> {
  const title = "Your scheduled order is on its way to the kitchen";
  const body = `We've sent your scheduled order to the restaurant to prepare for your slot. (${order.code})`;
  const linkHref = `/orders/${order.id}`;
  try {
    await prisma.notification.create({
      data: {
        userId: order.customerId,
        kind: "transactional",
        title,
        body,
        linkHref,
        orderId: order.id,
      },
    });
    await publishUnread(order.customerId);
    await dispatchNotification(order.customerId, { kind: "transactional", title, body, linkHref });
  } catch (err) {
    logger.error({ err, orderId: order.id }, "notifyScheduledOrderPromoted failed (non-fatal)");
  }
}

export type PromoSegment = "all" | "new" | "lapsed";

// Resolve a simple v1 segment to the set of customer userIds, honouring marketing
// opt-out. "new" = signed up in the last 30d; "lapsed" = no order in the last 45d.
async function segmentUserIds(segment: PromoSegment): Promise<string[]> {
  const now = Date.now();
  const base = {
    marketingOptOut: false,
    roles: { some: { role: "customer" as const } },
  };

  if (segment === "new") {
    const since = new Date(now - 30 * 24 * 60 * 60 * 1000);
    const users = await prisma.user.findMany({
      where: { ...base, createdAt: { gte: since } },
      select: { id: true },
    });
    return users.map((u) => u.id);
  }

  if (segment === "lapsed") {
    const since = new Date(now - 45 * 24 * 60 * 60 * 1000);
    const users = await prisma.user.findMany({
      where: { ...base, ordersPlaced: { none: { placedAt: { gte: since } } } },
      select: { id: true },
    });
    return users.map((u) => u.id);
  }

  const users = await prisma.user.findMany({ where: base, select: { id: true } });
  return users.map((u) => u.id);
}

// Admin-composed promo blast to a segment. Reuses the inbox as the delivery surface;
// the #13 push pipeline can fan out from the same rows later. Returns how many entries
// were created. Opted-out users are excluded by segmentUserIds, satisfying the
// "opting out suppresses promo entries" acceptance criterion.
export async function blastPromo(input: {
  segment: PromoSegment;
  title: string;
  body: string;
  linkHref?: string | null;
  restaurantId?: string | null;
}): Promise<number> {
  const userIds = await segmentUserIds(input.segment);
  if (userIds.length === 0) return 0;

  await prisma.notification.createMany({
    data: userIds.map((userId) => ({
      userId,
      kind: "promo" as const,
      title: input.title,
      body: input.body,
      linkHref: input.linkHref ?? null,
      restaurantId: input.restaurantId ?? null,
    })),
  });

  // Best-effort live badge refresh per recipient (non-fatal), batched so a large blast
  // doesn't fire thousands of simultaneous COUNT queries and exhaust the pool (#120).
  await forEachLimited(userIds, BLAST_FANOUT_CONCURRENCY, (userId) => publishUnread(userId));
  // Out-of-app fan-out (#13). No-op unless a channel is enabled; each dispatch is
  // self-isolating, so a slow provider can't fail the blast.
  await forEachLimited(userIds, BLAST_FANOUT_CONCURRENCY, (userId) =>
    dispatchNotification(userId, {
      kind: "promo",
      title: input.title,
      body: input.body,
      linkHref: input.linkHref ?? null,
    }),
  );
  logger.info({ segment: input.segment, count: userIds.length }, "promo blast sent");
  return userIds.length;
}
