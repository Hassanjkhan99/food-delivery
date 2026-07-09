// In-memory pubsub (single API instance for MVP; Redis pubsub is the scale path).
// Topics: branch:{id}:orders, order:{id}, rider:{id}:jobs
import { createPubSub } from "graphql-yoga";

export type OrderChangedPayload = {
  orderId: string;
  branchId: string;
  status: string;
};

export const pubsub = createPubSub<{
  branchOrders: [branchId: string, payload: OrderChangedPayload];
  orderStatus: [orderId: string, payload: OrderChangedPayload];
  riderJobs: [riderId: string, payload: OrderChangedPayload];
}>();

export function publishOrderChanged(payload: OrderChangedPayload, riderId?: string | null) {
  pubsub.publish("branchOrders", payload.branchId, payload);
  pubsub.publish("orderStatus", payload.orderId, payload);
  if (riderId) pubsub.publish("riderJobs", riderId, payload);
}
