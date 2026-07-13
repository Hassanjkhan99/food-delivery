// GraphQL pubsub for SSE subscriptions. Topics: branch:{id}:orders, order:{id},
// rider:{id}:jobs, user:{id}:notifications.
//
// Transport is env-selected (#11/#26): when REDIS_URL is set the events fan out
// through a Redis pub/sub event target, so subscribers living on *different* API
// instances (or serverless invocations) all see every publish. Without it we fall
// back to the in-process event target — correct for single-instance dev, but the
// reason live SSE never pushed on the collapsed Vercel deploy.
import { createPubSub } from "graphql-yoga";
import { createRedisEventTarget } from "@graphql-yoga/redis-event-target";
import Redis from "ioredis";
import { env } from "./env.js";
import { logger } from "./logger.js";

export type OrderChangedPayload = {
  orderId: string;
  branchId: string;
  status: string;
};

// Fired whenever a notification row is created for a user (#56): drives the live
// bell badge / inbox refresh. Carries the current unread count so the client can
// update the badge without a round-trip.
export type NotificationPayload = {
  userId: string;
  unreadCount: number;
};

// Redis pub/sub needs two connections: a subscriber connection can't issue other
// commands, so publishing uses a separate client. Both point at the same instance.
function redisEventTarget(url: string) {
  const publishClient = new Redis(url, { lazyConnect: false });
  const subscribeClient = new Redis(url, { lazyConnect: false });
  for (const [name, client] of [
    ["publish", publishClient],
    ["subscribe", subscribeClient],
  ] as const) {
    client.on("error", (err) => logger.error({ err, client: name }, "redis pubsub error"));
  }
  logger.info("pubsub: using Redis event target (multi-instance SSE enabled)");
  return createRedisEventTarget({ publishClient, subscribeClient });
}

export const pubsub = createPubSub<{
  branchOrders: [branchId: string, payload: OrderChangedPayload];
  orderStatus: [orderId: string, payload: OrderChangedPayload];
  riderJobs: [riderId: string, payload: OrderChangedPayload];
  userNotifications: [userId: string, payload: NotificationPayload];
}>(env.redisUrl ? { eventTarget: redisEventTarget(env.redisUrl) } : {});

export function publishNotification(payload: NotificationPayload) {
  pubsub.publish("userNotifications", payload.userId, payload);
}

export function publishOrderChanged(payload: OrderChangedPayload, riderId?: string | null) {
  pubsub.publish("branchOrders", payload.branchId, payload);
  pubsub.publish("orderStatus", payload.orderId, payload);
  if (riderId) pubsub.publish("riderJobs", riderId, payload);
}
