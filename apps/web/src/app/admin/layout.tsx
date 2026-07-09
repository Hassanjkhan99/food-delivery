"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BadgeDollarSign,
  Bike,
  FileClock,
  Gauge,
  HandCoins,
  Store,
  Undo2,
} from "lucide-react";

const NAV = [
  { href: "/admin", label: "Overview", icon: Gauge },
  { href: "/admin/restaurants", label: "Restaurants", icon: Store },
  { href: "/admin/riders", label: "Riders", icon: Bike },
  { href: "/admin/refunds", label: "Refunds", icon: Undo2 },
  { href: "/admin/payouts", label: "Payouts", icon: HandCoins },
  { href: "/admin/fees", label: "Fees", icon: BadgeDollarSign },
  { href: "/admin/audit", label: "Audit", icon: FileClock },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="flex min-h-screen bg-kd-surface-muted">
      <aside className="hidden w-52 shrink-0 border-r border-kd-border bg-neutral-900 p-4 text-white sm:block">
        <Link href="/admin" className="mb-6 block text-lg font-bold">
          ⚙️ Admin
        </Link>
        <nav className="space-y-1">
          {NAV.map((n) => {
            const Icon = n.icon;
            const active =
              n.href === "/admin" ? pathname === "/admin" : pathname.startsWith(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${
                  active
                    ? "bg-white font-medium text-neutral-900"
                    : "text-neutral-300 hover:bg-neutral-800"
                }`}
              >
                <Icon className="h-4 w-4" />
                {n.label}
              </Link>
            );
          })}
        </nav>
        <Link href="/" className="mt-8 block text-xs text-neutral-300 hover:text-white">
          ← Customer site
        </Link>
      </aside>
      <div className="flex-1 p-4 sm:p-6">{children}</div>
    </div>
  );
}
