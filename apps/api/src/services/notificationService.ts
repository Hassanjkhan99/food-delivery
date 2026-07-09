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

// Customer-facing copy for each status that warrants an inbox entry. Statuses not in
// this map (e.g. reassigning, failed_delivery_attempt) don't create a notification.
const STATUS_COPY: Partial<Record<OrderStatus, { title: string; body: string }>> = {
  pending_acceptance: {
    title: "Order placed",
    body: "We've sent your order to the restaurant. Hang tight!",
  },
  accepted: { title: "Order accepted", body: "The restaurant is getting started on your order." },
  preparing: { title: "Preparing your food", body: "Your order is being prepared." },
  ready_for_pickup: { title: "Ready for pickup", body: "Your order is ready and waiting for a rider." },
  rider_assigned: { title: "Rider assigned", body: "A rider is heading to the restaurant." },
  picked_up: { title: "On the way", body: "Your rider has picked up your order." },
  out_for_delivery: { title: "Out for delivery", body: "Your order is on its way to you." },
  delivered: { title: "Delivered — enjoy!", body: "Your order has been delivered. Bon appétit!" },
  rejected: { title: "Order not accepted", body: "The restaurant couldn't accept your order." },
  auto_expired: {
    title: "Order not accepted in time",
    body: "The restaurant didn't respond in time. You haven't been charged.",
  },
  cancelled: { title: "Order cancelled", body: "Your order was cancelled." },
};

async function publishUnread(userId: string) {
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
  try {
    await prisma.notification.create({
      data: {
        userId: order.customerId,
        kind: "transactional",
        title: copy.title,
        body: `${copy.body} (${order.code})`,
        linkHref: `/orders/${order.id}`,
        orderId: order.id,
      },
    });
    await publishUnread(order.customerId);
  } catch (err) {
    logger.error({ err, orderId: order.id, status }, "notifyOrderStatus failed (non-fatal)");
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

  // Best-effort live badge refresh per recipient (non-fatal).
  await Promise.allSettled(userIds.map((userId) => publishUnread(userId)));
  logger.info({ segment: input.segment, count: userIds.length }, "promo blast sent");
  return userIds.length;
}
