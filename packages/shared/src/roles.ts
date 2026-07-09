export const ROLES = [
  "customer",
  "restaurant_owner",
  "restaurant_staff",
  "rider",
  "admin",
] as const;
export type Role = (typeof ROLES)[number];

/** Landing route per role, used by login redirect and middleware bounce. */
export function homeForRoles(roles: Role[]): string {
  if (roles.includes("admin")) return "/admin";
  if (roles.includes("restaurant_owner") || roles.includes("restaurant_staff"))
    return "/restaurant/orders";
  if (roles.includes("rider")) return "/rider";
  return "/";
}
