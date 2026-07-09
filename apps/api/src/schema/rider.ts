// Rider domain: availability, job list, pickup/deliver lifecycle, COD capture, incidents.
import { prisma } from "@fd/db";
import { GraphQLError } from "graphql";
import type { AppContext } from "../context.js";
import { transition } from "../services/orderService.js";
import { missingRequirements } from "../services/riderVerificationService.js";
import { builder } from "./builder.js";

// Valid rider document kinds (mirrors the RiderDocKind enum in the Prisma schema).
const RIDER_DOC_KINDS = [
  "cnic_front",
  "cnic_back",
  "photo",
  "vehicle_registration",
  "license",
] as const;

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
    offeredAt: t.field({ type: "DateTime", nullable: true, resolve: (d) => d.offeredAt }),
    acceptedAt: t.field({ type: "DateTime", nullable: true, resolve: (d) => d.acceptedAt }),
    declineReason: t.exposeString("declineReason", { nullable: true }),
    assignedAt: t.field({ type: "DateTime", nullable: true, resolve: (d) => d.assignedAt }),
    order: t.relation("order"),
    podMedia: t.relation("podMedia", { nullable: true }),
  }),
});

// One delivered job in the rider's earnings ledger. `net` = deliveryFee + tip (no rider
// ledger split exists yet); `codCollected` is the cash handled at the door.
type EarningsRow = {
  taskId: string;
  orderId: string;
  orderCode: string;
  deliveredAt: Date | null;
  deliveryFeeMinor: number;
  tipMinor: number;
  codCollectedMinor: number;
  netMinor: number;
};

const EarningsRowType = builder.objectRef<EarningsRow>("RiderEarningsRow");
EarningsRowType.implement({
  fields: (t) => ({
    taskId: t.exposeString("taskId"),
    orderId: t.exposeString("orderId"),
    orderCode: t.exposeString("orderCode"),
    deliveredAt: t.field({ type: "DateTime", nullable: true, resolve: (r) => r.deliveredAt }),
    deliveryFeeMinor: t.exposeInt("deliveryFeeMinor"),
    tipMinor: t.exposeInt("tipMinor"),
    codCollectedMinor: t.exposeInt("codCollectedMinor"),
    netMinor: t.exposeInt("netMinor"),
  }),
});

// A computed rider payout window (see myRiderPayouts — riders aren't settled via the
// Payout table yet, so these are derived from delivered jobs).
type RiderPayoutRow = {
  periodKey: string;
  periodStart: Date;
  periodEnd: Date;
  jobCount: number;
  amountMinor: number;
  isComputed: boolean;
};

const RiderPayoutRowType = builder.objectRef<RiderPayoutRow>("RiderPayoutRow");
RiderPayoutRowType.implement({
  fields: (t) => ({
    periodKey: t.exposeString("periodKey"),
    periodStart: t.field({ type: "DateTime", resolve: (r) => r.periodStart }),
    periodEnd: t.field({ type: "DateTime", resolve: (r) => r.periodEnd }),
    jobCount: t.exposeInt("jobCount"),
    amountMinor: t.exposeInt("amountMinor"),
    isComputed: t.exposeBoolean("isComputed"),
  }),
});

// ISO-week bucket (Mon 00:00 → next Mon 00:00, UTC) for grouping computed payouts.
function isoWeekWindow(when: Date): { key: string; start: Date; end: Date } {
  const d = new Date(Date.UTC(when.getUTCFullYear(), when.getUTCMonth(), when.getUTCDate()));
  const day = d.getUTCDay(); // 0=Sun … 6=Sat
  const mondayOffset = (day + 6) % 7; // days since Monday
  const start = new Date(d);
  start.setUTCDate(d.getUTCDate() - mondayOffset);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 7);
  const key = start.toISOString().slice(0, 10);
  return { key, start, end };
}

builder.queryFields((t) => ({
  myRiderProfile: t.field({
    type: builder
      .objectRef<{
        riderId: string;
        isOnline: boolean;
        riderType: string;
        verificationStatus: string;
        trustScore: number;
        sharedModeEnabled: boolean;
        trainingCompleted: boolean;
        agreementAccepted: boolean;
        rejectionReason: string | null;
        missingRequirements: string[];
      }>("RiderProfile")
      .implement({
        fields: (f) => ({
          riderId: f.exposeString("riderId"),
          isOnline: f.exposeBoolean("isOnline"),
          riderType: f.exposeString("riderType"),
          verificationStatus: f.exposeString("verificationStatus"),
          trustScore: f.exposeInt("trustScore"),
          sharedModeEnabled: f.exposeBoolean("sharedModeEnabled"),
          trainingCompleted: f.exposeBoolean("trainingCompleted"),
          agreementAccepted: f.exposeBoolean("agreementAccepted"),
          rejectionReason: f.exposeString("rejectionReason", { nullable: true }),
          missingRequirements: f.field({
            type: ["String"],
            resolve: (p) => p.missingRequirements,
          }),
        }),
      }),
    nullable: true,
    authScopes: { rider: true },
    resolve: async (_root, _args, ctx) => {
      if (!ctx.riderId) return null;
      const rider = await prisma.rider.findUnique({
        where: { id: ctx.riderId },
        include: { availability: true, verificationDocs: true },
      });
      if (!rider) return null;
      return {
        riderId: rider.id,
        isOnline: rider.availability?.isOnline ?? false,
        riderType: rider.riderType,
        verificationStatus: rider.verificationStatus,
        trustScore: rider.trustScore,
        sharedModeEnabled: rider.sharedModeEnabled,
        trainingCompleted: rider.trainingCompleted,
        agreementAccepted: rider.agreementAccepted,
        rejectionReason: rider.rejectionReason,
        missingRequirements: missingRequirements(rider),
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

  // Per-job earnings ledger for the rider (#delivery). Computed live from delivered
  // tasks — there is no rider payout split in the money ledger yet (see Order.tipAmount
  // and ledgerService), so `net` is the delivery fee + tip the platform owes the rider
  // for the drop, and `codCollected` is the cash they handled (informational, already
  // owed to the restaurant). Totals are summed on RiderEarningsBreakdown.
  myEarningsBreakdown: t.field({
    type: builder
      .objectRef<{ rows: EarningsRow[] }>("RiderEarningsBreakdown")
      .implement({
        fields: (f) => ({
          rows: f.field({ type: [EarningsRowType], resolve: (b) => b.rows }),
          jobCount: f.int({ resolve: (b) => b.rows.length }),
          deliveryFeeMinor: f.int({ resolve: (b) => b.rows.reduce((s, r) => s + r.deliveryFeeMinor, 0) }),
          tipMinor: f.int({ resolve: (b) => b.rows.reduce((s, r) => s + r.tipMinor, 0) }),
          codCollectedMinor: f.int({ resolve: (b) => b.rows.reduce((s, r) => s + r.codCollectedMinor, 0) }),
          netMinor: f.int({ resolve: (b) => b.rows.reduce((s, r) => s + r.netMinor, 0) }),
        }),
      }),
    authScopes: { rider: true },
    resolve: async (_root, _args, ctx) => {
      const tasks = await prisma.deliveryTask.findMany({
        where: { riderId: ctx.riderId!, status: "delivered" },
        include: { order: true },
        orderBy: { createdAt: "desc" },
        take: 100,
      });
      const rows: EarningsRow[] = tasks.map((task) => {
        const deliveryFeeMinor = task.order.deliveryFeeMinor;
        const tipMinor = task.order.tipAmount;
        return {
          taskId: task.id,
          orderId: task.orderId,
          orderCode: task.order.code,
          deliveredAt: task.order.deliveredAt,
          deliveryFeeMinor,
          tipMinor,
          codCollectedMinor: task.codAmountMinor,
          netMinor: deliveryFeeMinor + tipMinor,
        };
      });
      return { rows };
    },
  }),

  // Rider payout history. Riders are not paid out through the Payout table yet (that
  // table is restaurant-scoped), so this is COMPUTED from delivered jobs and grouped
  // into ISO-week windows. `isComputed` is always true — flagged so the client can show
  // "estimated" rather than implying a settled bank transfer.
  myRiderPayouts: t.field({
    type: [RiderPayoutRowType],
    authScopes: { rider: true },
    resolve: async (_root, _args, ctx) => {
      const tasks = await prisma.deliveryTask.findMany({
        where: { riderId: ctx.riderId!, status: "delivered" },
        include: { order: true },
      });
      const byWeek = new Map<string, RiderPayoutRow>();
      for (const task of tasks) {
        const when = task.order.deliveredAt ?? task.createdAt;
        const { key, start, end } = isoWeekWindow(when);
        const net = task.order.deliveryFeeMinor + task.order.tipAmount;
        const row = byWeek.get(key) ?? {
          periodKey: key,
          periodStart: start,
          periodEnd: end,
          jobCount: 0,
          amountMinor: 0,
          isComputed: true,
        };
        row.jobCount += 1;
        row.amountMinor += net;
        byWeek.set(key, row);
      }
      return [...byWeek.values()].sort(
        (a, b) => b.periodStart.getTime() - a.periodStart.getTime(),
      );
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

  // Swipe-to-accept: a rider takes an offered job. Promotes the task offered→assigned
  // (the normal lifecycle continues from `assigned` exactly as the auto-assign path) and
  // moves the order to rider_assigned. The status guard makes accept idempotency-safe: a
  // second accept, or an offer that was withdrawn/reassigned, fails cleanly.
  acceptTask: t.prismaField({
    type: DeliveryTaskType,
    authScopes: { rider: true },
    args: { taskId: t.arg.string({ required: true }) },
    resolve: async (query, _root, args, ctx) => {
      const task = await assertMyTask(ctx, args.taskId);
      if (task.status !== "offered") throw new GraphQLError("Job is not awaiting acceptance");
      const now = new Date();
      // Only promote if it's still `offered` (a concurrent decline/withdraw loses).
      const res = await prisma.deliveryTask.updateMany({
        where: { id: task.id, status: "offered" },
        data: { status: "assigned", acceptedAt: now, assignedAt: now, declineReason: null },
      });
      if (res.count === 0) throw new GraphQLError("Offer is no longer available");
      await prisma.deliveryEvent.create({
        data: { taskId: task.id, type: "accepted", actorUserId: ctx.userId },
      });
      await transition(task.orderId, "rider_assigned", { userId: ctx.userId, role: "rider" }, {
        expectedFrom: "ready_for_pickup",
      });
      return prisma.deliveryTask.findUniqueOrThrow({ ...query, where: { id: task.id } });
    },
  }),

  // Rider declines an offered job. Detaches the rider and returns the task to
  // `unassigned` so the restaurant can re-offer/assign; the order stays ready_for_pickup.
  declineTask: t.field({
    type: "Boolean",
    authScopes: { rider: true },
    args: {
      taskId: t.arg.string({ required: true }),
      reason: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      const task = await assertMyTask(ctx, args.taskId);
      if (task.status !== "offered") throw new GraphQLError("Job is not awaiting acceptance");
      const res = await prisma.deliveryTask.updateMany({
        where: { id: task.id, status: "offered" },
        data: {
          status: "unassigned",
          riderId: null,
          offeredAt: null,
          declineReason: args.reason ?? null,
        },
      });
      if (res.count === 0) throw new GraphQLError("Offer is no longer available");
      await prisma.deliveryEvent.create({
        data: {
          taskId: task.id,
          type: "declined",
          actorUserId: ctx.userId,
          note: args.reason ?? null,
        },
      });
      return true;
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
      // Optional proof-of-delivery photo. Upload via presignUpload/finalizeUpload first,
      // then pass the finalized assetId here (same media flow as menu/theme images).
      podMediaId: t.arg.string({ required: false }),
    },
    resolve: async (_q, _root, args, ctx) => {
      const task = await assertMyTask(ctx, args.taskId);
      if (task.status !== "picked_up") throw new GraphQLError("Job is not out for delivery");

      // Validate the POD asset (if supplied) before we mark delivered.
      if (args.podMediaId) {
        const asset = await prisma.mediaAsset.findUnique({ where: { id: args.podMediaId } });
        if (!asset || asset.status !== "finalized") {
          throw new GraphQLError("Proof-of-delivery photo is not finalized");
        }
      }

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
        data: { status: "delivered", ...(args.podMediaId ? { podMediaId: args.podMediaId } : {}) },
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

  // Rider uploads a verification document. The MediaAsset must already be finalized
  // (same presign→finalize flow as menu/theme/POD images). Re-submitting the same kind
  // replaces the prior doc so the admin queue always sees the latest. Submitting while
  // rejected/verified moves the rider back to `pending` for re-review.
  submitRiderDoc: t.prismaField({
    type: "RiderVerificationDoc",
    authScopes: { rider: true },
    args: {
      kind: t.arg.string({ required: true }),
      assetId: t.arg.string({ required: true }),
    },
    resolve: async (query, _root, args, ctx) => {
      if (!ctx.riderId) throw new GraphQLError("No rider profile");
      if (!RIDER_DOC_KINDS.includes(args.kind as never)) {
        throw new GraphQLError("Invalid document kind");
      }
      const asset = await prisma.mediaAsset.findUnique({ where: { id: args.assetId } });
      if (!asset || asset.status !== "finalized") {
        throw new GraphQLError("Document upload is not finalized");
      }
      // Replace any existing doc of the same kind for this rider.
      await prisma.riderVerificationDoc.deleteMany({
        where: { riderId: ctx.riderId, kind: args.kind as never },
      });
      const doc = await prisma.riderVerificationDoc.create({
        data: { riderId: ctx.riderId, kind: args.kind as never, assetId: args.assetId },
      });
      // A new/updated doc re-opens review unless already pending.
      await prisma.rider.updateMany({
        where: { id: ctx.riderId, verificationStatus: { not: "pending" } },
        data: { verificationStatus: "pending" },
      });
      return prisma.riderVerificationDoc.findUniqueOrThrow({ ...query, where: { id: doc.id } });
    },
  }),

  // Rider sets vehicle details + completes training / accepts the agreement. Any field is
  // optional so the onboarding form can save incrementally.
  updateRiderOnboarding: t.prismaField({
    type: "Rider",
    authScopes: { rider: true },
    args: {
      vehicleType: t.arg.string({ required: false }),
      vehiclePlate: t.arg.string({ required: false }),
      trainingCompleted: t.arg.boolean({ required: false }),
      agreementAccepted: t.arg.boolean({ required: false }),
    },
    resolve: async (query, _root, args, ctx) => {
      if (!ctx.riderId) throw new GraphQLError("No rider profile");
      return prisma.rider.update({
        ...query,
        where: { id: ctx.riderId },
        data: {
          ...(args.vehicleType != null ? { vehicleType: args.vehicleType } : {}),
          ...(args.vehiclePlate != null ? { vehiclePlate: args.vehiclePlate } : {}),
          ...(args.trainingCompleted != null
            ? { trainingCompleted: args.trainingCompleted }
            : {}),
          ...(args.agreementAccepted != null
            ? { agreementAccepted: args.agreementAccepted }
            : {}),
        },
      });
    },
  }),
}));
