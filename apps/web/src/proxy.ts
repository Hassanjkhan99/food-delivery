// Edge role gating (Next 16 proxy — the middleware successor). Verifies the JWS
// signature + role claims only; the API remains the enforcement authority (it
// re-validates the session against the DB on every request).
import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";

const SESSION_COOKIE_NAME = "fd_session";

type RoleClaim = { role: string; restaurantId?: string | null };

const SECTION_ROLES: Array<{ prefix: string; roles: string[] | "any" }> = [
  { prefix: "/admin", roles: ["admin"] },
  { prefix: "/restaurant", roles: ["restaurant_owner", "restaurant_staff"] },
  { prefix: "/rider", roles: ["rider"] },
  { prefix: "/orders", roles: "any" },
  { prefix: "/checkout", roles: "any" },
  { prefix: "/payment-methods", roles: "any" },
];

function homeFor(roles: string[]): string {
  if (roles.includes("admin")) return "/admin";
  if (roles.includes("restaurant_owner") || roles.includes("restaurant_staff"))
    return "/restaurant/orders";
  if (roles.includes("rider")) return "/rider";
  return "/";
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const section = SECTION_ROLES.find((s) => pathname.startsWith(s.prefix));
  if (!section) return NextResponse.next();

  const loginRedirect = () => {
    const url = new URL("/login", request.url);
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  };

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return loginRedirect();

  const secret = process.env.SESSION_SECRET;
  if (!secret) return loginRedirect();

  let roles: string[];
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret));
    roles = (Array.isArray(payload.roles) ? (payload.roles as RoleClaim[]) : []).map(
      (r) => r.role,
    );
  } catch {
    return loginRedirect();
  }

  if (section.roles !== "any" && !section.roles.some((r) => roles.includes(r))) {
    return NextResponse.redirect(new URL(homeFor(roles), request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/admin/:path*",
    "/restaurant/:path*",
    "/rider/:path*",
    "/orders/:path*",
    "/checkout",
    "/payment-methods",
  ],
};
