"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ConsoleProvider, useConsole } from "./useConsole";
import {
  BarChart3,
  ClipboardList,
  CookingPot,
  FileSpreadsheet,
  LifeBuoy,
  Megaphone,
  MessageSquare,
  Palette,
  Settings,
  ShieldCheck,
  Sun,
  Ticket,
  UserCog,
  Users,
  Wallet,
} from "lucide-react";
import { SidebarShell, type SidebarNavItem } from "@/components/ui/sidebar-shell";

// `staff: true` items are visible to restaurant_staff; everything else is owner-only (#156).
const NAV: (SidebarNavItem & { staff?: boolean })[] = [
  { href: "/restaurant/orders", label: "Orders", icon: ClipboardList, staff: true },
  { href: "/restaurant/today", label: "Today", icon: Sun, staff: true },
  { href: "/restaurant/menu", label: "Menu", icon: CookingPot },
  { href: "/restaurant/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/restaurant/reviews", label: "Reviews", icon: MessageSquare },
  { href: "/restaurant/support", label: "Support", icon: LifeBuoy },
  { href: "/restaurant/branding", label: "Branding", icon: Palette },
  { href: "/restaurant/campaigns", label: "Promotions", icon: Megaphone },
  { href: "/restaurant/promo-codes", label: "Promo codes", icon: Ticket },
  { href: "/restaurant/riders", label: "Riders", icon: Users },
  { href: "/restaurant/wallet", label: "Wallet", icon: Wallet },
  { href: "/restaurant/settlements", label: "Settlements", icon: FileSpreadsheet },
  { href: "/restaurant/staff", label: "Staff", icon: UserCog },
  { href: "/restaurant/verification", label: "Verification", icon: ShieldCheck },
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

// Owner-only route prefixes (#204): every NAV entry that isn't a staff lane. Used to block
// restaurant_staff who reach an owner surface by direct URL, not just by nav-hiding.
const OWNER_ONLY_PREFIXES = NAV.filter((n) => !n.staff).map((n) => n.href);

function ConsoleShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { isOwner, fetching } = useConsole();
  // Staff see only the operational lanes; owners see the full console (#156).
  const nav = isOwner ? NAV : NAV.filter((n) => n.staff);
  // #204: direct-URL guard. Resolvers already reject staff, but block the page too so a
  // staff member who types an owner-only URL is bounced to Orders instead of seeing a
  // half-rendered surface that then errors. Wait for the role to load to avoid a flash.
  const blocked =
    !fetching && !isOwner && OWNER_ONLY_PREFIXES.some((href) => pathname.startsWith(href));
  useEffect(() => {
    if (blocked) router.replace("/restaurant/orders");
  }, [blocked, router]);
  return (
    <SidebarShell
      brand={<Link href="/restaurant/orders">🍜 Console</Link>}
      items={nav}
      aside={<BranchSwitcher />}
      footer={<Link href="/">← Customer site</Link>}
    >
      {blocked ? (
        <div className="mx-auto mt-16 max-w-md rounded-2xl border border-kd-border bg-kd-surface p-6 text-center">
          <p className="font-semibold">Owner-only page</p>
          <p className="mt-1 text-sm text-kd-fg-muted">
            Only the restaurant owner can view this. Taking you back to Orders…
          </p>
        </div>
      ) : (
        children
      )}
    </SidebarShell>
  );
}
