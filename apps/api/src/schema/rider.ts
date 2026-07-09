// Rider domain: availability, job list, pickup/deliver lifecycle, COD capture, incidents.
import { prisma } from "@fd/db";
import { GraphQLError } from "graphql";
import type { AppContext } from "../context.js";
import { transition } from "../services/orderService.js";
import { builder } from "./builder.js";

async function assertMyTask(ctx: AppContext, taskId: string) {
  const task = await prisma.deliveryTask.findUnique({
    where: { id: taskId },
    include: { order: { include: { branch: true } } },
  });
  if (!task) throw new GraphQLError("Job not found");
  if (task.riderId !== ctx.riderId && !ctx.hasRole("admin")) {
    throw new GraphQLError("Not your job");
  }
  return task;
}

const DeliveryTaskType = builder.prismaObject("DeliveryTask", {
  fields: (t) => ({
    id: t.exposeID("id"),
    status: t.exposeString("status"),
    codAmountMinor: t.exposeInt("codAmountMinor"),
    assignedAt: t.field({ type: "DateTime", nullable: true, resolve: (d) => d.assignedAt }),
    order: t.relation("order"),
  }),
});

builder.queryFields((t) => ({
  myRiderProfile: t.field({
    type: builder
      .objectRef<{ riderId: string; isOnline: boolean; riderType: string }>("RiderProfile")
      .implement({
        fields: (f) => ({
          riderId: f.exposeString("riderId"),
          isOnline: f.exposeBoolean("isOnline"),
          riderType: f.exposeString("riderType"),
        }),
      }),
    nullable: true,
    authScopes: { rider: true },
    resolve: async (_root, _args, ctx) => {
      if (!ctx.riderId) return null;
      const rider = await prisma.rider.findUnique({
        where: { id: ctx.riderId },
        include: { availability: true },
      });
      if (!rider) return null;
      return {
        riderId: rider.id,
        isOnline: rider.availability?.isOnline ?? false,
        riderType: rider.riderType,
      };
    },
  }),

  myJobs: t.prismaField({
    type: [DeliveryTaskType],
    authScopes: { rider: true },
    resolve: (query, _root, _args, ctx) =>
      prisma.deliveryTask.findMany({
        ...query,
        where: { riderId: ctx.riderId! },
        orderBy: { createdAt: "desc" },
        take: 30,
      }),
  }),

  myEarnings: t.field({
    type: builder
      .objectRef<{ deliveredCount: number; codCollectedMinor: number }>("RiderEarnings")
      .implement({
        fields: (f) => ({
          deliveredCount: f.exposeInt("deliveredCount"),
          codCollectedMinor: f.exposeInt("codCollectedMinor"),
        }),
      }),
    authScopes: { rider: true },
    resolve: async (_root, _args, ctx) => {
      const delivered = await prisma.deliveryTask.findMany({
        where: { riderId: ctx.riderId!, status: "delivered" },
      });
      return {
        deliveredCount: delivered.length,
        codCollectedMinor: delivered.reduce((s, t2) => s + t2.codAmountMinor, 0),
      };
    },
  }),
}));

builder.mutationFields((t) => ({
  setAvailability: t.field({
    type: "Boolean",
    authScopes: { rider: true },
    args: { online: t.arg.boolean({ required: true }) },
    resolve: async (_root, args, ctx) => {
      await prisma.riderAvailability.upsert({
        where: { riderId: ctx.riderId! },
        update: { isOnline: args.online },
        create: { riderId: ctx.riderId!, isOnline: args.online },
      });
      return args.online;
    },
  }),

  riderArrivedAtPickup: t.prismaField({
    type: DeliveryTaskType,
    authScopes: { rider: true },
    args: { taskId: t.arg.string({ required: true }) },
    resolve: async (_q, _root, args, ctx) => {
      const task = await assertMyTask(ctx, args.taskId);
      if (task.status !== "assigned") throw new GraphQLError("Job is not awaiting pickup");
      await prisma.deliveryEvent.create({
        data: { taskId: task.id, type: "arrived_pickup", actorUserId: ctx.userId },
      });
      return prisma.deliveryTask.update({
        where: { id: task.id },
        data: { status: "arrived_pickup" },
      });
    },
  }),

  riderPickedUp: t.prismaField({
    type: DeliveryTaskType,
    authScopes: { rider: true },
    args: { taskId: t.arg.string({ required: true }) },
    resolve: async (_q, _root, args, ctx) => {
      const task = await assertMyTask(ctx, args.taskId);
      if (!["assigned", "arrived_pickup"].includes(task.status)) {
        throw new GraphQLError("Job is not awaiting pickup");
      }
      // picked_up then straight to out_for_delivery (rider is moving).
      await transition(task.orderId, "picked_up", { userId: ctx.userId, role: "rider" });
      await transition(task.orderId, "out_for_delivery", { userId: ctx.userId, role: "rider" });
      await prisma.deliveryEvent.create({
        data: { taskId: task.id, type: "picked_up", actorUserId: ctx.userId },
      });
      return prisma.deliveryTask.update({
        where: { id: task.id },
        data: { status: "picked_up" },
      });
    },
  }),

  riderDelivered: t.prismaField({
    type: DeliveryTaskType,
    authScopes: { rider: true },
    args: {
      taskId: t.arg.string({ required: true }),
      codCollectedMinor: t.arg.int({ required: true }),
    },
    resolve: async (_q, _root, args, ctx) => {
      const task = await assertMyTask(ctx, args.taskId);
      if (task.status !== "picked_up") throw new GraphQLError("Job is not out for delivery");

      await transition(task.orderId, "delivered", { userId: ctx.userId, role: "rider" });

      // COD mismatch opens an incident ticket but the delivery still completes.
      if (task.codAmountMinor > 0 && args.codCollectedMinor !== task.codAmountMinor) {
        await prisma.supportTicket.create({
          data: {
            customerId: task.order.customerId,
            orderId: task.orderId,
            category: "cash_mismatch",
            subject: `COD mismatch on ${task.order.code}`,
            body: `Expected ${task.codAmountMinor}, rider declared ${args.codCollectedMinor}.`,
          },
        });
      }

      await prisma.deliveryEvent.create({
        data: {
          taskId: task.id,
          type: "delivered",
          actorUserId: ctx.userId,
          note: task.codAmountMinor > 0 ? `COD declared: ${args.codCollectedMinor}` : null,
        },
      });
      return prisma.deliveryTask.update({
        where: { id: task.id },
        data: { status: "delivered" },
      });
    },
  }),

  reportIncident: t.field({
    type: "Boolean",
    authScopes: { rider: true },
    args: {
      taskId: t.arg.string({ required: true }),
      note: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      const task = await assertMyTask(ctx, args.taskId);
      await prisma.deliveryEvent.create({
        data: { taskId: task.id, type: "incident", actorUserId: ctx.userId, note: args.note },
      });
      await prisma.supportTicket.create({
        data: {
          customerId: task.order.customerId,
          orderId: task.orderId,
          category: "rider_incident",
          subject: `Rider incident on ${task.order.code}`,
          body: args.note,
        },
      });
      return true;
    },
  }),
}));
