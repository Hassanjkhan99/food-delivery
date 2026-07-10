"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "urql";
import { graphql } from "@/graphql/generated";
import { formatRs } from "@fd/shared";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

const StatsQuery = graphql(`
  query AdminStats {
    dashboardStats {
      ordersToday
      gmvTodayMinor
      activeOrders
      acceptanceSlaPct
      cancellationRatePct
      pendingApprovals
      openTickets
      pendingRefunds
    }
  }
`);

export default function AdminOverviewPage() {
  const router = useRouter();
  const [{ data, fetching }] = useQuery({ query: StatsQuery, requestPolicy: "cache-and-network" });
  const [orderId, setOrderId] = useState("");
  const s = data?.dashboardStats;

  if (fetching && !s) return <Skeleton className="h-64 rounded-2xl" />;

  const tiles = s
    ? [
        { label: "Orders today", value: String(s.ordersToday) },
        { label: "GMV today (delivered)", value: formatRs(s.gmvTodayMinor) },
        { label: "Active orders", value: String(s.activeOrders) },
        { label: "Acceptance SLA (120s)", value: `${s.acceptanceSlaPct.toFixed(0)}%` },
        { label: "Cancellation rate", value: `${s.cancellationRatePct.toFixed(1)}%` },
        { label: "Pending approvals", value: String(s.pendingApprovals) },
        { label: "Open tickets", value: String(s.openTickets) },
        { label: "Pending refunds", value: String(s.pendingRefunds) },
      ]
    : [];

  return (
    <main>
      <h1 className="mb-4 text-xl font-bold">Marketplace overview</h1>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-2xl border border-kd-border bg-kd-surface p-4">
            <p className="text-2xl font-bold">{t.value}</p>
            <p className="text-xs text-kd-fg-muted">{t.label}</p>
          </div>
        ))}
      </div>

      <div className="mt-8 max-w-md rounded-2xl border border-kd-border bg-kd-surface p-4">
        <p className="mb-2 text-sm font-semibold">Order escalation</p>
        <div className="flex gap-2">
          <Input
            placeholder="Order id…"
            value={orderId}
            onChange={(e) => setOrderId(e.target.value)}
          />
          <Button
            disabled={!orderId.trim()}
            onClick={() => router.push(`/admin/orders/${orderId.trim()}`)}
          >
            Open
          </Button>
        </div>
      </div>
    </main>
  );
}
