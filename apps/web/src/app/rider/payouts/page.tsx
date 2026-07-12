"use client";

import { useQuery } from "urql";
import { graphql } from "@/graphql/generated";
import { formatRs } from "@fd/shared";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

// Rider payout history. These windows are COMPUTED from delivered jobs (ISO weeks),
// not settled bank transfers — isComputed is always true, so every row is labelled
// "estimated" to avoid implying money has moved.
const PayoutsQuery = graphql(`
  query RiderPayouts {
    myRiderPayouts {
      periodKey
      periodStart
      periodEnd
      jobCount
      amountMinor
      isComputed
    }
  }
`);

function formatDate(value: unknown): string {
  return new Date(value as string).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
}

export default function RiderPayoutsPage() {
  const [{ data, fetching }] = useQuery({
    query: PayoutsQuery,
    requestPolicy: "cache-and-network",
  });
  const payouts = data?.myRiderPayouts ?? [];

  return (
    <main className="space-y-4">
      <h1 className="text-xl font-bold">Payouts</h1>

      {fetching && payouts.length === 0 && (
        <div className="space-y-2">
          <Skeleton className="h-20 rounded-2xl" />
          <Skeleton className="h-20 rounded-2xl" />
        </div>
      )}

      {!fetching && payouts.length === 0 && (
        <p className="rounded-xl bg-kd-surface p-6 text-center text-sm text-kd-fg-subtle">
          No payout periods yet — completed deliveries roll up into weekly payouts here.
        </p>
      )}

      <div className="space-y-2">
        {payouts.map((p) => (
          <div key={p.periodKey} className="rounded-2xl border border-kd-border bg-kd-surface p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold">
                  {formatDate(p.periodStart)} – {formatDate(p.periodEnd)}
                </p>
                <p className="text-xs text-kd-fg-muted">
                  {p.jobCount} {p.jobCount === 1 ? "delivery" : "deliveries"}
                </p>
              </div>
              <div className="text-right">
                <p className="text-lg font-bold">{formatRs(p.amountMinor)}</p>
                {p.isComputed && (
                  <Badge variant="secondary" className="mt-1">
                    Estimated
                  </Badge>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      <p className="text-xs text-kd-fg-subtle">
        Payouts are grouped by week (Mon–Sun) and estimated from your delivered jobs (delivery fee +
        tip). Actual settlement is handled by your restaurant or the platform and may differ.
      </p>
    </main>
  );
}
