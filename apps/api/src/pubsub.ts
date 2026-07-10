// In-memory pubsub (single API instance for MVP; Redis pubsub is the scale path).
// Topics: branch:{id}:orders, order:{id}, rider:{id}:jobs
import { createPubSub } from "graphql-yoga";

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

export const pubsub = createPubSub<{
  branchOrders: [branchId: string, payload: OrderChangedPayload];
  orderStatus: [orderId: string, payload: OrderChangedPayload];
  riderJobs: [riderId: string, payload: OrderChangedPayload];
  userNotifications: [userId: string, payload: NotificationPayload];
}>();

export function publishNotification(payload: NotificationPayload) {
  pubsub.publish("userNotifications", payload.userId, payload);
}

export function publishOrderChanged(payload: OrderChangedPayload, riderId?: string | null) {
  pubsub.publish("branchOrders", payload.branchId, payload);
  pubsub.publish("orderStatus", payload.orderId, payload);
  if (riderId) pubsub.publish("riderJobs", riderId, payload);
}
