"use client";

import { useState } from "react";
import { useMutation, useQuery } from "urql";
import { graphql } from "@/graphql/generated";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const FeeQuery = graphql(`
  query CurrentFees {
    currentFeeConfig {
      id
      smallBusinessCommissionBps
      smallBusinessPlatformFeeMinor
      chainCommissionBps
      chainPlatformFeeMinor
      createdAt
    }
  }
`);

const UpdateFeesMutation = graphql(`
  mutation UpdateFees($sbBps: Int!, $sbFee: Int!, $chBps: Int!, $chFee: Int!) {
    updateFeeConfig(
      smallBusinessCommissionBps: $sbBps
      smallBusinessPlatformFeeMinor: $sbFee
      chainCommissionBps: $chBps
      chainPlatformFeeMinor: $chFee
    ) {
      id
    }
  }
`);

export default function AdminFeesPage() {
  const [{ data }, refetch] = useQuery({ query: FeeQuery, requestPolicy: "cache-and-network" });
  const [saveState, save] = useMutation(UpdateFeesMutation);
  // Explicit edits win; otherwise render the active config (no sync effect needed).
  const [edited, setEdited] = useState<{
    sbBps: string;
    sbFee: string;
    chBps: string;
    chFee: string;
  } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const current = data?.currentFeeConfig;

  const form = edited ?? {
    sbBps: String(current?.smallBusinessCommissionBps ?? 0),
    sbFee: String((current?.smallBusinessPlatformFeeMinor ?? 2000) / 100),
    chBps: String(current?.chainCommissionBps ?? 800),
    chFee: String((current?.chainPlatformFeeMinor ?? 3000) / 100),
  };
  const setForm = setEdited;

  return (
    <main className="max-w-lg">
      <h1 className="mb-1 text-xl font-bold">Fee configuration</h1>
      <p className="mb-4 text-sm text-kd-fg-muted">
        Versioned — new orders snapshot the latest config; past orders never change.
      </p>

      <div className="space-y-4 rounded-2xl border border-kd-border bg-kd-surface p-4 text-sm">
        <p className="font-semibold">Small business (lenient)</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Commission (bps)</Label>
            <Input
              inputMode="numeric"
              value={form.sbBps}
              onChange={(e) => setForm({ ...form, sbBps: e.target.value })}
              className="mt-1"
            />
          </div>
          <div>
            <Label>Platform fee (Rs/order)</Label>
            <Input
              inputMode="numeric"
              value={form.sbFee}
              onChange={(e) => setForm({ ...form, sbFee: e.target.value })}
              className="mt-1"
            />
          </div>
        </div>
        <p className="font-semibold">Chains (full rate)</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Commission (bps)</Label>
            <Input
              inputMode="numeric"
              value={form.chBps}
              onChange={(e) => setForm({ ...form, chBps: e.target.value })}
              className="mt-1"
            />
          </div>
          <div>
            <Label>Platform fee (Rs/order)</Label>
            <Input
              inputMode="numeric"
              value={form.chFee}
              onChange={(e) => setForm({ ...form, chFee: e.target.value })}
              className="mt-1"
            />
          </div>
        </div>
        {message && <p className="text-kd-fg-muted">{message}</p>}
        <Button
          className="w-full"
          disabled={saveState.fetching}
          onClick={async () => {
            const r = await save({
              sbBps: Number(form.sbBps),
              sbFee: Math.round(Number(form.sbFee) * 100),
              chBps: Number(form.chBps),
              chFee: Math.round(Number(form.chFee) * 100),
            });
            setMessage(
              r.error
                ? (r.error.graphQLErrors[0]?.message ?? "Save failed")
                : "New fee version active.",
            );
            refetch({ requestPolicy: "network-only" });
          }}
        >
          Publish new version
        </Button>
        {current && (
          <p className="text-xs text-kd-fg-subtle">
            Active since {new Date(current.createdAt as unknown as string).toLocaleString()} — 100
            bps = 1%.
          </p>
        )}
      </div>
    </main>
  );
}
