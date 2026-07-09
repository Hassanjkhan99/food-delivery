// Public marketplace: browse restaurants, branch detail, published menu, theme.
import { prisma } from "@fd/db";
import { haversineMeters } from "@fd/shared";
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
  }),
});

builder.prismaObject("Restaurant", {
  fields: (t) => ({
    id: t.exposeID("id"),
    name: t.exposeString("name"),
    slug: t.exposeString("slug"),
    status: t.exposeString("status"),
    tier: t.exposeString("tier"),
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
    hoursJson: t.field({ type: "JSON", nullable: true, resolve: (b) => b.hoursJson }),
    restaurant: t.relation("restaurant"),
    activeMenu: t.prismaField({
      type: "Menu",
      nullable: true,
      resolve: (query, branch) =>
        branch.activeMenuId
          ? prisma.menu.findUnique({ ...query, where: { id: branch.activeMenuId } })
          : null,
    }),
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
    badges: t.exposeStringList("badges"),
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

builder.queryFields((t) => ({
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
