// SSE subscriptions (graphql-sse protocol, served natively by Yoga on /graphql):
// live board, customer tracking, rider job feed. In-memory pubsub — single instance.
import { prisma } from "@fd/db";
import { GraphQLError } from "graphql";
import { pubsub, type OrderChangedPayload } from "../pubsub.js";
import { builder } from "./builder.js";

const OrderChangedType = builder.objectRef<OrderChangedPayload>("OrderChanged");
OrderChangedType.implement({
  fields: (t) => ({
    orderId: t.exposeString("orderId"),
    branchId: t.exposeString("branchId"),
    status: t.exposeString("status"),
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
          throw new GraphQLError("Not a member of this restaurant");
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
        if (!order) throw new GraphQLError("Order not found");
        const allowed =
          order.customerId === ctx.userId ||
          ctx.hasRole("admin") ||
          ctx.restaurantIds.includes(order.branch.restaurantId);
        if (!allowed) throw new GraphQLError("Not authorized");
        return pubsub.subscribe("orderStatus", args.orderId);
      },
      resolve: (payload: OrderChangedPayload) => payload,
    }),

    riderJobFeed: t.field({
      type: OrderChangedType,
      authScopes: { rider: true },
      subscribe: (_root, _args, ctx) => {
        if (!ctx.riderId) throw new GraphQLError("No rider profile");
        return pubsub.subscribe("riderJobs", ctx.riderId);
      },
      resolve: (payload: OrderChangedPayload) => payload,
    }),
  }),
});
