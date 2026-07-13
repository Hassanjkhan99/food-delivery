// Shared-rider dispatch domain (#21): lender policy, offer generation, accept-locks-task,
// ledger-split hook. Foundation building on the #67 offer→accept flow. See
// services/dispatchService.ts for the scoring + constraint + split math (pure, testable).
//
// The engine is opt-in everywhere: a rider must set sharedOptIn, and a lender restaurant must
// enable a SharedRiderPolicy (and not have the per-shift veto on) before its riders are lent.
// The lender's own orders always win — enforced by the active-job ceiling in the scorer.
import { prisma } from "@fd/db";
import { GraphQLError } from "graphql";
import type { AppContext } from "../context.js";
import { transition } from "../services/orderService.js";
import {
  OFFER_TTL_SECONDS,
  rankCandidates,
  scoreCandidate,
  postDispatchSplit,
  type RiderCandidate,
  type ScoredCandidate,
} from "../services/dispatchService.js";
import { builder } from "./builder.js";

// Same membership guard used across the restaurant console.
async function assertOrderBranchMember(ctx: AppContext, orderId: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { branch: true },
  });
  if (!order)
    throw new GraphQLError("We couldn't find that order.", { extensions: { code: "not_found" } });
  if (!ctx.restaurantIds.includes(order.branch.restaurantId) && !ctx.hasRole("admin")) {
    throw new GraphQLError("You don't have access to this restaurant.", {
      extensions: { code: "forbidden" },
    });
  }
  return order;
}

async function assertRestaurantMember(ctx: AppContext, restaurantId: string) {
  if (!ctx.restaurantIds.includes(restaurantId) && !ctx.hasRole("admin")) {
    throw new GraphQLError("You don't have access to this restaurant.", {
      extensions: { code: "forbidden" },
    });
  }
}

// ─────────────────────────── types ───────────────────────────

builder.prismaObject("SharedRiderPolicy", {
  fields: (t) => ({
    id: t.exposeID("id"),
    restaurantId: t.exposeString("restaurantId"),
    sharingEnabled: t.exposeBoolean("sharingEnabled"),
    vetoActive: t.exposeBoolean("vetoActive"),
    maxActiveJobs: t.exposeInt("maxActiveJobs"),
    maxPickupMeters: t.exposeInt("maxPickupMeters"),
    maxIncrementalDelaySec: t.exposeInt("maxIncrementalDelaySec"),
    codTrustThreshold: t.exposeInt("codTrustThreshold"),
  }),
});

builder.prismaObject("DeliveryOffer", {
  fields: (t) => ({
    id: t.exposeID("id"),
    taskId: t.exposeString("taskId"),
    riderId: t.exposeString("riderId"),
    status: t.exposeString("status"),
    matchedScore: t.exposeFloat("matchedScore"),
    rank: t.exposeInt("rank"),
    pickupMeters: t.exposeInt("pickupMeters", { nullable: true }),
    incrementalDelaySec: t.exposeInt("incrementalDelaySec", { nullable: true }),
    isSharedRider: t.exposeBoolean("isSharedRider"),
    expiresAt: t.field({ type: "DateTime", resolve: (o) => o.expiresAt }),
    offeredAt: t.field({ type: "DateTime", resolve: (o) => o.offeredAt }),
    respondedAt: t.field({ type: "DateTime", nullable: true, resolve: (o) => o.respondedAt }),
    declineReason: t.exposeString("declineReason", { nullable: true }),
    rider: t.relation("rider"),
    task: t.relation("task"),
  }),
});

// A scored candidate preview (no offer persisted) — surfaced so the restaurant console can
// show the shortlist + why riders were excluded before committing to generate offers.
const ScoredCandidateType = builder.objectRef<ScoredCandidate>("ScoredRiderCandidate");
ScoredCandidateType.implement({
  fields: (t) => ({
    riderId: t.exposeString("riderId"),
    isSharedRider: t.exposeBoolean("isSharedRider"),
    score: t.exposeFloat("score"),
    pickupMeters: t.exposeInt("pickupMeters"),
    etaToPickupSec: t.exposeInt("etaToPickupSec"),
    diversionMeters: t.exposeInt("diversionMeters"),
    incrementalDelaySec: t.exposeInt("incrementalDelaySec"),
    cashRiskScore: t.exposeFloat("cashRiskScore"),
    eligible: t.exposeBoolean("eligible"),
    rejectReason: t.exposeString("rejectReason", { nullable: true }),
  }),
});

// ─────────────────────────── candidate loading + scoring ───────────────────────────

type OrderForDispatch = Awaited<ReturnType<typeof loadOrderForDispatch>>;

async function loadOrderForDispatch(orderId: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { branch: true },
  });
  if (!order)
    throw new GraphQLError("We couldn't find that order.", { extensions: { code: "not_found" } });
  return order;
}

function dropoffFromSnapshot(snapshot: unknown): { lat: number; lng: number } | null {
  const snap = snapshot as { lat?: unknown; lng?: unknown } | null;
  if (snap && typeof snap.lat === "number" && typeof snap.lng === "number") {
    return { lat: snap.lat, lng: snap.lng };
  }
  return null;
}

/**
 * Build the scored shortlist for an order. Candidate pool = the source restaurant's own
 * riders PLUS any shared-eligible riders from OTHER restaurants (their lender policy is
 * loaded so the scorer can apply the right guards). Cheap haversine scoring is applied to
 * everyone; a production build would call a route matrix only for the top SHORTLIST_SIZE.
 */
async function buildScoredShortlist(
  order: NonNullable<OrderForDispatch>,
): Promise<ScoredCandidate[]> {
  const sourceRestaurantId = order.branch.restaurantId;
  const pickup = { lat: Number(order.branch.lat), lng: Number(order.branch.lng) };
  const isCod = order.paymentMode === "cod";

  // Own riders + shared-opted-in riders from other restaurants that are online.
  const riders = await prisma.rider.findMany({
    where: {
      verificationStatus: "verified",
      OR: [{ restaurantId: sourceRestaurantId }, { sharedOptIn: true }],
      availability: { isOnline: true },
    },
    include: { availability: true },
  });

  // Active pre-pickup tasks per rider, WITH the committed order's dropoff. Used both for the
  // active-job ceiling AND as the diversion reference point: the new pickup's detour is
  // measured against where the rider is already headed, not the new order's dropoff (#126 P2).
  const activeTasks = await prisma.deliveryTask.findMany({
    where: {
      riderId: { in: riders.map((r) => r.id) },
      status: { in: ["offered", "assigned", "arrived_pickup"] },
    },
    select: { riderId: true, order: { select: { addressSnapshotJson: true } } },
    orderBy: { createdAt: "desc" },
  });
  const activeByRider = new Map<string, number>();
  const committedDropoffByRider = new Map<string, { lat: number; lng: number }>();
  for (const t of activeTasks) {
    if (!t.riderId) continue;
    activeByRider.set(t.riderId, (activeByRider.get(t.riderId) ?? 0) + 1);
    // Keep the most-recent active task's dropoff (query is ordered desc, first wins).
    if (!committedDropoffByRider.has(t.riderId)) {
      const d = dropoffFromSnapshot(t.order.addressSnapshotJson);
      if (d) committedDropoffByRider.set(t.riderId, d);
    }
  }

  // Lender policies for the restaurants owning shared candidates.
  const policyByRestaurant = new Map<
    string,
    Awaited<ReturnType<typeof prisma.sharedRiderPolicy.findMany>>[number]
  >();
  const otherRestaurantIds = [
    ...new Set(
      riders
        .filter((r) => r.restaurantId && r.restaurantId !== sourceRestaurantId)
        .map((r) => r.restaurantId as string),
    ),
  ];
  if (otherRestaurantIds.length > 0) {
    const policies = await prisma.sharedRiderPolicy.findMany({
      where: { restaurantId: { in: otherRestaurantIds } },
    });
    for (const p of policies) policyByRestaurant.set(p.restaurantId, p);
  }

  return riders.map((rider) => {
    const isShared = rider.restaurantId !== sourceRestaurantId;
    const cand: RiderCandidate = {
      rider,
      isSharedRider: isShared,
      activeJobCount: activeByRider.get(rider.id) ?? 0,
      committedDropoff: committedDropoffByRider.get(rider.id) ?? null,
    };
    // The governing policy for a shared rider is their HOME restaurant's lender policy.
    const policy =
      isShared && rider.restaurantId ? (policyByRestaurant.get(rider.restaurantId) ?? null) : null;
    return scoreCandidate(cand, {
      pickup,
      sourceRestaurantId,
      isCod,
      policy,
    });
  });
}

// ─────────────────────────── queries ───────────────────────────

builder.queryFields((t) => ({
  // Lender policy for a restaurant (null until configured). Restaurant-scoped.
  sharedRiderPolicy: t.prismaField({
    type: "SharedRiderPolicy",
    nullable: true,
    authScopes: { restaurantMember: true },
    args: { restaurantId: t.arg.string({ required: true }) },
    resolve: async (query, _root, args, ctx) => {
      await assertRestaurantMember(ctx, args.restaurantId);
      return prisma.sharedRiderPolicy.findUnique({
        ...query,
        where: { restaurantId: args.restaurantId },
      });
    },
  }),

  // Preview the scored dispatch shortlist for an order without persisting offers. Includes
  // ineligible riders (with rejectReason) so the console can explain the shortlist.
  sharedRiderCandidates: t.field({
    type: [ScoredCandidateType],
    authScopes: { restaurantMember: true },
    args: { orderId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      const order = await assertOrderBranchMember(ctx, args.orderId);
      const full = await loadOrderForDispatch(order.id);
      const scored = await buildScoredShortlist(full!);
      // Best score first; eligible ranked ahead of rejected.
      return scored.sort((a, b) => Number(b.eligible) - Number(a.eligible) || b.score - a.score);
    },
  }),

  // Offers already generated for an order's task (audit / live board).
  offersForOrder: t.prismaField({
    type: ["DeliveryOffer"],
    authScopes: { restaurantMember: true },
    args: { orderId: t.arg.string({ required: true }) },
    resolve: async (query, _root, args, ctx) => {
      await assertOrderBranchMember(ctx, args.orderId);
      const task = await prisma.deliveryTask.findUnique({ where: { orderId: args.orderId } });
      if (!task) return [];
      return prisma.deliveryOffer.findMany({
        ...query,
        where: { taskId: task.id },
        orderBy: { rank: "asc" },
      });
    },
  }),

  // A rider's live (pending, unexpired) shared offers — the rider app polls/subscribes this.
  mySharedOffers: t.prismaField({
    type: ["DeliveryOffer"],
    authScopes: { rider: true },
    resolve: (query, _root, _args, ctx) =>
      prisma.deliveryOffer.findMany({
        ...query,
        where: { riderId: ctx.riderId!, status: "pending", expiresAt: { gt: new Date() } },
        orderBy: { offeredAt: "desc" },
      }),
  }),
}));

// ─────────────────────────── mutations ───────────────────────────

builder.mutationFields((t) => ({
  // Upsert a restaurant's lender policy (opt-in + limits + per-shift veto). Restaurant-scoped.
  setSharedRiderPolicy: t.prismaField({
    type: "SharedRiderPolicy",
    authScopes: { restaurantMember: true },
    args: {
      restaurantId: t.arg.string({ required: true }),
      sharingEnabled: t.arg.boolean({ required: false }),
      vetoActive: t.arg.boolean({ required: false }),
      maxActiveJobs: t.arg.int({ required: false }),
      maxPickupMeters: t.arg.int({ required: false }),
      maxIncrementalDelaySec: t.arg.int({ required: false }),
      codTrustThreshold: t.arg.int({ required: false }),
    },
    resolve: async (query, _root, args, ctx) => {
      await assertRestaurantMember(ctx, args.restaurantId);
      const patch = {
        ...(args.sharingEnabled != null ? { sharingEnabled: args.sharingEnabled } : {}),
        ...(args.vetoActive != null ? { vetoActive: args.vetoActive } : {}),
        ...(args.maxActiveJobs != null ? { maxActiveJobs: args.maxActiveJobs } : {}),
        ...(args.maxPickupMeters != null ? { maxPickupMeters: args.maxPickupMeters } : {}),
        ...(args.maxIncrementalDelaySec != null
          ? { maxIncrementalDelaySec: args.maxIncrementalDelaySec }
          : {}),
        ...(args.codTrustThreshold != null ? { codTrustThreshold: args.codTrustThreshold } : {}),
      };
      return prisma.sharedRiderPolicy.upsert({
        ...query,
        where: { restaurantId: args.restaurantId },
        update: patch,
        create: { restaurantId: args.restaurantId, ...patch },
      });
    },
  }),

  // Rider consent to receive shared-work offers from other restaurants (opt-in everywhere).
  setRiderSharedOptIn: t.field({
    type: "Boolean",
    authScopes: { rider: true },
    args: { optIn: t.arg.boolean({ required: true }) },
    resolve: async (_root, args, ctx) => {
      await prisma.rider.update({
        where: { id: ctx.riderId! },
        data: { sharedOptIn: args.optIn },
      });
      return args.optIn;
    },
  }),

  // Generate offers to the top shortlisted riders for an order's delivery task. Creates the
  // task in `offered` state if needed (mirrors offerTask) and writes one DeliveryOffer per
  // shortlisted rider with a short (OFFER_TTL_SECONDS) expiry. Every offer is recorded for
  // fairness analytics. The first valid accept locks the task (acceptSharedOffer).
  generateSharedOffers: t.field({
    type: [ScoredCandidateType],
    authScopes: { restaurantMember: true },
    args: {
      orderId: t.arg.string({ required: true }),
      // Cap how many top candidates actually receive an offer (defaults to the shortlist).
      limit: t.arg.int({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      const order = await assertOrderBranchMember(ctx, args.orderId);
      const full = (await loadOrderForDispatch(order.id))!;
      const scored = await buildScoredShortlist(full);
      const shortlist = rankCandidates(scored);
      const take =
        args.limit != null ? Math.max(0, Math.min(args.limit, shortlist.length)) : shortlist.length;
      const winners = shortlist.slice(0, take);
      if (winners.length === 0) return scored;

      const now = new Date();
      const expiresAt = new Date(now.getTime() + OFFER_TTL_SECONDS * 1000);

      await prisma.$transaction(async (tx) => {
        // Ensure a DeliveryTask exists and is still open for offering. If the order already has
        // a task that is assigned/arrived/delivered (a rider committed) or was unassigned by the
        // decline flow, creating pending offers would either be un-acceptable (acceptSharedOffer
        // requires status `offered` + riderId null) or race an already-locked task — so re-open a
        // stale `unassigned` task and refuse to offer on a committed one.
        const existing = await tx.deliveryTask.findUnique({ where: { orderId: order.id } });
        let task = existing;
        if (!existing) {
          task = await tx.deliveryTask.create({
            data: {
              orderId: order.id,
              status: "offered",
              offeredAt: now,
              codAmountMinor: order.paymentMode === "cod" ? order.grandTotalMinor : 0,
            },
          });
        } else if (existing.status === "unassigned") {
          task = await tx.deliveryTask.update({
            where: { id: existing.id },
            data: { status: "offered", offeredAt: now, riderId: null },
          });
        } else if (existing.status !== "offered") {
          throw new GraphQLError("This order's delivery is already assigned to a rider.", {
            extensions: { code: "conflict" },
          });
        }
        if (!task)
          throw new GraphQLError("We couldn't set up this delivery. Please try again.", {
            extensions: { code: "invalid_state" },
          });
        // Supersede any still-pending offers for this task before re-offering.
        await tx.deliveryOffer.updateMany({
          where: { taskId: task.id, status: "pending" },
          data: { status: "withdrawn", respondedAt: now },
        });
        for (const [i, w] of winners.entries()) {
          await tx.deliveryOffer.create({
            data: {
              taskId: task.id,
              riderId: w.riderId,
              status: "pending",
              matchedScore: w.score,
              rank: i,
              pickupMeters: w.pickupMeters >= 0 ? w.pickupMeters : null,
              incrementalDelaySec: w.incrementalDelaySec >= 0 ? w.incrementalDelaySec : null,
              isSharedRider: w.isSharedRider,
              expiresAt,
            },
          });
        }
      });

      return winners;
    },
  }),

  // Rider accepts a shared offer. The FIRST valid accept for a task wins and LOCKS the task
  // to that rider (task → assigned, offer → accepted, sibling pending offers → withdrawn). The
  // conditional updateMany guards make this race-safe: a second accept, an expired offer, or an
  // already-locked task all fail cleanly.
  acceptSharedOffer: t.prismaField({
    type: "DeliveryOffer",
    authScopes: { rider: true },
    args: { offerId: t.arg.string({ required: true }) },
    resolve: async (query, _root, args, ctx) => {
      const offer = await prisma.deliveryOffer.findUnique({
        where: { id: args.offerId },
        include: { task: true },
      });
      if (!offer)
        throw new GraphQLError("We couldn't find that offer.", {
          extensions: { code: "not_found" },
        });
      if (offer.riderId !== ctx.riderId)
        throw new GraphQLError("This offer isn't assigned to you.", {
          extensions: { code: "forbidden" },
        });
      if (offer.status !== "pending")
        throw new GraphQLError("This offer is no longer available.", {
          extensions: { code: "conflict" },
        });
      if (offer.expiresAt.getTime() <= Date.now())
        throw new GraphQLError("This offer has expired.", { extensions: { code: "conflict" } });

      const now = new Date();
      await prisma.$transaction(async (tx) => {
        // Re-validate rider capacity INSIDE the tx: two offers for the same rider (each scored
        // while activeJobCount was 0) could both otherwise be accepted and overcommit the rider
        // past the lender's ceiling. Count any OTHER active pre-pickup task this rider already
        // holds and refuse the accept if one exists (default ceiling = 1 committed job).
        const alreadyCommitted = await tx.deliveryTask.count({
          where: {
            riderId: offer.riderId,
            status: { in: ["assigned", "arrived_pickup"] },
            NOT: { id: offer.taskId },
          },
        });
        if (alreadyCommitted > 0) {
          throw new GraphQLError(
            "You already have an active job, so you can't take another one right now.",
            { extensions: { code: "not_allowed" } },
          );
        }
        // Lock the task to this rider ONLY if it is still open (offered + no rider committed).
        const locked = await tx.deliveryTask.updateMany({
          where: { id: offer.taskId, status: "offered", riderId: null },
          data: { status: "assigned", riderId: offer.riderId, acceptedAt: now, assignedAt: now },
        });
        if (locked.count === 0)
          throw new GraphQLError("This job has already been taken by another rider.", {
            extensions: { code: "conflict" },
          });
        // Accept THIS offer only if still pending AND unexpired — enforcing the TTL at the point
        // of locking closes the window where a request that started just before expiry lands here
        // after the offer has elapsed.
        const won = await tx.deliveryOffer.updateMany({
          where: { id: offer.id, status: "pending", expiresAt: { gt: now } },
          data: { status: "accepted", respondedAt: now },
        });
        if (won.count === 0)
          throw new GraphQLError("This offer is no longer available.", {
            extensions: { code: "conflict" },
          });
        // Withdraw sibling pending offers for the same task.
        await tx.deliveryOffer.updateMany({
          where: { taskId: offer.taskId, status: "pending", id: { not: offer.id } },
          data: { status: "withdrawn", respondedAt: now },
        });
        await tx.deliveryEvent.create({
          data: { taskId: offer.taskId, type: "accepted", actorUserId: ctx.userId },
        });
      });

      // Mirror acceptTask: move the order to `rider_assigned` so the restaurant's assignRider
      // flow (guarded by expectedFrom: "ready_for_pickup") can no longer overwrite the task now
      // that a shared rider has committed. Best-effort: if the order isn't ready yet the task
      // lock still stands and the order advances on its own lifecycle.
      try {
        await transition(
          offer.task.orderId,
          "rider_assigned",
          { userId: ctx.userId, role: "rider" },
          {
            expectedFrom: "ready_for_pickup",
          },
        );
      } catch {
        // Order not in ready_for_pickup (e.g. offered pre-ready) — the task lock is authoritative.
      }

      return prisma.deliveryOffer.findUniqueOrThrow({ ...query, where: { id: offer.id } });
    },
  }),

  // Rider declines a shared offer (recorded for fairness analytics; does not touch the task).
  declineSharedOffer: t.field({
    type: "Boolean",
    authScopes: { rider: true },
    args: { offerId: t.arg.string({ required: true }), reason: t.arg.string({ required: false }) },
    resolve: async (_root, args, ctx) => {
      const res = await prisma.deliveryOffer.updateMany({
        where: { id: args.offerId, riderId: ctx.riderId!, status: "pending" },
        data: { status: "declined", respondedAt: new Date(), declineReason: args.reason ?? null },
      });
      if (res.count === 0)
        throw new GraphQLError("This offer is no longer available.", {
          extensions: { code: "conflict" },
        });
      return true;
    },
  }),

  // Ledger-split hook for a DELIVERED shared job. Reallocates a cut of the delivery fee the
  // seller received at settlement to the platform dispatch fee, the lender restaurant's
  // payable, and the rider bonus (double-entry, balanced). Additive: leaves normal settlement
  // (onOrderDelivered) untouched. postDispatchSplit itself is a no-op for a seller-owned rider
  // (no lender) and is idempotent per order (safe to call more than once). Restaurant-scoped
  // to the seller. (Codex #126)
  postSharedDispatchSplit: t.field({
    type: "String",
    nullable: true,
    authScopes: { restaurantMember: true },
    args: { orderId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      const order = await assertOrderBranchMember(ctx, args.orderId);
      const task = await prisma.deliveryTask.findUnique({
        where: { orderId: order.id },
        include: { rider: true },
      });
      if (!task || task.status !== "delivered") {
        throw new GraphQLError("This order hasn't been delivered yet.", {
          extensions: { code: "invalid_state" },
        });
      }
      if (!task.rider)
        throw new GraphQLError("This delivery doesn't have a rider assigned.", {
          extensions: { code: "invalid_state" },
        });

      const sourceRestaurantId = order.branch.restaurantId;
      const lenderRestaurantId =
        task.rider.restaurantId && task.rider.restaurantId !== sourceRestaurantId
          ? task.rider.restaurantId
          : null;

      return prisma.$transaction((tx) =>
        postDispatchSplit(tx, {
          orderId: order.id,
          orderCode: order.code,
          deliveryFeeMinor: order.deliveryFeeMinor,
          sourceRestaurantId,
          lenderRestaurantId,
          riderId: task.rider!.id,
        }),
      );
    },
  }),
}));
