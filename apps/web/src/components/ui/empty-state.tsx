import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";
import { GlassPanel } from "@/components/ui/glass";

const emptyStateVariants = cva("flex flex-col items-center justify-center text-center", {
  variants: {
    padding: {
      sm: "px-3 py-6",
      default: "px-4 py-10",
      lg: "px-6 py-14",
    },
  },
  defaultVariants: { padding: "default" },
});

/**
 * Friendly empty / zero-result / not-found state: an icon (Lucide element or emoji), a
 * title, an optional body line, and an optional action. Consolidates the many bespoke
 * "No … yet" blocks across the app.
 *
 * `surface`:
 *  • "glass" → frosted GlassPanel (customer feed states, over the ambient background)
 *  • "card"  → solid surface + border (console screens) — the default
 *  • "bare"  → no container, for dropping inside an existing panel
 */
function EmptyState({
  icon,
  title,
  description,
  action,
  surface = "card",
  padding,
  className,
  ...props
}: Omit<React.ComponentProps<"div">, "title"> &
  VariantProps<typeof emptyStateVariants> & {
    icon?: React.ReactNode;
    title: React.ReactNode;
    description?: React.ReactNode;
    action?: React.ReactNode;
    surface?: "glass" | "card" | "bare";
  }) {
  const inner = (
    <>
      {icon && <div className="mb-2 text-3xl text-kd-fg-subtle">{icon}</div>}
      <h3 className="text-kd-title font-semibold text-kd-fg">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-kd-label text-kd-fg-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </>
  );

  if (surface === "glass") {
    return (
      <GlassPanel
        data-slot="empty-state"
        className={cn(emptyStateVariants({ padding }), className)}
        {...props}
      >
        {inner}
      </GlassPanel>
    );
  }

  return (
    <div
      data-slot="empty-state"
      className={cn(
        emptyStateVariants({ padding }),
        surface === "card" && "rounded-2xl border border-kd-border bg-kd-surface",
        className,
      )}
      {...props}
    >
      {inner}
    </div>
  );
}

export { EmptyState, emptyStateVariants };
