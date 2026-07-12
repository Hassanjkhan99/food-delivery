"use client";

// Vendor "Today" tab (#46): a live operational snapshot for the current PKT day — order
// count, revenue, an acceptance-rate proxy, and the day's top items. Read-only; polls
// alongside the board's SSE feed via a light interval refetch.
import { useEffect } from "react";
import { useQuery } from "urql";
import { graphql } from "@/graphql/generated";
import { formatRs } from "@fd/shared";
import { useConsole } from "../useConsole";
import { Skeleton } from "@/components/ui/skeleton";

const TodayQuery = graphql(`
  query Today($branchId: String!) {
    todaySummary(branchId: $branchId) {
      orders
      revenueMinor
      acceptanceSlaPct
      topItems {
        name
        qty
        revenueMinor
      }
    }
  }
`);

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-kd-border bg-kd-surface p-4">
      <p className="text-xs uppercase text-kd-fg-muted">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-kd-fg-subtle">{hint}</p>}
    </div>
  );
}

export default function TodayPage() {
  const { branch, restaurant } = useConsole();
  const [{ data, fetching }, refetch] = useQuery({
    query: TodayQuery,
    variables: { branchId: branch?.id ?? "" },
    pause: !branch,
    requestPolicy: "cache-and-network",
  });

  useEffect(() => {
    if (!branch) return;
    const t = setInterval(() => refetch({ requestPolicy: "network-only" }), 30_000);
    return () => clearInterval(t);
  }, [branch, refetch]);

  if (!restaurant || !branch) {
    return fetching ? (
      <Skeleton className="h-64 rounded-2xl" />
    ) : (
      <p className="text-kd-fg-muted">Complete onboarding first.</p>
    );
  }

  const s = data?.todaySummary;

  return (
    <main className="max-w-3xl">
      <h1 className="mb-4 text-xl font-bold">Today</h1>
      {!s ? (
        <Skeleton className="h-40 rounded-2xl" />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Stat label="Orders" value={String(s.orders)} />
            <Stat label="Revenue" value={formatRs(s.revenueMinor)} hint="Accepted orders" />
            <Stat label="Acceptance" value={`${s.acceptanceSlaPct}%`} hint="Accepted vs. decided" />
          </div>

          <h2 className="mt-6 mb-2 text-sm font-bold uppercase text-kd-fg-muted">Top items</h2>
          <div className="rounded-xl border border-kd-border bg-kd-surface">
            {s.topItems.length === 0 ? (
              <p className="p-4 text-sm text-kd-fg-muted">No items sold yet today.</p>
            ) : (
              <ul className="divide-y divide-kd-border">
                {s.topItems.map((it) => (
                  <li key={it.name} className="flex items-center justify-between p-3 text-sm">
                    <span className="font-medium">{it.name}</span>
                    <span className="text-kd-fg-muted">
                      {it.qty} sold · {formatRs(it.revenueMinor)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </main>
  );
}
