"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ConsoleProvider, useConsole } from "./useConsole";
import {
  BarChart3,
  ClipboardList,
  CookingPot,
  FileSpreadsheet,
  Megaphone,
  MessageSquare,
  Palette,
  Settings,
  Sun,
  Ticket,
  Users,
  Wallet,
} from "lucide-react";

const NAV = [
  { href: "/restaurant/orders", label: "Orders", icon: ClipboardList },
  { href: "/restaurant/today", label: "Today", icon: Sun },
  { href: "/restaurant/menu", label: "Menu", icon: CookingPot },
  { href: "/restaurant/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/restaurant/reviews", label: "Reviews", icon: MessageSquare },
  { href: "/restaurant/branding", label: "Branding", icon: Palette },
  { href: "/restaurant/campaigns", label: "Promotions", icon: Megaphone },
  { href: "/restaurant/promo-codes", label: "Promo codes", icon: Ticket },
  { href: "/restaurant/riders", label: "Riders", icon: Users },
  { href: "/restaurant/wallet", label: "Wallet", icon: Wallet },
  { href: "/restaurant/settlements", label: "Settlements", icon: FileSpreadsheet },
  { href: "/restaurant/settings", label: "Settings", icon: Settings },
];

// Branch switcher — only shown when the restaurant has more than one branch (#155).
function BranchSwitcher() {
  const { branches, branch, setBranchId } = useConsole();
  if (branches.length <= 1) return null;
  return (
    <div className="mb-4">
      <label htmlFor="branch-switch" className="mb-1 block text-xs text-kd-fg-subtle">
        Branch
      </label>
      <select
        id="branch-switch"
        value={branch?.id ?? ""}
        onChange={(e) => setBranchId(e.target.value)}
        className="w-full rounded-md border border-kd-border bg-kd-surface px-2 py-1.5 text-sm"
      >
        {branches.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>
    </div>
  );
}

export default function RestaurantLayout({ children }: { children: React.ReactNode }) {
  return (
    <ConsoleProvider>
      <ConsoleShell>{children}</ConsoleShell>
    </ConsoleProvider>
  );
}

function ConsoleShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="flex min-h-screen bg-kd-surface-muted">
      <aside className="hidden w-52 shrink-0 border-r border-kd-border bg-kd-surface p-4 sm:block">
        <Link href="/restaurant/orders" className="mb-6 block text-lg font-bold">
          🍜 Console
        </Link>
        <BranchSwitcher />
        <nav className="space-y-1">
          {NAV.map((n) => {
            const Icon = n.icon;
            const active = pathname.startsWith(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${
                  active
                    ? "bg-kd-primary font-medium text-white"
                    : "text-kd-fg-muted hover:bg-kd-surface-muted"
                }`}
              >
                <Icon className="h-4 w-4" />
                {n.label}
              </Link>
            );
          })}
        </nav>
        <Link href="/" className="mt-8 block text-xs text-kd-fg-subtle hover:text-kd-fg-muted">
          ← Customer site
        </Link>
      </aside>
      <div className="flex-1 p-4 sm:p-6">{children}</div>
    </div>
  );
}
