"use client";

import { useRef, useState } from "react";
import { useMutation, useQuery } from "urql";
import { Gift, Wallet } from "lucide-react";
import { formatRs } from "@fd/shared";
import { graphql } from "@/graphql/generated";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const AMOUNTS_MINOR = [50_000, 100_000, 200_000, 500_000];

const GiftCardsPageQuery = graphql(`
  query GiftCardsPage {
    myWallet {
      balanceMinor
    }
    myPaymentMethods {
      id
      brand
      last4
    }
    myGiftCards {
      id
      code
      amountMinor
      balanceMinor
      status
      recipientEmail
      createdAt
    }
  }
`);

const PurchaseMutation = graphql(`
  mutation PurchaseGiftCard($input: GiftCardPurchaseInput!) {
    purchaseGiftCard(input: $input) {
      id
      code
      amountMinor
    }
  }
`);

const RedeemMutation = graphql(`
  mutation RedeemGiftCard($code: String!) {
    redeemGiftCard(code: $code) {
      balanceMinor
    }
  }
`);

export default function GiftCardsPage() {
  const [{ data }, refetch] = useQuery({
    query: GiftCardsPageQuery,
    requestPolicy: "cache-and-network",
  });
  const [purchaseState, purchase] = useMutation(PurchaseMutation);
  const [redeemState, redeem] = useMutation(RedeemMutation);

  const [amount, setAmount] = useState<number>(100_000);
  const [methodId, setMethodId] = useState<string>("");
  const [recipient, setRecipient] = useState("");
  const [buyError, setBuyError] = useState<string | null>(null);
  const [lastCode, setLastCode] = useState<string | null>(null);

  const [redeemCode, setRedeemCode] = useState("");
  const [redeemError, setRedeemError] = useState<string | null>(null);
  const [redeemMsg, setRedeemMsg] = useState<string | null>(null);

  // Stable per-purchase key: a retry of the SAME purchase reuses it (idempotent),
  // and it is rotated only after a purchase succeeds.
  const idempotencyKey = useRef<string>(crypto.randomUUID());

  const methods = data?.myPaymentMethods ?? [];
  const effectiveMethodId = methodId || methods[0]?.id || "";

  async function onBuy(e: React.FormEvent) {
    e.preventDefault();
    setBuyError(null);
    setLastCode(null);
    if (!effectiveMethodId) {
      setBuyError("Add a payment method first.");
      return;
    }
    const result = await purchase({
      input: {
        amountMinor: amount,
        paymentMethodId: effectiveMethodId,
        recipientEmail: recipient.trim() || undefined,
        idempotencyKey: idempotencyKey.current,
      },
    });
    if (result.error) {
      setBuyError(result.error.graphQLErrors[0]?.message ?? "Could not buy gift card");
      return;
    }
    setLastCode(result.data?.purchaseGiftCard.code ?? null);
    setRecipient("");
    idempotencyKey.current = crypto.randomUUID(); // fresh key for the next purchase
    refetch({ requestPolicy: "network-only" });
  }

  async function onRedeem(e: React.FormEvent) {
    e.preventDefault();
    setRedeemError(null);
    setRedeemMsg(null);
    const result = await redeem({ code: redeemCode.trim() });
    if (result.error) {
      setRedeemError(result.error.graphQLErrors[0]?.message ?? "Could not redeem");
      return;
    }
    setRedeemMsg(`Redeemed! Wallet balance is now ${formatRs(result.data!.redeemGiftCard.balanceMinor)}.`);
    setRedeemCode("");
    refetch({ requestPolicy: "network-only" });
  }

  return (
    <main className="mx-auto max-w-md">
      <h1 className="mb-6 text-2xl font-bold">Gift cards</h1>

      <div className="mb-6 flex items-center justify-between rounded-xl border border-kd-border bg-kd-surface p-4">
        <div className="flex items-center gap-3">
          <Wallet className="h-6 w-6 text-kd-fg-subtle" />
          <div>
            <p className="text-xs text-kd-fg-muted">Wallet balance</p>
            <p className="text-lg font-semibold">{formatRs(data?.myWallet.balanceMinor ?? 0)}</p>
          </div>
        </div>
      </div>

      <form
        onSubmit={onBuy}
        className="space-y-4 rounded-xl border border-kd-border bg-kd-surface p-4"
      >
        <p className="flex items-center gap-2 font-semibold">
          <Gift className="h-5 w-5 text-kd-primary" /> Buy a gift card
        </p>
        <div>
          <Label>Amount</Label>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {AMOUNTS_MINOR.map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => setAmount(a)}
                className={
                  "rounded-lg border px-3 py-2 text-sm font-medium transition " +
                  (amount === a
                    ? "border-kd-primary bg-kd-primary/10 text-kd-primary"
                    : "border-kd-border text-kd-fg hover:bg-kd-surface-muted")
                }
              >
                {formatRs(a)}
              </button>
            ))}
          </div>
        </div>

        <div>
          <Label htmlFor="method">Pay with</Label>
          {methods.length === 0 ? (
            <p className="mt-1 text-sm text-kd-fg-muted">
              No saved cards.{" "}
              <a href="/payment-methods" className="text-kd-primary hover:underline">
                Add one
              </a>{" "}
              to buy a gift card.
            </p>
          ) : (
            <select
              id="method"
              value={effectiveMethodId}
              onChange={(e) => setMethodId(e.target.value)}
              className="mt-1 w-full rounded-lg border border-kd-border bg-kd-surface px-3 py-2 text-sm capitalize"
            >
              {methods.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.brand} •••• {m.last4}
                </option>
              ))}
            </select>
          )}
        </div>

        <div>
          <Label htmlFor="recipient">Recipient email (optional)</Label>
          <Input
            id="recipient"
            type="email"
            placeholder="friend@example.com"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            className="mt-1"
          />
        </div>

        {buyError && <p className="text-sm text-kd-danger">{buyError}</p>}
        {lastCode && (
          <p className="rounded-lg bg-kd-surface-muted p-3 text-sm">
            Gift card created. Share this code:{" "}
            <span className="font-mono font-semibold">{lastCode}</span>
          </p>
        )}
        <Button
          type="submit"
          disabled={purchaseState.fetching || methods.length === 0}
          className="w-full"
        >
          {purchaseState.fetching ? "Processing…" : `Buy for ${formatRs(amount)}`}
        </Button>
      </form>

      <form
        onSubmit={onRedeem}
        className="mt-6 space-y-4 rounded-xl border border-kd-border bg-kd-surface p-4"
      >
        <p className="font-semibold">Redeem a code</p>
        <div>
          <Label htmlFor="code">Gift card code</Label>
          <Input
            id="code"
            placeholder="XXXX-XXXX-XXXX"
            value={redeemCode}
            onChange={(e) => setRedeemCode(e.target.value)}
            className="mt-1 font-mono uppercase"
            required
          />
        </div>
        {redeemError && <p className="text-sm text-kd-danger">{redeemError}</p>}
        {redeemMsg && <p className="text-sm text-kd-success">{redeemMsg}</p>}
        <Button type="submit" disabled={redeemState.fetching} variant="outline" className="w-full">
          {redeemState.fetching ? "Redeeming…" : "Redeem to wallet"}
        </Button>
      </form>

      {(data?.myGiftCards.length ?? 0) > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-sm font-semibold text-kd-fg-muted">Purchased gift cards</h2>
          <div className="space-y-2">
            {data!.myGiftCards.map((g) => (
              <div
                key={g.id}
                className="flex items-center justify-between rounded-xl border border-kd-border bg-kd-surface p-3 text-sm"
              >
                <div>
                  <p className="font-mono font-semibold">{g.code}</p>
                  {g.recipientEmail && (
                    <p className="text-xs text-kd-fg-muted">To {g.recipientEmail}</p>
                  )}
                </div>
                <div className="text-right">
                  <p className="font-medium">{formatRs(g.amountMinor)}</p>
                  <p className="text-xs capitalize text-kd-fg-subtle">{g.status}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
