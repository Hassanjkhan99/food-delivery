"use client";

import { useQuery } from "urql";
import { formatRs } from "@fd/shared";
import { graphql } from "@/graphql/generated";

// #30: admin-visible cancellation & refund policy matrix. Read-only view of the
// static scenario table plus the live engine config the cancel flow enforces.
const PolicyMatrixQuery = graphql(`
  query CancellationPolicyMatrix {
    cancellationPolicyMatrix {
      rows {
        scenario
        label
        customerPays
        outcome
      }
      config {
        gracePeriodSeconds
        postAcceptFeeMinor
        afterPreparedSubtotalBps
        unreachableChargesDeliveryFee
        unreachableWaitSeconds
      }
    }
  }
`);

export default function AdminCancellationsPage() {
  const [{ data, fetching, error }] = useQuery({
    query: PolicyMatrixQuery,
    requestPolicy: "cache-and-network",
  });

  const matrix = data?.cancellationPolicyMatrix;
  const rows = matrix?.rows ?? [];
  const config = matrix?.config;

  return (
    <main className="max-w-3xl">
      <h1 className="mb-1 text-xl font-bold">Cancellation &amp; refund policy</h1>
      <p className="mb-4 text-sm text-kd-fg-muted">
        Matrix-driven engine (#30). The cancel/reject/auto-expire flows evaluate these rules to set
        the fee, fault party, and refund. Post-acceptance edge cases still route to the refund
        workbench for review.
      </p>

      {fetching && !matrix && <p className="text-sm text-kd-fg-muted">Loading…</p>}
      {error && (
        <p className="text-sm text-kd-fg-muted">Could not load the policy matrix right now.</p>
      )}

      {rows.length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-kd-border bg-kd-surface">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-kd-border bg-kd-surface-muted text-kd-fg-muted">
              <tr>
                <th className="px-4 py-3 font-semibold">Scenario</th>
                <th className="px-4 py-3 font-semibold">Customer pays</th>
                <th className="px-4 py-3 font-semibold">Outcome</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.scenario} className="border-b border-kd-border last:border-0">
                  <td className="px-4 py-3 font-medium">{r.label}</td>
                  <td className="px-4 py-3 text-kd-fg-muted">{r.customerPays}</td>
                  <td className="px-4 py-3 text-kd-fg-muted">{r.outcome}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {config && (
        <div className="mt-5 rounded-2xl border border-kd-border bg-kd-surface p-4 text-sm">
          <p className="mb-3 font-semibold">Live configuration</p>
          <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <ConfigRow
              label="Grace window (post-accept, free)"
              value={`${config.gracePeriodSeconds / 60} min`}
            />
            <ConfigRow
              label="Post-accept fee (after grace)"
              value={formatRs(config.postAcceptFeeMinor)}
            />
            <ConfigRow
              label="After-prepared fee"
              value={`${config.afterPreparedSubtotalBps / 100}% of subtotal`}
            />
            <ConfigRow
              label="Unreachable at drop"
              value={
                config.unreachableChargesDeliveryFee
                  ? `Delivery fee forfeited · ${config.unreachableWaitSeconds / 60}-min wait`
                  : `No charge · ${config.unreachableWaitSeconds / 60}-min wait`
              }
            />
          </dl>
          <p className="mt-3 text-xs text-kd-fg-subtle">
            Config lives in @fd/shared (CANCELLATION_POLICY_CONFIG); adjust there until it moves to
            versioned FeeConfig.
          </p>
        </div>
      )}
    </main>
  );
}

function ConfigRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-kd-surface-muted px-3 py-2">
      <dt className="text-kd-fg-muted">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
