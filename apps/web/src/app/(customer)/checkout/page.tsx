"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "urql";
import { graphql } from "@/graphql/generated";
import { formatRs } from "@fd/shared";
import { useCart } from "@/lib/cart";
import { useCartExtras } from "../cart/page";
import { useDeliveryLocation } from "@/lib/location";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { AddressSelector, type SavedAddress } from "../addresses/address-selector";
import { SaveAddressMutation } from "../addresses/address-graphql";

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
  // Tip + cutlery collected on the cart page (persisted in `fd-cart-extras`).
  // The API already accepts both: tipAmount folds into the quote's grandTotal
  // (untaxed, uncommissioned) and cutleryRequested rides along on placeOrder.
  const { tipAmount, cutleryRequested, reset: resetExtras } = useCartExtras();
  const loc = useDeliveryLocation();

  const [addressText, setAddressText] = useState("");
  const [contactPhone, setContactPhone] = useState("+92");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [paymentMode, setPaymentMode] = useState<"cod" | "card">("cod");
  const [selectedMethodId, setSelectedMethodId] = useState<string | null>(null);

  // Saved-address book state. selectedAddressId is null while entering a new
  // address; saveNewAddress persists a fresh manual entry back to the book.
  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(null);
  const [saveNewAddress, setSaveNewAddress] = useState(false);
  const [, runSaveAddress] = useMutation(SaveAddressMutation);

  function selectSavedAddress(addr: SavedAddress) {
    setSelectedAddressId(addr.id);
    setAddressText(addr.text);
    if (addr.phone) setContactPhone(addr.phone);
    if (addr.notes) setNote(addr.notes);
    setSaveNewAddress(false);
  }

  function startNewAddress() {
    setSelectedAddressId(null);
    setAddressText("");
    setNote("");
  }

  const [{ data: methodsData }] = useQuery({ query: CheckoutMethodsQuery });
  const methods = useMemo(() => methodsData?.myPaymentMethods ?? [], [methodsData]);
  // Derived default (no effect needed): explicit selection wins, else default card.
  const paymentMethodId =
    selectedMethodId ?? methods.find((m) => m.isDefault)?.id ?? methods[0]?.id ?? null;

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
      input: { branchId, lines: cartLines, deliveryLat: loc.lat, deliveryLng: loc.lng, tipAmount },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId, cartLines, loc.lat, loc.lng, tipAmount]);

  if (!branchId || lines.length === 0) {
    return (
      <main className="py-16 text-center">
        <p className="text-kd-fg-muted">Nothing to check out.</p>
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

    // Persist a fresh manual entry to the address book before placing the order,
    // if the customer opted in. Best-effort: a save failure shouldn't block checkout.
    if (!selectedAddressId && saveNewAddress) {
      await runSaveAddress({
        input: {
          label: addressText.slice(0, 40) || "Address",
          text: addressText,
          lat: loc.lat,
          lng: loc.lng,
          phone: contactPhone.trim() || undefined,
          notes: note.trim() || undefined,
        },
      });
    }

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
        tipAmount,
        cutleryRequested,
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
    resetExtras();
    router.push(`/orders/${order.id}`);
  }

  return (
    <main className="mx-auto max-w-lg">
      <h1 className="mb-1 text-2xl font-bold">Checkout</h1>
      <p className="mb-6 text-sm text-kd-fg-muted">Ordering from {branchName}</p>

      <form onSubmit={submit} className="space-y-4">
        <AddressSelector
          selectedId={selectedAddressId}
          onSelect={selectSavedAddress}
          onNew={startNewAddress}
        />

        {selectedAddressId === null && (
          <>
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
              <p className="mt-1 text-xs text-kd-fg-subtle">Delivering near {loc.label}</p>
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

            <label className="flex items-center gap-2 text-sm text-kd-fg">
              <input
                type="checkbox"
                checked={saveNewAddress}
                onChange={(e) => setSaveNewAddress(e.target.checked)}
              />
              Save this address for next time
            </label>
          </>
        )}

        <div>
          <Label htmlFor="note">Delivery instructions (optional)</Label>
          <Textarea
            id="note"
            placeholder="Ring the bell, leave at the gate, call on arrival…"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            className="mt-1"
          />
        </div>

        <div className="rounded-xl border border-kd-border bg-kd-surface p-4">
          <p className="mb-3 text-sm font-semibold">Payment</p>
          <RadioGroup
            value={paymentMode}
            onValueChange={(v) => setPaymentMode(v as "cod" | "card")}
          >
            <Label
              htmlFor="pay-cod"
              className="flex cursor-pointer items-center gap-3 rounded-lg border border-kd-border p-3 has-data-[checked]:border-kd-primary has-data-[checked]:bg-kd-primary-soft"
            >
              <RadioGroupItem id="pay-cod" value="cod" />
              <span className="text-sm font-medium text-kd-fg">Cash on delivery</span>
            </Label>
            <Label
              htmlFor="pay-card"
              className="flex cursor-pointer items-center gap-3 rounded-lg border border-kd-border p-3 has-data-[checked]:border-kd-primary has-data-[checked]:bg-kd-primary-soft"
            >
              <RadioGroupItem id="pay-card" value="card" />
              <span className="text-sm font-medium text-kd-fg">Pay now by card</span>
            </Label>
          </RadioGroup>
          {paymentMode === "card" && (
            <div className="mt-3 space-y-2 border-t border-kd-border pt-3">
              {methods.length === 0 ? (
                <p className="text-xs text-kd-fg-muted">
                  No saved cards.{" "}
                  <Link href="/payment-methods" className="underline">
                    Add one
                  </Link>{" "}
                  first.
                </p>
              ) : (
                <RadioGroup
                  value={paymentMethodId ?? ""}
                  onValueChange={(v) => setSelectedMethodId(v)}
                >
                  {methods.map((m) => (
                    <Label
                      key={m.id}
                      htmlFor={`pm-${m.id}`}
                      className="flex cursor-pointer items-center gap-3 text-sm capitalize"
                    >
                      <RadioGroupItem id={`pm-${m.id}`} value={m.id} />
                      {m.brand} •••• {m.last4}
                      {m.isDefault && (
                        <span className="rounded bg-kd-surface-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase text-kd-fg-muted">
                          default
                        </span>
                      )}
                    </Label>
                  ))}
                </RadioGroup>
              )}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-kd-border bg-kd-surface p-4 text-sm">
          {quoteState.fetching && <p className="text-kd-fg-subtle">Calculating…</p>}
          {quoteError && <p className="text-kd-danger">{quoteError}</p>}
          {quote && (
            <>
              <div className="flex justify-between">
                <span className="text-kd-fg-muted">Subtotal</span>
                <span>{formatRs(quote.subtotalMinor)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-kd-fg-muted">Tax</span>
                <span>{formatRs(quote.taxTotalMinor)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-kd-fg-muted">Delivery fee</span>
                <span>{formatRs(quote.deliveryFeeMinor)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-kd-fg-muted">Platform fee</span>
                <span>{formatRs(quote.platformFeeMinor)}</span>
              </div>
              {tipAmount > 0 && (
                <div className="flex justify-between">
                  <span className="text-kd-fg-muted">Rider tip</span>
                  <span>{formatRs(tipAmount)}</span>
                </div>
              )}
              <Separator className="my-2" />
              <div className="flex justify-between text-base font-semibold">
                <span>Total</span>
                <span>{formatRs(quote.grandTotalMinor)}</span>
              </div>
              <p className="mt-2 text-xs text-kd-fg-subtle">
                Billed by the restaurant. Receipt issued by the restaurant.
              </p>
              {!quote.meetsMinimum && (
                <p className="mt-2 text-xs font-medium text-kd-warning">
                  Below the minimum order of {formatRs(quote.minOrderMinor)}.
                </p>
              )}
              {!quote.inRadius && (
                <p className="mt-2 text-xs font-medium text-kd-danger">
                  This address is outside the delivery radius.
                </p>
              )}
            </>
          )}
        </div>

        {error && <p className="text-sm text-kd-danger">{error}</p>}

        <Button
          type="submit"
          size="lg"
          className="w-full"
          disabled={placeState.fetching || !quote || !quote.meetsMinimum || !quote.inRadius}
        >
          {placeState.fetching
            ? "Placing order…"
            : `Place order${quote ? ` · ${formatRs(quote.grandTotalMinor)}` : ""}`}
        </Button>
      </form>
    </main>
  );
}
