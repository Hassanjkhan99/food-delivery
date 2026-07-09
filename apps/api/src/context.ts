// Request context: cookie -> verify JWS -> load live Session + roles from DB.
// Fail-closed: any failure yields an anonymous context (resolvers then 401 via scope-auth).
import type { YogaInitialContext } from "graphql-yoga";
import { prisma } from "@fd/db";
import type { Role } from "@fd/shared";
import { SESSION_COOKIE_NAME } from "@fd/shared";
import { verifySessionToken } from "./auth/session.js";

export type RoleBinding = { role: Role; restaurantId: string | null };

export type AppContext = YogaInitialContext & {
  userId: string | null;
  sessionId: string | null;
  roles: RoleBinding[];
  restaurantIds: string[];
  riderId: string | null;
  hasRole: (role: Role) => boolean;
};

const ANON: Pick<AppContext, "userId" | "sessionId" | "roles" | "restaurantIds" | "riderId"> = {
  userId: null,
  sessionId: null,
  roles: [],
  restaurantIds: [],
  riderId: null,
};

export async function buildContext(initial: YogaInitialContext): Promise<AppContext> {
  const base = { ...initial, ...ANON, hasRole: (_: Role) => false } as AppContext;

  const cookie = await initial.request.cookieStore?.get(SESSION_COOKIE_NAME);
  if (!cookie?.value) return base;

  const claims = await verifySessionToken(cookie.value);
  if (!claims) return base;

  const session = await prisma.session.findFirst({
    where: { id: claims.sid, revokedAt: null, expiresAt: { gte: new Date() } },
    include: { user: { include: { roles: true, rider: true } } },
  });
  if (!session) return base;

  const roles: RoleBinding[] = session.user.roles.map((r) => ({
    role: r.role as Role,
    restaurantId: r.restaurantId,
  }));

  return {
    ...initial,
    userId: session.userId,
    sessionId: session.id,
    roles,
    restaurantIds: [...new Set(roles.flatMap((r) => (r.restaurantId ? [r.restaurantId] : [])))],
    riderId: session.user.rider?.id ?? null,
    hasRole: (role: Role) => roles.some((r) => r.role === role),
  } as AppContext;
}
