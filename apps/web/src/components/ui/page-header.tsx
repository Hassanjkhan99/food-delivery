import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Standard page/section header: a title (renders as `h1`) with an optional description
 * and a right-aligned actions slot. Replaces the ad-hoc
 * `<header><h1>…</h1><p>…</p></header>` markup repeated on nearly every screen.
 */
function PageHeader({
  title,
  description,
  actions,
  className,
  ...props
}: Omit<React.ComponentProps<"div">, "title"> & {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div
      data-slot="page-header"
      className={cn("mb-6 flex flex-wrap items-start justify-between gap-3", className)}
      {...props}
    >
      <div className="min-w-0 space-y-1">
        <h1 className="text-kd-heading font-bold tracking-tight text-kd-fg">{title}</h1>
        {description && <p className="text-kd-label text-kd-fg-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export { PageHeader };
