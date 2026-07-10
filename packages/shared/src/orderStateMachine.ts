// Single source of truth for order status transitions and who may perform them.
// Enforced server-side by orderService.transition(); the UI reads it to show/hide actions.
import type { Role } from "./roles";

export type OrderStatus =
  | "pending_acceptance"
  | "accepted"
  | "rejected"
  | "auto_expired"
  | "preparing"
  | "ready_for_pickup"
  | "rider_assigned"
  | "reassigning"
  | "picked_up"
  | "out_for_delivery"
  | "delivered"
  | "failed_delivery_attempt"
  | "cancelled";

export type ActorRole = Role | "system";

export type Transition = { to: OrderStatus; allowedRoles: ActorRole[] };

const RESTAURANT: ActorRole[] = ["restaurant_owner", "restaurant_staff", "admin"];
const RIDER: ActorRole[] = ["rider", "admin"];
const SYSTEM: ActorRole[] = ["system", "admin"];

export const TRANSITIONS: Record<OrderStatus, Transition[]> = {
  pending_acceptance: [
    { to: "accepted", allowedRoles: RESTAURANT },
    { to: "rejected", allowedRoles: RESTAURANT },
    { to: "auto_expired", allowedRoles: SYSTEM },
    { to: "cancelled", allowedRoles: ["customer", "admin"] },
  ],
  accepted: [
    { to: "preparing", allowedRoles: RESTAURANT },
    { to: "cancelled", allowedRoles: ["customer", ...RESTAURANT] },
  ],
  preparing: [
    { to: "ready_for_pickup", allowedRoles: RESTAURANT },
    { to: "cancelled", allowedRoles: RESTAURANT },
  ],
  ready_for_pickup: [
    // Restaurant assigns a rider, or a rider self-accepts an offered job (swipe-to-accept).
    { to: "rider_assigned", allowedRoles: [...RESTAURANT, ...RIDER] },
    { to: "picked_up", allowedRoles: [...RESTAURANT, ...RIDER] },
  ],
  rider_assigned: [
    { to: "picked_up", allowedRoles: RIDER },
    { to: "reassigning", allowedRoles: RESTAURANT },
    { to: "cancelled", allowedRoles: RESTAURANT },
  ],
  reassigning: [
    { to: "rider_assigned", allowedRoles: RESTAURANT },
    { to: "cancelled", allowedRoles: RESTAURANT },
  ],
  picked_up: [{ to: "out_for_delivery", allowedRoles: [...RIDER, "system"] }],
  out_for_delivery: [
    { to: "delivered", allowedRoles: RIDER },
    { to: "failed_delivery_attempt", allowedRoles: RIDER },
  ],
  failed_delivery_attempt: [
    { to: "out_for_delivery", allowedRoles: RIDER },
    { to: "cancelled", allowedRoles: ["admin"] },
  ],
  delivered: [],
  auto_expired: [],
  rejected: [],
  cancelled: [],
};

export const TERMINAL_STATUSES: OrderStatus[] = [
  "delivered",
  "auto_expired",
  "rejected",
  "cancelled",
];

export class InvalidTransitionError extends Error {
  constructor(
    public readonly from: OrderStatus,
    public readonly to: OrderStatus,
    public readonly role: ActorRole,
  ) {
    super(`Cannot transition order from '${from}' to '${to}' as '${role}'`);
    this.name = "InvalidTransitionError";
  }
}

/** Throws InvalidTransitionError unless `from -> to` is legal for `role`. */
export function assertTransition(from: OrderStatus, to: OrderStatus, role: ActorRole): void {
  const legal = TRANSITIONS[from]?.some(
    (t) => t.to === to && (t.allowedRoles.includes(role) || role === "admin"),
  );
  if (!legal) throw new InvalidTransitionError(from, to, role);
}

export function canTransition(from: OrderStatus, to: OrderStatus, role: ActorRole): boolean {
  try {
    assertTransition(from, to, role);
    return true;
  } catch {
    return false;
  }
}
