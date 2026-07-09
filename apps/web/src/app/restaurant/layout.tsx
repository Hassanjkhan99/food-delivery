"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ClipboardList, CookingPot, Palette, Settings, Users, Wallet } from "lucide-react";

const NAV = [
  { href: "/restaurant/orders", label: "Orders", icon: ClipboardList },
  { href: "/restaurant/menu", label: "Menu", icon: CookingPot },
  { href: "/restaurant/branding", label: "Branding", icon: Palette },
  { href: "/restaurant/riders", label: "Riders", icon: Users },
  { href: "/restaurant/wallet", label: "Wallet", icon: Wallet },
  { href: "/restaurant/settings", label: "Settings", icon: Settings },
];

export default function RestaurantLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="flex min-h-screen bg-kd-surface-muted">
      <aside className="hidden w-52 shrink-0 border-r border-kd-border bg-kd-surface p-4 sm:block">
        <Link href="/restaurant/orders" className="mb-6 block text-lg font-bold">
          🍜 Console
        </Link>
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
