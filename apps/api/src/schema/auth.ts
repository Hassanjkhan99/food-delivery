// Auth domain: viewer, requestOtp, verifyOtp, logout.
import { prisma } from "@fd/db";
import { GraphQLError } from "graphql";
import { SESSION_COOKIE_NAME, SESSION_TTL_DAYS, homeForRoles, type Role } from "@fd/shared";
import { signSessionToken } from "../auth/session.js";
import { requestOtp, verifyOtp } from "../auth/otp.js";
import { env } from "../env.js";
import { builder } from "./builder.js";

// Mirrors @whatwg-node/cookie-store's CookieStoreDeleteOptions (a transitive dep — kept
// local so we don't couple to its package path).
type CookieStoreDeleteOptions = { name: string; domain?: string; path?: string };

// Shared session-cookie attributes. Domain + SameSite are env-driven so the API can be
// split onto its own origin: on a shared parent domain (api. + app.<domain>) set
// SESSION_COOKIE_DOMAIN=.<domain> so BOTH the web edge proxy and the API read the same
// cookie. delete() must reuse the same domain/path or a domained cookie won't clear.
function sessionCookieAttrs() {
  const sameSite = env.sessionCookieSameSite;
  return {
    path: "/",
    sameSite,
    httpOnly: true,
    // SameSite=None is only honoured on Secure cookies, so force Secure regardless of env.
    secure: sameSite === "none" ? true : env.isProduction,
    domain: env.sessionCookieDomain,
  } as const;
}

async function clearSessionCookie(ctx: {
  request: { cookieStore?: { delete: (init: string | CookieStoreDeleteOptions) => Promise<void> } };
}) {
  const domain = env.sessionCookieDomain;
  // Omit domain entirely when host-only (preserves the original delete-by-name behavior);
  // a domained cookie only clears when the same Domain + Path are supplied.
  const init: CookieStoreDeleteOptions = domain
    ? { name: SESSION_COOKIE_NAME, domain, path: "/" }
    : { name: SESSION_COOKIE_NAME };
  await ctx.request.cookieStore?.delete(init);
}

export const UserType = builder.prismaObject("User", {
  fields: (t) => ({
    id: t.exposeID("id"),
    phone: t.exposeString("phone"),
    name: t.exposeString("name", { nullable: true }),
    email: t.exposeString("email", { nullable: true }),
    // Marketing opt-out state (#56), surfaced so the account screen can toggle it.
    marketingOptOut: t.exposeBoolean("marketingOptOut"),
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

// Active device sessions surfaced to the account page for revocation.
const SessionType = builder.prismaObject("Session", {
  fields: (t) => ({
    id: t.exposeID("id"),
    userAgent: t.exposeString("userAgent", { nullable: true }),
    createdAt: t.field({ type: "DateTime", resolve: (s) => s.createdAt }),
    expiresAt: t.field({ type: "DateTime", resolve: (s) => s.expiresAt }),
    // Whether this row is the session making the request (don't offer self-revoke as "sign out elsewhere").
    isCurrent: t.boolean({
      resolve: (session, _args, ctx) => session.id === ctx.sessionId,
    }),
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

  // Active (non-revoked, non-expired) sessions for the signed-in user, newest first.
  mySessions: t.prismaField({
    type: [SessionType],
    authScopes: { loggedIn: true },
    resolve: (query, _root, _args, ctx) =>
      prisma.session.findMany({
        ...query,
        where: { userId: ctx.userId!, revokedAt: null, expiresAt: { gte: new Date() } },
        orderBy: { createdAt: "desc" },
      }),
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

      // Cookie scope is env-driven (see sessionCookieAttrs): host-only by default (works
      // for :3000/:4000 on localhost and the same-origin deploy), or shared-parent-domain
      // when the API is split onto its own subdomain.
      await ctx.request.cookieStore?.set({
        name: SESSION_COOKIE_NAME,
        value: token,
        expires: session.expiresAt.getTime(),
        ...sessionCookieAttrs(),
      });

      return toViewer(userId, roleClaims);
    },
  }),

  // Lazy profile capture (name/email). Called on first checkout ("who should the
  // rider ask for?") and from the account page. Only provided fields are patched.
  updateProfile: t.prismaField({
    type: "User",
    authScopes: { loggedIn: true },
    args: {
      name: t.arg.string({ required: false }),
      email: t.arg.string({ required: false }),
    },
    resolve: (query, _root, args, ctx) => {
      // Distinguish an omitted arg (leave the column untouched) from a provided
      // blank/null one (the user cleared the field → write null). An arg only
      // appears in the update when the client actually sent it.
      const data: { name?: string | null; email?: string | null } = {};
      if (args.name !== undefined) data.name = args.name?.trim() || null;
      if (args.email !== undefined) data.email = args.email?.trim() || null;
      return prisma.user.update({
        ...query,
        where: { id: ctx.userId! },
        data,
      });
    },
  }),

  // Revoke a specific device session the user owns (remote sign-out).
  revokeSession: t.field({
    type: "Boolean",
    authScopes: { loggedIn: true },
    args: { sessionId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      const session = await prisma.session.findFirst({
        where: { id: args.sessionId, userId: ctx.userId! },
      });
      if (!session)
        throw new GraphQLError("That session is no longer active.", {
          extensions: { code: "session_not_found" },
        });
      await prisma.session.update({
        where: { id: session.id },
        data: { revokedAt: new Date() },
      });
      // If they revoked their own current session, clear the cookie too.
      if (session.id === ctx.sessionId) {
        await clearSessionCookie(ctx);
      }
      return true;
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
      await clearSessionCookie(ctx);
      return true;
    },
  }),
}));
