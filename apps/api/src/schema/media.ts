// Uploads, menu source docs (physical-menu digitization), CSV import, layout,
// theming, and post-delivery ratings.
import { prisma } from "@fd/db";
import { GraphQLError } from "graphql";
import type { AppContext } from "../context.js";
import { assetUrl, finalizeUpload, presignUpload } from "../services/uploads.js";
import { importMenuCsv, parseMenuCsvAsset } from "../services/menuImport.js";
import { ensureDraft } from "../services/menuService.js";
import { builder } from "./builder.js";

async function assertBranchMember(ctx: AppContext, branchId: string) {
  const branch = await prisma.branch.findUnique({ where: { id: branchId } });
  if (!branch) throw new GraphQLError("Branch not found");
  if (!ctx.restaurantIds.includes(branch.restaurantId) && !ctx.hasRole("admin")) {
    throw new GraphQLError("Not a member of this restaurant");
  }
  return branch;
}

const MediaAssetType = builder.prismaObject("MediaAsset", {
  fields: (t) => ({
    id: t.exposeID("id"),
    contentType: t.exposeString("contentType"),
    status: t.exposeString("status"),
    url: t.string({ resolve: (a) => assetUrl(a.objectKey) }),
  }),
});

const PresignResult = builder.objectRef<{ assetId: string; uploadUrl: string }>("PresignResult");
PresignResult.implement({
  fields: (t) => ({
    assetId: t.exposeString("assetId"),
    uploadUrl: t.exposeString("uploadUrl"),
  }),
});

builder.prismaObject("MenuSourceDoc", {
  fields: (t) => ({
    id: t.exposeID("id"),
    kind: t.exposeString("kind"),
    status: t.exposeString("status"),
    createdAt: t.field({ type: "DateTime", resolve: (d) => d.createdAt }),
    asset: t.relation("asset"),
  }),
});

const CsvRowType = builder.objectRef<{
  line: number;
  category: string;
  name: string;
  description: string;
  priceMinor: number;
  error: string | null;
}>("CsvPreviewRow");
CsvRowType.implement({
  fields: (t) => ({
    line: t.exposeInt("line"),
    category: t.exposeString("category"),
    name: t.exposeString("name"),
    description: t.exposeString("description"),
    priceMinor: t.exposeInt("priceMinor"),
    error: t.exposeString("error", { nullable: true }),
  }),
});

const ImportResult = builder.objectRef<{ created: number; updated: number }>("CsvImportResult");
ImportResult.implement({
  fields: (t) => ({
    created: t.exposeInt("created"),
    updated: t.exposeInt("updated"),
  }),
});

builder.queryFields((t) => ({
  menuSourceDocs: t.prismaField({
    type: ["MenuSourceDoc"],
    authScopes: { restaurantMember: true },
    args: { branchId: t.arg.string({ required: true }) },
    resolve: async (query, _root, args, ctx) => {
      await assertBranchMember(ctx, args.branchId);
      return prisma.menuSourceDoc.findMany({
        ...query,
        where: { branchId: args.branchId },
        orderBy: { createdAt: "desc" },
      });
    },
  }),
}));

builder.mutationFields((t) => ({
  presignUpload: t.field({
    type: PresignResult,
    authScopes: { loggedIn: true },
    args: {
      contentType: t.arg.string({ required: true }),
      byteSize: t.arg.int({ required: true }),
      kind: t.arg.string({ required: true }),
    },
    resolve: (_root, args, ctx) => presignUpload(ctx.userId!, args),
  }),

  finalizeUpload: t.prismaField({
    type: MediaAssetType,
    authScopes: { loggedIn: true },
    args: { assetId: t.arg.string({ required: true }) },
    resolve: (_q, _root, args, ctx) => finalizeUpload(ctx.userId!, args.assetId),
  }),

  registerMenuSourceDoc: t.prismaField({
    type: "MenuSourceDoc",
    authScopes: { restaurantMember: true },
    args: {
      branchId: t.arg.string({ required: true }),
      assetId: t.arg.string({ required: true }),
      kind: t.arg.string({ required: true }),
    },
    resolve: async (_q, _root, args, ctx) => {
      await assertBranchMember(ctx, args.branchId);
      if (!["photo", "pdf", "csv"].includes(args.kind)) throw new GraphQLError("Invalid kind");
      const asset = await prisma.mediaAsset.findUnique({ where: { id: args.assetId } });
      if (!asset || asset.status !== "finalized") throw new GraphQLError("Asset not finalized");
      return prisma.menuSourceDoc.create({
        data: { branchId: args.branchId, assetId: args.assetId, kind: args.kind as never },
      });
    },
  }),

  previewMenuCsv: t.field({
    type: [CsvRowType],
    authScopes: { restaurantMember: true },
    args: { assetId: t.arg.string({ required: true }) },
    resolve: (_root, args, ctx) => parseMenuCsvAsset(ctx.userId!, args.assetId),
  }),

  importMenuCsvToDraft: t.field({
    type: ImportResult,
    authScopes: { restaurantMember: true },
    args: {
      branchId: t.arg.string({ required: true }),
      assetId: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      await assertBranchMember(ctx, args.branchId);
      return importMenuCsv(ctx.userId!, args.branchId, args.assetId);
    },
  }),

  updateMenuLayout: t.prismaField({
    type: "Menu",
    authScopes: { restaurantMember: true },
    args: {
      branchId: t.arg.string({ required: true }),
      layoutJson: t.arg({ type: "JSON", required: true }),
    },
    resolve: async (_q, _root, args, ctx) => {
      await assertBranchMember(ctx, args.branchId);
      const draft = await ensureDraft(args.branchId);
      return prisma.menu.update({
        where: { id: draft.id },
        data: { layoutJson: args.layoutJson as never },
      });
    },
  }),

  updateTheme: t.prismaField({
    type: "RestaurantTheme",
    authScopes: { restaurantMember: true },
    args: {
      restaurantId: t.arg.string({ required: true }),
      primaryColor: t.arg.string({ required: false }),
      accentColor: t.arg.string({ required: false }),
      backgroundColor: t.arg.string({ required: false }),
      textColor: t.arg.string({ required: false }),
      fontKey: t.arg.string({ required: false }),
      cardStyle: t.arg.string({ required: false }),
      heroEffect: t.arg.string({ required: false }),
      logoAssetId: t.arg.string({ required: false }),
      heroAssetId: t.arg.string({ required: false }),
    },
    resolve: async (_q, _root, args, ctx) => {
      if (!ctx.restaurantIds.includes(args.restaurantId) && !ctx.hasRole("admin")) {
        throw new GraphQLError("Not a member of this restaurant");
      }
      const color = /^#[0-9a-fA-F]{6}$/;
      for (const c of [args.primaryColor, args.accentColor, args.backgroundColor, args.textColor]) {
        if (c && !color.test(c)) throw new GraphQLError("Colors must be #rrggbb");
      }
      if (args.cardStyle && !["flat", "tilt3d", "glass"].includes(args.cardStyle)) {
        throw new GraphQLError("Invalid card style");
      }
      if (args.heroEffect && !["none", "parallax", "depth"].includes(args.heroEffect)) {
        throw new GraphQLError("Invalid hero effect");
      }
      const data = {
        ...(args.primaryColor ? { primaryColor: args.primaryColor } : {}),
        ...(args.accentColor ? { accentColor: args.accentColor } : {}),
        ...(args.backgroundColor ? { backgroundColor: args.backgroundColor } : {}),
        ...(args.textColor ? { textColor: args.textColor } : {}),
        ...(args.fontKey ? { fontKey: args.fontKey } : {}),
        ...(args.cardStyle ? { cardStyle: args.cardStyle as never } : {}),
        ...(args.heroEffect ? { heroEffect: args.heroEffect as never } : {}),
        ...(args.logoAssetId !== undefined ? { logoAssetId: args.logoAssetId } : {}),
        ...(args.heroAssetId !== undefined ? { heroAssetId: args.heroAssetId } : {}),
      };
      return prisma.restaurantTheme.upsert({
        where: { restaurantId: args.restaurantId },
        update: data,
        create: { restaurantId: args.restaurantId, ...data },
      });
    },
  }),

  rateOrder: t.prismaField({
    type: "Rating",
    authScopes: { loggedIn: true },
    args: {
      orderId: t.arg.string({ required: true }),
      stars: t.arg.int({ required: true }),
      tags: t.arg.stringList({ required: false }),
      comment: t.arg.string({ required: false }),
    },
    resolve: async (_q, _root, args, ctx) => {
      if (args.stars < 1 || args.stars > 5) throw new GraphQLError("Stars must be 1-5");
      const order = await prisma.order.findUnique({
        where: { id: args.orderId },
        include: { branch: true },
      });
      if (!order || order.customerId !== ctx.userId) throw new GraphQLError("Order not found");
      if (order.status !== "delivered") throw new GraphQLError("Only delivered orders can be rated");
      const existing = await prisma.rating.findUnique({ where: { orderId: args.orderId } });
      if (existing) throw new GraphQLError("Order already rated");
      return prisma.rating.create({
        data: {
          orderId: args.orderId,
          customerId: ctx.userId!,
          restaurantId: order.branch.restaurantId,
          stars: args.stars,
          tags: args.tags ?? [],
          comment: args.comment,
        },
      });
    },
  }),
}));

builder.prismaObject("Rating", {
  fields: (t) => ({
    id: t.exposeID("id"),
    stars: t.exposeInt("stars"),
    tags: t.exposeStringList("tags"),
    comment: t.exposeString("comment", { nullable: true }),
  }),
});
