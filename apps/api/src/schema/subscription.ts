// SSE subscriptions (graphql-sse protocol, served natively by Yoga on /graphql):
// live board, customer tracking, rider job feed. In-memory pubsub — single instance.
import { prisma } from "@fd/db";
import { GraphQLError } from "graphql";
import { pubsub, type OrderChangedPayload, type NotificationPayload } from "../pubsub.js";
import { builder } from "./builder.js";

const OrderChangedType = builder.objectRef<OrderChangedPayload>("OrderChanged");
OrderChangedType.implement({
  fields: (t) => ({
    orderId: t.exposeString("orderId"),
    branchId: t.exposeString("branchId"),
    status: t.exposeString("status"),
  }),
});

// Live bell badge (#56): pushes the caller's current unread count on every new inbox row.
const NotificationEventType = builder.objectRef<NotificationPayload>("NotificationEvent");
NotificationEventType.implement({
  fields: (t) => ({
    userId: t.exposeString("userId"),
    unreadCount: t.exposeInt("unreadCount"),
  }),
});

builder.subscriptionType({
  fields: (t) => ({
    branchOrderFeed: t.field({
      type: OrderChangedType,
      authScopes: { restaurantMember: true },
      args: { branchId: t.arg.string({ required: true }) },
      subscribe: async (_root, args, ctx) => {
        const branch = await prisma.branch.findUnique({ where: { id: args.branchId } });
        if (
          !branch ||
          (!ctx.restaurantIds.includes(branch.restaurantId) && !ctx.hasRole("admin"))
        ) {
          throw new GraphQLError("You don't have access to this restaurant's orders.", {
            extensions: { code: "forbidden" },
          });
        }
        return pubsub.subscribe("branchOrders", args.branchId);
      },
      resolve: (payload: OrderChangedPayload) => payload,
    }),

    orderStatus: t.field({
      type: OrderChangedType,
      authScopes: { loggedIn: true },
      args: { orderId: t.arg.string({ required: true }) },
      subscribe: async (_root, args, ctx) => {
        const order = await prisma.order.findUnique({
          where: { id: args.orderId },
          include: { branch: true },
        });
        if (!order)
          throw new GraphQLError("We couldn't find that order.", {
            extensions: { code: "not_found" },
          });
        const allowed =
          order.customerId === ctx.userId ||
          ctx.hasRole("admin") ||
          ctx.restaurantIds.includes(order.branch.restaurantId);
        if (!allowed)
          throw new GraphQLError("You don't have permission to follow this order.", {
            extensions: { code: "forbidden" },
          });
        return pubsub.subscribe("orderStatus", args.orderId);
      },
      resolve: (payload: OrderChangedPayload) => payload,
    }),

    riderJobFeed: t.field({
      type: OrderChangedType,
      authScopes: { rider: true },
      subscribe: (_root, _args, ctx) => {
        if (!ctx.riderId)
        throw new GraphQLError("You need a rider profile to receive job offers.", {
          extensions: { code: "forbidden" },
        });
        return pubsub.subscribe("riderJobs", ctx.riderId);
      },
      resolve: (payload: OrderChangedPayload) => payload,
    }),

    // Notification feed for the signed-in user: drives the live unread badge (#56).
    notificationFeed: t.field({
      type: NotificationEventType,
      authScopes: { loggedIn: true },
      subscribe: (_root, _args, ctx) => {
        if (!ctx.userId)
        throw new GraphQLError("Please sign in to receive notifications.", {
          extensions: { code: "unauthenticated" },
        });
        return pubsub.subscribe("userNotifications", ctx.userId);
      },
      resolve: (payload: NotificationPayload) => payload,
    }),
  }),
});
