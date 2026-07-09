// Public marketplace: browse restaurants, branch detail, published menu, theme.
import { prisma } from "@fd/db";
import { haversineMeters } from "@fd/shared";
import { GraphQLError } from "graphql";
import { z } from "zod";
import { branchOpenNow } from "../services/branchHours.js";
import { builder } from "./builder.js";

builder.prismaObject("RestaurantTheme", {
  fields: (t) => ({
    id: t.exposeID("id"),
    primaryColor: t.exposeString("primaryColor"),
    accentColor: t.exposeString("accentColor"),
    backgroundColor: t.exposeString("backgroundColor"),
    textColor: t.exposeString("textColor"),
    fontKey: t.exposeString("fontKey"),
    cardStyle: t.exposeString("cardStyle"),
    heroEffect: t.exposeString("heroEffect"),
    logoUrl: t.string({
      nullable: true,
      resolve: async (theme) => {
        if (!theme.logoAssetId) return null;
        const a = await prisma.mediaAsset.findUnique({ where: { id: theme.logoAssetId } });
        return a ? (await import("../services/uploads.js")).assetUrl(a.objectKey) : null;
      },
    }),
    heroUrl: t.string({
      nullable: true,
      resolve: async (theme) => {
        if (!theme.heroAssetId) return null;
        const a = await prisma.mediaAsset.findUnique({ where: { id: theme.heroAssetId } });
        return a ? (await import("../services/uploads.js")).assetUrl(a.objectKey) : null;
      },
    }),
  }),
});

builder.prismaObject("Restaurant", {
  fields: (t) => ({
    id: t.exposeID("id"),
    name: t.exposeString("name"),
    slug: t.exposeString("slug"),
    status: t.exposeString("status"),
    tier: t.exposeString("tier"),
    cuisineTags: t.exposeStringList("cuisineTags"),
    theme: t.relation("theme", { nullable: true }),
    branches: t.relation("branches"),
    avgRating: t.float({
      nullable: true,
      resolve: async (r) => {
        const agg = await prisma.rating.aggregate({
          where: { restaurantId: r.id, moderationStatus: "approved" },
          _avg: { stars: true },
        });
        return agg._avg.stars;
      },
    }),
    ratingCount: t.int({
      resolve: (r) =>
        prisma.rating.count({ where: { restaurantId: r.id, moderationStatus: "approved" } }),
    }),
    // Count of approved ratings per star, index 0 => 1★ … index 4 => 5★.
    // Powers the distribution bars on the reviews page.
    ratingDistribution: t.field({
      type: ["Int"],
      resolve: async (r) => {
        const rows = await prisma.rating.groupBy({
          by: ["stars"],
          where: { restaurantId: r.id, moderationStatus: "approved" },
          _count: { stars: true },
        });
        const buckets = [0, 0, 0, 0, 0];
        for (const row of rows) {
          if (row.stars >= 1 && row.stars <= 5) buckets[row.stars - 1] = row._count.stars;
        }
        return buckets;
      },
    }),
    // Paginated approved reviews, newest first (offset pagination — the house style).
    ratings: t.prismaField({
      type: ["Rating"],
      args: {
        limit: t.arg.int({ required: false }),
        offset: t.arg.int({ required: false }),
      },
      resolve: (query, r, args) =>
        prisma.rating.findMany({
          ...query,
          where: { restaurantId: r.id, moderationStatus: "approved" },
          orderBy: { createdAt: "desc" },
          take: Math.min(Math.max(args.limit ?? 10, 1), 50),
          skip: Math.max(args.offset ?? 0, 0),
        }),
    }),
  }),
});

// Resolved image for a branch card/hero. `source` lets the client render the
// right treatment (e.g. mandatory attribution overlay for Google photos).
// null means "no image" — the client shows its typography fallback (tier 3).
const BranchPhoto = builder.objectRef<{
  url: string;
  source: "uploaded" | "google";
  attributionHtml: string | null;
}>("BranchPhoto");
BranchPhoto.implement({
  fields: (t) => ({
    url: t.exposeString("url"),
    source: t.exposeString("source"),
    attributionHtml: t.exposeString("attributionHtml", { nullable: true }),
  }),
});

builder.prismaObject("Branch", {
  fields: (t) => ({
    id: t.exposeID("id"),
    name: t.exposeString("name"),
    addressText: t.exposeString("addressText"),
    lat: t.float({ resolve: (b) => Number(b.lat) }),
    lng: t.float({ resolve: (b) => Number(b.lng) }),
    deliveryRadiusM: t.exposeInt("deliveryRadiusM"),
    minOrderMinor: t.exposeInt("minOrderMinor"),
    deliveryFeeMinor: t.exposeInt("deliveryFeeMinor"),
    isAcceptingOrders: t.exposeBoolean("isAcceptingOrders"),
    prepBufferMinutes: t.exposeInt("prepBufferMinutes"),
    hoursJson: t.field({ type: "JSON", nullable: true, resolve: (b) => b.hoursJson }),
    // Structured opening hours (#19), day-sorted then by start time. Empty when the
    // branch still relies on the legacy hoursJson blob (or has no hours at all).
    hours: t.relation("hours", {
      query: { orderBy: [{ dayOfWeek: "asc" }, { openMinute: "asc" }] },
    }),
    // Server-computed open/closed state (evaluated in PKT). Prefers the structured
    // BranchHours rows and falls back to hoursJson (#19/#63). The home feed shows a
    // "Closed — opens HH:MM" overlay instead of hiding closed branches.
    isOpenNow: t.boolean({
      resolve: (b) => branchOpenNow(b).then((s) => s.isOpen),
    }),
    opensAtLabel: t.string({
      nullable: true,
      resolve: (b) => branchOpenNow(b).then((s) => s.opensAtLabel),
    }),
    restaurant: t.relation("restaurant"),
    // Image pipeline (#50): uploaded restaurant hero -> Google Places venue photo
    // -> null (client fallback). All secret/ToS-bound work stays server-side.
    photo: t.field({
      type: BranchPhoto,
      nullable: true,
      resolve: async (branch) => {
        const { assetUrl } = await import("../services/uploads.js");
        // Tier 1: restaurant's uploaded hero (owned, stored by us).
        const theme = await prisma.restaurantTheme.findUnique({
          where: { restaurantId: branch.restaurantId },
        });
        if (theme?.heroAssetId) {
          const a = await prisma.mediaAsset.findUnique({ where: { id: theme.heroAssetId } });
          if (a)
            return {
              url: assetUrl(a.objectKey),
              source: "uploaded" as const,
              attributionHtml: null,
            };
        }
        // Tier 2: live Google Places venue photo (no bytes stored).
        if (branch.googlePlaceId) {
          const { getPlacePhoto } = await import("../services/placesPhoto.js");
          const p = await getPlacePhoto(branch.googlePlaceId);
          if (p)
            return { url: p.url, source: "google" as const, attributionHtml: p.attributionHtml };
        }
        // Tier 3: no image -> client renders the typography fallback.
        return null;
      },
    }),
    activeMenu: t.prismaField({
      type: "Menu",
      nullable: true,
      resolve: (query, branch) =>
        branch.activeMenuId
          ? prisma.menu.findUnique({ ...query, where: { id: branch.activeMenuId } })
          : null,
    }),
    // "Popular" pseudo-category: top items by quantity across the last 30 days of
    // delivered orders at this branch, resolved back to their *current* menu items
    // (so removed/unavailable items drop out gracefully). New branches with no order
    // history simply return [] and the client omits the section.
    //
    // We tally by the snapshot *name*, not menuItemId: publishing a menu draft clones
    // it into fresh MenuItem rows with new ids (cloneMenu), so old snapshot ids would
    // stop matching the active menu and Popular would reset on every publish. Names are
    // stable across clones, so popularity survives edits. MVP is fully computed; a
    // future curated override (#38 "hybrid") would fetch pinned items first here.
    popularItems: t.prismaField({
      type: ["MenuItem"],
      args: { limit: t.arg.int({ required: false }) },
      resolve: async (query, branch, args) => {
        if (!branch.activeMenuId) return [];
        const limit = Math.min(Math.max(args.limit ?? 8, 1), 20);
        const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const rows = await prisma.orderItem.findMany({
          where: {
            order: { branchId: branch.id, status: "delivered", placedAt: { gte: since } },
          },
          select: { qty: true, menuSnapshotJson: true },
        });
        const tally = new Map<string, number>();
        for (const row of rows) {
          const snap = row.menuSnapshotJson as { name?: string } | null;
          const name = snap?.name;
          if (name) tally.set(name, (tally.get(name) ?? 0) + row.qty);
        }
        const topNames = [...tally.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, limit)
          .map(([name]) => name);
        if (topNames.length === 0) return [];
        const items = await prisma.menuItem.findMany({
          ...query,
          where: {
            name: { in: topNames },
            isAvailable: true,
            category: { menuId: branch.activeMenuId },
          },
        });
        // Rank by tally order; dedupe if two current items share a popular name.
        const rank = new Map(topNames.map((name, i) => [name, i]));
        const seen = new Set<string>();
        return items
          .filter((it) => (seen.has(it.name) ? false : (seen.add(it.name), true)))
          .sort((a, b) => (rank.get(a.name) ?? 99) - (rank.get(b.name) ?? 99));
      },
    }),
  }),
});

builder.prismaObject("BranchHours", {
  fields: (t) => ({
    id: t.exposeID("id"),
    dayOfWeek: t.exposeInt("dayOfWeek"),
    openMinute: t.exposeInt("openMinute"),
    closeMinute: t.exposeInt("closeMinute"),
  }),
});

builder.prismaObject("Menu", {
  fields: (t) => ({
    id: t.exposeID("id"),
    version: t.exposeInt("version"),
    status: t.exposeString("status"),
    layoutJson: t.field({ type: "JSON", nullable: true, resolve: (m) => m.layoutJson }),
    categories: t.relation("categories", {
      query: { orderBy: { sortOrder: "asc" } },
    }),
  }),
});

builder.prismaObject("MenuCategory", {
  fields: (t) => ({
    id: t.exposeID("id"),
    name: t.exposeString("name"),
    description: t.exposeString("description", { nullable: true }),
    sortOrder: t.exposeInt("sortOrder"),
    items: t.relation("items", { query: { orderBy: { sortOrder: "asc" } } }),
  }),
});

builder.prismaObject("MenuItem", {
  fields: (t) => ({
    id: t.exposeID("id"),
    name: t.exposeString("name"),
    description: t.exposeString("description", { nullable: true }),
    priceMinor: t.exposeInt("priceMinor"),
    isAvailable: t.exposeBoolean("isAvailable"),
    // Timed 86 (#46): when this item is scheduled to come back. null when available or
    // 86'd indefinitely. Informational for the vendor board; not enforced server-side yet.
    unavailableUntil: t.field({
      type: "DateTime",
      nullable: true,
      resolve: (i) => i.unavailableUntil,
    }),
    badges: t.exposeStringList("badges"),
    // Image pipeline (#50): uploaded dish photo only. Google Places has no
    // per-dish imagery, so items skip tier 2 — null -> client typography fallback.
    imageUrl: t.string({
      nullable: true,
      resolve: async (item) => {
        if (!item.imageAssetId) return null;
        const a = await prisma.mediaAsset.findUnique({ where: { id: item.imageAssetId } });
        return a ? (await import("../services/uploads.js")).assetUrl(a.objectKey) : null;
      },
    }),
    modifierGroups: t.field({
      type: [ModifierGroupType],
      resolve: async (item) => {
        const joins = await prisma.menuItemModifierGroup.findMany({
          where: { itemId: item.id },
          orderBy: { sortOrder: "asc" },
          include: { group: { include: { options: { orderBy: { sortOrder: "asc" } } } } },
        });
        return joins.map((j) => j.group);
      },
    }),
  }),
});

const ModifierGroupType = builder.prismaObject("ModifierGroup", {
  fields: (t) => ({
    id: t.exposeID("id"),
    name: t.exposeString("name"),
    minSelect: t.exposeInt("minSelect"),
    maxSelect: t.exposeInt("maxSelect"),
    // Derived (no column): a group the customer must choose from at least once.
    required: t.boolean({ resolve: (g) => g.minSelect >= 1 }),
    // prismaField (not t.relation): parents of this type are sometimes loaded manually
    // (MenuItem.modifierGroups), where relation include-propagation can't apply.
    options: t.prismaField({
      type: ["ModifierOption"],
      resolve: (query, group) =>
        prisma.modifierOption.findMany({
          ...query,
          where: { groupId: group.id },
          orderBy: { sortOrder: "asc" },
        }),
    }),
  }),
});

builder.prismaObject("ModifierOption", {
  fields: (t) => ({
    id: t.exposeID("id"),
    name: t.exposeString("name"),
    priceDeltaMinor: t.exposeInt("priceDeltaMinor"),
    isAvailable: t.exposeBoolean("isAvailable"),
  }),
});

type BranchSearchHit = { branchId: string; distanceM: number };
const BranchSearchResult = builder.objectRef<BranchSearchHit>("BranchSearchResult");
BranchSearchResult.implement({
  fields: (t) => ({
    distanceM: t.exposeInt("distanceM"),
    etaMinutes: t.int({
      // Coarse ETA band: prep default 20m + ride time at ~20km/h.
      resolve: (hit) => 20 + Math.round(hit.distanceM / 333),
    }),
    branch: t.prismaField({
      type: "Branch",
      resolve: (query, hit) =>
        prisma.branch.findUniqueOrThrow({ ...query, where: { id: hit.branchId } }),
    }),
  }),
});

builder.prismaObject("HomeBanner", {
  fields: (t) => ({
    id: t.exposeID("id"),
    title: t.exposeString("title"),
    imageUrl: t.exposeString("imageUrl"),
    linkHref: t.exposeString("linkHref", { nullable: true }),
  }),
});

// Delivery-area waitlist entry (#64). Public "notify me" sign-up, upserted by email.
builder.prismaObject("Waitlist", {
  fields: (t) => ({
    id: t.exposeID("id"),
    email: t.exposeString("email"),
    areaLabel: t.exposeString("areaLabel", { nullable: true }),
    createdAt: t.field({ type: "DateTime", resolve: (w) => w.createdAt }),
  }),
});

builder.queryFields((t) => ({
  // Active promo banners for the home carousel, ordered by sortOrder. The active
  // window (startsAt/endsAt) is enforced here so the client never sees expired ones.
  homeBanners: t.prismaField({
    type: ["HomeBanner"],
    resolve: (query) => {
      const now = new Date();
      return prisma.homeBanner.findMany({
        ...query,
        where: {
          isActive: true,
          AND: [
            { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
            { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
          ],
        },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      });
    },
  }),

  browseBranches: t.field({
    type: [BranchSearchResult],
    args: {
      lat: t.arg.float({ required: true }),
      lng: t.arg.float({ required: true }),
    },
    resolve: async (_root, args) => {
      const branches = await prisma.branch.findMany({
        where: { restaurant: { status: "approved" }, activeMenuId: { not: null } },
        select: { id: true, lat: true, lng: true, deliveryRadiusM: true },
      });
      return branches
        .map((b) => ({
          branchId: b.id,
          distanceM: haversineMeters(Number(b.lat), Number(b.lng), args.lat, args.lng),
          radius: b.deliveryRadiusM,
        }))
        .filter((b) => b.distanceM <= b.radius)
        .sort((a, b) => a.distanceM - b.distanceM);
    },
  }),

  branchBySlug: t.prismaField({
    type: "Branch",
    nullable: true,
    args: { slug: t.arg.string({ required: true }) },
    resolve: (query, _root, args) =>
      prisma.branch.findFirst({
        ...query,
        where: { restaurant: { slug: args.slug, status: "approved" } },
      }),
  }),
}));

const joinWaitlistSchema = z.object({
  email: z.string().email().max(320),
  areaLabel: z.string().max(120).optional(),
  lat: z.number().gte(-90).lte(90).optional(),
  lng: z.number().gte(-180).lte(180).optional(),
});

builder.mutationFields((t) => ({
  // Persist an empty-delivery-area "notify me" sign-up (#64). Public (no auth).
  // Upsert by email so a repeat submit refreshes the recorded area/pin.
  joinWaitlist: t.prismaField({
    type: "Waitlist",
    args: {
      email: t.arg.string({ required: true }),
      areaLabel: t.arg.string({ required: false }),
      lat: t.arg.float({ required: false }),
      lng: t.arg.float({ required: false }),
    },
    resolve: (query, _root, args) => {
      const parsed = joinWaitlistSchema.safeParse({
        email: args.email,
        areaLabel: args.areaLabel ?? undefined,
        lat: args.lat ?? undefined,
        lng: args.lng ?? undefined,
      });
      if (!parsed.success) throw new GraphQLError("Enter a valid email address");
      const email = parsed.data.email.trim().toLowerCase();
      const data = {
        areaLabel: parsed.data.areaLabel ?? null,
        lat: parsed.data.lat ?? null,
        lng: parsed.data.lng ?? null,
      };
      return prisma.waitlist.upsert({
        ...query,
        where: { email },
        update: data,
        create: { email, ...data },
      });
    },
  }),
}));
