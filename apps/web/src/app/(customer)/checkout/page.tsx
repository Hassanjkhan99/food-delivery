"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "urql";
import { graphql } from "@/graphql/generated";
import { formatRs } from "@fd/shared";
import { useCart } from "@/lib/cart";
import { useDeliveryLocation } from "@/lib/location";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";

const QuoteMutation = graphql(`
  mutation CheckoutQuote($input: QuoteCartInput!) {
    quoteCart(input: $input) {
      subtotalMinor
      deliveryFeeMinor
      taxTotalMinor
      platformFeeMinor
      grandTotalMinor
      minOrderMinor
      meetsMinimum
      inRadius
    }
  }
`);

const PlaceOrderMutation = graphql(`
  mutation PlaceOrder($input: PlaceOrderInput!, $key: String!) {
    placeOrder(input: $input, idempotencyKey: $key) {
      id
      code
      status
    }
  }
`);

const CheckoutMethodsQuery = graphql(`
  query CheckoutPaymentMethods {
    myPaymentMethods {
      id
      brand
      last4
      isDefault
    }
  }
`);

export default function CheckoutPage() {
  const router = useRouter();
  const { branchId, branchName, lines, clear } = useCart();
  const loc = useDeliveryLocation();

  const [addressText, setAddressText] = useState("");
  const [contactPhone, setContactPhone] = useState("+92");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [paymentMode, setPaymentMode] = useState<"cod" | "card">("cod");
  const [paymentMethodId, setPaymentMethodId] = useState<string | null>(null);

  const [{ data: methodsData }] = useQuery({ query: CheckoutMethodsQuery });
  const methods = methodsData?.myPaymentMethods ?? [];

  useEffect(() => {
    if (paymentMode === "card" && !paymentMethodId && methods.length > 0) {
      setPaymentMethodId(methods.find((m) => m.isDefault)?.id ?? methods[0]!.id);
    }
  }, [paymentMode, paymentMethodId, methods]);

  // Generated when checkout renders — NOT on click — so retries are idempotent.
  const idempotencyKey = useRef<string>(crypto.randomUUID());

  const cartLines = useMemo(
    () =>
      lines.map((l) => ({
        menuItemId: l.menuItemId,
        qty: l.qty,
        modifierOptionIds: l.modifierOptionIds,
        notes: l.notes,
      })),
    [lines],
  );

  const [quoteState, runQuote] = useMutation(QuoteMutation);
  const [placeState, runPlace] = useMutation(PlaceOrderMutation);

  useEffect(() => {
    if (!branchId || lines.length === 0) return;
    void runQuote({
      input: { branchId, lines: cartLines, deliveryLat: loc.lat, deliveryLng: loc.lng },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId, cartLines, loc.lat, loc.lng]);

  if (!branchId || lines.length === 0) {
    return (
      <main className="py-16 text-center">
        <p className="text-neutral-500">Nothing to check out.</p>
        <Link href="/" className={buttonVariants({ className: "mt-4" })}>
          Browse restaurants
        </Link>
      </main>
    );
  }

  const quote = quoteState.data?.quoteCart;
  const quoteError = quoteState.error?.graphQLErrors[0]?.message;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const result = await runPlace({
      key: idempotencyKey.current,
      input: {
        branchId: branchId!,
        lines: cartLines,
        deliveryLat: loc.lat,
        deliveryLng: loc.lng,
        addressText,
        contactPhone,
        customerNote: note.trim() || undefined,
        paymentMode,
        paymentMethodId: paymentMode === "card" ? paymentMethodId : undefined,
      },
    });
    const order = result.data?.placeOrder;
    if (result.error || !order) {
      const msg = result.error?.graphQLErrors[0]?.message ?? "Could not place the order";
      if (msg.toLowerCase().includes("not authenticated") || msg.includes("Not authorized")) {
        router.push("/login?next=/checkout");
        return;
      }
      setError(msg);
      return;
    }
    clear();
    router.push(`/orders/${order.id}`);
  }

  return (
    <main className="mx-auto max-w-lg">
      <h1 className="mb-1 text-2xl font-bold">Checkout</h1>
      <p className="mb-6 text-sm text-neutral-500">Ordering from {branchName}</p>

      <form onSubmit={submit} className="space-y-4">
        <div>
          <Label htmlFor="address">Delivery address</Label>
          <Textarea
            id="address"
            required
            minLength={5}
            placeholder="House, street, sector, landmark…"
            value={addressText}
            onChange={(e) => setAddressText(e.target.value)}
            rows={2}
            className="mt-1"
          />
          <p className="mt-1 text-xs text-neutral-400">Delivering near {loc.label}</p>
        </div>

        <div>
          <Label htmlFor="phone">Contact phone</Label>
          <Input
            id="phone"
            type="tel"
            required
            placeholder="+923001234567"
            value={contactPhone}
            onChange={(e) => setContactPhone(e.target.value)}
            className="mt-1"
          />
        </div>

        <div>
          <Label htmlFor="note">Note for the restaurant (optional)</Label>
          <Textarea
            id="note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            className="mt-1"
          />
        </div>

        <div className="rounded-xl border border-neutral-200 bg-white p-4">
          <p className="mb-2 text-sm font-semibold">Payment</p>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="paymode"
              checked={paymentMode === "cod"}
              onChange={() => setPaymentMode("cod")}
            />
            Cash on delivery
          </label>
          <label className="mt-1 flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="paymode"
              checked={paymentMode === "card"}
              onChange={() => setPaymentMode("card")}
            />
            Pay now by card
          </label>
          {paymentMode === "card" && (
            <div className="mt-3 space-y-2 border-t border-neutral-100 pt-3">
              {methods.length === 0 && (
                <p className="text-xs text-neutral-500">
                  No saved cards.{" "}
                  <Link href="/payment-methods" className="underline">
                    Add one
                  </Link>{" "}
                  first.
                </p>
              )}
              {methods.map((m) => (
                <label key={m.id} className="flex items-center gap-2 text-sm capitalize">
                  <input
                    type="radio"
                    name="paymethod"
                    checked={paymentMethodId === m.id}
                    onChange={() => setPaymentMethodId(m.id)}
                  />
                  {m.brand} •••• {m.last4}
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-neutral-200 bg-white p-4 text-sm">
          {quoteState.fetching && <p className="text-neutral-400">Calculating…</p>}
          {quoteError && <p className="text-red-600">{quoteError}</p>}
          {quote && (
            <>
              <div className="flex justify-between"><span className="text-neutral-500">Subtotal</span><span>{formatRs(quote.subtotalMinor)}</span></div>
              <div className="flex justify-between"><span className="text-neutral-500">Tax</span><span>{formatRs(quote.taxTotalMinor)}</span></div>
              <div className="flex justify-between"><span className="text-neutral-500">Delivery fee</span><span>{formatRs(quote.deliveryFeeMinor)}</span></div>
              <div className="flex justify-between"><span className="text-neutral-500">Platform fee</span><span>{formatRs(quote.platformFeeMinor)}</span></div>
              <Separator className="my-2" />
              <div className="flex justify-between text-base font-semibold">
                <span>Total</span><span>{formatRs(quote.grandTotalMinor)}</span>
              </div>
              <p className="mt-2 text-xs text-neutral-400">Billed by the restaurant. Receipt issued by the restaurant.</p>
              {!quote.meetsMinimum && (
                <p className="mt-2 text-xs font-medium text-amber-600">
                  Below the minimum order of {formatRs(quote.minOrderMinor)}.
                </p>
              )}
              {!quote.inRadius && (
                <p className="mt-2 text-xs font-medium text-red-600">
                  This address is outside the delivery radius.
                </p>
              )}
            </>
          )}
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <Button
          type="submit"
          size="lg"
          className="w-full"
          disabled={placeState.fetching || !quote || !quote.meetsMinimum || !quote.inRadius}
        >
          {placeState.fetching ? "Placing order…" : `Place order${quote ? ` · ${formatRs(quote.grandTotalMinor)}` : ""}`}
        </Button>
      </form>
    </main>
  );
}
