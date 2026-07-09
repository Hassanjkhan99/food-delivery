"use client";

import { useQuery } from "urql";
import { graphql } from "@/graphql/generated";
import { formatRs } from "@fd/shared";
import { useConsole } from "../useConsole";
import { Badge } from "@/components/ui/badge";

const WalletQuery = graphql(`
  query Wallet($restaurantId: String!) {
    walletBalance(restaurantId: $restaurantId)
    walletStatement(restaurantId: $restaurantId) {
      id
      txId
      debitMinor
      creditMinor
      memo
      createdAt
    }
    payoutHistory(restaurantId: $restaurantId) {
      id
      amountMinor
      status
      reference
      paidAt
    }
  }
`);

export default function WalletPage() {
  const { restaurant } = useConsole();
  const [{ data }] = useQuery({
    query: WalletQuery,
    variables: { restaurantId: restaurant?.id ?? "" },
    pause: !restaurant,
    requestPolicy: "cache-and-network",
  });

  if (!restaurant) return <p className="text-kd-fg-muted">Complete onboarding first.</p>;

  const balance = data?.walletBalance ?? 0;

  return (
    <main className="max-w-2xl">
      <h1 className="mb-4 text-xl font-bold">Wallet</h1>

      <div className="mb-6 rounded-2xl border border-kd-border bg-kd-surface p-6">
        <p className="text-sm text-kd-fg-muted">Current balance (payable to you)</p>
        <p className={`text-3xl font-bold ${balance < 0 ? "text-kd-danger" : "text-kd-fg"}`}>
          {formatRs(balance)}
        </p>
        {balance < 0 && (
          <p className="mt-1 text-xs text-kd-danger">
            Negative balance: platform fees from COD orders exceed card-order earnings. It nets
            against future card orders or is invoiced.
          </p>
        )}
      </div>

      <h2 className="mb-2 font-semibold">Payouts</h2>
      <div className="mb-6 space-y-2">
        {data?.payoutHistory.map((p) => (
          <div
            key={p.id}
            className="flex items-center justify-between rounded-xl border border-kd-border bg-kd-surface p-3 text-sm"
          >
            <span>
              {p.reference ?? p.id.slice(0, 8)}
              {p.paidAt && (
                <span className="ml-2 text-xs text-kd-fg-subtle">
                  {new Date(p.paidAt as unknown as string).toLocaleDateString()}
                </span>
              )}
            </span>
            <span className="flex items-center gap-2">
              <Badge variant={p.status === "paid" ? "default" : "secondary"}>{p.status}</Badge>
              <span className="font-semibold">{formatRs(p.amountMinor)}</span>
            </span>
          </div>
        ))}
        {data?.payoutHistory.length === 0 && (
          <p className="text-sm text-kd-fg-subtle">No payouts yet.</p>
        )}
      </div>

      <h2 className="mb-2 font-semibold">Statement</h2>
      <div className="space-y-1">
        {data?.walletStatement.map((e) => (
          <div
            key={e.id}
            className="flex items-center justify-between rounded-lg bg-kd-surface px-3 py-2 text-sm"
          >
            <span className="min-w-0 truncate text-kd-fg-muted">{e.memo}</span>
            <span
              className={`ml-3 shrink-0 font-mono ${e.creditMinor > 0 ? "text-kd-success" : "text-kd-danger"}`}
            >
              {e.creditMinor > 0 ? `+${formatRs(e.creditMinor)}` : `−${formatRs(e.debitMinor)}`}
            </span>
          </div>
        ))}
        {data?.walletStatement.length === 0 && (
          <p className="text-sm text-kd-fg-subtle">No entries yet.</p>
        )}
      </div>
    </main>
  );
}
