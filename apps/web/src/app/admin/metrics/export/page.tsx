"use client";

// Admin metrics export (#29): orders / GMV / take-rate per period as CSV for BI.
// GMV = subtotal + tax + delivery over delivered orders; take rate = platform
// revenue / GMV (kickoff KPI formulas). CSV comes back as a GraphQL string field
// and is downloaded client-side.
import { useState } from "react";
import { useClient } from "urql";
import { graphql } from "@/graphql/generated";
import { downloadText } from "@/lib/download";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const MetricsCsvQuery = graphql(`
  query AdminMetricsCsv($from: DateTime, $to: DateTime, $granularity: String) {
    adminMetricsCsv(from: $from, to: $to, granularity: $granularity)
  }
`);

const GRANULARITIES = ["day", "week", "month"] as const;
type Granularity = (typeof GRANULARITIES)[number];

function defaultRange() {
  const to = new Date();
  const from = new Date(to.getTime() - 30 * 24 * 60 * 60_000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: iso(from), to: iso(to) };
}

export default function AdminMetricsExportPage() {
  const client = useClient();
  const [range, setRange] = useState(defaultRange);
  const [granularity, setGranularity] = useState<Granularity>("day");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const from = range.from ? new Date(`${range.from}T00:00:00.000Z`) : null;
      const to = range.to ? new Date(`${range.to}T23:59:59.999Z`) : null;
      const res = await client
        .query(MetricsCsvQuery, { from, to, granularity })
        .toPromise();
      const csv = res.data?.adminMetricsCsv;
      if (res.error || !csv) throw new Error(res.error?.message ?? "Export failed");
      downloadText(`metrics_${granularity}_${range.from}_${range.to}.csv`, csv);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="max-w-lg">
      <h1 className="mb-1 text-xl font-bold">Metrics export</h1>
      <p className="mb-4 text-sm text-kd-fg-muted">
        Orders, GMV and take-rate per period over delivered orders. GMV = subtotal + tax +
        delivery; take rate = platform revenue / GMV.
      </p>

      <div className="space-y-4 rounded-2xl border border-kd-border bg-kd-surface p-4">
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

        <div>
          <Label>Granularity</Label>
          <div className="mt-1 flex gap-2">
            {GRANULARITIES.map((g) => (
              <Button
                key={g}
                type="button"
                variant={granularity === g ? "default" : "outline"}
                onClick={() => setGranularity(g)}
                className="flex-1 capitalize"
              >
                {g}
              </Button>
            ))}
          </div>
        </div>

        {error && <p className="text-sm text-kd-danger">{error}</p>}

        <Button className="w-full" onClick={run} disabled={busy}>
          {busy ? "Preparing…" : "Download CSV"}
        </Button>
      </div>
    </main>
  );
}
