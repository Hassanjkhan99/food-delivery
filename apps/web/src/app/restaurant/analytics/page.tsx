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
      avgAcceptSeconds
      repeatCustomerRate
      topItems {
        name
        qty
        revenueMinor
      }
      bottomItems {
        name
        qty
        revenueMinor
      }
      revenueByDay {
        date
        revenueMinor
        orders
      }
      acceptSecondsTrend {
        date
        revenueMinor
        orders
      }
      cancelReasons {
        reason
        count
      }
    }
  }
`);

// Human labels for cancellation reason codes; falls back to the raw code.
const CANCEL_REASON_LABELS: Record<string, string> = {
  customer_request: "Customer request",
  restaurant_unavailable: "Restaurant unavailable",
  item_out_of_stock: "Item out of stock",
  rider_unavailable: "Rider unavailable",
  address_issue: "Address issue",
  payment_failed: "Payment failed",
  other: "Other",
};

function cancelReasonLabel(code: string): string {
  return (
    CANCEL_REASON_LABELS[code] ?? code.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())
  );
}

function formatAcceptTime(seconds: number | null | undefined): string {
  if (seconds == null) return "—";
  if (seconds < 90) return `${seconds}s`;
  return `${Math.round(seconds / 60)} min`;
}

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

  if (!restaurant || !branch) return <p className="text-kd-fg-muted">Complete onboarding first.</p>;

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
          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
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
            <div className="rounded-2xl border border-kd-border bg-kd-surface p-5">
              <p className="text-sm text-kd-fg-muted">Avg accept time</p>
              <p className="text-3xl font-bold text-kd-fg">
                {formatAcceptTime(a.avgAcceptSeconds)}
              </p>
            </div>
            <div className="rounded-2xl border border-kd-border bg-kd-surface p-5">
              <p className="text-sm text-kd-fg-muted">Repeat customers</p>
              <p className="text-3xl font-bold text-kd-fg">
                {Math.round(a.repeatCustomerRate * 100)}%
              </p>
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

          <div className="mb-6 rounded-2xl border border-kd-border bg-kd-surface p-5">
            <h2 className="mb-4 font-semibold">Revenue by day</h2>
            {a.revenueByDay.length > 0 ? (
              <>
                <Bars
                  data={a.revenueByDay.map((d) => d.revenueMinor)}
                  labelFor={(i) => {
                    const d = a.revenueByDay[i]?.date;
                    return d ? d.slice(5) : ""; // MM-DD
                  }}
                />
                <p className="mt-2 text-xs text-kd-fg-subtle">
                  Daily revenue (PKT), delivered orders.
                </p>
              </>
            ) : (
              <p className="text-sm text-kd-fg-subtle">No sales in this window yet.</p>
            )}
          </div>

          <div className="mb-6 rounded-2xl border border-kd-border bg-kd-surface p-5">
            <h2 className="mb-4 font-semibold">Acceptance time trend</h2>
            {a.acceptSecondsTrend.length > 0 ? (
              <>
                <Bars
                  data={a.acceptSecondsTrend.map((d) => d.revenueMinor)}
                  labelFor={(i) => {
                    const d = a.acceptSecondsTrend[i]?.date;
                    return d ? d.slice(5) : "";
                  }}
                />
                <p className="mt-2 text-xs text-kd-fg-subtle">
                  Mean seconds from order placed to accepted, per day.
                </p>
              </>
            ) : (
              <p className="text-sm text-kd-fg-subtle">No accepted orders in this window yet.</p>
            )}
          </div>

          <div className="mb-6 rounded-2xl border border-kd-border bg-kd-surface p-5">
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

          {a.bottomItems.length > 0 && (
            <div className="mt-6 rounded-2xl border border-kd-border bg-kd-surface p-5">
              <h2 className="mb-1 font-semibold">Bottom items</h2>
              <p className="mb-3 text-xs text-kd-fg-subtle">Lowest sellers in this window.</p>
              <div className="space-y-1">
                {a.bottomItems.map((it, i) => (
                  <div
                    key={`${it.name}-${i}`}
                    className="flex items-center justify-between rounded-lg bg-kd-surface-muted px-3 py-2 text-sm"
                  >
                    <span className="min-w-0 truncate">
                      {it.name}
                      <span className="ml-2 text-xs text-kd-fg-subtle">×{it.qty}</span>
                    </span>
                    <span className="ml-3 shrink-0 font-semibold">{formatRs(it.revenueMinor)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="mt-6 rounded-2xl border border-kd-border bg-kd-surface p-5">
            <h2 className="mb-3 font-semibold">Cancellation reasons</h2>
            <div className="space-y-1">
              {a.cancelReasons.map((c) => (
                <div
                  key={c.reason}
                  className="flex items-center justify-between rounded-lg bg-kd-surface-muted px-3 py-2 text-sm"
                >
                  <span className="min-w-0 truncate">{cancelReasonLabel(c.reason)}</span>
                  <span className="ml-3 shrink-0 font-semibold tabular-nums">{c.count}</span>
                </div>
              ))}
              {a.cancelReasons.length === 0 && (
                <p className="text-sm text-kd-fg-subtle">No cancellations in this window.</p>
              )}
            </div>
          </div>
        </>
      )}
    </main>
  );
}
