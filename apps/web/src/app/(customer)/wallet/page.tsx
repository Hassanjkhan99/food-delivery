"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "urql";
import { Wallet as WalletIcon } from "lucide-react";
import { graphql } from "@/graphql/generated";
import { formatRs } from "@fd/shared";
import { parseGqlError, friendlyMessage } from "@/lib/graphql-error";
import { Button, buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

const WalletQuery = graphql(`
  query MyWallet {
    myWallet {
      balanceMinor
      transactions {
        id
        amountMinor
        memo
        createdAt
      }
    }
    myPaymentMethods {
      id
      brand
      last4
      isDefault
    }
  }
`);

const TopUpMutation = graphql(`
  mutation TopUpWallet($amountMinor: Int!, $paymentMethodId: String!, $idempotencyKey: String!) {
    topUpWallet(
      amountMinor: $amountMinor
      paymentMethodId: $paymentMethodId
      idempotencyKey: $idempotencyKey
    ) {
      balanceMinor
    }
  }
`);

// Preset top-up amounts (minor units): Rs 500 / 1000 / 2000 / 5000.
const PRESETS = [50_000, 100_000, 200_000, 500_000];

export default function WalletPage() {
  const [{ data, fetching }, refetch] = useQuery({
    query: WalletQuery,
    requestPolicy: "cache-and-network",
  });
  const [topUpState, topUp] = useMutation(TopUpMutation);

  const [amountMinor, setAmountMinor] = useState<number>(PRESETS[1]);
  const [methodId, setMethodId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Stable key for the in-flight top-up so a double-click / retry is idempotent server-side
  // (#116). Rotated after each completed attempt so the next top-up gets a fresh key.
  const idempotencyKey = useRef<string>(crypto.randomUUID());

  const wallet = data?.myWallet;
  const methods = data?.myPaymentMethods ?? [];
  const selectedMethodId =
    methodId ?? methods.find((m) => m.isDefault)?.id ?? methods[0]?.id ?? null;

  async function onTopUp() {
    setError(null);
    if (!selectedMethodId) {
      setError("Add a card first to top up.");
      return;
    }
    const result = await topUp({
      amountMinor,
      paymentMethodId: selectedMethodId,
      idempotencyKey: idempotencyKey.current,
    });
    if (result.error) {
      // A networkError means the response was lost — the server MAY already have charged
      // and credited. Keep the SAME key so a retry dedupes server-side instead of charging
      // twice. Only rotate on a definite server response (a GraphQL decline/validation),
      // where the customer needs a fresh key to try again (#116).
      if (!result.error.networkError) idempotencyKey.current = crypto.randomUUID();
      setError(friendlyMessage(parseGqlError(result.error, "We couldn't complete the top-up.")));
      return;
    }
    // Success: rotate so the next deliberate top-up isn't deduped against this one.
    idempotencyKey.current = crypto.randomUUID();
    refetch({ requestPolicy: "network-only" });
  }

  return (
    <main className="mx-auto max-w-md">
      <h1 className="mb-6 text-2xl font-bold">Wallet</h1>

      <div className="rounded-xl border border-kd-border bg-kd-primary-soft p-5">
        <div className="flex items-center gap-2 text-kd-fg-muted">
          <WalletIcon className="h-5 w-5" />
          <span className="text-sm font-medium">Available balance</span>
        </div>
        <p className="mt-2 text-3xl font-bold text-kd-fg">
          {fetching && !wallet ? "…" : formatRs(wallet?.balanceMinor ?? 0)}
        </p>
      </div>

      <section className="mt-6 rounded-xl border border-kd-border bg-kd-surface p-4">
        <p className="mb-3 text-sm font-semibold">Top up</p>
        <div className="grid grid-cols-4 gap-2">
          {PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setAmountMinor(p)}
              className={
                p === amountMinor
                  ? "rounded-lg border border-kd-primary bg-kd-primary-soft px-2 py-2 text-sm font-medium text-kd-fg"
                  : "rounded-lg border border-kd-border px-2 py-2 text-sm text-kd-fg-muted hover:border-kd-primary"
              }
            >
              {formatRs(p)}
            </button>
          ))}
        </div>

        <div className="mt-4">
          {methods.length === 0 ? (
            <p className="text-xs text-kd-fg-muted">
              No saved cards.{" "}
              <Link href="/payment-methods" className="underline">
                Add one
              </Link>{" "}
              to top up.
            </p>
          ) : (
            <RadioGroup value={selectedMethodId ?? ""} onValueChange={(v) => setMethodId(v)}>
              {methods.map((m) => (
                <Label
                  key={m.id}
                  htmlFor={`wm-${m.id}`}
                  className="flex cursor-pointer items-center gap-3 text-sm capitalize"
                >
                  <RadioGroupItem id={`wm-${m.id}`} value={m.id} />
                  {m.brand} •••• {m.last4}
                </Label>
              ))}
            </RadioGroup>
          )}
        </div>

        {error && <p className="mt-3 text-sm text-kd-danger">{error}</p>}

        <Button
          className="mt-4 w-full"
          disabled={topUpState.fetching || methods.length === 0}
          onClick={onTopUp}
        >
          {topUpState.fetching ? "Processing…" : `Top up ${formatRs(amountMinor)}`}
        </Button>
      </section>

      <section className="mt-6">
        <p className="mb-2 text-sm font-semibold">Transaction history</p>
        <div className="space-y-2">
          {(wallet?.transactions ?? []).map((txn) => (
            <div
              key={txn.id}
              className="flex items-center justify-between rounded-lg border border-kd-border bg-kd-surface px-3 py-2 text-sm"
            >
              <div className="min-w-0">
                <p className="truncate text-kd-fg">{txn.memo}</p>
                <p className="text-xs text-kd-fg-subtle">
                  {new Date(txn.createdAt).toLocaleString()}
                </p>
              </div>
              <span
                className={
                  txn.amountMinor >= 0
                    ? "shrink-0 font-medium text-kd-success"
                    : "shrink-0 font-medium text-kd-fg"
                }
              >
                {txn.amountMinor >= 0 ? "+" : "−"}
                {formatRs(Math.abs(txn.amountMinor))}
              </span>
            </div>
          ))}
          {wallet && wallet.transactions.length === 0 && (
            <p className="text-sm text-kd-fg-muted">No wallet activity yet.</p>
          )}
        </div>
      </section>

      <Link
        href="/account"
        className={buttonVariants({ variant: "outline", className: "mt-6 w-full" })}
      >
        Back to account
      </Link>
    </main>
  );
}
