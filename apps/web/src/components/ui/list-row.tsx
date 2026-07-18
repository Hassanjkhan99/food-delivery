import * as React from "react";
import Link from "next/link";

import { cn } from "@/lib/utils";

/**
 * A horizontal summary row: optional leading visual, a title + optional subtitle, and an
 * optional trailing slot (status, amount, chevron). Renders as a Next `<Link>` when
 * `href` is set, otherwise a `<div>` (or `<button>`-like via `onClick`). Replaces the
 * `flex items-center justify-between … rounded-xl border` rows across the consoles.
 */
function ListRow({
  leading,
  title,
  subtitle,
  trailing,
  href,
  className,
  ...props
}: Omit<React.ComponentProps<"div">, "title" | "prefix"> & {
  leading?: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  trailing?: React.ReactNode;
  href?: string;
}) {
  const interactive = Boolean(href) || Boolean(props.onClick);
  const classes = cn(
    "flex items-center gap-3 rounded-xl border border-kd-border bg-kd-surface px-4 py-3",
    interactive && "transition-colors hover:border-kd-fg-subtle",
    className,
  );

  const content = (
    <>
      {leading && <div className="shrink-0">{leading}</div>}
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-kd-fg">{title}</div>
        {subtitle && <div className="truncate text-kd-label text-kd-fg-muted">{subtitle}</div>}
      </div>
      {trailing && <div className="shrink-0 text-right">{trailing}</div>}
    </>
  );

  if (href) {
    return (
      <Link href={href} data-slot="list-row" className={classes}>
        {content}
      </Link>
    );
  }

  return (
    <div data-slot="list-row" className={classes} {...props}>
      {content}
    </div>
  );
}

export { ListRow };
