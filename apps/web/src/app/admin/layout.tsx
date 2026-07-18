"use client";

import Link from "next/link";
import {
  Ban,
  BadgeDollarSign,
  Bike,
  FileClock,
  FileSpreadsheet,
  Gauge,
  HandCoins,
  LifeBuoy,
  Megaphone,
  ShieldCheck,
  Store,
  Tag,
  Undo2,
} from "lucide-react";
import { SidebarShell, type SidebarNavItem } from "@/components/ui/sidebar-shell";

const NAV: SidebarNavItem[] = [
  { href: "/admin", label: "Command center", icon: Gauge, exact: true },
  { href: "/admin/restaurants", label: "Restaurants", icon: Store },
  { href: "/admin/kyc", label: "KYC", icon: ShieldCheck },
  { href: "/admin/tickets", label: "Support", icon: LifeBuoy },
  { href: "/admin/campaigns", label: "Promotions", icon: Megaphone },
  { href: "/admin/riders", label: "Riders", icon: Bike },
  { href: "/admin/vouchers", label: "Vouchers", icon: Tag },
  { href: "/admin/refunds", label: "Refunds", icon: Undo2 },
  { href: "/admin/payouts", label: "Payouts", icon: HandCoins },
  { href: "/admin/fees", label: "Fees", icon: BadgeDollarSign },
  { href: "/admin/metrics/export", label: "Metrics export", icon: FileSpreadsheet },
  { href: "/admin/cancellations", label: "Cancellations", icon: Ban },
  { href: "/admin/audit", label: "Audit", icon: FileClock },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarShell
      tone="dark"
      brand={<Link href="/admin">⚙️ Admin</Link>}
      items={NAV}
      footer={<Link href="/">← Customer site</Link>}
    >
      {children}
    </SidebarShell>
  );
}
