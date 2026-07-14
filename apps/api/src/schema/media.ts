// Uploads, menu source docs (physical-menu digitization), CSV import, layout,
// theming, and post-delivery ratings.
import { prisma } from "@fd/db";
import { GraphQLError } from "graphql";
import type { AppContext } from "../context.js";
import { assetReadUrl, finalizeUpload, presignUpload } from "../services/uploads.js";
import { importMenuCsv, parseMenuCsvAsset } from "../services/menuImport.js";
import { previewMenuOcrAsset, type MenuOcrResult } from "../services/menuOcr.js";
import { ensureDraft } from "../services/menuService.js";
import { builder } from "./builder.js";

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

// Menu digitization/import/layout are owner-only (#204): restaurant_staff run the order
// board, not the menu. Gate at the resolver so nav-hiding isn't the only barrier.
async function assertBranchOwner(ctx: AppContext, branchId: string) {
  const branch = await assertBranchMember(ctx, branchId);
  const isOwner = ctx.roles.some(
    (r) => r.role === "restaurant_owner" && r.restaurantId === branch.restaurantId,
  );
  if (!isOwner && !ctx.hasRole("admin")) {
    throw new GraphQLError("Only the restaurant owner can do this.", {
      extensions: { code: "forbidden" },
    });
  }
  return branch;
}

const MediaAssetType = builder.prismaObject("MediaAsset", {
  fields: (t) => ({
    id: t.exposeID("id"),
    contentType: t.exposeString("contentType"),
    status: t.exposeString("status"),
    // Async so a private asset yields a fresh short-lived signed URL each read (#119);
    // public assets still resolve to the plain public URL.
    url: t.string({ resolve: (a) => assetReadUrl(a.objectKey) }),
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

// Photo/PDF OCR preview (#177). Reuses CsvPreviewRow so the extracted rows flow into the
// same review UI + importMenuCsvToDraft pipeline as CSV. With MENU_OCR_DRIVER=none (default)
// `status` is "not_configured" and `rows` is empty — a safe no-op until a provider is wired.
const MenuOcrPreviewType = builder.objectRef<MenuOcrResult>("MenuOcrPreview");
MenuOcrPreviewType.implement({
  fields: (t) => ({
    // "ok" | "not_configured" | "unsupported" | "failed"
    status: t.exposeString("status"),
    message: t.exposeString("message"),
    driver: t.exposeString("driver"),
    rows: t.field({ type: [CsvRowType], resolve: (r) => r.rows }),
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
      await assertBranchOwner(ctx, args.branchId);
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
      // Route sensitive uploads (KYC/CNIC, rider docs) to a signed-read private key (#119).
      private: t.arg.boolean({ required: false }),
    },
    resolve: (_root, args, ctx) =>
      presignUpload(ctx.userId!, { ...args, private: args.private ?? undefined }),
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
      await assertBranchOwner(ctx, args.branchId);
      if (!["photo", "pdf", "csv"].includes(args.kind))
        throw new GraphQLError("Please choose a valid document type: photo, PDF, or CSV.", {
          extensions: { code: "validation_error" },
        });
      const asset = await prisma.mediaAsset.findUnique({ where: { id: args.assetId } });
      if (!asset || asset.status !== "finalized")
        throw new GraphQLError("Please finish uploading the file before continuing.", {
          extensions: { code: "invalid_state" },
        });
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

  // Photo/PDF OCR preview (#177). Owner-gated like the other menu-import mutations.
  // Additive: routes the asset through the MENU_OCR_DRIVER provider and returns rows in
  // the CsvPreviewRow shape, so the client feeds them straight into importMenuCsvToDraft.
  // Default driver "none" returns an empty preview + a "connect an OCR provider" message.
  previewMenuOcr: t.field({
    type: MenuOcrPreviewType,
    authScopes: { restaurantMember: true },
    args: {
      branchId: t.arg.string({ required: true }),
      assetId: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      await assertBranchOwner(ctx, args.branchId);
      return previewMenuOcrAsset(ctx.userId!, args.assetId);
    },
  }),

  importMenuCsvToDraft: t.field({
    type: ImportResult,
    authScopes: { restaurantMember: true },
    args: {
      branchId: t.arg.string({ required: true }),
      assetId: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      await assertBranchOwner(ctx, args.branchId);
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
      await assertBranchOwner(ctx, args.branchId);
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
        throw new GraphQLError("You don't have access to this restaurant.", {
          extensions: { code: "forbidden" },
        });
      }
      const color = /^#[0-9a-fA-F]{6}$/;
      for (const c of [args.primaryColor, args.accentColor, args.backgroundColor, args.textColor]) {
        if (c && !color.test(c))
          throw new GraphQLError("Please enter colors as a 6-digit hex code, like #ff5733.", {
            extensions: { code: "validation_error" },
          });
      }
      if (args.cardStyle && !["flat", "tilt3d", "glass"].includes(args.cardStyle)) {
        throw new GraphQLError("Please choose a valid card style.", {
          extensions: { code: "validation_error" },
        });
      }
      if (args.heroEffect && !["none", "parallax", "depth"].includes(args.heroEffect)) {
        throw new GraphQLError("Please choose a valid hero effect.", {
          extensions: { code: "validation_error" },
        });
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
      if (args.stars < 1 || args.stars > 5)
        throw new GraphQLError("Please give a rating between 1 and 5 stars.", {
          extensions: { code: "validation_error" },
        });
      const order = await prisma.order.findUnique({
        where: { id: args.orderId },
        include: { branch: true },
      });
      if (!order || order.customerId !== ctx.userId)
        throw new GraphQLError("We couldn't find that order.", {
          extensions: { code: "not_found" },
        });
      if (order.status !== "delivered")
        throw new GraphQLError("You can only rate an order once it has been delivered.", {
          extensions: { code: "invalid_state" },
        });
      const existing = await prisma.rating.findUnique({ where: { orderId: args.orderId } });
      if (existing)
        throw new GraphQLError("You've already rated this order.", {
          extensions: { code: "already_exists" },
        });
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

  // Vendor reply to a review (#61). Owner-guarded: the caller must be a member of
  // the rating's restaurant. Auto-published (no admin moderation — mirrors the
  // auto-approve rating policy). Upsert so an owner can edit an existing reply.
  respondToRating: t.prismaField({
    type: "RatingResponse",
    authScopes: { restaurantMember: true },
    args: {
      ratingId: t.arg.string({ required: true }),
      body: t.arg.string({ required: true }),
    },
    resolve: async (_q, _root, args, ctx) => {
      const body = args.body.trim();
      if (!body)
        throw new GraphQLError("Please enter a response before submitting.", {
          extensions: { code: "validation_error" },
        });
      if (body.length > 1000)
        throw new GraphQLError("Your response is too long. Please keep it under 1000 characters.", {
          extensions: { code: "validation_error" },
        });
      const rating = await prisma.rating.findUnique({ where: { id: args.ratingId } });
      if (!rating)
        throw new GraphQLError("We couldn't find that review.", {
          extensions: { code: "not_found" },
        });
      if (!ctx.restaurantIds.includes(rating.restaurantId) && !ctx.hasRole("admin")) {
        throw new GraphQLError("You don't have access to this restaurant.", {
          extensions: { code: "forbidden" },
        });
      }
      return prisma.ratingResponse.upsert({
        where: { ratingId: args.ratingId },
        update: { body },
        create: { ratingId: args.ratingId, restaurantId: rating.restaurantId, body },
      });
    },
  }),
}));

builder.prismaObject("RatingResponse", {
  fields: (t) => ({
    id: t.exposeID("id"),
    body: t.exposeString("body"),
    createdAt: t.field({ type: "DateTime", resolve: (r) => r.createdAt }),
    updatedAt: t.field({ type: "DateTime", resolve: (r) => r.updatedAt }),
  }),
});

builder.prismaObject("Rating", {
  fields: (t) => ({
    id: t.exposeID("id"),
    stars: t.exposeInt("stars"),
    tags: t.exposeStringList("tags"),
    comment: t.exposeString("comment", { nullable: true }),
    createdAt: t.field({ type: "DateTime", resolve: (r) => r.createdAt }),
    // Vendor reply, auto-published (#61). Null until the owner responds.
    response: t.relation("response", { nullable: true }),
  }),
});
