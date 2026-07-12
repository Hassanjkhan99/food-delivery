"use client";

import { useState } from "react";
import { useMutation, useQuery } from "urql";
import { graphql } from "@/graphql/generated";
import { formatRs } from "@fd/shared";
import { Button } from "@/components/ui/button";

const CandidatesQuery = graphql(`
  query PayoutCandidates {
    payoutCandidates {
      restaurantId
      name
      balanceMinor
    }
  }
`);

const RunBatchMutation = graphql(`
  mutation RunPayoutBatch($restaurantId: String) {
    runPayoutBatch(restaurantId: $restaurantId) {
      id
      amountMinor
      reference
    }
  }
`);

export default function AdminPayoutsPage() {
  const [{ data }, refetch] = useQuery({
    query: CandidatesQuery,
    requestPolicy: "cache-and-network",
  });
  const [runState, run] = useMutation(RunBatchMutation);
  const [message, setMessage] = useState<string | null>(null);
  const candidates = data?.payoutCandidates ?? [];
  const positive = candidates.filter((c) => c.balanceMinor > 0);

  return (
    <main className="max-w-2xl">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold">Payouts</h1>
        <Button
          disabled={runState.fetching || positive.length === 0}
          onClick={async () => {
            const r = await run({});
            const paid = r.data?.runPayoutBatch ?? [];
            setMessage(
              r.error
                ? (r.error.graphQLErrors[0]?.message ?? "Batch failed")
                : `Paid ${paid.length} restaurants — ${paid.map((p) => p.reference).join(", ")}`,
            );
            refetch({ requestPolicy: "network-only" });
          }}
        >
          {runState.fetching ? "Running…" : `Run batch (${positive.length})`}
        </Button>
      </div>

      {message && (
        <p className="mb-4 rounded-lg bg-kd-surface-muted px-3 py-2 text-sm">{message}</p>
      )}

      <div className="space-y-2">
        {candidates.map((c) => (
          <div
            key={c.restaurantId}
            className="flex items-center justify-between rounded-xl border border-kd-border bg-kd-surface p-4 text-sm"
          >
            <span className="font-medium">{c.name}</span>
            <div className="flex items-center gap-3">
              <span
                className={`font-mono font-semibold ${c.balanceMinor < 0 ? "text-kd-danger" : ""}`}
              >
                {formatRs(c.balanceMinor)}
              </span>
              {c.balanceMinor > 0 && (
                <Button
                  size="xs"
                  variant="outline"
                  onClick={async () => {
                    await run({ restaurantId: c.restaurantId });
                    refetch({ requestPolicy: "network-only" });
                  }}
                >
                  Pay now
                </Button>
              )}
            </div>
          </div>
        ))}
        {candidates.length === 0 && (
          <p className="text-sm text-kd-fg-muted">All balances settled.</p>
        )}
      </div>
      <p className="mt-4 text-xs text-kd-fg-subtle">
        Negative balances are platform receivables (COD fees) that net against future earnings.
      </p>
    </main>
  );
}
