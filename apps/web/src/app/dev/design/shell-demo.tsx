"use client";

import { BarChart3, ClipboardList, CookingPot, Settings } from "lucide-react";

import { SidebarShell } from "@/components/ui/sidebar-shell";

/** Client showcase for SidebarShell. It's a `"use client"` component (like the real
 *  restaurant/admin layouts) because Lucide `icon` functions can't cross the
 *  server→client boundary as props. Shown in a clipped frame (the shell is min-h-screen). */
export function ShellDemo() {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="h-72 overflow-hidden rounded-xl border border-kd-border">
        <SidebarShell
          brand={<span>🍜 Console</span>}
          items={[
            { href: "/dev/design", label: "Orders", icon: ClipboardList },
            { href: "/x/menu", label: "Menu", icon: CookingPot },
            { href: "/x/analytics", label: "Analytics", icon: BarChart3 },
            { href: "/x/settings", label: "Settings", icon: Settings },
          ]}
          footer={<span>← Customer site</span>}
        >
          <p className="text-sm text-kd-fg-muted">Light tone (restaurant console).</p>
        </SidebarShell>
      </div>
      <div className="h-72 overflow-hidden rounded-xl border border-kd-border">
        <SidebarShell
          tone="dark"
          brand={<span>⚙️ Admin</span>}
          items={[
            { href: "/dev/design", label: "Command center", icon: BarChart3 },
            { href: "/x/kyc", label: "KYC", icon: Settings },
          ]}
          footer={<span>← Customer site</span>}
        >
          <p className="text-sm text-kd-fg-muted">Dark tone (admin console).</p>
        </SidebarShell>
      </div>
    </div>
  );
}
