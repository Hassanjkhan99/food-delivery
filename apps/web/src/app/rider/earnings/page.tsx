"use client";

import { useQuery } from "urql";
import { graphql } from "@/graphql/generated";
import { formatRs } from "@fd/shared";

const EarningsQuery = graphql(`
  query RiderEarnings {
    myEarnings {
      deliveredCount
      codCollectedMinor
    }
  }
`);

export default function RiderEarningsPage() {
  const [{ data }] = useQuery({ query: EarningsQuery, requestPolicy: "cache-and-network" });
  const e = data?.myEarnings;

  return (
    <main className="space-y-4">
      <h1 className="text-xl font-bold">Earnings</h1>
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-kd-border bg-kd-surface p-4 text-center">
          <p className="text-3xl font-bold">{e?.deliveredCount ?? 0}</p>
          <p className="text-xs text-kd-fg-muted">deliveries completed</p>
        </div>
        <div className="rounded-2xl border border-kd-border bg-kd-surface p-4 text-center">
          <p className="text-3xl font-bold">{formatRs(e?.codCollectedMinor ?? 0)}</p>
          <p className="text-xs text-kd-fg-muted">COD handled</p>
        </div>
      </div>
      <p className="text-xs text-kd-fg-subtle">
        Restaurant riders are settled by their restaurant. Per-job payables for shared and
        independent riders arrive with the shared-rider dispatch phase.
      </p>
    </main>
  );
}
