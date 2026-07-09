// Auth domain: viewer, requestOtp, verifyOtp, logout.
import { prisma } from "@fd/db";
import { SESSION_COOKIE_NAME, SESSION_TTL_DAYS, homeForRoles, type Role } from "@fd/shared";
import { signSessionToken } from "../auth/session.js";
import { requestOtp, verifyOtp } from "../auth/otp.js";
import { env } from "../env.js";
import { builder } from "./builder.js";

export const UserType = builder.prismaObject("User", {
  fields: (t) => ({
    id: t.exposeID("id"),
    phone: t.exposeString("phone"),
    name: t.exposeString("name", { nullable: true }),
    email: t.exposeString("email", { nullable: true }),
  }),
});

const RoleBindingType = builder.objectRef<{ role: string; restaurantId: string | null }>(
  "RoleBinding",
);
RoleBindingType.implement({
  fields: (t) => ({
    role: t.exposeString("role"),
    restaurantId: t.exposeString("restaurantId", { nullable: true }),
  }),
});

type ViewerShape = {
  userId: string;
  roles: Array<{ role: string; restaurantId: string | null }>;
  home: string;
};
const ViewerType = builder.objectRef<ViewerShape>("Viewer");
ViewerType.implement({
  fields: (t) => ({
    user: t.prismaField({
      type: "User",
      resolve: (query, viewer) =>
        prisma.user.findUniqueOrThrow({ ...query, where: { id: viewer.userId } }),
    }),
    roles: t.field({ type: [RoleBindingType], resolve: (v) => v.roles }),
    home: t.exposeString("home"),
  }),
});

const OtpRequestResult = builder.objectRef<{ devCode: string | null }>("OtpRequestResult");
OtpRequestResult.implement({
  fields: (t) => ({
    // Only populated outside production — the dev "SMS".
    devCode: t.exposeString("devCode", { nullable: true }),
  }),
});

function toViewer(userId: string, roles: Array<{ role: string; restaurantId: string | null }>) {
  return {
    userId,
    roles,
    home: homeForRoles(roles.map((r) => r.role as Role)),
  };
}

builder.queryFields((t) => ({
  viewer: t.field({
    type: ViewerType,
    nullable: true,
    resolve: (_root, _args, ctx) => (ctx.userId ? toViewer(ctx.userId, ctx.roles) : null),
  }),
}));

builder.mutationFields((t) => ({
  requestOtp: t.field({
    type: OtpRequestResult,
    args: { phone: t.arg.string({ required: true }) },
    resolve: (_root, args) => requestOtp(args.phone),
  }),

  verifyOtp: t.field({
    type: ViewerType,
    args: {
      phone: t.arg.string({ required: true }),
      code: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      const { userId } = await verifyOtp(args.phone, args.code);

      const session = await prisma.session.create({
        data: {
          userId,
          expiresAt: new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60_000),
          userAgent: ctx.request.headers.get("user-agent"),
        },
      });

      const roles = await prisma.userRole.findMany({ where: { userId } });
      const roleClaims = roles.map((r) => ({
        role: r.role as string,
        restaurantId: r.restaurantId,
      }));
      const token = await signSessionToken({ sid: session.id, uid: userId, roles: roleClaims });

      // Host-only cookie (no Domain) so it flows to both :3000 and :4000 on localhost.
      await ctx.request.cookieStore?.set({
        name: SESSION_COOKIE_NAME,
        value: token,
        path: "/",
        sameSite: "lax",
        httpOnly: true,
        secure: env.isProduction,
        expires: session.expiresAt.getTime(),
        domain: null,
      });

      return toViewer(userId, roleClaims);
    },
  }),

  logout: t.field({
    type: "Boolean",
    authScopes: { loggedIn: true },
    resolve: async (_root, _args, ctx) => {
      if (ctx.sessionId) {
        await prisma.session.update({
          where: { id: ctx.sessionId },
          data: { revokedAt: new Date() },
        });
      }
      await ctx.request.cookieStore?.delete(SESSION_COOKIE_NAME);
      return true;
    },
  }),
}));
