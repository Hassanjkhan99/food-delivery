// Notification / offers inbox domain (#56): the customer bell + inbox list, plus the
// admin promo-blast mutation. Read state is per-row; unread count drives the badge.
import { prisma } from "@fd/db";
import { GraphQLError } from "graphql";
import { z } from "zod";
import { blastPromo, publishUnread, type PromoSegment } from "../services/notificationService.js";
import { builder } from "./builder.js";

builder.prismaObject("Notification", {
  fields: (t) => ({
    id: t.exposeID("id"),
    // enum exposed as string, matching the codebase convention (OrderStatus etc.).
    kind: t.exposeString("kind"),
    title: t.exposeString("title"),
    body: t.exposeString("body"),
    linkHref: t.exposeString("linkHref", { nullable: true }),
    orderId: t.exposeString("orderId", { nullable: true }),
    restaurantId: t.exposeString("restaurantId", { nullable: true }),
    read: t.boolean({ resolve: (n) => n.readAt !== null }),
    readAt: t.field({ type: "DateTime", nullable: true, resolve: (n) => n.readAt }),
    createdAt: t.field({ type: "DateTime", resolve: (n) => n.createdAt }),
  }),
});

builder.queryFields((t) => ({
  // The signed-in user's inbox, newest first. Capped — the inbox is a recent-activity
  // surface, not an archive.
  myNotifications: t.prismaField({
    type: ["Notification"],
    authScopes: { loggedIn: true },
    resolve: (query, _root, _args, ctx) =>
      prisma.notification.findMany({
        ...query,
        where: { userId: ctx.userId! },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
  }),

  unreadNotificationCount: t.int({
    authScopes: { loggedIn: true },
    resolve: (_root, _args, ctx) =>
      prisma.notification.count({ where: { userId: ctx.userId!, readAt: null } }),
  }),
}));

// Promo links must be safe in-app destinations: a single leading slash, no protocol,
// no protocol-relative "//host" and no back-slash tricks. This prevents a blast from
// sending customers to an arbitrary external or javascript: URL when they tap a notice.
const inAppPath = z
  .string()
  .trim()
  .max(512)
  .regex(/^\/(?!\/)[^\\]*$/, "linkHref must be a relative in-app path (e.g. /offers)");

const promoBlastSchema = z.object({
  segment: z.enum(["all", "new", "lapsed"]),
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(500),
  linkHref: inAppPath.optional(),
  restaurantId: z.string().trim().max(64).optional(),
});

builder.mutationFields((t) => ({
  // Mark one notification read. Scoped to the owner via updateMany so a stale/foreign
  // id is a no-op rather than an error.
  markNotificationRead: t.boolean({
    authScopes: { loggedIn: true },
    args: { id: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      const res = await prisma.notification.updateMany({
        where: { id: args.id, userId: ctx.userId!, readAt: null },
        data: { readAt: new Date() },
      });
      // Refresh the live bell badge only if a row actually flipped to read.
      if (res.count > 0) await publishUnread(ctx.userId!);
      return true;
    },
  }),

  markAllNotificationsRead: t.int({
    authScopes: { loggedIn: true },
    resolve: async (_root, _args, ctx) => {
      const res = await prisma.notification.updateMany({
        where: { userId: ctx.userId!, readAt: null },
        data: { readAt: new Date() },
      });
      if (res.count > 0) await publishUnread(ctx.userId!);
      return res.count;
    },
  }),

  // Marketing opt-out toggle (#56). Transactional order updates are unaffected.
  setMarketingOptOut: t.prismaField({
    type: "User",
    authScopes: { loggedIn: true },
    args: { optOut: t.arg.boolean({ required: true }) },
    resolve: (query, _root, args, ctx) =>
      prisma.user.update({
        ...query,
        where: { id: ctx.userId! },
        data: { marketingOptOut: args.optOut },
      }),
  }),

  // Admin promo blast to a simple segment (all / new / lapsed). Creates inbox entries
  // for every recipient except those who opted out of marketing, and returns the count.
  sendPromoBlast: t.int({
    authScopes: { admin: true },
    args: {
      segment: t.arg.string({ required: true }),
      title: t.arg.string({ required: true }),
      body: t.arg.string({ required: true }),
      linkHref: t.arg.string({ required: false }),
      restaurantId: t.arg.string({ required: false }),
    },
    resolve: async (_root, args) => {
      const parsed = promoBlastSchema.safeParse({
        segment: args.segment,
        title: args.title,
        body: args.body,
        linkHref: args.linkHref ?? undefined,
        restaurantId: args.restaurantId ?? undefined,
      });
      if (!parsed.success) throw new GraphQLError("Invalid promo blast input");
      return blastPromo({
        segment: parsed.data.segment as PromoSegment,
        title: parsed.data.title,
        body: parsed.data.body,
        linkHref: parsed.data.linkHref ?? null,
        restaurantId: parsed.data.restaurantId ?? null,
      });
    },
  }),
}));
