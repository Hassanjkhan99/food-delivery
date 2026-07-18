import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Metric tile: a prominent tabular value with an eyebrow label and an optional hint /
 * delta line and icon. Replaces the ad-hoc `rounded-2xl border p-4` + `text-2xl
 * tabular-nums` tiles repeated across the admin / restaurant / rider consoles.
 */
function StatTile({
  label,
  value,
  hint,
  icon,
  className,
  ...props
}: Omit<React.ComponentProps<"div">, "title"> & {
  label: React.ReactNode;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <div
      data-slot="stat-tile"
      className={cn("rounded-2xl border border-kd-border bg-kd-surface p-4", className)}
      {...props}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-kd-caption font-medium uppercase tracking-wide text-kd-fg-muted">
          {label}
        </p>
        {icon && <span className="shrink-0 text-kd-fg-subtle">{icon}</span>}
      </div>
      <p className="mt-1 text-2xl font-bold tabular-nums text-kd-fg">{value}</p>
      {hint && <p className="mt-0.5 text-kd-caption text-kd-fg-muted">{hint}</p>}
    </div>
  );
}

export { StatTile };
