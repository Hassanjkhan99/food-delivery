"use client";

import { useQuery } from "urql";
import { graphql } from "@/graphql/generated";
import { formatRs } from "@fd/shared";
import { useConsole } from "../useConsole";

const AnalyticsQuery = graphql(`
  query RestaurantAnalytics($branchId: String!, $days: Int) {
    restaurantAnalytics(branchId: $branchId, days: $days) {
      totalOrders
      totalRevenueMinor
      avgOrderValueMinor
      ordersByDayOfWeek
      ordersByHour
      topItems {
        name
        qty
        revenueMinor
      }
    }
  }
`);

// ordersByDayOfWeek is indexed 0=Sunday…6=Saturday (server buckets in PKT).
const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const DAYS_WINDOW = 30;

function Bars({ data, labelFor }: { data: number[]; labelFor: (i: number) => string }) {
  const max = Math.max(1, ...data);
  return (
    <div className="flex items-end gap-1" style={{ height: 120 }}>
      {data.map((v, i) => (
        <div key={i} className="flex flex-1 flex-col items-center gap-1">
          <div className="flex w-full flex-1 items-end">
            <div
              className="w-full rounded-t bg-kd-primary transition-all"
              style={{ height: `${(v / max) * 100}%` }}
              title={`${labelFor(i)}: ${v}`}
              aria-label={`${labelFor(i)}: ${v} orders`}
            />
          </div>
          <span className="text-[10px] leading-none text-kd-fg-subtle">{labelFor(i)}</span>
        </div>
      ))}
    </div>
  );
}

export default function AnalyticsPage() {
  const { restaurant, branch } = useConsole();
  const [{ data, fetching, error }] = useQuery({
    query: AnalyticsQuery,
    variables: { branchId: branch?.id ?? "", days: DAYS_WINDOW },
    pause: !branch,
    requestPolicy: "cache-and-network",
  });

  if (!restaurant || !branch)
    return <p className="text-kd-fg-muted">Complete onboarding first.</p>;

  const a = data?.restaurantAnalytics;

  return (
    <main className="max-w-3xl">
      <h1 className="mb-1 text-xl font-bold">Analytics</h1>
      <p className="mb-4 text-sm text-kd-fg-muted">
        Delivered orders over the last {DAYS_WINDOW} days.
      </p>

      {error && (
        <p className="mb-4 rounded-xl border border-kd-danger bg-kd-danger-soft p-3 text-sm text-kd-danger">
          Could not load analytics. Please try again.
        </p>
      )}

      {fetching && !a && <p className="text-sm text-kd-fg-subtle">Loading…</p>}

      {a && (
        <>
          <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-kd-border bg-kd-surface p-5">
              <p className="text-sm text-kd-fg-muted">Total orders</p>
              <p className="text-3xl font-bold text-kd-fg">{a.totalOrders}</p>
            </div>
            <div className="rounded-2xl border border-kd-border bg-kd-surface p-5">
              <p className="text-sm text-kd-fg-muted">Revenue</p>
              <p className="text-3xl font-bold text-kd-fg">{formatRs(a.totalRevenueMinor)}</p>
            </div>
            <div className="rounded-2xl border border-kd-border bg-kd-surface p-5">
              <p className="text-sm text-kd-fg-muted">Avg order value</p>
              <p className="text-3xl font-bold text-kd-fg">{formatRs(a.avgOrderValueMinor)}</p>
            </div>
          </div>

          <div className="mb-6 rounded-2xl border border-kd-border bg-kd-surface p-5">
            <h2 className="mb-4 font-semibold">Orders by day of week</h2>
            <Bars data={a.ordersByDayOfWeek} labelFor={(i) => DAY_LABELS[i] ?? String(i)} />
          </div>

          <div className="mb-6 rounded-2xl border border-kd-border bg-kd-surface p-5">
            <h2 className="mb-4 font-semibold">Orders by hour</h2>
            <Bars data={a.ordersByHour} labelFor={(i) => (i % 3 === 0 ? String(i) : "")} />
            <p className="mt-2 text-xs text-kd-fg-subtle">Hour of day (PKT), 0–23.</p>
          </div>

          <div className="rounded-2xl border border-kd-border bg-kd-surface p-5">
            <h2 className="mb-3 font-semibold">Top items</h2>
            <div className="space-y-1">
              {a.topItems.map((it, i) => (
                <div
                  key={`${it.name}-${i}`}
                  className="flex items-center justify-between rounded-lg bg-kd-surface-muted px-3 py-2 text-sm"
                >
                  <span className="min-w-0 truncate">
                    <span className="mr-2 text-kd-fg-subtle">{i + 1}.</span>
                    {it.name}
                    <span className="ml-2 text-xs text-kd-fg-subtle">×{it.qty}</span>
                  </span>
                  <span className="ml-3 shrink-0 font-semibold">{formatRs(it.revenueMinor)}</span>
                </div>
              ))}
              {a.topItems.length === 0 && (
                <p className="text-sm text-kd-fg-subtle">No sales in this window yet.</p>
              )}
            </div>
          </div>
        </>
      )}
    </main>
  );
}
