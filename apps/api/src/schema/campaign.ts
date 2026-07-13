// Promoted deals / featured placements (#22).
//
// Restaurant console: create/submit campaigns (featured_slot | deal_badge), see the tiered
// daily rate + a wallet balance check. Admin: approval queue + approve/reject (audited).
// Daily accrual is triggered by runCampaignAccrual (see campaignService — no cron in MVP).
// Customer: featuredBranches surfaces active featured_slot campaigns above organic results,
// with an SLA guardrail so operationally poor restaurants can't buy top placement.
import { prisma } from "@fd/db";
import { GraphQLError } from "graphql";
import type { AppContext } from "../context.js";
import { accountBalance } from "../services/ledgerService.js";
import {
  accrueCampaigns,
  campaignWindowContains,
  dailyRateFor,
} from "../services/campaignService.js";
import { builder } from "./builder.js";

// Placement below this acceptance-SLA (over the trailing window) is capped: a paid
// featured slot still shows but is de-ranked to the tail of the promoted rail, so
// promotions never fully override operational quality (kickoff-research guardrail).
const SLA_CAP_PCT = 80;

async function acceptanceSlaPct(restaurantId: string, days = 30): Promise<number> {
  const since = new Date(Date.now() - days * 24 * 60 * 60_000);
  const orders = await prisma.order.findMany({
    where: { branch: { restaurantId }, placedAt: { gte: since } },
    select: { acceptedAt: true, acceptDeadlineAt: true, status: true },
  });
  const decided = orders.filter(
    (o) => o.acceptedAt || ["rejected", "auto_expired"].includes(o.status),
  );
  if (decided.length === 0) return 100;
  const inSla = decided.filter((o) => o.acceptedAt && o.acceptedAt <= o.acceptDeadlineAt);
  return (inSla.length / decided.length) * 100;
}

// Double-billing guard (#117): a restaurant may only have ONE live featured_slot at a
// time — accrueCampaigns bills per active campaign, so two overlapping featured slots
// would debit the wallet twice for a single promoted rail. `pending_approval` counts too
// so a second slot can't be queued to slip through right behind the first. `exceptId`
// lets a campaign re-check without matching itself.
async function assertNoActiveFeaturedSlot(restaurantId: string, exceptId?: string) {
  const existing = await prisma.campaign.findFirst({
    where: {
      restaurantId,
      type: "featured_slot",
      status: { in: ["active", "pending_approval"] },
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
  });
  if (existing) {
    throw new GraphQLError(
      "This restaurant already has a featured placement live or awaiting approval. End it before starting another.",
      { extensions: { code: "duplicate_active_placement" } },
    );
  }
}

async function assertRestaurantMember(ctx: AppContext, restaurantId: string) {
  if (!ctx.restaurantIds.includes(restaurantId) && !ctx.hasRole("admin")) {
    throw new GraphQLError("You don't have access to this restaurant.", {
      extensions: { code: "forbidden" },
    });
  }
}

async function audit(
  actorUserId: string | null,
  action: string,
  subjectId: string,
  before: unknown,
  after: unknown,
) {
  await prisma.auditLog.create({
    data: {
      actorUserId,
      actorRole: "admin",
      action,
      subjectType: "Campaign",
      subjectId,
      beforeJson: before as never,
      afterJson: after as never,
    },
  });
}

builder.prismaObject("Campaign", {
  fields: (t) => ({
    id: t.exposeID("id"),
    type: t.exposeString("type"),
    status: t.exposeString("status"),
    dailyRateMinor: t.exposeInt("dailyRateMinor"),
    label: t.exposeString("label", { nullable: true }),
    rejectedReason: t.exposeString("rejectedReason", { nullable: true }),
    startsAt: t.field({ type: "DateTime", nullable: true, resolve: (c) => c.startsAt }),
    endsAt: t.field({ type: "DateTime", nullable: true, resolve: (c) => c.endsAt }),
    approvedAt: t.field({ type: "DateTime", nullable: true, resolve: (c) => c.approvedAt }),
    createdAt: t.field({ type: "DateTime", resolve: (c) => c.createdAt }),
    restaurant: t.relation("restaurant"),
  }),
});

// Featured placement surfaced to customers: the boosted branch + whether the SLA
// guardrail capped its rank. `label` is the campaign's promo copy (may be null).
const FeaturedPlacement = builder.objectRef<{
  campaignId: string;
  branchId: string;
  label: string | null;
  slaCapped: boolean;
}>("FeaturedPlacement");
FeaturedPlacement.implement({
  fields: (t) => ({
    campaignId: t.exposeString("campaignId"),
    label: t.exposeString("label", { nullable: true }),
    slaCapped: t.exposeBoolean("slaCapped"),
    branch: t.prismaField({
      type: "Branch",
      resolve: (query, p) =>
        prisma.branch.findUniqueOrThrow({ ...query, where: { id: p.branchId } }),
    }),
  }),
});

const CampaignAccrualResult = builder.objectRef<{
  campaignId: string;
  restaurantId: string;
  amountMinor: number;
  ended: boolean;
}>("CampaignAccrualResult");
CampaignAccrualResult.implement({
  fields: (t) => ({
    campaignId: t.exposeString("campaignId"),
    restaurantId: t.exposeString("restaurantId"),
    amountMinor: t.exposeInt("amountMinor"),
    ended: t.exposeBoolean("ended"),
  }),
});

builder.queryFields((t) => ({
  // Restaurant-console list of a restaurant's own campaigns, newest first.
  myCampaigns: t.prismaField({
    type: ["Campaign"],
    authScopes: { restaurantMember: true },
    args: { restaurantId: t.arg.string({ required: true }) },
    resolve: async (query, _root, args, ctx) => {
      await assertRestaurantMember(ctx, args.restaurantId);
      return prisma.campaign.findMany({
        ...query,
        where: { restaurantId: args.restaurantId },
        orderBy: { createdAt: "desc" },
      });
    },
  }),

  // The daily rate this restaurant would pay for a featured slot at its current tier.
  featuredSlotRate: t.int({
    authScopes: { restaurantMember: true },
    args: { restaurantId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      await assertRestaurantMember(ctx, args.restaurantId);
      const r = await prisma.restaurant.findUniqueOrThrow({ where: { id: args.restaurantId } });
      return dailyRateFor(r.tier, "featured_slot");
    },
  }),

  // Admin approval queue: campaigns awaiting a decision, oldest first.
  campaignApprovalQueue: t.prismaField({
    type: ["Campaign"],
    authScopes: { admin: true },
    resolve: (query) =>
      prisma.campaign.findMany({
        ...query,
        where: { status: "pending_approval" },
        orderBy: { createdAt: "asc" },
      }),
  }),

  // Customer feed: active featured-slot placements, one per branch. The SLA guardrail
  // marks (and de-ranks) placements from restaurants below the acceptance threshold so
  // paid promotion never fully overrides operational quality.
  featuredBranches: t.field({
    type: [FeaturedPlacement],
    resolve: async () => {
      const now = new Date();
      const campaigns = await prisma.campaign.findMany({
        where: { status: "active", type: "featured_slot" },
        include: { restaurant: { include: { branches: { select: { id: true } } } } },
        orderBy: { createdAt: "desc" },
      });
      const seen = new Set<string>();
      const out: Array<{
        campaignId: string;
        branchId: string;
        label: string | null;
        slaCapped: boolean;
        rank: number;
      }> = [];
      for (const c of campaigns) {
        if (!campaignWindowContains(c, now)) continue;
        if (c.restaurant.status !== "approved") continue;
        // Emit a placement for EVERY branch of the campaign, not just branches[0] (#117):
        // a chain campaign should surface for whichever of its branches the user is near.
        // The caller intersects these against the in-range feed (browseBranches), so a
        // branch that doesn't reach the user is dropped client-side; here we just fan out.
        // SLA is per-restaurant, so compute it once per campaign.
        if (c.restaurant.branches.length === 0) continue;
        const slaCapped = (await acceptanceSlaPct(c.restaurantId)) < SLA_CAP_PCT;
        for (const branch of c.restaurant.branches) {
          if (seen.has(branch.id)) continue;
          seen.add(branch.id);
          out.push({
            campaignId: c.id,
            branchId: branch.id,
            label: c.label ?? null,
            slaCapped,
            rank: c.dailyRateMinor,
          });
        }
      }
      // Capped placements sink below healthy ones; within a group, higher spend ranks first.
      return out
        .sort((a, b) => {
          if (a.slaCapped !== b.slaCapped) return a.slaCapped ? 1 : -1;
          return b.rank - a.rank;
        })
        .map(({ campaignId, branchId, label, slaCapped }) => ({
          campaignId,
          branchId,
          label,
          slaCapped,
        }));
    },
  }),
}));

builder.mutationFields((t) => ({
  // Create a draft campaign. The daily rate is computed server-side from the restaurant's
  // tier + type so the client can never set its own price.
  createCampaign: t.prismaField({
    type: "Campaign",
    authScopes: { restaurantMember: true },
    args: {
      restaurantId: t.arg.string({ required: true }),
      type: t.arg.string({ required: true }),
      label: t.arg.string({ required: false }),
      startsAt: t.arg({ type: "DateTime", required: false }),
      endsAt: t.arg({ type: "DateTime", required: false }),
    },
    resolve: async (query, _root, args, ctx) => {
      await assertRestaurantMember(ctx, args.restaurantId);
      if (!["featured_slot", "deal_badge"].includes(args.type)) {
        throw new GraphQLError("Please choose a valid campaign type.", {
          extensions: { code: "validation_error" },
        });
      }
      const starts = args.startsAt ?? null;
      const ends = args.endsAt ?? null;
      if (starts && ends && ends <= starts) {
        throw new GraphQLError("The end date must be after the start date.", {
          extensions: { code: "validation_error" },
        });
      }
      const r = await prisma.restaurant.findUniqueOrThrow({ where: { id: args.restaurantId } });
      const dailyRateMinor = await dailyRateFor(
        r.tier,
        args.type as "featured_slot" | "deal_badge",
      );
      return prisma.campaign.create({
        ...query,
        data: {
          restaurantId: args.restaurantId,
          type: args.type as "featured_slot" | "deal_badge",
          status: "draft",
          dailyRateMinor,
          label: args.label?.trim() || null,
          startsAt: starts,
          endsAt: ends,
        },
      });
    },
  }),

  // Submit a draft for admin approval, after a wallet balance check: a chain paying a
  // daily rate must have enough payable balance to cover at least one day, so it can't
  // run up an unbacked debt. Rs 0 campaigns (small-business / deal_badge) skip the check.
  submitCampaign: t.prismaField({
    type: "Campaign",
    authScopes: { restaurantMember: true },
    args: { id: t.arg.string({ required: true }) },
    resolve: async (query, _root, args, ctx) => {
      const c = await prisma.campaign.findUnique({ where: { id: args.id } });
      if (!c)
        throw new GraphQLError("We couldn't find that campaign.", {
          extensions: { code: "not_found" },
        });
      await assertRestaurantMember(ctx, c.restaurantId);
      if (c.status !== "draft" && c.status !== "rejected") {
        throw new GraphQLError("Only draft or rejected campaigns can be submitted for approval.", {
          extensions: { code: "invalid_state" },
        });
      }
      // #117: block a second featured slot from entering the approval/active pipeline.
      if (c.type === "featured_slot") await assertNoActiveFeaturedSlot(c.restaurantId, c.id);
      if (c.dailyRateMinor > 0) {
        const balance = await prisma.$transaction((tx) =>
          accountBalance(tx as never, `restaurant:${c.restaurantId}:payable`),
        );
        if (balance < c.dailyRateMinor) {
          throw new GraphQLError(
            "Your wallet balance is too low to cover one day of this campaign. Please top up first.",
            { extensions: { code: "invalid_state" } },
          );
        }
      }
      return prisma.campaign.update({
        ...query,
        where: { id: args.id },
        data: { status: "pending_approval", rejectedReason: null },
      });
    },
  }),

  // Restaurant or admin cancels a campaign (draft/pending/active → ended).
  cancelCampaign: t.prismaField({
    type: "Campaign",
    authScopes: { restaurantMember: true },
    args: { id: t.arg.string({ required: true }) },
    resolve: async (query, _root, args, ctx) => {
      const c = await prisma.campaign.findUnique({ where: { id: args.id } });
      if (!c)
        throw new GraphQLError("We couldn't find that campaign.", {
          extensions: { code: "not_found" },
        });
      await assertRestaurantMember(ctx, c.restaurantId);
      return prisma.campaign.update({
        ...query,
        where: { id: args.id },
        data: { status: "ended" },
      });
    },
  }),

  approveCampaign: t.prismaField({
    type: "Campaign",
    authScopes: { admin: true },
    args: { id: t.arg.string({ required: true }) },
    resolve: async (query, _root, args, ctx) => {
      const c = await prisma.campaign.findUnique({ where: { id: args.id } });
      if (!c)
        throw new GraphQLError("We couldn't find that campaign.", {
          extensions: { code: "not_found" },
        });
      if (c.status !== "pending_approval")
        throw new GraphQLError("This campaign is not awaiting approval.", {
          extensions: { code: "invalid_state" },
        });
      // #117: re-check at approval time — two slots could have been submitted before
      // either was approved. Excludes this campaign so it doesn't match itself.
      if (c.type === "featured_slot") await assertNoActiveFeaturedSlot(c.restaurantId, c.id);
      const updated = await prisma.campaign.update({
        ...query,
        where: { id: args.id },
        data: {
          status: "active",
          approvedByUserId: ctx.userId,
          approvedAt: new Date(),
          rejectedReason: null,
        },
      });
      await audit(
        ctx.userId,
        "campaign.approve",
        args.id,
        { status: c.status },
        { status: "active" },
      );
      return updated;
    },
  }),

  rejectCampaign: t.prismaField({
    type: "Campaign",
    authScopes: { admin: true },
    args: { id: t.arg.string({ required: true }), reason: t.arg.string({ required: true }) },
    resolve: async (query, _root, args, ctx) => {
      if (!args.reason.trim())
        throw new GraphQLError("Please provide a reason for rejecting this campaign.", {
          extensions: { code: "validation_error" },
        });
      const c = await prisma.campaign.findUnique({ where: { id: args.id } });
      if (!c)
        throw new GraphQLError("We couldn't find that campaign.", {
          extensions: { code: "not_found" },
        });
      if (c.status !== "pending_approval")
        throw new GraphQLError("This campaign is not awaiting approval.", {
          extensions: { code: "invalid_state" },
        });
      const updated = await prisma.campaign.update({
        ...query,
        where: { id: args.id },
        data: { status: "rejected", rejectedReason: args.reason },
      });
      await audit(
        ctx.userId,
        "campaign.reject",
        args.id,
        { status: c.status },
        { status: "rejected", reason: args.reason },
      );
      return updated;
    },
  }),

  // Run the daily accrual (idempotent; no cron in MVP so admin triggers it). Mirrors
  // runPayoutBatch: each active campaign debits payable / credits platform revenue once
  // per UTC day, and finished campaigns are retired.
  runCampaignAccrual: t.field({
    type: [CampaignAccrualResult],
    authScopes: { admin: true },
    resolve: async (_root, _args, ctx) => {
      const results = await accrueCampaigns();
      for (const r of results.filter((x) => x.amountMinor > 0 || x.ended)) {
        await audit(ctx.userId, r.ended ? "campaign.end" : "campaign.accrue", r.campaignId, null, {
          amountMinor: r.amountMinor,
          ended: r.ended,
        });
      }
      return results;
    },
  }),
}));
