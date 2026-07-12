// Public marketplace: browse restaurants, branch detail, published menu, theme.
import { prisma } from "@fd/db";
import {
  BROWSE_SORTS,
  type BrowseSort,
  haversineMeters,
  median,
  priceBandFor,
} from "@fd/shared";
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
    // Promoted deals (#22): the label of the restaurant's active in-window deal_badge
    // campaign, or null. Cards render this as a "deal" pill. Kept lightweight (one
    // findFirst) so it can be selected per-card without a dedicated query.
    dealBadge: t.string({
      nullable: true,
      resolve: async (r) => {
        const now = new Date();
        const c = await prisma.campaign.findFirst({
          where: {
            restaurantId: r.id,
            type: "deal_badge",
            status: "active",
            AND: [
              { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
              { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
            ],
          },
          orderBy: { createdAt: "desc" },
        });
        if (!c) return null;
        return c.label?.trim() || "Deal";
      },
    }),
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
          const snap = row.menuSnapshotJson as { name?: string; kind?: string } | null;
          // Popular resolves names back to MenuItem rows, so only tally item lines —
          // combo (#53) snapshots share a top-level name that isn't a menu item.
          if (snap?.kind === "combo") continue;
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
    // Combos / meal deals (#53), available ones first, then by sort order. The client
    // aggregates these + discounted items into a "Deals" section at the top of the menu.
    combos: t.relation("combos", {
      query: { orderBy: [{ isAvailable: "desc" }, { sortOrder: "asc" }] },
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
    // Item-level offer (#53): the "was" price. The client strikes it through and shows a
    // "% off" badge; priceMinor stays the charged price. Only meaningful when strictly
    // greater than priceMinor — we null it out otherwise so the UI never shows a fake deal.
    compareAtPriceMinor: t.int({
      nullable: true,
      resolve: (item) =>
        item.compareAtPriceMinor != null && item.compareAtPriceMinor > item.priceMinor
          ? item.compareAtPriceMinor
          : null,
    }),
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

// Combo / meal deal (#53). priceMinor is the fixed bundle price. originalPriceMinor is
// the summed a-la-carte price of the components (server-computed) so the client can show
// the saving without trusting the client. Components are the frozen-at-quote item list.
builder.prismaObject("Combo", {
  fields: (t) => ({
    id: t.exposeID("id"),
    name: t.exposeString("name"),
    description: t.exposeString("description", { nullable: true }),
    priceMinor: t.exposeInt("priceMinor"),
    isAvailable: t.exposeBoolean("isAvailable"),
    items: t.relation("items", { query: { orderBy: { sortOrder: "asc" } } }),
    imageUrl: t.string({
      nullable: true,
      resolve: async (combo) => {
        if (!combo.imageAssetId) return null;
        const a = await prisma.mediaAsset.findUnique({ where: { id: combo.imageAssetId } });
        return a ? (await import("../services/uploads.js")).assetUrl(a.objectKey) : null;
      },
    }),
    // Sum of the components' current a-la-carte prices (item price × qty). The "% off" is
    // (original - price) / original. Computed server-side so the badge can't be spoofed.
    originalPriceMinor: t.int({
      resolve: async (combo) => {
        const items = await prisma.comboItem.findMany({
          where: { comboId: combo.id },
          include: { menuItem: true },
        });
        return items.reduce((s, ci) => s + ci.menuItem.priceMinor * ci.qty, 0);
      },
    }),
  }),
});

builder.prismaObject("ComboItem", {
  fields: (t) => ({
    id: t.exposeID("id"),
    qty: t.exposeInt("qty"),
    menuItem: t.relation("menuItem"),
  }),
});

// A ranked browse hit. distanceM comes from haversine; priceBand (1-3) and
// popularityScore are computed server-side in browseBranches (#51) so sort/filter
// stay consistent and the client can render the "Rs/Rs Rs/Rs Rs Rs" band cheaply.
type BranchSearchHit = {
  branchId: string;
  distanceM: number;
  priceBand: number;
  popularityScore: number;
};
const BranchSearchResult = builder.objectRef<BranchSearchHit>("BranchSearchResult");
BranchSearchResult.implement({
  fields: (t) => ({
    distanceM: t.exposeInt("distanceM"),
    // Menu-median price band 1-3 (0 = unknown, empty menu). Client maps to "Rs" glyphs.
    priceBand: t.exposeInt("priceBand"),
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

// A dish hit from searchMarketplace: the matched menu item plus the branch/restaurant
// it belongs to (and its distance) so the client can render a thumbnail row that
// deep-links into /r/[slug]?item=<menuItemId>.
type ItemSearchHit = { menuItemId: string; branchId: string; distanceM: number };
const ItemSearchResult = builder.objectRef<ItemSearchHit>("ItemSearchResult");
ItemSearchResult.implement({
  fields: (t) => ({
    distanceM: t.exposeInt("distanceM"),
    item: t.prismaField({
      type: "MenuItem",
      resolve: (query, hit) =>
        prisma.menuItem.findUniqueOrThrow({ ...query, where: { id: hit.menuItemId } }),
    }),
    branch: t.prismaField({
      type: "Branch",
      resolve: (query, hit) =>
        prisma.branch.findUniqueOrThrow({ ...query, where: { id: hit.branchId } }),
    }),
  }),
});

// Combined typeahead/results payload for the /search screen (#37).
type SearchPayload = { restaurants: BranchSearchHit[]; items: ItemSearchHit[] };
const SearchMarketplaceResult = builder.objectRef<SearchPayload>("SearchMarketplaceResult");
SearchMarketplaceResult.implement({
  fields: (t) => ({
    restaurants: t.field({ type: [BranchSearchResult], resolve: (p) => p.restaurants }),
    items: t.field({ type: [ItemSearchResult], resolve: (p) => p.items }),
  }),
});

// ── browse filter + sort inputs (#51) ────────────────────────────────────────
const BrowseFilterInput = builder.inputType("BrowseFilter", {
  fields: (t) => ({
    // Only branches whose delivery fee is 0.
    freeDelivery: t.boolean({ required: false }),
    // Minimum approved-rating average (e.g. 4.0 / 4.5). Branches with no rating
    // are excluded when this is set (they can't be proven to clear the bar).
    minRating: t.float({ required: false }),
    // Cap on the 1-3 price band (1 = only budget, 3 = anything).
    maxPriceBand: t.int({ required: false }),
    // Only branches open right now (server-evaluated from structured hours / hoursJson).
    openNow: t.boolean({ required: false }),
    // Match ANY of these platform cuisine tags (OR semantics, Foodpanda-style chips).
    cuisineTags: t.stringList({ required: false }),
  }),
});

const BrowseSortEnum = builder.enumType("BrowseSort", {
  values: BROWSE_SORTS,
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

  // Discovery feed (#51): deliverable branches, optionally filtered (free delivery,
  // min rating, price band, open-now, cuisine chips) and sorted. Filters that need
  // server-only data (open-now from hours, priceBand from menu median, popularity from
  // 30-day delivered orders, rating from approved ratings) are computed here so the
  // client can't reproduce them from the wire shape.
  browseBranches: t.field({
    type: [BranchSearchResult],
    args: {
      lat: t.arg.float({ required: true }),
      lng: t.arg.float({ required: true }),
      filter: t.arg({ type: BrowseFilterInput, required: false }),
      sort: t.arg({ type: BrowseSortEnum, required: false }),
    },
    resolve: async (_root, args) => {
      const filter = args.filter ?? {};
      const cuisineTags = (filter.cuisineTags ?? []).filter((c) => c.trim().length > 0);

      // Cheap DB-side filters first (delivery fee, cuisine) to shrink the set before
      // the per-branch computed work below.
      const branches = await prisma.branch.findMany({
        where: {
          restaurant: {
            status: "approved",
            ...(cuisineTags.length > 0 ? { cuisineTags: { hasSome: cuisineTags } } : {}),
          },
          activeMenuId: { not: null },
          ...(filter.freeDelivery ? { deliveryFeeMinor: 0 } : {}),
        },
        select: {
          id: true,
          lat: true,
          lng: true,
          deliveryRadiusM: true,
          hoursJson: true,
          restaurantId: true,
          activeMenuId: true,
        },
      });

      // Deliverable-radius gate (haversine) — the original behaviour.
      const inRange = branches
        .map((b) => ({
          branch: b,
          distanceM: haversineMeters(Number(b.lat), Number(b.lng), args.lat, args.lng),
        }))
        .filter(({ distanceM, branch }) => distanceM <= branch.deliveryRadiusM);

      if (inRange.length === 0) return [];

      const branchIds = inRange.map(({ branch }) => branch.id);
      const restaurantIds = [...new Set(inRange.map(({ branch }) => branch.restaurantId))];
      const menuIds = inRange
        .map(({ branch }) => branch.activeMenuId)
        .filter((id): id is string => Boolean(id));
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      // Batch the computed inputs so we don't fan out per branch.
      const [ratingRows, priceRows, popularityRows] = await Promise.all([
        prisma.rating.groupBy({
          by: ["restaurantId"],
          where: { restaurantId: { in: restaurantIds }, moderationStatus: "approved" },
          _avg: { stars: true },
        }),
        // All available item prices for each active menu, to compute a per-branch median.
        prisma.menuItem.findMany({
          where: {
            isAvailable: true,
            category: { menuId: { in: menuIds } },
          },
          select: { priceMinor: true, category: { select: { menuId: true } } },
        }),
        prisma.order.groupBy({
          by: ["branchId"],
          where: { branchId: { in: branchIds }, status: "delivered", placedAt: { gte: since } },
          _count: { _all: true },
        }),
      ]);

      const ratingByRestaurant = new Map(
        ratingRows.map((r) => [r.restaurantId, r._avg.stars ?? null]),
      );
      const pricesByMenu = new Map<string, number[]>();
      for (const row of priceRows) {
        const mid = row.category.menuId;
        const list = pricesByMenu.get(mid) ?? [];
        list.push(row.priceMinor);
        pricesByMenu.set(mid, list);
      }
      const popularityByBranch = new Map(
        popularityRows.map((r) => [r.branchId, r._count._all]),
      );

      // Open-now is evaluated per branch (loads structured hours) only when needed for
      // the filter or the eta/relevance sort — but it's cheap and we need it for the
      // openNow filter, so resolve for the whole set in parallel.
      const openStates = await Promise.all(
        inRange.map(({ branch }) =>
          branchOpenNow({ id: branch.id, hoursJson: branch.hoursJson }).then((s) => s.isOpen),
        ),
      );

      let hits = inRange.map(({ branch, distanceM }, i) => {
        const prices = branch.activeMenuId ? pricesByMenu.get(branch.activeMenuId) ?? [] : [];
        const rating = ratingByRestaurant.get(branch.restaurantId) ?? null;
        return {
          branchId: branch.id,
          distanceM,
          priceBand: prices.length > 0 ? priceBandFor(median(prices)) : 0,
          popularityScore: popularityByBranch.get(branch.id) ?? 0,
          isOpenNow: openStates[i],
          rating,
        };
      });

      // Computed filters.
      if (filter.openNow) hits = hits.filter((h) => h.isOpenNow);
      if (typeof filter.minRating === "number") {
        hits = hits.filter((h) => h.rating != null && h.rating >= filter.minRating!);
      }
      if (typeof filter.maxPriceBand === "number") {
        // priceBand 0 (unknown/empty menu) never satisfies a cap.
        hits = hits.filter((h) => h.priceBand > 0 && h.priceBand <= filter.maxPriceBand!);
      }

      const sort: BrowseSort = args.sort ?? "relevance";
      hits.sort((a, b) => {
        switch (sort) {
          case "rating":
            return (b.rating ?? -1) - (a.rating ?? -1) || a.distanceM - b.distanceM;
          case "distance":
            return a.distanceM - b.distanceM;
          case "eta":
            // eta is monotonic in distance (prep is constant), so distance ordering matches.
            return a.distanceM - b.distanceM;
          case "popularity":
            return b.popularityScore - a.popularityScore || a.distanceM - b.distanceM;
          case "relevance":
          default:
            // Hybrid default: open branches first, then nearest.
            if (a.isOpenNow !== b.isOpenNow) return a.isOpenNow ? -1 : 1;
            return a.distanceM - b.distanceM;
        }
      });

      return hits.map((h) => ({
        branchId: h.branchId,
        distanceM: h.distanceM,
        priceBand: h.priceBand,
        popularityScore: h.popularityScore,
      }));
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

  // Marketplace search (#37): case-insensitive match over restaurant names,
  // cuisine tags, and ACTIVE menu item names — restricted to approved restaurants
  // whose branch delivers to (lat,lng). Returns two parallel lists (restaurants +
  // dishes) so the /search UI can tab between them. Distance-sorted like the home feed.
  //
  // v1 uses Prisma `contains`/`hasSome` (ILIKE under the hood) rather than pg_trgm
  // (#37 target) — it needs no extension/index migration (DB is offline) and is plenty
  // for the pilot dataset. Swapping in a trigram index later is a pure perf change.
  searchMarketplace: t.field({
    type: SearchMarketplaceResult,
    args: {
      query: t.arg.string({ required: true }),
      lat: t.arg.float({ required: true }),
      lng: t.arg.float({ required: true }),
    },
    resolve: async (_root, args): Promise<SearchPayload> => {
      const q = args.query.trim();
      if (q.length < 2) return { restaurants: [], items: [] };

      // Branches that deliver here, keyed for distance lookup.
      const nearby = await prisma.branch.findMany({
        where: { restaurant: { status: "approved" }, activeMenuId: { not: null } },
        select: { id: true, lat: true, lng: true, deliveryRadiusM: true, activeMenuId: true },
      });
      const inRange = nearby
        .map((b) => ({
          id: b.id,
          activeMenuId: b.activeMenuId,
          distanceM: haversineMeters(Number(b.lat), Number(b.lng), args.lat, args.lng),
          radius: b.deliveryRadiusM,
        }))
        .filter((b) => b.distanceM <= b.radius);
      const distanceById = new Map(inRange.map((b) => [b.id, b.distanceM]));
      const menuIdToBranch = new Map(
        inRange.flatMap((b) => (b.activeMenuId ? [[b.activeMenuId, b.id] as const] : [])),
      );

      // Restaurant hits: name OR cuisine tag matches. Collapse to the single nearest
      // in-range branch per restaurant so a chain doesn't flood the list.
      const restaurants = await prisma.restaurant.findMany({
        where: {
          status: "approved",
          OR: [{ name: { contains: q, mode: "insensitive" } }, { cuisineTags: { has: q } }],
          branches: { some: { id: { in: [...distanceById.keys()] } } },
        },
        select: { branches: { select: { id: true } } },
      });
      const restaurantHits: BranchSearchHit[] = [];
      const seenBranch = new Set<string>();
      for (const r of restaurants) {
        const candidates = r.branches
          .map((b) => ({ id: b.id, distanceM: distanceById.get(b.id) }))
          .filter((b): b is { id: string; distanceM: number } => b.distanceM !== undefined)
          .sort((a, b) => a.distanceM - b.distanceM);
        const best = candidates[0];
        if (best && !seenBranch.has(best.id)) {
          seenBranch.add(best.id);
          // priceBand/popularityScore are browse-ranking facets (#51); search results
          // don't rank by them, so default to 0 (= unknown, handled by the client).
          restaurantHits.push({
            branchId: best.id,
            distanceM: best.distanceM,
            priceBand: 0,
            popularityScore: 0,
          });
        }
      }
      restaurantHits.sort((a, b) => a.distanceM - b.distanceM);

      // Dish hits: available items in an in-range active menu whose name matches.
      // No DB-side `take` here: Prisma would slice an arbitrary first N rows *before*
      // branch distances are known, dropping closer matches beyond the cutoff. Instead
      // we fetch all in-range matches (the query is already bounded to nearby menus),
      // attach distances, sort, then cap — so the cap keeps the nearest results.
      const menuIds = [...menuIdToBranch.keys()];
      const items = menuIds.length
        ? await prisma.menuItem.findMany({
            where: {
              name: { contains: q, mode: "insensitive" },
              isAvailable: true,
              category: { menuId: { in: menuIds } },
            },
            select: { id: true, category: { select: { menuId: true } } },
          })
        : [];
      const itemHits: ItemSearchHit[] = [];
      for (const it of items) {
        const branchId = menuIdToBranch.get(it.category.menuId);
        if (!branchId) continue;
        itemHits.push({ menuItemId: it.id, branchId, distanceM: distanceById.get(branchId) ?? 0 });
      }
      itemHits.sort((a, b) => a.distanceM - b.distanceM);

      return { restaurants: restaurantHits, items: itemHits.slice(0, 50) };
    },
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
      if (!parsed.success)
        throw new GraphQLError("Please enter a valid email address.", {
          extensions: { code: "validation_error" },
        });
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
