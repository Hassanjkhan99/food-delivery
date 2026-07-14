export const ROLES = [
  "customer",
  "restaurant_owner",
  "restaurant_staff",
  "rider",
  "admin",
] as const;
export type Role = (typeof ROLES)[number];

/**
 * True if `roles` grant `restaurant_owner` on the given restaurant (#204). Owner-only
 * console surfaces (menu, money, staff, settings, branding, promos, analytics, reviews)
 * gate on this; `restaurant_staff` membership is NOT enough. Admin is handled separately
 * by callers (cross-tenant).
 */
export function isRestaurantOwner(
  roles: ReadonlyArray<{ role: string; restaurantId?: string | null }>,
  restaurantId: string,
): boolean {
  return roles.some((r) => r.role === "restaurant_owner" && r.restaurantId === restaurantId);
}

/** Landing route per role, used by login redirect and middleware bounce. */
export function homeForRoles(roles: Role[]): string {
  if (roles.includes("admin")) return "/admin";
  if (roles.includes("restaurant_owner") || roles.includes("restaurant_staff"))
    return "/restaurant/orders";
  if (roles.includes("rider")) return "/rider";
  return "/";
}
