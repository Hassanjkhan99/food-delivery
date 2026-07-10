"use client";

// Settlement reports & exports (#29). Period picker + CSV downloads:
//  • Settlement report — per-order money breakdown; net reconciles to the ledger.
//  • eIMS invoice export — PRA eIMS-aligned invoice lines for the branch.
// CSV is returned as a GraphQL string field and downloaded client-side (see
// lib/download). Wallet ledger/balance stays on the Wallet page — this page is
// the reconciliation/export surface derived from the same orders + ledger.
import { useState } from "react";
import { useClient } from "urql";
import { graphql } from "@/graphql/generated";
import { useConsole } from "../useConsole";
import { downloadText } from "@/lib/download";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const SettlementCsvQuery = graphql(`
  query SettlementCsv($restaurantId: String!, $from: DateTime, $to: DateTime) {
    settlementReportCsv(restaurantId: $restaurantId, from: $from, to: $to)
  }
`);

const EimsInvoiceCsvQuery = graphql(`
  query EimsInvoiceCsv($branchId: String!, $from: DateTime, $to: DateTime) {
    eimsInvoiceCsv(branchId: $branchId, from: $from, to: $to)
  }
`);

// Default the picker to the trailing 7 days (the reconcile-a-week acceptance case).
function defaultRange() {
  const to = new Date();
  const from = new Date(to.getTime() - 7 * 24 * 60 * 60_000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: iso(from), to: iso(to) };
}

export default function SettlementsPage() {
  const { restaurant, branch } = useConsole();
  const client = useClient();
  const [range, setRange] = useState(defaultRange);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Parse the YYYY-MM-DD inputs into day-bounded instants (whole days inclusive).
  function bounds() {
    const from = range.from ? new Date(`${range.from}T00:00:00.000Z`) : null;
    const to = range.to ? new Date(`${range.to}T23:59:59.999Z`) : null;
    return { from, to };
  }

  async function runSettlement() {
    if (!restaurant) return;
    setBusy("settlement");
    setError(null);
    try {
      const { from, to } = bounds();
      const res = await client
        // Always re-run the resolver: cache-first would re-serve a stale CSV for
        // the same date range after new orders are delivered in an active period.
        .query(
          SettlementCsvQuery,
          { restaurantId: restaurant.id, from, to },
          { requestPolicy: "network-only" },
        )
        .toPromise();
      const csv = res.data?.settlementReportCsv;
      if (res.error || !csv) throw new Error(res.error?.message ?? "Export failed");
      downloadText(`settlement_${restaurant.slug}_${range.from}_${range.to}.csv`, csv);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setBusy(null);
    }
  }

  async function runEims() {
    if (!branch) return;
    setBusy("eims");
    setError(null);
    try {
      const { from, to } = bounds();
      const res = await client
        .query(
          EimsInvoiceCsvQuery,
          { branchId: branch.id, from, to },
          { requestPolicy: "network-only" },
        )
        .toPromise();
      const csv = res.data?.eimsInvoiceCsv;
      if (res.error || !csv) throw new Error(res.error?.message ?? "Export failed");
      downloadText(`eims_invoices_${range.from}_${range.to}.csv`, csv);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setBusy(null);
    }
  }

  if (!restaurant) return <p className="text-kd-fg-muted">Complete onboarding first.</p>;

  return (
    <main className="max-w-2xl">
      <h1 className="mb-1 text-xl font-bold">Settlements & reports</h1>
      <p className="mb-4 text-sm text-kd-fg-muted">
        Export a period&apos;s orders for reconciliation. The settlement report&apos;s{" "}
        <span className="font-medium">net</span> column equals the ledger balance movement for the
        same dates (delivered orders only).
      </p>

      <div className="mb-6 rounded-2xl border border-kd-border bg-kd-surface p-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>From</Label>
            <Input
              type="date"
              value={range.from}
              max={range.to}
              onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
              className="mt-1"
            />
          </div>
          <div>
            <Label>To</Label>
            <Input
              type="date"
              value={range.to}
              min={range.from}
              onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
              className="mt-1"
            />
          </div>
        </div>
        {error && <p className="mt-3 text-sm text-kd-danger">{error}</p>}
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between rounded-xl border border-kd-border bg-kd-surface p-4">
          <div className="min-w-0 pr-3">
            <p className="font-semibold">Settlement report</p>
            <p className="text-xs text-kd-fg-muted">
              Gross, tax, delivery, commission, platform fee, net — one row per delivered order.
            </p>
          </div>
          <Button onClick={runSettlement} disabled={busy !== null}>
            {busy === "settlement" ? "Preparing…" : "Download CSV"}
          </Button>
        </div>

        <div className="flex items-center justify-between rounded-xl border border-kd-border bg-kd-surface p-4">
          <div className="min-w-0 pr-3">
            <p className="font-semibold">eIMS invoice export</p>
            <p className="text-xs text-kd-fg-muted">
              PRA eIMS-aligned invoice lines for this branch: invoice number, qty, sale price, ST
              charge, inclusive total.
            </p>
          </div>
          <Button variant="secondary" onClick={runEims} disabled={busy !== null || !branch}>
            {busy === "eims" ? "Preparing…" : "Download CSV"}
          </Button>
        </div>
      </div>
    </main>
  );
}
