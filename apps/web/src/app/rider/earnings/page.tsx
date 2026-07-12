"use client";

import { useQuery } from "urql";
import { graphql } from "@/graphql/generated";
import { formatRs } from "@fd/shared";
import { Skeleton } from "@/components/ui/skeleton";

// Rider earnings: headline totals + a per-job breakdown (delivery fee, tip, COD, net).
// net = deliveryFee + tip (there's no rider ledger split yet); COD is cash handled at the
// door, already owed to the restaurant — shown for reconciliation, not added to net.
const EarningsQuery = graphql(`
  query RiderEarnings {
    myEarnings {
      deliveredCount
      codCollectedMinor
    }
    myEarningsBreakdown {
      jobCount
      deliveryFeeMinor
      tipMinor
      codCollectedMinor
      netMinor
      rows {
        taskId
        orderId
        orderCode
        deliveredAt
        deliveryFeeMinor
        tipMinor
        codCollectedMinor
        netMinor
      }
    }
  }
`);

export default function RiderEarningsPage() {
  const [{ data, fetching }] = useQuery({
    query: EarningsQuery,
    requestPolicy: "cache-and-network",
  });
  const e = data?.myEarnings;
  const breakdown = data?.myEarningsBreakdown;
  const rows = breakdown?.rows ?? [];

  return (
    <main className="space-y-4">
      <h1 className="text-xl font-bold">Earnings</h1>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-kd-border bg-kd-surface p-4 text-center">
          <p className="text-3xl font-bold">{e?.deliveredCount ?? 0}</p>
          <p className="text-xs text-kd-fg-muted">deliveries completed</p>
        </div>
        <div className="rounded-2xl border border-kd-border bg-kd-surface p-4 text-center">
          <p className="text-3xl font-bold text-kd-success">{formatRs(breakdown?.netMinor ?? 0)}</p>
          <p className="text-xs text-kd-fg-muted">net earned</p>
        </div>
      </div>

      {/* Totals split so the rider can see how net is made up. */}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-xl border border-kd-border bg-kd-surface p-3 text-center">
          <p className="text-lg font-semibold">{formatRs(breakdown?.deliveryFeeMinor ?? 0)}</p>
          <p className="text-xs text-kd-fg-muted">delivery fees</p>
        </div>
        <div className="rounded-xl border border-kd-border bg-kd-surface p-3 text-center">
          <p className="text-lg font-semibold">{formatRs(breakdown?.tipMinor ?? 0)}</p>
          <p className="text-xs text-kd-fg-muted">tips</p>
        </div>
        <div className="rounded-xl border border-kd-border bg-kd-surface p-3 text-center">
          <p className="text-lg font-semibold text-kd-warning">
            {formatRs(breakdown?.codCollectedMinor ?? e?.codCollectedMinor ?? 0)}
          </p>
          <p className="text-xs text-kd-fg-muted">COD handled</p>
        </div>
      </div>

      <section>
        <h2 className="mb-2 text-sm font-bold uppercase text-kd-fg-muted">Per-job breakdown</h2>

        {fetching && rows.length === 0 && (
          <div className="space-y-2">
            <Skeleton className="h-20 rounded-2xl" />
            <Skeleton className="h-20 rounded-2xl" />
          </div>
        )}

        {!fetching && rows.length === 0 && (
          <p className="rounded-xl bg-kd-surface p-6 text-center text-sm text-kd-fg-subtle">
            No completed deliveries yet — your job earnings will appear here.
          </p>
        )}

        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.taskId} className="rounded-2xl border border-kd-border bg-kd-surface p-4">
              <div className="flex items-center justify-between">
                <span className="font-semibold">{r.orderCode}</span>
                <span className="font-semibold text-kd-success">{formatRs(r.netMinor)}</span>
              </div>
              {r.deliveredAt && (
                <p className="text-xs text-kd-fg-subtle">
                  {new Date(r.deliveredAt as unknown as string).toLocaleString()}
                </p>
              )}
              <dl className="mt-2 grid grid-cols-3 gap-2 text-sm">
                <div>
                  <dt className="text-xs text-kd-fg-muted">Delivery fee</dt>
                  <dd>{formatRs(r.deliveryFeeMinor)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-kd-fg-muted">Tip</dt>
                  <dd>{formatRs(r.tipMinor)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-kd-fg-muted">COD</dt>
                  <dd className={r.codCollectedMinor > 0 ? "text-kd-warning" : undefined}>
                    {formatRs(r.codCollectedMinor)}
                  </dd>
                </div>
              </dl>
            </div>
          ))}
        </div>
      </section>

      <p className="text-xs text-kd-fg-subtle">
        Net = delivery fee + tip. COD is cash you collected at the door on the restaurant&rsquo;s
        behalf — it is not part of your earnings. Restaurant riders are settled by their restaurant;
        independent-rider payouts are estimated on the Payouts tab.
      </p>
    </main>
  );
}
