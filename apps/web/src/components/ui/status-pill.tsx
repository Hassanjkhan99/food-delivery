import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import type { OrderStatus } from "@fd/shared";

import { cn } from "@/lib/utils";

/**
 * Data-driven status pill. Consolidates the ~30 places that each re-declare their own
 * status → label + status → color maps. A shared registry (below) maps domain states to a
 * `{ label, tone }` descriptor so a status renders identically everywhere.
 */
const statusPillVariants = cva(
  "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold",
  {
    variants: {
      tone: {
        neutral: "bg-kd-surface-muted text-kd-fg-muted",
        info: "bg-kd-info-soft text-kd-info",
        success: "bg-kd-success-soft text-kd-success",
        warning: "bg-kd-warning-soft text-kd-warning-soft-fg",
        danger: "bg-kd-danger-soft text-kd-danger",
        brand: "bg-kd-primary-soft text-kd-primary",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export type StatusTone = NonNullable<VariantProps<typeof statusPillVariants>["tone"]>;
export type StatusDescriptor = { label: string; tone: StatusTone };

function StatusPill({
  tone,
  label,
  className,
  ...props
}: Omit<React.ComponentProps<"span">, "children"> &
  VariantProps<typeof statusPillVariants> & { label: React.ReactNode }) {
  return (
    <span
      data-slot="status-pill"
      className={cn(statusPillVariants({ tone }), className)}
      {...props}
    >
      {label}
    </span>
  );
}

/**
 * Order-status registry. `tone` groups the state: in-progress → info, delivered →
 * success, negative/terminal → danger, transient waits → neutral/warning. Keyed by the
 * canonical `OrderStatus` union from `@fd/shared` so a new status is a compile error here
 * until it's given a descriptor.
 */
export const ORDER_STATUS_DESCRIPTORS: Record<OrderStatus, StatusDescriptor> = {
  pending_acceptance: { label: "Waiting for restaurant", tone: "warning" },
  accepted: { label: "Accepted", tone: "info" },
  preparing: { label: "Preparing", tone: "info" },
  ready_for_pickup: { label: "Ready", tone: "info" },
  rider_assigned: { label: "Rider assigned", tone: "info" },
  reassigning: { label: "Reassigning rider", tone: "warning" },
  picked_up: { label: "Picked up", tone: "info" },
  out_for_delivery: { label: "On the way", tone: "info" },
  delivered: { label: "Delivered", tone: "success" },
  rejected: { label: "Rejected", tone: "danger" },
  auto_expired: { label: "Not accepted in time", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "danger" },
  failed_delivery_attempt: { label: "Delivery attempt failed", tone: "danger" },
};

/** Convenience wrapper: render an order status from the shared registry. */
function OrderStatusPill({
  status,
  className,
}: {
  status: OrderStatus | string;
  className?: string;
}) {
  const d = ORDER_STATUS_DESCRIPTORS[status as OrderStatus] ?? {
    label: String(status),
    tone: "neutral" as const,
  };
  return <StatusPill tone={d.tone} label={d.label} className={className} />;
}

export { StatusPill, OrderStatusPill, statusPillVariants };
