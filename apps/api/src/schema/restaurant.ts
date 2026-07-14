// Restaurant console domain: live order board, menu CRUD + publish, riders, wallet,
// onboarding, branch settings. Every resolver verifies branch/restaurant membership.
import { prisma, withTenant } from "@fd/db";
import { GraphQLError } from "graphql";
import type { AppContext } from "../context.js";
import { transition, type Actor } from "../services/orderService.js";
import { recordCancellation, evaluateOrderCancellation } from "../services/policyService.js";
import { publishOrderChanged } from "../pubsub.js";
import { formatRs } from "@fd/shared";
import { accountBalance, postLedgerTx, postItemRemovalRefund } from "../services/ledgerService.js";
import { ensureDraft, publishDraft } from "../services/menuService.js";
import { settlementReportCsv, eimsInvoiceCsv } from "../services/csvExport.js";
import { builder } from "./builder.js";

// Build a Prisma date-range filter for a timestamp column, omitting unset bounds.
function dateRangeWhere(field: string, from?: Date | null, to?: Date | null) {
  if (!from && !to) return {};
  return { [field]: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } };
}

async function assertBranchMember(ctx: AppContext, branchId: string) {
  const branch = await prisma.branch.findUnique({ where: { id: branchId } });
  if (!branch)
    throw new GraphQLError("We couldn't find that branch.", {
      extensions: { code: "not_found" },
    });
  if (!ctx.restaurantIds.includes(branch.restaurantId) && !ctx.hasRole("admin")) {
    throw new GraphQLError("You don't have access to this restaurant.", {
      extensions: { code: "forbidden" },
    });
  }
  return branch;
}

async function assertRestaurantMember(ctx: AppContext, restaurantId: string) {
  const restaurant = await prisma.restaurant.findUnique({ where: { id: restaurantId } });
  if (!restaurant)
    throw new GraphQLError("We couldn't find that restaurant.", {
      extensions: { code: "not_found" },
    });
  if (!ctx.restaurantIds.includes(restaurantId) && !ctx.hasRole("admin")) {
    throw new GraphQLError("You don't have access to this restaurant.", {
      extensions: { code: "forbidden" },
    });
  }
  return restaurant;
}

// Stricter than membership: only the restaurant_owner (or admin) — used to keep money and
// business config out of restaurant_staff's hands (#156).
function assertRestaurantOwner(ctx: AppContext, restaurantId: string) {
  const isOwner = ctx.roles.some(
    (r) => r.role === "restaurant_owner" && r.restaurantId === restaurantId,
  );
  if (!isOwner && !ctx.hasRole("admin")) {
    throw new GraphQLError("Only the restaurant owner can do this.", {
      extensions: { code: "forbidden" },
    });
  }
}

// Owner-level guard for branch-scoped surfaces (#204). `restaurant_staff` run the order
// board (accept/prepare/ready/86) but must not reach menu editing — nav-hiding alone left
// those resolvers open to a direct call, so gate them here as well.
async function assertBranchOwner(ctx: AppContext, branchId: string) {
  const branch = await assertBranchMember(ctx, branchId);
  assertRestaurantOwner(ctx, branch.restaurantId);
  return branch;
}

async function assertOrderBranchMember(ctx: AppContext, orderId: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { branch: true },
  });
  if (!order)
    throw new GraphQLError("We couldn't find that order.", {
      extensions: { code: "not_found" },
    });
  if (!ctx.restaurantIds.includes(order.branch.restaurantId) && !ctx.hasRole("admin")) {
    throw new GraphQLError("You don't have access to this restaurant.", {
      extensions: { code: "forbidden" },
    });
  }
  return order;
}

function restaurantActor(ctx: AppContext): Actor {
  return {
    userId: ctx.userId,
    role: ctx.hasRole("restaurant_owner") ? "restaurant_owner" : "restaurant_staff",
  };
}

// One open window for setBranchHours: minutes are since-midnight (PKT), 0..1439.
// closeMinute <= openMinute means the window spans midnight (see branchHoursOpenState).
const BranchHoursInput = builder.inputType("BranchHoursInput", {
  fields: (t) => ({
    dayOfWeek: t.int({ required: true }),
    openMinute: t.int({ required: true }),
    closeMinute: t.int({ required: true }),
  }),
});

builder.prismaObject("RiderVerificationDoc", {
  fields: (t) => ({
    id: t.exposeID("id"),
    kind: t.exposeString("kind"),
    createdAt: t.field({ type: "DateTime", resolve: (d) => d.createdAt }),
    asset: t.relation("asset"),
  }),
});

builder.prismaObject("Rider", {
  fields: (t) => ({
    id: t.exposeID("id"),
    riderType: t.exposeString("riderType"),
    verificationStatus: t.exposeString("verificationStatus"),
    trustScore: t.exposeInt("trustScore"),
    vehicleType: t.exposeString("vehicleType", { nullable: true }),
    vehiclePlate: t.exposeString("vehiclePlate", { nullable: true }),
    trainingCompleted: t.exposeBoolean("trainingCompleted"),
    agreementAccepted: t.exposeBoolean("agreementAccepted"),
    sharedModeEnabled: t.exposeBoolean("sharedModeEnabled"),
    // Whether this rider is barred from carrying COD orders (#118). Dispatchers need this
    // on the roster so the order board can flag/disable a COD-disabled rider for a COD
    // order before assignment fails with `rider_cod_disabled`. Operational (not identity)
    // data, so — unlike verificationDocs — it's safe to expose to the restaurant roster.
    codDisabled: t.exposeBoolean("codDisabled"),
    verifiedAt: t.field({ type: "DateTime", nullable: true, resolve: (r) => r.verifiedAt }),
    rejectionReason: t.exposeString("rejectionReason", { nullable: true }),
    user: t.relation("user"),
    // Identity documents (CNIC/photo) are the admin review queue's concern only. The
    // restaurant roster (branchRiders) shares this Rider type but must never expose these
    // URLs to restaurant owners/staff, so gate the field to admins.
    verificationDocs: t.relation("verificationDocs", { authScopes: { admin: true } }),
    isOnline: t.boolean({
      resolve: async (rider) => {
        const a = await prisma.riderAvailability.findUnique({ where: { riderId: rider.id } });
        return a?.isOnline ?? false;
      },
    }),
  }),
});

const LedgerEntryType = builder.prismaObject("LedgerEntry", {
  fields: (t) => ({
    id: t.exposeID("id"),
    txId: t.exposeString("txId"),
    debitMinor: t.exposeInt("debitMinor"),
    creditMinor: t.exposeInt("creditMinor"),
    memo: t.exposeString("memo"),
    createdAt: t.field({ type: "DateTime", resolve: (e) => e.createdAt }),
  }),
});

builder.prismaObject("Payout", {
  fields: (t) => ({
    id: t.exposeID("id"),
    amountMinor: t.exposeInt("amountMinor"),
    status: t.exposeString("status"),
    reference: t.exposeString("reference", { nullable: true }),
    periodStart: t.field({ type: "DateTime", resolve: (p) => p.periodStart }),
    periodEnd: t.field({ type: "DateTime", resolve: (p) => p.periodEnd }),
    paidAt: t.field({ type: "DateTime", nullable: true, resolve: (p) => p.paidAt }),
  }),
});

// Owner analytics (#21): a top-selling item, tallied by snapshot name (see popularItems
// for why name, not id) with its units sold and gross revenue over the window.
const AnalyticsTopItem = builder.objectRef<{
  name: string;
  qty: number;
  revenueMinor: number;
}>("AnalyticsTopItem");
AnalyticsTopItem.implement({
  fields: (t) => ({
    name: t.exposeString("name"),
    qty: t.exposeInt("qty"),
    revenueMinor: t.exposeInt("revenueMinor"),
  }),
});

// One day's revenue in the trailing window (#61). `date` is an ISO yyyy-mm-dd in PKT.
const AnalyticsRevenueDay = builder.objectRef<{
  date: string;
  revenueMinor: number;
  orders: number;
}>("AnalyticsRevenueDay");
AnalyticsRevenueDay.implement({
  fields: (t) => ({
    date: t.exposeString("date"),
    revenueMinor: t.exposeInt("revenueMinor"),
    orders: t.exposeInt("orders"),
  }),
});

// One cancellation-reason bucket (#61): the reason code and how many times it occurred.
const AnalyticsCancelReason = builder.objectRef<{ reason: string; count: number }>(
  "AnalyticsCancelReason",
);
AnalyticsCancelReason.implement({
  fields: (t) => ({
    reason: t.exposeString("reason"),
    count: t.exposeInt("count"),
  }),
});

// Read-only sales summary over a trailing window, computed from delivered orders.
// ordersByDayOfWeek is indexed 0=Sunday…6=Saturday; ordersByHour is 0…23. Both are
// bucketed in PKT so they line up with the branch's opening hours.
//
// #61 deepens this: bottomItems (worst sellers), avgAcceptSeconds + an acceptance-time
// trend, a cancellation-reason breakdown, repeat-customer rate, and revenue by day.
// Everything is still computed live from Order/OrderItem/Cancellation — no stored
// aggregates, no schema change for analytics.
type AnalyticsResult = {
  totalOrders: number;
  totalRevenueMinor: number;
  avgOrderValueMinor: number;
  ordersByDayOfWeek: number[];
  ordersByHour: number[];
  topItems: Array<{ name: string; qty: number; revenueMinor: number }>;
  bottomItems: Array<{ name: string; qty: number; revenueMinor: number }>;
  revenueByDay: Array<{ date: string; revenueMinor: number; orders: number }>;
  avgAcceptSeconds: number | null;
  acceptSecondsTrend: Array<{ date: string; revenueMinor: number; orders: number }>;
  cancelReasons: Array<{ reason: string; count: number }>;
  repeatCustomerRate: number;
};
const RestaurantAnalytics = builder.objectRef<AnalyticsResult>("RestaurantAnalytics");
RestaurantAnalytics.implement({
  fields: (t) => ({
    totalOrders: t.exposeInt("totalOrders"),
    totalRevenueMinor: t.exposeInt("totalRevenueMinor"),
    avgOrderValueMinor: t.exposeInt("avgOrderValueMinor"),
    ordersByDayOfWeek: t.field({ type: ["Int"], resolve: (a) => a.ordersByDayOfWeek }),
    ordersByHour: t.field({ type: ["Int"], resolve: (a) => a.ordersByHour }),
    topItems: t.field({ type: [AnalyticsTopItem], resolve: (a) => a.topItems }),
    bottomItems: t.field({ type: [AnalyticsTopItem], resolve: (a) => a.bottomItems }),
    revenueByDay: t.field({ type: [AnalyticsRevenueDay], resolve: (a) => a.revenueByDay }),
    // Mean seconds from placed→accepted over the window (null if nothing accepted).
    avgAcceptSeconds: t.int({ nullable: true, resolve: (a) => a.avgAcceptSeconds }),
    // Per-day mean acceptance time: `revenueMinor` carries the mean seconds and
    // `orders` the sample size (reuses AnalyticsRevenueDay to avoid a bespoke type).
    acceptSecondsTrend: t.field({
      type: [AnalyticsRevenueDay],
      resolve: (a) => a.acceptSecondsTrend,
    }),
    cancelReasons: t.field({ type: [AnalyticsCancelReason], resolve: (a) => a.cancelReasons }),
    // Share (0..1) of delivered-order customers who ordered more than once in the window.
    repeatCustomerRate: t.float({ resolve: (a) => a.repeatCustomerRate }),
  }),
});

// Vendor "Today" tab (#46): live operational snapshot for the current PKT calendar day,
// computed from this branch's orders since local midnight. acceptanceSlaPct is the share
// of orders that reached the kitchen (accepted or beyond) vs. all decided orders (i.e.
// excluding those still pending) — a rough on-time/accepted proxy, not a timing SLA.
type TodaySummaryResult = {
  orders: number;
  revenueMinor: number;
  acceptanceSlaPct: number;
  topItems: Array<{ name: string; qty: number; revenueMinor: number }>;
};
const TodaySummary = builder.objectRef<TodaySummaryResult>("TodaySummary");
TodaySummary.implement({
  fields: (t) => ({
    orders: t.exposeInt("orders"),
    revenueMinor: t.exposeInt("revenueMinor"),
    acceptanceSlaPct: t.exposeInt("acceptanceSlaPct"),
    topItems: t.field({ type: [AnalyticsTopItem], resolve: (a) => a.topItems }),
  }),
});

const PKT_OFFSET_MS = 5 * 60 * 60_000;

// Start of the current PKT calendar day as a UTC instant.
function pktStartOfToday(): Date {
  const nowPkt = new Date(Date.now() + PKT_OFFSET_MS);
  const midnightPkt = Date.UTC(nowPkt.getUTCFullYear(), nowPkt.getUTCMonth(), nowPkt.getUTCDate());
  return new Date(midnightPkt - PKT_OFFSET_MS);
}

// Staff roster row (#156) — a restaurant_staff UserRole flattened with its user's contact.
const StaffMemberRef = builder.objectRef<{
  roleId: string;
  userId: string;
  name: string | null;
  phone: string;
}>("StaffMember");
StaffMemberRef.implement({
  fields: (t) => ({
    roleId: t.exposeString("roleId"),
    userId: t.exposeString("userId"),
    name: t.exposeString("name", { nullable: true }),
    phone: t.exposeString("phone"),
  }),
});

// Restaurant KYC / verification record (#152).
builder.prismaObject("RestaurantKyc", {
  fields: (t) => ({
    id: t.exposeID("id"),
    restaurantId: t.exposeString("restaurantId"),
    ownerName: t.exposeString("ownerName"),
    ownerCnic: t.exposeString("ownerCnic"),
    bankAccountName: t.exposeString("bankAccountName", { nullable: true }),
    bankIban: t.exposeString("bankIban", { nullable: true }),
    cnicAssetId: t.exposeString("cnicAssetId", { nullable: true }),
    status: t.exposeString("status"),
    rejectionReason: t.exposeString("rejectionReason", { nullable: true }),
    submittedAt: t.field({ type: "DateTime", resolve: (k) => k.submittedAt }),
    reviewedAt: t.field({ type: "DateTime", nullable: true, resolve: (k) => k.reviewedAt }),
    restaurant: t.relation("restaurant"),
  }),
});

// ── queries ─────────────────────────────────────────────────────────────────

builder.queryFields((t) => ({
  myRestaurants: t.prismaField({
    type: ["Restaurant"],
    authScopes: { restaurantMember: true },
    resolve: (query, _root, _args, ctx) =>
      prisma.restaurant.findMany({ ...query, where: { id: { in: ctx.restaurantIds } } }),
  }),

  // Owner-only: the restaurant's staff roster (#156).
  restaurantStaff: t.field({
    type: [StaffMemberRef],
    authScopes: { restaurantMember: true },
    args: { restaurantId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      assertRestaurantOwner(ctx, args.restaurantId);
      const roles = await prisma.userRole.findMany({
        where: { role: "restaurant_staff", restaurantId: args.restaurantId },
        include: { user: true },
        orderBy: { id: "asc" },
      });
      return roles.map((r) => ({
        roleId: r.id,
        userId: r.userId,
        name: r.user.name,
        phone: r.user.phone,
      }));
    },
  }),

  // Owner: this restaurant's KYC record + status (null until submitted). (#152)
  restaurantKyc: t.prismaField({
    type: "RestaurantKyc",
    nullable: true,
    authScopes: { restaurantMember: true },
    args: { restaurantId: t.arg.string({ required: true }) },
    resolve: async (query, _root, args, ctx) => {
      await assertRestaurantMember(ctx, args.restaurantId);
      return prisma.restaurantKyc.findUnique({
        ...query,
        where: { restaurantId: args.restaurantId },
      });
    },
  }),

  // Admin: KYC records awaiting review, oldest first. (#152)
  kycQueue: t.prismaField({
    type: ["RestaurantKyc"],
    authScopes: { admin: true },
    resolve: (query) =>
      prisma.restaurantKyc.findMany({
        ...query,
        where: { status: "submitted" },
        orderBy: { submittedAt: "asc" },
      }),
  }),

  boardOrders: t.prismaField({
    type: ["Order"],
    authScopes: { restaurantMember: true },
    args: {
      branchId: t.arg.string({ required: true }),
      statuses: t.arg.stringList({ required: false }),
    },
    resolve: async (query, _root, args, ctx) => {
      await assertBranchMember(ctx, args.branchId);
      return prisma.order.findMany({
        ...query,
        where: {
          branchId: args.branchId,
          ...(args.statuses && args.statuses.length > 0
            ? { status: { in: args.statuses as never } }
            : {}),
        },
        orderBy: { placedAt: "desc" },
        take: 100,
      });
    },
  }),

  // Vendor "Today" tab (#46): revenue + acceptance snapshot for the current PKT day.
  todaySummary: t.field({
    type: TodaySummary,
    authScopes: { restaurantMember: true },
    args: { branchId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      await assertBranchMember(ctx, args.branchId);
      const since = pktStartOfToday();
      const orders = await prisma.order.findMany({
        where: { branchId: args.branchId, placedAt: { gte: since } },
        select: {
          status: true,
          acceptedAt: true,
          grandTotalMinor: true,
          items: { select: { qty: true, lineTotalMinor: true, menuSnapshotJson: true } },
        },
      });

      // An order "was accepted" if the kitchen ever accepted it, even if the customer later
      // cancelled — the final status alone can't tell those apart (cancellation is allowed
      // after `accepted`). Use the acceptedAt timestamp as the source of truth.
      const wasAccepted = (o: { acceptedAt: Date | null }) => o.acceptedAt !== null;
      // Revenue counts orders the kitchen accepted (mirrors wasAccepted) — never rejected,
      // expired, or still-pending orders that never reached the kitchen.
      const DECIDED = orders.filter((o) => o.status !== "pending_acceptance");
      const ACCEPTED = orders.filter(wasAccepted);

      let revenueMinor = 0;
      const tally = new Map<string, { qty: number; revenueMinor: number }>();
      for (const o of ACCEPTED) {
        revenueMinor += o.grandTotalMinor;
        for (const it of o.items) {
          const snap = it.menuSnapshotJson as { name?: string } | null;
          const name = snap?.name;
          if (!name) continue;
          const agg = tally.get(name) ?? { qty: 0, revenueMinor: 0 };
          agg.qty += it.qty;
          agg.revenueMinor += it.lineTotalMinor;
          tally.set(name, agg);
        }
      }
      const topItems = [...tally.entries()]
        .map(([name, v]) => ({ name, qty: v.qty, revenueMinor: v.revenueMinor }))
        .sort((a, b) => b.qty - a.qty)
        .slice(0, 5);

      return {
        orders: orders.length,
        revenueMinor,
        acceptanceSlaPct: DECIDED.length
          ? Math.round((ACCEPTED.length / DECIDED.length) * 100)
          : 100,
        topItems,
      };
    },
  }),

  // Console reviews feed (#61): approved ratings for the owner's restaurant, newest
  // first, each with its vendor response (if any) so the console can show reply status.
  restaurantReviews: t.prismaField({
    type: ["Rating"],
    authScopes: { restaurantMember: true },
    args: {
      restaurantId: t.arg.string({ required: true }),
      limit: t.arg.int({ required: false }),
      offset: t.arg.int({ required: false }),
    },
    resolve: async (query, _root, args, ctx) => {
      if (!ctx.restaurantIds.includes(args.restaurantId) && !ctx.hasRole("admin")) {
        throw new GraphQLError("You don't have access to this restaurant.", {
          extensions: { code: "forbidden" },
        });
      }
      return prisma.rating.findMany({
        ...query,
        where: { restaurantId: args.restaurantId, moderationStatus: "approved" },
        orderBy: { createdAt: "desc" },
        take: Math.min(Math.max(args.limit ?? 20, 1), 50),
        skip: Math.max(args.offset ?? 0, 0),
      });
    },
  }),

  draftMenu: t.prismaField({
    type: "Menu",
    authScopes: { restaurantMember: true },
    args: { branchId: t.arg.string({ required: true }) },
    resolve: async (query, _root, args, ctx) => {
      await assertBranchOwner(ctx, args.branchId);
      const draft = await ensureDraft(args.branchId);
      return prisma.menu.findUniqueOrThrow({ ...query, where: { id: draft.id } });
    },
  }),

  // Live (published) menu items that are currently 86'd. Member-scoped (#204): the menu
  // editor is owner-only, but staff run the board — they must be able to see and restock
  // items they took offline via the board's 86 flow (setItemAvailability stays member-level).
  branchUnavailableItems: t.prismaField({
    type: ["MenuItem"],
    authScopes: { restaurantMember: true },
    args: { branchId: t.arg.string({ required: true }) },
    resolve: async (query, _root, args, ctx) => {
      await assertBranchMember(ctx, args.branchId);
      const live = await prisma.menu.findFirst({
        where: { branchId: args.branchId, status: "published" },
        orderBy: { version: "desc" },
      });
      if (!live) return [];
      return prisma.menuItem.findMany({
        ...query,
        where: { category: { menuId: live.id }, isAvailable: false },
        orderBy: { name: "asc" },
      });
    },
  }),

  branchRiders: t.prismaField({
    type: ["Rider"],
    authScopes: { restaurantMember: true },
    args: { branchId: t.arg.string({ required: true }) },
    resolve: async (query, _root, args, ctx) => {
      const branch = await assertBranchMember(ctx, args.branchId);
      return prisma.rider.findMany({
        ...query,
        where: { restaurantId: branch.restaurantId },
      });
    },
  }),

  walletBalance: t.int({
    authScopes: { restaurantMember: true },
    args: { restaurantId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      if (!ctx.restaurantIds.includes(args.restaurantId) && !ctx.hasRole("admin")) {
        throw new GraphQLError("You don't have access to this restaurant.", {
          extensions: { code: "forbidden" },
        });
      }
      return prisma.$transaction((tx) =>
        accountBalance(tx as never, `restaurant:${args.restaurantId}:payable`),
      );
    },
  }),

  walletStatement: t.prismaField({
    type: [LedgerEntryType],
    authScopes: { restaurantMember: true },
    args: { restaurantId: t.arg.string({ required: true }) },
    resolve: async (query, _root, args, ctx) => {
      if (!ctx.restaurantIds.includes(args.restaurantId) && !ctx.hasRole("admin")) {
        throw new GraphQLError("You don't have access to this restaurant.", {
          extensions: { code: "forbidden" },
        });
      }
      return prisma.ledgerEntry.findMany({
        ...query,
        where: { account: { code: `restaurant:${args.restaurantId}:payable` } },
        orderBy: { createdAt: "desc" },
        take: 100,
      });
    },
  }),

  payoutHistory: t.prismaField({
    type: ["Payout"],
    authScopes: { restaurantMember: true },
    args: { restaurantId: t.arg.string({ required: true }) },
    resolve: async (query, _root, args, ctx) => {
      if (!ctx.restaurantIds.includes(args.restaurantId) && !ctx.hasRole("admin")) {
        throw new GraphQLError("You don't have access to this restaurant.", {
          extensions: { code: "forbidden" },
        });
      }
      // Reference adoption of the #33 RLS withTenant() pattern (see packages/db/RLS.md).
      // Admin cuts across tenants (no single restaurantId) so it must run OUTSIDE the wrapper;
      // tenant users go through withTenant so Postgres RLS enforces isolation as defense-in-depth.
      const findPayouts = (db: typeof prisma) =>
        db.payout.findMany({
          ...query,
          where: { restaurantId: args.restaurantId },
          orderBy: { createdAt: "desc" },
        });
      if (ctx.hasRole("admin")) return findPayouts(prisma);
      return withTenant(args.restaurantId, (tx) => findPayouts(tx as typeof prisma));
    },
  }),

  // Owner sales analytics for a branch over a trailing window (#21). Read-only, computed
  // live from delivered Order/OrderItem rows — no schema change, no stored aggregates.
  restaurantAnalytics: t.field({
    type: RestaurantAnalytics,
    authScopes: { restaurantMember: true },
    args: {
      branchId: t.arg.string({ required: true }),
      days: t.arg.int({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      await assertBranchMember(ctx, args.branchId);
      const days = Math.min(Math.max(args.days ?? 30, 1), 365);
      const since = new Date(Date.now() - days * 24 * 60 * 60_000);
      const orders = await prisma.order.findMany({
        where: { branchId: args.branchId, status: "delivered", placedAt: { gte: since } },
        select: {
          grandTotalMinor: true,
          placedAt: true,
          acceptedAt: true,
          customerId: true,
          items: { select: { qty: true, lineTotalMinor: true, menuSnapshotJson: true } },
        },
      });

      const ordersByDayOfWeek = Array<number>(7).fill(0);
      const ordersByHour = Array<number>(24).fill(0);
      const tally = new Map<string, { qty: number; revenueMinor: number }>();
      // Per-PKT-day revenue + acceptance latency, keyed by yyyy-mm-dd.
      const byDay = new Map<
        string,
        { revenueMinor: number; orders: number; acceptSum: number; acceptN: number }
      >();
      const ordersByCustomer = new Map<string, number>();
      let totalRevenueMinor = 0;
      let acceptSum = 0;
      let acceptN = 0;

      for (const o of orders) {
        totalRevenueMinor += o.grandTotalMinor;
        // Bucket in PKT wall-clock (read UTC getters on the shifted instant).
        const pkt = new Date(o.placedAt.getTime() + PKT_OFFSET_MS);
        const dow = pkt.getUTCDay();
        const hour = pkt.getUTCHours();
        ordersByDayOfWeek[dow] = (ordersByDayOfWeek[dow] ?? 0) + 1;
        ordersByHour[hour] = (ordersByHour[hour] ?? 0) + 1;

        const dateKey = pkt.toISOString().slice(0, 10);
        const dayAgg = byDay.get(dateKey) ?? {
          revenueMinor: 0,
          orders: 0,
          acceptSum: 0,
          acceptN: 0,
        };
        dayAgg.revenueMinor += o.grandTotalMinor;
        dayAgg.orders += 1;
        if (o.acceptedAt) {
          const secs = Math.max(0, (o.acceptedAt.getTime() - o.placedAt.getTime()) / 1000);
          acceptSum += secs;
          acceptN += 1;
          dayAgg.acceptSum += secs;
          dayAgg.acceptN += 1;
        }
        byDay.set(dateKey, dayAgg);

        ordersByCustomer.set(o.customerId, (ordersByCustomer.get(o.customerId) ?? 0) + 1);

        for (const it of o.items) {
          const snap = it.menuSnapshotJson as { name?: string } | null;
          const name = snap?.name;
          if (!name) continue;
          const agg = tally.get(name) ?? { qty: 0, revenueMinor: 0 };
          agg.qty += it.qty;
          agg.revenueMinor += it.lineTotalMinor;
          tally.set(name, agg);
        }
      }

      const sortedItems = [...tally.entries()]
        .map(([name, v]) => ({ name, qty: v.qty, revenueMinor: v.revenueMinor }))
        .sort((a, b) => b.qty - a.qty);
      const topItems = sortedItems.slice(0, 10);
      // Worst sellers: reverse tail, but never duplicate the top list on small menus.
      const bottomItems = [...sortedItems]
        .reverse()
        .slice(0, 10)
        .filter((it) => !topItems.includes(it));

      const revenueByDay = [...byDay.entries()]
        .map(([date, v]) => ({ date, revenueMinor: v.revenueMinor, orders: v.orders }))
        .sort((a, b) => (a.date < b.date ? -1 : 1));
      const acceptSecondsTrend = [...byDay.entries()]
        .filter(([, v]) => v.acceptN > 0)
        .map(([date, v]) => ({
          date,
          revenueMinor: Math.round(v.acceptSum / v.acceptN),
          orders: v.acceptN,
        }))
        .sort((a, b) => (a.date < b.date ? -1 : 1));

      // Cancellation-reason breakdown for this branch's orders in the window.
      const cancelGroups = await prisma.cancellation.groupBy({
        by: ["reasonCode"],
        where: { order: { branchId: args.branchId }, createdAt: { gte: since } },
        _count: { reasonCode: true },
      });
      const cancelReasons = cancelGroups
        .map((g) => ({ reason: g.reasonCode, count: g._count.reasonCode }))
        .sort((a, b) => b.count - a.count);

      const uniqueCustomers = ordersByCustomer.size;
      const repeatCustomers = [...ordersByCustomer.values()].filter((n) => n > 1).length;
      const repeatCustomerRate = uniqueCustomers ? repeatCustomers / uniqueCustomers : 0;

      const totalOrders = orders.length;
      return {
        totalOrders,
        totalRevenueMinor,
        avgOrderValueMinor: totalOrders ? Math.round(totalRevenueMinor / totalOrders) : 0,
        ordersByDayOfWeek,
        ordersByHour,
        topItems,
        bottomItems,
        revenueByDay,
        avgAcceptSeconds: acceptN ? Math.round(acceptSum / acceptN) : null,
        acceptSecondsTrend,
        cancelReasons,
        repeatCustomerRate,
      };
    },
  }),

  // Settlement report CSV (#29): per-order money breakdown for a restaurant over a
  // period. The net_to_restaurant column reconciles against the ledger movement for
  // the same window (net = subtotal + tax + delivery − commission − platform fee, the
  // exact restaurant:{id}:payable position posted on delivery). Delivered orders only.
  settlementReportCsv: t.string({
    authScopes: { restaurantMember: true },
    args: {
      restaurantId: t.arg.string({ required: true }),
      from: t.arg({ type: "DateTime", required: false }),
      to: t.arg({ type: "DateTime", required: false }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.restaurantIds.includes(args.restaurantId) && !ctx.hasRole("admin")) {
        throw new GraphQLError("You don't have access to this restaurant.", {
          extensions: { code: "forbidden" },
        });
      }
      const orders = await prisma.order.findMany({
        where: {
          branch: { restaurantId: args.restaurantId },
          status: "delivered",
          ...dateRangeWhere("deliveredAt", args.from, args.to),
        },
        include: { branch: { select: { name: true } } },
        orderBy: { deliveredAt: "asc" },
      });
      return settlementReportCsv(orders);
    },
  }),

  // eIMS-aligned invoice export CSV (#29 / #18): one row per invoice line for a branch
  // over a period. Fields follow the PRA eIMS lookup primitives (invoice number, line
  // items, qty, sale price, ST charge, inclusive total). Order tax is apportioned to
  // lines pro-rata; see csvExport.eimsInvoiceCsv.
  eimsInvoiceCsv: t.string({
    authScopes: { restaurantMember: true },
    args: {
      branchId: t.arg.string({ required: true }),
      from: t.arg({ type: "DateTime", required: false }),
      to: t.arg({ type: "DateTime", required: false }),
    },
    resolve: async (_root, args, ctx) => {
      await assertBranchMember(ctx, args.branchId);
      const orders = await prisma.order.findMany({
        where: {
          branchId: args.branchId,
          status: "delivered",
          ...dateRangeWhere("deliveredAt", args.from, args.to),
        },
        include: { items: true, branch: { select: { name: true } } },
        orderBy: { deliveredAt: "asc" },
      });
      return eimsInvoiceCsv(orders);
    },
  }),
}));

// ── order actions ───────────────────────────────────────────────────────────

builder.mutationFields((t) => ({
  acceptOrder: t.prismaField({
    type: "Order",
    authScopes: { restaurantMember: true },
    args: {
      id: t.arg.string({ required: true }),
      prepEtaMinutes: t.arg.int({ required: true }),
    },
    resolve: async (_q, _root, args, ctx) => {
      await assertOrderBranchMember(ctx, args.id);
      await transition(args.id, "accepted", restaurantActor(ctx), {
        expectedFrom: "pending_acceptance",
      });
      return prisma.order.update({
        where: { id: args.id },
        data: { prepEtaMinutes: args.prepEtaMinutes },
      });
    },
  }),

  // Remove a single unavailable line item from a live order (#111). Honours the
  // customer's `remove_item` preference: deletes the line, recomputes the order totals,
  // and issues a platform-controlled partial refund so the customer is NOT charged for an
  // item they won't receive. Allowed while the order is still in the kitchen
  // (pending_acceptance … ready_for_pickup); removing the last line is disallowed (that's a
  // full cancellation — reject/cancel instead).
  removeOrderItem: t.prismaField({
    type: "Order",
    authScopes: { restaurantMember: true },
    args: {
      orderId: t.arg.string({ required: true }),
      orderItemId: t.arg.string({ required: true }),
    },
    resolve: async (query, _root, args, ctx) => {
      await assertOrderBranchMember(ctx, args.orderId);
      const REMOVABLE_STATUSES = [
        "pending_acceptance",
        "accepted",
        "preparing",
        "ready_for_pickup",
      ];
      const { branchId, status } = await prisma.$transaction(async (tx) => {
        // Serialize concurrent removals on the same order so two staff clients can't both
        // read items.length===2, both delete a different line, and empty the order while
        // double-refunding (the last-item guard below reads a snapshot). (#111 review)
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`order-edit:${args.orderId}`})::bigint)`;
        const order = await tx.order.findUniqueOrThrow({
          where: { id: args.orderId },
          include: { payment: true, branch: true, items: true, deliveryTask: true },
        });
        if (!REMOVABLE_STATUSES.includes(order.status)) {
          throw new GraphQLError("This order can no longer be edited.", {
            extensions: { code: "invalid_state" },
          });
        }
        const item = order.items.find((i) => i.id === args.orderItemId);
        if (!item) {
          throw new GraphQLError("That item isn't on this order (it may already be removed).", {
            extensions: { code: "not_found" },
          });
        }
        if (order.items.length <= 1) {
          throw new GraphQLError(
            "This is the only item on the order — reject or cancel the whole order instead.",
            { extensions: { code: "last_item" } },
          );
        }

        // Refund the removed line's own subtotal + its proportional share of tax; scale the
        // restaurant commission down so the platform doesn't over-collect. Delivery fee, the
        // flat platform fee and any tip stay (the order still ships). NB: with a voucher /
        // loyalty discount applied this can slightly over-refund the discounted portion —
        // acceptable for v1; clamped to the order's grand total.
        const removedSubtotal = item.lineTotalMinor;
        const oldSubtotal = order.subtotalMinor;
        const share = oldSubtotal > 0 ? removedSubtotal / oldSubtotal : 0;
        const removedTax = Math.round(order.taxTotalMinor * share);
        const removedCommission = Math.round(order.commissionMinor * share);
        const refundMinor = Math.max(
          0,
          Math.min(removedSubtotal + removedTax, order.grandTotalMinor),
        );

        await tx.orderItem.delete({ where: { id: item.id } });
        await tx.order.update({
          where: { id: order.id },
          data: {
            subtotalMinor: order.subtotalMinor - removedSubtotal,
            taxTotalMinor: order.taxTotalMinor - removedTax,
            commissionMinor: order.commissionMinor - removedCommission,
            grandTotalMinor: order.grandTotalMinor - refundMinor,
          },
        });

        if (order.paymentMode === "cod") {
          // No cash collected yet: reduce what the rider must collect. If the task isn't
          // created yet, codAmountMinor is derived from grandTotalMinor at creation, so the
          // update above already carries the reduction forward.
          if (order.deliveryTask) {
            await tx.deliveryTask.update({
              where: { id: order.deliveryTask.id },
              data: {
                codAmountMinor: Math.max(0, order.deliveryTask.codAmountMinor - refundMinor),
              },
            });
          }
        } else {
          await postItemRemovalRefund(tx, order, refundMinor);
        }

        await tx.auditLog.create({
          data: {
            actorRole: "restaurant",
            actorUserId: ctx.userId,
            action: "order.item_removed",
            subjectType: "Order",
            subjectId: order.id,
            afterJson: {
              orderItemId: item.id,
              name: (item.menuSnapshotJson as { name?: string } | null)?.name ?? null,
              refundMinor,
              paymentMode: order.paymentMode,
            },
          },
        });
        return { branchId: order.branchId, status: order.status };
      });

      // Refresh the live board / customer tracking (totals + items changed).
      publishOrderChanged({ orderId: args.orderId, branchId, status });
      return prisma.order.findUniqueOrThrow({ ...query, where: { id: args.orderId } });
    },
  }),

  rejectOrder: t.prismaField({
    type: "Order",
    authScopes: { restaurantMember: true },
    args: {
      id: t.arg.string({ required: true }),
      reason: t.arg.string({ required: true }),
    },
    resolve: async (_q, _root, args, ctx) => {
      await assertOrderBranchMember(ctx, args.id);
      if (!args.reason.trim())
        throw new GraphQLError("Please provide a reason for rejecting this order.", {
          extensions: { code: "validation_error" },
        });
      // #30: restaurant-fault cancellation (full refund + ranking penalty). Evaluate
      // pre-transition, persist the policy row only after the transition succeeds.
      const order = await prisma.order.findUniqueOrThrow({ where: { id: args.id } });
      const decision = evaluateOrderCancellation(order, "restaurant");
      const updated = await transition(args.id, "rejected", restaurantActor(ctx), {
        reason: args.reason,
        meta: {
          policyScenario: decision.scenario,
          policyOutcome: decision.outcome,
          faultParty: decision.faultParty,
        },
      });
      await recordCancellation(order, "restaurant");
      return updated;
    },
  }),

  startPreparing: t.prismaField({
    type: "Order",
    authScopes: { restaurantMember: true },
    args: { id: t.arg.string({ required: true }) },
    resolve: async (_q, _root, args, ctx) => {
      await assertOrderBranchMember(ctx, args.id);
      return transition(args.id, "preparing", restaurantActor(ctx));
    },
  }),

  updatePrepEta: t.prismaField({
    type: "Order",
    authScopes: { restaurantMember: true },
    args: {
      id: t.arg.string({ required: true }),
      prepEtaMinutes: t.arg.int({ required: true }),
    },
    resolve: async (_q, _root, args, ctx) => {
      await assertOrderBranchMember(ctx, args.id);
      return prisma.order.update({
        where: { id: args.id },
        data: { prepEtaMinutes: args.prepEtaMinutes },
      });
    },
  }),

  markReady: t.prismaField({
    type: "Order",
    authScopes: { restaurantMember: true },
    args: { id: t.arg.string({ required: true }) },
    resolve: async (_q, _root, args, ctx) => {
      await assertOrderBranchMember(ctx, args.id);
      return transition(args.id, "ready_for_pickup", restaurantActor(ctx));
    },
  }),

  // Pickup collection (#54): the customer collected the order at the counter, so the
  // branch closes it out directly (ready_for_pickup -> delivered) with no rider leg.
  // Guarded to pickup orders — delivery orders must go through the rider flow.
  markCollected: t.prismaField({
    type: "Order",
    authScopes: { restaurantMember: true },
    args: { id: t.arg.string({ required: true }) },
    resolve: async (_q, _root, args, ctx) => {
      const order = await assertOrderBranchMember(ctx, args.id);
      if (order.fulfillmentMode !== "pickup") {
        throw new GraphQLError("Only pickup orders can be marked as collected.", {
          extensions: { code: "not_allowed" },
        });
      }
      return transition(args.id, "delivered", restaurantActor(ctx), {
        expectedFrom: "ready_for_pickup",
        reason: "Collected by customer",
      });
    },
  }),

  assignRider: t.prismaField({
    type: "Order",
    authScopes: { restaurantMember: true },
    args: {
      orderId: t.arg.string({ required: true }),
      riderId: t.arg.string({ required: true }),
    },
    resolve: async (_q, _root, args, ctx) => {
      const order = await assertOrderBranchMember(ctx, args.orderId);
      // Pickup orders have no rider leg (#54): the customer collects at the counter, so
      // never let one enter the delivery workflow via a stale UI or restaurant client.
      if (order.fulfillmentMode === "pickup") {
        throw new GraphQLError("Pickup orders can't be assigned to a rider.", {
          extensions: { code: "not_allowed" },
        });
      }
      const rider = await prisma.rider.findUnique({ where: { id: args.riderId } });
      if (!rider || rider.restaurantId !== order.branch.restaurantId) {
        throw new GraphQLError("This rider isn't on your restaurant's roster.", {
          extensions: { code: "not_found" },
        });
      }
      // Rider verification gate (#28): a rejected rider can't be assigned jobs.
      if (rider.verificationStatus === "rejected") {
        throw new GraphQLError("This rider was rejected and can't be assigned orders.", {
          extensions: { code: "not_allowed" },
        });
      }
      // Cash-variance auto-disable (#25): a rider flagged for repeated short remittance
      // can't be handed COD orders until an admin clears them.
      if (order.paymentMode === "cod" && rider.codDisabled) {
        throw new GraphQLError(
          "This rider is currently blocked from taking cash-on-delivery orders.",
          {
            extensions: { code: "rider_cod_disabled" },
          },
        );
      }
      await prisma.deliveryTask.upsert({
        where: { orderId: args.orderId },
        update: { riderId: args.riderId, status: "assigned", assignedAt: new Date() },
        create: {
          orderId: args.orderId,
          riderId: args.riderId,
          status: "assigned",
          assignedAt: new Date(),
          codAmountMinor: order.paymentMode === "cod" ? order.grandTotalMinor : 0,
        },
      });
      await prisma.deliveryEvent.create({
        data: {
          taskId: (
            await prisma.deliveryTask.findUniqueOrThrow({ where: { orderId: args.orderId } })
          ).id,
          type: "assigned",
          actorUserId: ctx.userId,
        },
      });
      return transition(args.orderId, "rider_assigned", restaurantActor(ctx), {
        expectedFrom: "ready_for_pickup",
      });
    },
  }),

  // Offer a job to a rider for swipe-to-accept (additive alternative to assignRider,
  // which hard-assigns). Creates/updates the DeliveryTask in `offered` state with the
  // rider attached so it surfaces in that rider's myJobs; the order itself stays
  // ready_for_pickup until the rider accepts (acceptTask promotes it to rider_assigned).
  offerTask: t.prismaField({
    type: "DeliveryTask",
    authScopes: { restaurantMember: true },
    args: {
      orderId: t.arg.string({ required: true }),
      riderId: t.arg.string({ required: true }),
    },
    resolve: async (query, _root, args, ctx) => {
      const order = await assertOrderBranchMember(ctx, args.orderId);
      // Pickup orders have no rider leg (#54): never offer one to a rider.
      if (order.fulfillmentMode === "pickup") {
        throw new GraphQLError("Pickup orders can't be offered to a rider.", {
          extensions: { code: "not_allowed" },
        });
      }
      // Only orders still awaiting a rider can be offered. Guards against offering a
      // pending/cancelled/delivered order and surfacing a bogus job to the rider.
      if (order.status !== "ready_for_pickup") {
        throw new GraphQLError("This order isn't ready for pickup yet.", {
          extensions: { code: "invalid_state" },
        });
      }
      const rider = await prisma.rider.findUnique({ where: { id: args.riderId } });
      if (!rider || rider.restaurantId !== order.branch.restaurantId) {
        throw new GraphQLError("This rider isn't on your restaurant's roster.", {
          extensions: { code: "not_found" },
        });
      }
      // Rider verification gate (#28): a rejected rider can't be offered jobs.
      if (rider.verificationStatus === "rejected") {
        throw new GraphQLError("This rider was rejected and can't be offered orders.", {
          extensions: { code: "not_allowed" },
        });
      }
      // Fraud control (#25): a rider whose COD was auto-disabled can't take cash orders.
      if (order.paymentMode === "cod" && rider.codDisabled) {
        throw new GraphQLError(
          "This rider is currently blocked from taking cash-on-delivery orders.",
          {
            extensions: { code: "rider_cod_disabled" },
          },
        );
      }
      // Don't clobber a task that has already progressed (assigned/picked up/etc.);
      // only a fresh (unassigned) or re-offerable (offered) task may be (re)offered. (#21)
      const existing = await prisma.deliveryTask.findUnique({
        where: { orderId: args.orderId },
        select: { status: true },
      });
      if (existing && existing.status !== "unassigned" && existing.status !== "offered") {
        throw new GraphQLError("This delivery is already in progress.", {
          extensions: { code: "invalid_state" },
        });
      }
      const task = await prisma.deliveryTask.upsert({
        where: { orderId: args.orderId },
        update: {
          riderId: args.riderId,
          status: "offered",
          offeredAt: new Date(),
          acceptedAt: null,
          assignedAt: null,
          declineReason: null,
        },
        create: {
          orderId: args.orderId,
          riderId: args.riderId,
          status: "offered",
          offeredAt: new Date(),
          codAmountMinor: order.paymentMode === "cod" ? order.grandTotalMinor : 0,
        },
      });
      await prisma.deliveryEvent.create({
        data: { taskId: task.id, type: "offered", actorUserId: ctx.userId },
      });
      // Push to the rider's job feed so the full-screen offer alert (#47) surfaces
      // immediately, instead of waiting for the 30s poll fallback. The order itself
      // stays ready_for_pickup — only the rider's queue changed.
      publishOrderChanged(
        { orderId: order.id, branchId: order.branchId, status: order.status },
        args.riderId,
      );
      return prisma.deliveryTask.findUniqueOrThrow({ ...query, where: { id: task.id } });
    },
  }),

  setAcceptingOrders: t.prismaField({
    type: "Branch",
    authScopes: { restaurantMember: true },
    args: {
      branchId: t.arg.string({ required: true }),
      accepting: t.arg.boolean({ required: true }),
    },
    resolve: async (_q, _root, args, ctx) => {
      await assertBranchMember(ctx, args.branchId);
      return prisma.branch.update({
        where: { id: args.branchId },
        data: { isAcceptingOrders: args.accepting },
      });
    },
  }),

  // Busy mode (#46): add extra minutes to every prep ETA instead of pausing. The buffer
  // pre-fills the vendor accept sheet and is surfaced to customers on the quote side.
  // Pass 0 to clear. Clamped to a sane 0..60 range.
  setBusyMode: t.prismaField({
    type: "Branch",
    authScopes: { restaurantMember: true },
    args: {
      branchId: t.arg.string({ required: true }),
      bufferMinutes: t.arg.int({ required: true }),
    },
    resolve: async (_q, _root, args, ctx) => {
      await assertBranchMember(ctx, args.branchId);
      const buffer = Math.min(Math.max(args.bufferMinutes, 0), 60);
      return prisma.branch.update({
        where: { id: args.branchId },
        data: { prepBufferMinutes: buffer },
      });
    },
  }),

  // Replace a branch's structured opening hours (#19) with the provided set (a full
  // overwrite — pass [] to clear, which reverts isOpenNow to the always-open fallback).
  // Once any rows exist they take precedence over the legacy hoursJson everywhere.
  setBranchHours: t.prismaField({
    type: "Branch",
    authScopes: { restaurantMember: true },
    args: {
      branchId: t.arg.string({ required: true }),
      hours: t.arg({ type: [BranchHoursInput], required: true }),
    },
    resolve: async (query, _root, args, ctx) => {
      await assertBranchOwner(ctx, args.branchId);
      for (const h of args.hours) {
        if (h.dayOfWeek < 0 || h.dayOfWeek > 6)
          throw new GraphQLError("Please choose a valid day of the week.", {
            extensions: { code: "validation_error" },
          });
        if (h.openMinute < 0 || h.openMinute > 1439 || h.closeMinute < 0 || h.closeMinute > 1439) {
          throw new GraphQLError("Opening and closing times must fall within a single day.", {
            extensions: { code: "validation_error" },
          });
        }
      }
      await prisma.$transaction(async (tx) => {
        await tx.branchHours.deleteMany({ where: { branchId: args.branchId } });
        if (args.hours.length > 0) {
          await tx.branchHours.createMany({
            data: args.hours.map((h) => ({
              branchId: args.branchId,
              dayOfWeek: h.dayOfWeek,
              openMinute: h.openMinute,
              closeMinute: h.closeMinute,
            })),
          });
        }
      });
      // #151: spread Pothos `query` so a client selecting `setBranchHours { hours }` gets a
      // tracked Prisma delegate and the relation resolves (was erroring "Unable to find
      // delegate for model Branch").
      return prisma.branch.findUniqueOrThrow({ ...query, where: { id: args.branchId } });
    },
  }),

  // Owner-editable commercial terms (#153). Tier/commission stay admin-only; these three
  // are day-to-day levers a restaurant should control itself. Only provided fields are
  // patched, and each is range-checked to avoid nonsensical storefront values.
  updateBranchCommercials: t.prismaField({
    type: "Branch",
    authScopes: { restaurantMember: true },
    args: {
      branchId: t.arg.string({ required: true }),
      minOrderMinor: t.arg.int({ required: false }),
      deliveryFeeMinor: t.arg.int({ required: false }),
      deliveryRadiusM: t.arg.int({ required: false }),
    },
    resolve: async (_q, _root, args, ctx) => {
      const commercialsBranch = await assertBranchMember(ctx, args.branchId);
      assertRestaurantOwner(ctx, commercialsBranch.restaurantId);
      const data: { minOrderMinor?: number; deliveryFeeMinor?: number; deliveryRadiusM?: number } =
        {};
      if (args.minOrderMinor != null) {
        if (args.minOrderMinor < 0 || args.minOrderMinor > 1_000_000)
          throw new GraphQLError("Please enter a valid minimum order.", {
            extensions: { code: "validation_error" },
          });
        data.minOrderMinor = args.minOrderMinor;
      }
      if (args.deliveryFeeMinor != null) {
        if (args.deliveryFeeMinor < 0 || args.deliveryFeeMinor > 1_000_000)
          throw new GraphQLError("Please enter a valid delivery fee.", {
            extensions: { code: "validation_error" },
          });
        data.deliveryFeeMinor = args.deliveryFeeMinor;
      }
      if (args.deliveryRadiusM != null) {
        if (args.deliveryRadiusM < 100 || args.deliveryRadiusM > 50_000)
          throw new GraphQLError("Delivery radius must be between 0.1 and 50 km.", {
            extensions: { code: "validation_error" },
          });
        data.deliveryRadiusM = args.deliveryRadiusM;
      }
      return prisma.branch.update({ where: { id: args.branchId }, data });
    },
  }),

  // Owner-editable storefront profile (#153): name + cuisine tags. The slug is left stable
  // on purpose so existing storefront links keep resolving. Tier/commission remain admin-only.
  updateRestaurantProfile: t.prismaField({
    type: "Restaurant",
    authScopes: { restaurantMember: true },
    args: {
      restaurantId: t.arg.string({ required: true }),
      name: t.arg.string({ required: false }),
      cuisineTags: t.arg.stringList({ required: false }),
    },
    resolve: async (_q, _root, args, ctx) => {
      await assertRestaurantMember(ctx, args.restaurantId);
      assertRestaurantOwner(ctx, args.restaurantId);
      const data: { name?: string; cuisineTags?: string[] } = {};
      if (args.name != null) {
        const trimmed = args.name.trim();
        if (trimmed.length < 2 || trimmed.length > 80)
          throw new GraphQLError("Restaurant name must be 2–80 characters.", {
            extensions: { code: "validation_error" },
          });
        data.name = trimmed;
      }
      if (args.cuisineTags != null) {
        data.cuisineTags = args.cuisineTags
          .map((c) => c.trim().toLowerCase())
          .filter(Boolean)
          .slice(0, 10);
      }
      return prisma.restaurant.update({ where: { id: args.restaurantId }, data });
    },
  }),

  // On-demand payout request (#157). Moves the restaurant's whole payable balance into a
  // per-restaurant payout-clearing account and records a pending Payout — so the balance
  // can't be double-requested. An admin settles it (markPayoutPaid) to move clearing →
  // platform:cash. Double-entry throughout; balanced per tx.
  requestPayout: t.prismaField({
    type: "Payout",
    authScopes: { restaurantMember: true },
    args: { restaurantId: t.arg.string({ required: true }) },
    resolve: async (query, _root, args, ctx) => {
      await assertRestaurantMember(ctx, args.restaurantId);
      assertRestaurantOwner(ctx, args.restaurantId);
      const MIN_PAYOUT_MINOR = 100_000; // Rs 1,000 floor
      // KYC gate (#203): a restaurant can't be paid out until identity/bank details are
      // verified. requestPayout previously only checked ownership, in-flight, and the floor,
      // which contradicted the verification page's "can't be paid out until KYC approved".
      const kyc = await prisma.restaurantKyc.findUnique({
        where: { restaurantId: args.restaurantId },
      });
      if (kyc?.status !== "approved")
        throw new GraphQLError(
          "Your restaurant's KYC must be approved before you can request a payout.",
          { extensions: { code: "kyc_not_approved" } },
        );
      return prisma.$transaction(async (tx) => {
        const inFlight = await tx.payout.findFirst({
          where: { restaurantId: args.restaurantId, status: "pending" },
        });
        if (inFlight)
          throw new GraphQLError("You already have a payout in progress.", {
            extensions: { code: "payout_in_progress" },
          });
        const balance = await accountBalance(
          tx as never,
          `restaurant:${args.restaurantId}:payable`,
        );
        if (balance < MIN_PAYOUT_MINOR)
          throw new GraphQLError(
            `You need at least ${formatRs(MIN_PAYOUT_MINOR)} available to request a payout.`,
            { extensions: { code: "below_payout_minimum" } },
          );
        const restaurant = await tx.restaurant.findUniqueOrThrow({
          where: { id: args.restaurantId },
        });
        const created = await tx.payout.create({
          data: {
            restaurantId: args.restaurantId,
            periodStart: new Date(Date.now() - 7 * 24 * 60 * 60_000),
            periodEnd: new Date(),
            amountMinor: balance,
            status: "pending",
            reference: `PO-${Date.now().toString(36).toUpperCase()}-${restaurant.slug.slice(0, 8)}`,
          },
        });
        const txId = await postLedgerTx(
          tx,
          `Payout requested ${created.reference}`,
          [
            {
              code: `restaurant:${args.restaurantId}:payable`,
              ownerType: "restaurant",
              ownerId: args.restaurantId,
              debit: balance,
            },
            {
              code: `restaurant:${args.restaurantId}:payout_clearing`,
              ownerType: "restaurant",
              ownerId: args.restaurantId,
              credit: balance,
            },
          ],
          { payoutId: created.id },
        );
        return tx.payout.update({
          ...query,
          where: { id: created.id },
          data: { ledgerTxId: txId },
        });
      });
    },
  }),

  // Owner-only: add a staff member by phone (#156). Staff get the restaurant_staff role,
  // which reaches the order board but not menu/wallet/settings (owner-only mutations +
  // console nav gating). Idempotent on (user, restaurant).
  inviteStaff: t.field({
    type: StaffMemberRef,
    authScopes: { restaurantMember: true },
    args: {
      restaurantId: t.arg.string({ required: true }),
      phone: t.arg.string({ required: true }),
      name: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      assertRestaurantOwner(ctx, args.restaurantId);
      if (!/^\+92\d{10}$/.test(args.phone))
        throw new GraphQLError("Please enter a valid phone number, for example +923001234567.", {
          extensions: { code: "validation_error" },
        });
      const user = await prisma.user.upsert({
        where: { phone: args.phone },
        update: args.name ? { name: args.name } : {},
        create: { phone: args.phone, name: args.name ?? null },
      });
      const existing = await prisma.userRole.findFirst({
        where: { userId: user.id, role: "restaurant_staff", restaurantId: args.restaurantId },
      });
      const role =
        existing ??
        (await prisma.userRole.create({
          data: { userId: user.id, role: "restaurant_staff", restaurantId: args.restaurantId },
        }));
      return { roleId: role.id, userId: user.id, name: user.name, phone: user.phone };
    },
  }),

  // Owner-only: revoke a staff member's access to this restaurant (#156).
  removeStaff: t.field({
    type: "Boolean",
    authScopes: { restaurantMember: true },
    args: {
      restaurantId: t.arg.string({ required: true }),
      userId: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      assertRestaurantOwner(ctx, args.restaurantId);
      await prisma.userRole.deleteMany({
        where: { userId: args.userId, role: "restaurant_staff", restaurantId: args.restaurantId },
      });
      return true;
    },
  }),

  // Owner: submit/resubmit KYC for review (#152). Upserts and resets to "submitted",
  // clearing any prior rejection. An admin then approves/rejects via reviewKyc.
  submitKyc: t.prismaField({
    type: "RestaurantKyc",
    authScopes: { restaurantMember: true },
    args: {
      restaurantId: t.arg.string({ required: true }),
      ownerName: t.arg.string({ required: true }),
      ownerCnic: t.arg.string({ required: true }),
      bankAccountName: t.arg.string({ required: false }),
      bankIban: t.arg.string({ required: false }),
      cnicAssetId: t.arg.string({ required: false }),
    },
    resolve: async (query, _root, args, ctx) => {
      assertRestaurantOwner(ctx, args.restaurantId);
      const ownerName = args.ownerName.trim();
      const ownerCnic = args.ownerCnic.trim();
      if (ownerName.length < 2)
        throw new GraphQLError("Please enter the owner's full name.", {
          extensions: { code: "validation_error" },
        });
      if (!/^\d{5}-?\d{7}-?\d$/.test(ownerCnic))
        throw new GraphQLError("Please enter a valid CNIC, e.g. 42101-1234567-1.", {
          extensions: { code: "validation_error" },
        });
      // Enforce that a supplied CNIC scan is a PRIVATE asset owned by this user (#119).
      // The UI uploads it privately, but a direct GraphQL client could pass a public image
      // id, leaving the scan readable via the unauthenticated /files path — mirror the
      // submitRiderDoc guard here so the server, not just the client, guarantees privacy.
      if (args.cnicAssetId) {
        const asset = await prisma.mediaAsset.findUnique({ where: { id: args.cnicAssetId } });
        if (!asset || asset.ownerId !== ctx.userId)
          throw new GraphQLError("We couldn't find that upload.", {
            extensions: { code: "not_found" },
          });
        if (!asset.objectKey.startsWith("private/"))
          throw new GraphQLError("The CNIC document must be uploaded as a private asset.", {
            extensions: { code: "insecure_asset" },
          });
      }
      const data = {
        ownerName,
        ownerCnic,
        bankAccountName: args.bankAccountName?.trim() || null,
        bankIban: args.bankIban?.trim() || null,
        cnicAssetId: args.cnicAssetId ?? null,
        status: "submitted",
        rejectionReason: null,
        submittedAt: new Date(),
        reviewedAt: null,
        reviewedByUserId: null,
      };
      return prisma.restaurantKyc.upsert({
        ...query,
        where: { restaurantId: args.restaurantId },
        update: data,
        create: { restaurantId: args.restaurantId, ...data },
      });
    },
  }),

  inviteRider: t.prismaField({
    type: "Rider",
    authScopes: { restaurantMember: true },
    args: {
      branchId: t.arg.string({ required: true }),
      phone: t.arg.string({ required: true }),
      name: t.arg.string({ required: true }),
    },
    resolve: async (_q, _root, args, ctx) => {
      const branch = await assertBranchOwner(ctx, args.branchId);
      if (!/^\+92\d{10}$/.test(args.phone))
        throw new GraphQLError("Please enter a valid phone number, for example +923001234567.", {
          extensions: { code: "validation_error" },
        });
      const user = await prisma.user.upsert({
        where: { phone: args.phone },
        update: {},
        create: { phone: args.phone, name: args.name },
      });
      const existingRider = await prisma.rider.findUnique({ where: { userId: user.id } });
      if (existingRider)
        throw new GraphQLError("This person is already registered as a rider.", {
          extensions: { code: "already_exists" },
        });
      const hasRole = await prisma.userRole.findFirst({
        where: { userId: user.id, role: "rider" },
      });
      if (!hasRole) {
        await prisma.userRole.create({ data: { userId: user.id, role: "rider" } });
      }
      return prisma.rider.create({
        data: {
          userId: user.id,
          riderType: "restaurant",
          restaurantId: branch.restaurantId,
          verificationStatus: "verified",
        },
      });
    },
  }),

  // ── menu CRUD (operates on the draft) ─────────────────────────────────────

  upsertCategory: t.prismaField({
    type: "MenuCategory",
    authScopes: { restaurantMember: true },
    args: {
      branchId: t.arg.string({ required: true }),
      id: t.arg.string({ required: false }),
      name: t.arg.string({ required: true }),
      description: t.arg.string({ required: false }),
      sortOrder: t.arg.int({ required: false }),
    },
    resolve: async (_q, _root, args, ctx) => {
      await assertBranchOwner(ctx, args.branchId);
      const draft = await ensureDraft(args.branchId);
      if (args.id) {
        const cat = await prisma.menuCategory.findUnique({ where: { id: args.id } });
        if (!cat || cat.menuId !== draft.id)
          throw new GraphQLError("That category isn't part of your draft menu.", {
            extensions: { code: "not_found" },
          });
        return prisma.menuCategory.update({
          where: { id: args.id },
          data: {
            name: args.name,
            description: args.description,
            sortOrder: args.sortOrder ?? cat.sortOrder,
          },
        });
      }
      const count = await prisma.menuCategory.count({ where: { menuId: draft.id } });
      return prisma.menuCategory.create({
        data: {
          menuId: draft.id,
          name: args.name,
          description: args.description,
          sortOrder: args.sortOrder ?? count,
        },
      });
    },
  }),

  upsertMenuItem: t.prismaField({
    type: "MenuItem",
    authScopes: { restaurantMember: true },
    args: {
      branchId: t.arg.string({ required: true }),
      categoryId: t.arg.string({ required: true }),
      id: t.arg.string({ required: false }),
      name: t.arg.string({ required: true }),
      description: t.arg.string({ required: false }),
      priceMinor: t.arg.int({ required: true }),
      // Item-level offer (#53): original "was" price for a strike-through + % badge.
      // Pass a value > priceMinor to run an offer, or null/0 to clear it.
      compareAtPriceMinor: t.arg.int({ required: false }),
      badges: t.arg.stringList({ required: false }),
    },
    resolve: async (_q, _root, args, ctx) => {
      await assertBranchOwner(ctx, args.branchId);
      const draft = await ensureDraft(args.branchId);
      const category = await prisma.menuCategory.findUnique({ where: { id: args.categoryId } });
      if (!category || category.menuId !== draft.id)
        throw new GraphQLError("That category isn't part of your draft menu.", {
          extensions: { code: "not_found" },
        });
      if (args.priceMinor <= 0)
        throw new GraphQLError("Please enter a price greater than zero.", {
          extensions: { code: "validation_error" },
        });
      const compareAt =
        args.compareAtPriceMinor && args.compareAtPriceMinor > 0 ? args.compareAtPriceMinor : null;
      if (compareAt != null && compareAt <= args.priceMinor) {
        throw new GraphQLError("The 'was' price must be higher than the current price.", {
          extensions: { code: "validation_error" },
        });
      }
      const data = {
        categoryId: args.categoryId,
        name: args.name,
        description: args.description,
        priceMinor: args.priceMinor,
        compareAtPriceMinor: compareAt,
        badges: args.badges ?? [],
      };
      if (args.id) {
        const item = await prisma.menuItem.findUnique({
          where: { id: args.id },
          include: { category: true },
        });
        if (!item || item.category.menuId !== draft.id)
          throw new GraphQLError("That item isn't part of your draft menu.", {
            extensions: { code: "not_found" },
          });
        return prisma.menuItem.update({ where: { id: args.id }, data });
      }
      return prisma.menuItem.create({ data });
    },
  }),

  setItemAvailability: t.prismaField({
    type: "MenuItem",
    authScopes: { restaurantMember: true },
    args: {
      itemId: t.arg.string({ required: true }),
      available: t.arg.boolean({ required: true }),
      // Timed 86 (#46): when marking unavailable, record when it should return so the
      // board can show "back tomorrow". "today" -> end of the current PKT day; omitted
      // (or when re-enabling) -> cleared. Purely informational for now (no auto-sweep).
      until: t.arg.string({ required: false }),
    },
    resolve: async (_q, _root, args, ctx) => {
      const item = await prisma.menuItem.findUnique({
        where: { id: args.itemId },
        include: { category: { include: { menu: true } } },
      });
      if (!item)
        throw new GraphQLError("We couldn't find that menu item.", {
          extensions: { code: "not_found" },
        });
      await assertBranchMember(ctx, item.category.menu.branchId);
      // Availability applies to BOTH the live menu item and the draft twin (by name) —
      // stock-outs must hit customers immediately, not on next publish.
      let unavailableUntil: Date | null = null;
      if (!args.available && args.until === "today") {
        // End of the current PKT calendar day.
        const nowPkt = new Date(Date.now() + PKT_OFFSET_MS);
        unavailableUntil = new Date(
          Date.UTC(nowPkt.getUTCFullYear(), nowPkt.getUTCMonth(), nowPkt.getUTCDate() + 1) -
            PKT_OFFSET_MS,
        );
      }
      const updated = await prisma.menuItem.update({
        where: { id: args.itemId },
        data: { isAvailable: args.available, unavailableUntil },
      });
      // Twin propagation (#110): flip the SAME-NAME item in the branch's OTHER live menu
      // version (draft <-> published) so an 86 survives a publish and re-appears in edits.
      // Matched by name because publish deep-clones into fresh ids (see menuService). The
      // no-twin case (no draft yet, or item not present in the other version) is a no-op.
      const branchId = item.category.menu.branchId;
      const otherStatus = item.category.menu.status === "draft" ? "published" : "draft";
      const otherMenu = await prisma.menu.findFirst({
        where: { branchId, status: otherStatus },
        orderBy: { version: "desc" },
      });
      if (otherMenu) {
        // Scope by category name too (#110 review): menu-item names aren't unique, so a
        // name-only match would flip an unrelated same-name item in another category (e.g.
        // "Fries" under two sections). Matching the twin category narrows to the real twin.
        await prisma.menuItem.updateMany({
          where: {
            name: item.name,
            category: { menuId: otherMenu.id, name: item.category.name },
          },
          data: { isAvailable: args.available, unavailableUntil },
        });
      }
      return updated;
    },
  }),

  deleteMenuItem: t.field({
    type: "Boolean",
    authScopes: { restaurantMember: true },
    args: { itemId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      const item = await prisma.menuItem.findUnique({
        where: { id: args.itemId },
        include: { category: { include: { menu: true } } },
      });
      if (!item)
        throw new GraphQLError("We couldn't find that menu item.", {
          extensions: { code: "not_found" },
        });
      if (item.category.menu.status !== "draft")
        throw new GraphQLError("Only items in your draft menu can be deleted.", {
          extensions: { code: "not_allowed" },
        });
      await assertBranchOwner(ctx, item.category.menu.branchId);
      await prisma.$transaction(async (tx) => {
        // Remove the item's join rows first, including any combo (#53) it belongs to —
        // ComboItem.menuItem is a required FK, so Postgres rejects the delete otherwise.
        await tx.menuItemModifierGroup.deleteMany({ where: { itemId: args.itemId } });
        await tx.comboItem.deleteMany({ where: { menuItemId: args.itemId } });
        await tx.menuItem.delete({ where: { id: args.itemId } });
      });
      return true;
    },
  }),

  // ── modifier group / option CRUD (#20, operates on the draft) ─────────────
  // Modifier groups are menu-scoped (ModifierGroup.menuId) and attached to items via
  // the MenuItemModifierGroup join. All mutations below only touch the branch draft —
  // published menus are immutable and orders freeze a menuSnapshotJson, so live orders
  // are never affected. `required` is derived as minSelect >= 1 (no separate column).

  upsertModifierGroup: t.prismaField({
    type: "ModifierGroup",
    authScopes: { restaurantMember: true },
    args: {
      branchId: t.arg.string({ required: true }),
      id: t.arg.string({ required: false }),
      name: t.arg.string({ required: true }),
      minSelect: t.arg.int({ required: true }),
      maxSelect: t.arg.int({ required: true }),
      // When provided, ensures this draft item is linked to the group (idempotent).
      itemId: t.arg.string({ required: false }),
    },
    resolve: async (_q, _root, args, ctx) => {
      await assertBranchOwner(ctx, args.branchId);
      const draft = await ensureDraft(args.branchId);
      if (!args.name.trim())
        throw new GraphQLError("Please enter a name for this option group.", {
          extensions: { code: "validation_error" },
        });
      if (args.minSelect < 0 || args.maxSelect < 1 || args.minSelect > args.maxSelect) {
        throw new GraphQLError("Please choose a valid minimum and maximum number of selections.", {
          extensions: { code: "validation_error" },
        });
      }
      if (args.itemId) {
        const item = await prisma.menuItem.findUnique({
          where: { id: args.itemId },
          include: { category: true },
        });
        if (!item || item.category.menuId !== draft.id)
          throw new GraphQLError("That item isn't part of your draft menu.", {
            extensions: { code: "not_found" },
          });
      }
      let group;
      if (args.id) {
        const existing = await prisma.modifierGroup.findUnique({ where: { id: args.id } });
        if (!existing || existing.menuId !== draft.id)
          throw new GraphQLError("That option group isn't part of your draft menu.", {
            extensions: { code: "not_found" },
          });
        group = await prisma.modifierGroup.update({
          where: { id: args.id },
          data: { name: args.name, minSelect: args.minSelect, maxSelect: args.maxSelect },
        });
      } else {
        group = await prisma.modifierGroup.create({
          data: {
            menuId: draft.id,
            name: args.name,
            minSelect: args.minSelect,
            maxSelect: args.maxSelect,
          },
        });
      }
      if (args.itemId) {
        const sortOrder = await prisma.menuItemModifierGroup.count({
          where: { itemId: args.itemId },
        });
        await prisma.menuItemModifierGroup.upsert({
          where: { itemId_groupId: { itemId: args.itemId, groupId: group.id } },
          update: {},
          create: { itemId: args.itemId, groupId: group.id, sortOrder },
        });
      }
      return group;
    },
  }),

  deleteModifierGroup: t.field({
    type: "Boolean",
    authScopes: { restaurantMember: true },
    args: { id: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      const group = await prisma.modifierGroup.findUnique({
        where: { id: args.id },
        include: { menu: true },
      });
      if (!group)
        throw new GraphQLError("We couldn't find that option group.", {
          extensions: { code: "not_found" },
        });
      if (group.menu.status !== "draft")
        throw new GraphQLError("Only option groups in your draft menu can be deleted.", {
          extensions: { code: "not_allowed" },
        });
      await assertBranchOwner(ctx, group.menu.branchId);
      await prisma.$transaction(async (tx) => {
        await tx.menuItemModifierGroup.deleteMany({ where: { groupId: args.id } });
        await tx.modifierOption.deleteMany({ where: { groupId: args.id } });
        await tx.modifierGroup.delete({ where: { id: args.id } });
      });
      return true;
    },
  }),

  upsertModifierOption: t.prismaField({
    type: "ModifierOption",
    authScopes: { restaurantMember: true },
    args: {
      groupId: t.arg.string({ required: true }),
      id: t.arg.string({ required: false }),
      name: t.arg.string({ required: true }),
      priceDeltaMinor: t.arg.int({ required: true }),
      isAvailable: t.arg.boolean({ required: false }),
    },
    resolve: async (_q, _root, args, ctx) => {
      const group = await prisma.modifierGroup.findUnique({
        where: { id: args.groupId },
        include: { menu: true },
      });
      if (!group)
        throw new GraphQLError("We couldn't find that option group.", {
          extensions: { code: "not_found" },
        });
      if (group.menu.status !== "draft")
        throw new GraphQLError("Only options in your draft menu can be edited.", {
          extensions: { code: "not_allowed" },
        });
      await assertBranchOwner(ctx, group.menu.branchId);
      if (!args.name.trim())
        throw new GraphQLError("Please enter a name for this option.", {
          extensions: { code: "validation_error" },
        });
      if (args.priceDeltaMinor < 0)
        throw new GraphQLError("The extra charge for this option can't be negative.", {
          extensions: { code: "validation_error" },
        });
      if (args.id) {
        const existing = await prisma.modifierOption.findUnique({ where: { id: args.id } });
        if (!existing || existing.groupId !== args.groupId)
          throw new GraphQLError("That option doesn't belong to this option group.", {
            extensions: { code: "not_found" },
          });
        // On edit, only touch isAvailable when the caller explicitly sends it — omitting
        // it must NOT silently restock an option the restaurant had disabled.
        return prisma.modifierOption.update({
          where: { id: args.id },
          data: {
            name: args.name,
            priceDeltaMinor: args.priceDeltaMinor,
            ...(args.isAvailable != null ? { isAvailable: args.isAvailable } : {}),
          },
        });
      }
      const sortOrder = await prisma.modifierOption.count({ where: { groupId: args.groupId } });
      return prisma.modifierOption.create({
        data: {
          groupId: args.groupId,
          name: args.name,
          priceDeltaMinor: args.priceDeltaMinor,
          isAvailable: args.isAvailable ?? true,
          sortOrder,
        },
      });
    },
  }),

  deleteModifierOption: t.field({
    type: "Boolean",
    authScopes: { restaurantMember: true },
    args: { id: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      const option = await prisma.modifierOption.findUnique({
        where: { id: args.id },
        include: { group: { include: { menu: true } } },
      });
      if (!option)
        throw new GraphQLError("We couldn't find that option.", {
          extensions: { code: "not_found" },
        });
      if (option.group.menu.status !== "draft")
        throw new GraphQLError("Only options in your draft menu can be deleted.", {
          extensions: { code: "not_allowed" },
        });
      await assertBranchOwner(ctx, option.group.menu.branchId);
      await prisma.modifierOption.delete({ where: { id: args.id } });
      return true;
    },
  }),

  // ── menu item photo (#50 image pipeline reuse) ────────────────────────────
  // Set or clear a draft item's uploaded photo. Reuses the presign/finalize/MediaAsset
  // flow (media.ts): the client uploads via presignUpload+finalizeUpload, then passes the
  // finalized assetId here. Pass mediaId:null to clear. Item.imageUrl reads it back.
  setMenuItemPhoto: t.prismaField({
    type: "MenuItem",
    authScopes: { restaurantMember: true },
    args: {
      menuItemId: t.arg.string({ required: true }),
      mediaId: t.arg.string({ required: false }),
    },
    resolve: async (_q, _root, args, ctx) => {
      const item = await prisma.menuItem.findUnique({
        where: { id: args.menuItemId },
        include: { category: { include: { menu: true } } },
      });
      if (!item)
        throw new GraphQLError("We couldn't find that menu item.", {
          extensions: { code: "not_found" },
        });
      if (item.category.menu.status !== "draft")
        throw new GraphQLError("Only items in your draft menu can be edited.", {
          extensions: { code: "not_allowed" },
        });
      await assertBranchOwner(ctx, item.category.menu.branchId);
      if (args.mediaId) {
        const asset = await prisma.mediaAsset.findUnique({ where: { id: args.mediaId } });
        if (!asset || asset.status !== "finalized")
          throw new GraphQLError("That photo hasn't finished uploading yet. Please try again.", {
            extensions: { code: "invalid_state" },
          });
      }
      return prisma.menuItem.update({
        where: { id: args.menuItemId },
        data: { imageAssetId: args.mediaId ?? null },
      });
    },
  }),

  // ── combo / meal-deal CRUD (#53, operates on the draft) ───────────────────
  // Combos are menu-scoped (Combo.menuId) and cloned on publish (cloneMenu), so every
  // mutation only touches the branch draft. Component items must belong to the same draft
  // menu. v1 is fixed bundles (a set item list); choose-N-from-group is deferred.

  upsertCombo: t.prismaField({
    type: "Combo",
    authScopes: { restaurantMember: true },
    args: {
      branchId: t.arg.string({ required: true }),
      id: t.arg.string({ required: false }),
      name: t.arg.string({ required: true }),
      description: t.arg.string({ required: false }),
      priceMinor: t.arg.int({ required: true }),
    },
    resolve: async (_q, _root, args, ctx) => {
      await assertBranchOwner(ctx, args.branchId);
      const draft = await ensureDraft(args.branchId);
      if (!args.name.trim())
        throw new GraphQLError("Please enter a name for this deal.", {
          extensions: { code: "validation_error" },
        });
      if (args.priceMinor <= 0)
        throw new GraphQLError("Please enter a price greater than zero.", {
          extensions: { code: "validation_error" },
        });
      const data = {
        name: args.name,
        description: args.description,
        priceMinor: args.priceMinor,
      };
      if (args.id) {
        const existing = await prisma.combo.findUnique({ where: { id: args.id } });
        if (!existing || existing.menuId !== draft.id)
          throw new GraphQLError("That deal isn't part of your draft menu.", {
            extensions: { code: "not_found" },
          });
        return prisma.combo.update({ where: { id: args.id }, data });
      }
      const sortOrder = await prisma.combo.count({ where: { menuId: draft.id } });
      return prisma.combo.create({ data: { menuId: draft.id, ...data, sortOrder } });
    },
  }),

  setComboAvailability: t.prismaField({
    type: "Combo",
    authScopes: { restaurantMember: true },
    args: {
      comboId: t.arg.string({ required: true }),
      available: t.arg.boolean({ required: true }),
    },
    resolve: async (_q, _root, args, ctx) => {
      const combo = await prisma.combo.findUnique({
        where: { id: args.comboId },
        include: { menu: true },
      });
      if (!combo)
        throw new GraphQLError("We couldn't find that deal.", {
          extensions: { code: "not_found" },
        });
      await assertBranchOwner(ctx, combo.menu.branchId);
      return prisma.combo.update({
        where: { id: args.comboId },
        data: { isAvailable: args.available },
      });
    },
  }),

  deleteCombo: t.field({
    type: "Boolean",
    authScopes: { restaurantMember: true },
    args: { comboId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      const combo = await prisma.combo.findUnique({
        where: { id: args.comboId },
        include: { menu: true },
      });
      if (!combo)
        throw new GraphQLError("We couldn't find that deal.", {
          extensions: { code: "not_found" },
        });
      if (combo.menu.status !== "draft")
        throw new GraphQLError("Only deals in your draft menu can be deleted.", {
          extensions: { code: "not_allowed" },
        });
      await assertBranchOwner(ctx, combo.menu.branchId);
      await prisma.$transaction(async (tx) => {
        await tx.comboItem.deleteMany({ where: { comboId: args.comboId } });
        await tx.combo.delete({ where: { id: args.comboId } });
      });
      return true;
    },
  }),

  // Add a component item to a draft combo, or bump its qty if already present.
  addComboItem: t.prismaField({
    type: "Combo",
    authScopes: { restaurantMember: true },
    args: {
      comboId: t.arg.string({ required: true }),
      menuItemId: t.arg.string({ required: true }),
      qty: t.arg.int({ required: false }),
    },
    resolve: async (query, _root, args, ctx) => {
      const combo = await prisma.combo.findUnique({
        where: { id: args.comboId },
        include: { menu: true },
      });
      if (!combo)
        throw new GraphQLError("We couldn't find that deal.", {
          extensions: { code: "not_found" },
        });
      if (combo.menu.status !== "draft")
        throw new GraphQLError("Only deals in your draft menu can be edited.", {
          extensions: { code: "not_allowed" },
        });
      await assertBranchOwner(ctx, combo.menu.branchId);
      const item = await prisma.menuItem.findUnique({
        where: { id: args.menuItemId },
        include: { category: true },
      });
      if (!item || item.category.menuId !== combo.menuId)
        throw new GraphQLError("That item isn't part of your draft menu.", {
          extensions: { code: "not_found" },
        });
      const existing = await prisma.comboItem.findFirst({
        where: { comboId: args.comboId, menuItemId: args.menuItemId },
      });
      if (existing) {
        // An explicit qty sets the row; an omitted qty (the picker's re-select) bumps by
        // one so a deal can hold two of the same item without a dedicated qty control.
        const nextQty = args.qty != null ? Math.max(1, args.qty) : existing.qty + 1;
        await prisma.comboItem.update({ where: { id: existing.id }, data: { qty: nextQty } });
      } else {
        const qty = Math.max(1, args.qty ?? 1);
        const sortOrder = await prisma.comboItem.count({ where: { comboId: args.comboId } });
        await prisma.comboItem.create({
          data: { comboId: args.comboId, menuItemId: args.menuItemId, qty, sortOrder },
        });
      }
      return prisma.combo.findUniqueOrThrow({ ...query, where: { id: args.comboId } });
    },
  }),

  removeComboItem: t.prismaField({
    type: "Combo",
    authScopes: { restaurantMember: true },
    args: { comboItemId: t.arg.string({ required: true }) },
    resolve: async (query, _root, args, ctx) => {
      const ci = await prisma.comboItem.findUnique({
        where: { id: args.comboItemId },
        include: { combo: { include: { menu: true } } },
      });
      if (!ci)
        throw new GraphQLError("We couldn't find that deal item.", {
          extensions: { code: "not_found" },
        });
      if (ci.combo.menu.status !== "draft")
        throw new GraphQLError("Only deals in your draft menu can be edited.", {
          extensions: { code: "not_allowed" },
        });
      await assertBranchOwner(ctx, ci.combo.menu.branchId);
      await prisma.comboItem.delete({ where: { id: args.comboItemId } });
      return prisma.combo.findUniqueOrThrow({ ...query, where: { id: ci.comboId } });
    },
  }),

  publishMenu: t.prismaField({
    type: "Menu",
    authScopes: { restaurantMember: true },
    args: { branchId: t.arg.string({ required: true }) },
    resolve: async (_q, _root, args, ctx) => {
      await assertBranchOwner(ctx, args.branchId);
      return publishDraft(args.branchId);
    },
  }),

  // ── onboarding ────────────────────────────────────────────────────────────

  submitOnboarding: t.prismaField({
    type: "Restaurant",
    authScopes: { loggedIn: true },
    args: {
      name: t.arg.string({ required: true }),
      addressText: t.arg.string({ required: true }),
      lat: t.arg.float({ required: true }),
      lng: t.arg.float({ required: true }),
      minOrderMinor: t.arg.int({ required: true }),
      deliveryFeeMinor: t.arg.int({ required: true }),
      deliveryRadiusM: t.arg.int({ required: true }),
    },
    resolve: async (query, _root, args, ctx) => {
      const slugBase = args.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
      const slug = `${slugBase}-${Math.random().toString(36).slice(2, 6)}`;
      const taxProfile = await prisma.taxProfile.findFirstOrThrow();
      const restaurant = await prisma.restaurant.create({
        data: {
          name: args.name,
          slug,
          status: "pending_approval",
          ownerId: ctx.userId!,
          branches: {
            create: {
              name: "Main Branch",
              addressText: args.addressText,
              lat: args.lat as never,
              lng: args.lng as never,
              minOrderMinor: args.minOrderMinor,
              deliveryFeeMinor: args.deliveryFeeMinor,
              deliveryRadiusM: args.deliveryRadiusM,
              taxProfileId: taxProfile.id,
            },
          },
        },
      });
      await prisma.userRole.create({
        data: { userId: ctx.userId!, role: "restaurant_owner", restaurantId: restaurant.id },
      });
      // #151: re-read through Pothos `query` so a client selecting `submitOnboarding
      // { branches }` gets a tracked Prisma delegate and the relation resolves (was erroring
      // "Unable to find delegate for model Restaurant"). create() alone isn't query-tracked.
      return prisma.restaurant.findUniqueOrThrow({ ...query, where: { id: restaurant.id } });
    },
  }),
}));
