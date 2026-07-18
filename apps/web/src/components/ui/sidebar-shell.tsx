"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Shared console layout shell (sidebar + content). Consolidates the near-identical
 * restaurant and admin layouts — same frame + active-link logic, previously copy-pasted
 * with divergent styling. Customer (top-nav) and rider (mobile tab-bar) are deliberately
 * different navigation patterns and don't use this.
 *
 * `tone="dark"` keeps the admin console's dark chrome; `light` is the default.
 */
export type SidebarNavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Match `pathname === href` instead of `startsWith` (e.g. a dashboard index route). */
  exact?: boolean;
};

const TONES = {
  light: {
    root: "bg-kd-surface-muted",
    aside: "border-kd-border bg-kd-surface",
    active: "bg-kd-primary font-medium text-white",
    inactive: "text-kd-fg-muted hover:bg-kd-surface-muted",
    footer: "text-kd-fg-subtle hover:text-kd-fg-muted",
  },
  dark: {
    root: "bg-kd-surface-muted",
    aside: "border-kd-border bg-neutral-900 text-white",
    active: "bg-white font-medium text-neutral-900",
    inactive: "text-neutral-300 hover:bg-neutral-800",
    footer: "text-neutral-300 hover:text-white",
  },
} as const;

function SidebarShell({
  brand,
  items,
  aside,
  footer,
  tone = "light",
  children,
}: {
  /** The brand/home link shown at the top of the sidebar. */
  brand: React.ReactNode;
  items: SidebarNavItem[];
  /** Optional slot under the brand (e.g. a branch switcher). */
  aside?: React.ReactNode;
  /** Optional footer slot (e.g. a "← Customer site" link). */
  footer?: React.ReactNode;
  tone?: keyof typeof TONES;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const t = TONES[tone];

  return (
    <div className={cn("flex min-h-screen", t.root)}>
      <aside className={cn("hidden w-52 shrink-0 border-r p-4 sm:block", t.aside)}>
        <div className="mb-6 text-lg font-bold">{brand}</div>
        {aside}
        <nav className="space-y-1">
          {items.map((n) => {
            const Icon = n.icon;
            const active = n.exact ? pathname === n.href : pathname.startsWith(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-3 py-2 text-sm",
                  active ? t.active : t.inactive,
                )}
              >
                <Icon className="h-4 w-4" />
                {n.label}
              </Link>
            );
          })}
        </nav>
        {footer && <div className="mt-8 text-xs">{footer}</div>}
      </aside>
      <div className="flex-1 p-4 sm:p-6">{children}</div>
    </div>
  );
}

export { SidebarShell };
