"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "urql";
import { graphql } from "@/graphql/generated";
import {
  formatRs,
  LOYALTY_MAX_REDEEM_POINTS,
  VOUCHER_REJECTION_MESSAGE,
  type VoucherRejectionCode,
} from "@fd/shared";
import { useCart, useCartExtras } from "@/lib/cart";
import { parseGqlError, friendlyMessage, isStaleCartError } from "@/lib/graphql-error";
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
      baseDeliveryFeeMinor
      membershipDeliverySavingMinor
      membershipApplied
      taxTotalMinor
      platformFeeMinor
      discountMinor
      voucherCode
      voucherError
      grandTotalMinor
      minOrderMinor
      meetsMinimum
      inRadius
      distanceM
      loyaltyPointsBalance
      loyaltyPointsRedeemed
      loyaltyDiscountMinor
      deliveryOption
      deliveryOptions {
        key
        label
        description
        priceMinor
        etaMinutes
        etaLabel
        available
        recommended
      }
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
    myWallet {
      balanceMinor
    }
  }
`);

// Viewer's saved name drives the lazy "who should the rider ask for?" capture.
const CheckoutViewerQuery = graphql(`
  query CheckoutViewer {
    viewer {
      user {
        id
        phone
        name
      }
    }
  }
`);

const GuestRequestOtpMutation = graphql(`
  mutation GuestRequestOtp($phone: String!) {
    requestOtp(phone: $phone) {
      devCode
    }
  }
`);

const GuestVerifyOtpMutation = graphql(`
  mutation GuestVerifyOtp($phone: String!, $code: String!) {
    verifyOtp(phone: $phone, code: $code) {
      user {
        id
      }
    }
  }
`);

const UpdateProfileMutation = graphql(`
  mutation CheckoutUpdateProfile($name: String!) {
    updateProfile(name: $name) {
      id
      name
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
  const [fulfillmentMode, setFulfillmentMode] = useState<"delivery" | "pickup">("delivery");
  // Optional scheduled slot as a datetime-local value ("" = ASAP). Sent to the API as
  // an ISO string; scheduling is groundwork (see PR notes) but the picker is wired.
  const [scheduledLocal, setScheduledLocal] = useState("");
  // Selected delivery option (#98). "standard" is the default so an untouched checkout is
  // unchanged; the server prices + validates the choice and echoes it back on the quote.
  const [deliveryOption, setDeliveryOption] = useState<"standard" | "scheduled">("standard");
  const [paymentMode, setPaymentMode] = useState<"cod" | "card" | "wallet">("cod");
  const [selectedMethodId, setSelectedMethodId] = useState<string | null>(null);
  // Loyalty: when on, we ask the server to redeem the customer's full eligible balance.
  // The server clamps to balance + rules and returns what was actually applied (FP-07).
  const [useLoyalty, setUseLoyalty] = useState(false);

  // Promo code (#52). `voucherInput` is the field text; `voucherCode` is the applied
  // code sent to the server (only set on "Apply" so typing doesn't re-quote every keystroke).
  const [voucherInput, setVoucherInput] = useState("");
  const [voucherCode, setVoucherCode] = useState<string | null>(null);

  // Saved-address book state. selectedAddressId is null while entering a new
  // address; saveNewAddress persists a fresh manual entry back to the book.
  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(null);
  const [saveNewAddress, setSaveNewAddress] = useState(false);
  const [, runSaveAddress] = useMutation(SaveAddressMutation);

  // When a saved address is picked, its own coordinates must drive the quote and
  // the order snapshot — not the current browsing location, which may point at a
  // different place. Null while entering a new address (falls back to `loc`).
  const [savedCoords, setSavedCoords] = useState<{ lat: number; lng: number } | null>(null);
  const deliveryLat = savedCoords?.lat ?? loc.lat;
  const deliveryLng = savedCoords?.lng ?? loc.lng;

  function selectSavedAddress(addr: SavedAddress) {
    setSelectedAddressId(addr.id);
    setAddressText(addr.text);
    setSavedCoords({ lat: addr.lat, lng: addr.lng });
    if (addr.phone) setContactPhone(addr.phone);
    if (addr.notes) setNote(addr.notes);
    setSaveNewAddress(false);
  }

  function startNewAddress() {
    setSelectedAddressId(null);
    setAddressText("");
    setNote("");
    setSavedCoords(null);
  }

  // Guest checkout: a signed-out shopper verifies their phone inline (OTP) rather
  // than being bounced to /login and losing their place. verifyOtp find-or-creates
  // the customer account + sets the session cookie, after which placeOrder works.
  const [{ data: viewerData, fetching: viewerFetching }, refetchViewer] = useQuery({
    query: CheckoutViewerQuery,
    requestPolicy: "cache-and-network",
  });
  const loggedIn = Boolean(viewerData?.viewer?.user?.id);
  const [guestPhone, setGuestPhone] = useState("+92");
  const [guestCode, setGuestCode] = useState("");
  const [guestStep, setGuestStep] = useState<"phone" | "code">("phone");
  const [guestDevCode, setGuestDevCode] = useState<string | null>(null);
  const [guestError, setGuestError] = useState<string | null>(null);
  const [, requestGuestOtp] = useMutation(GuestRequestOtpMutation);
  const guestRequesting = useRef(false);
  const [verifyState, verifyGuestOtp] = useMutation(GuestVerifyOtpMutation);

  async function onGuestRequestOtp(e: React.FormEvent) {
    e.preventDefault();
    if (guestRequesting.current) return;
    setGuestError(null);
    guestRequesting.current = true;
    const result = await requestGuestOtp({ phone: guestPhone.trim() });
    guestRequesting.current = false;
    if (result.error) {
      setGuestError(friendlyMessage(parseGqlError(result.error, "We couldn't send the code.")));
      return;
    }
    setGuestDevCode(result.data?.requestOtp?.devCode ?? null);
    setGuestStep("code");
    // Pre-fill the delivery contact phone with the verified number.
    setContactPhone(guestPhone.trim());
  }

  async function onGuestVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setGuestError(null);
    const result = await verifyGuestOtp({ phone: guestPhone.trim(), code: guestCode });
    if (result.error || !result.data?.verifyOtp?.user?.id) {
      setGuestError(friendlyMessage(parseGqlError(result.error, "We couldn't verify that code.")));
      return;
    }
    // Session cookie is now set server-side; re-read the viewer so the order form unlocks.
    refetchViewer({ requestPolicy: "network-only" });
  }

  const [{ data: methodsData }] = useQuery({
    query: CheckoutMethodsQuery,
    pause: !loggedIn,
  });
  const methods = useMemo(() => methodsData?.myPaymentMethods ?? [], [methodsData]);
  const walletBalanceMinor = methodsData?.myWallet?.balanceMinor ?? 0;

  // Lazy name capture: prompt only when the signed-in user has no saved name.
  // Until the viewer resolves we can't know whether a name is on file, so we
  // treat the pending state as "not yet ready" and block submission (below).
  // Reuses the single viewer query above (guest-checkout + name-capture share it).
  const viewerLoaded = !viewerFetching && viewerData !== undefined;
  const savedName = viewerData?.viewer?.user?.name ?? null;
  const needsName = viewerData?.viewer != null && !savedName;
  const [customerName, setCustomerName] = useState("");
  const [, runUpdateProfile] = useMutation(UpdateProfileMutation);
  // Derived default (no effect needed): explicit selection wins, else default card.
  const paymentMethodId =
    selectedMethodId ?? methods.find((m) => m.isDefault)?.id ?? methods[0]?.id ?? null;

  // Generated when checkout renders — NOT on click — so retries are idempotent.
  const idempotencyKey = useRef<string>(crypto.randomUUID());

  const cartLines = useMemo(
    () =>
      lines.map((l) => ({
        // Combo lines (#53) carry comboId instead of menuItemId; the server prices and
        // snapshots them as one bundled line. Exactly one id is present per line.
        menuItemId: l.menuItemId ?? null,
        comboId: l.comboId ?? null,
        qty: l.qty,
        modifierOptionIds: l.modifierOptionIds,
        notes: l.notes,
        // Carry the per-line "if unavailable" preference to the server (#39).
        unavailabilityPreference: l.unavailabilityPreference,
      })),
    [lines],
  );

  const [quoteState, runQuote] = useMutation(QuoteMutation);
  const [placeState, runPlace] = useMutation(PlaceOrderMutation);

  // The fulfillment mode the last quote was requested for. Until a fresh quote for the
  // current mode returns, the displayed quote is stale (a Delivery-after-Pickup switch
  // would otherwise show a pickup total + no delivery fee while submit sends delivery).
  const [quotedMode, setQuotedMode] = useState<"delivery" | "pickup">(fulfillmentMode);
  // Requesting the max-allowed value tells the server "redeem as much as I'm allowed"; it
  // clamps to the live balance + subtotal ceiling. 0 disables redemption. The sentinel
  // must stay within the shared schema cap or the quote/place-order input fails validation.
  const redeemPoints = useLoyalty ? LOYALTY_MAX_REDEEM_POINTS : 0;

  useEffect(() => {
    if (!branchId || lines.length === 0) return;
    void runQuote({
      input: {
        branchId,
        lines: cartLines,
        deliveryLat,
        deliveryLng,
        tipAmount,
        voucherCode: voucherCode ?? undefined,
        fulfillmentMode,
        redeemPoints,
        deliveryOption,
      },
    }).then((res) => {
      // Only mark the mode as quoted once this request's result lands.
      if (res.data?.quoteCart) setQuotedMode(fulfillmentMode);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    branchId,
    cartLines,
    deliveryLat,
    deliveryLng,
    tipAmount,
    voucherCode,
    fulfillmentMode,
    redeemPoints,
    deliveryOption,
  ]);

  if (!branchId || lines.length === 0) {
    return (
      <main className="py-16 text-center">
        <h1 className="mb-2 text-2xl font-bold">Checkout</h1>
        <p className="text-kd-fg-muted">Nothing to check out.</p>
        <Link href="/" className={buttonVariants({ className: "mt-4" })}>
          Browse restaurants
        </Link>
      </main>
    );
  }

  const quote = quoteState.data?.quoteCart;
  const quoteParsed = quoteState.error ? parseGqlError(quoteState.error) : null;
  const quoteError = quoteParsed ? friendlyMessage(quoteParsed) : undefined;
  // Wallet can't cover this order → block placement and nudge to top up.
  const walletShort =
    paymentMode === "wallet" && !!quote && walletBalanceMinor < quote.grandTotalMinor;

  const isPickup = fulfillmentMode === "pickup";
  // The visible quote is stale while a mode switch is still being re-priced.
  const quoteStale = !quote || quotedMode !== fulfillmentMode || quoteState.fetching;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    // Guard against placing an order against a stale quote (e.g. a fast mode switch).
    if (quoteStale) return;

    // Pickup has no delivery address; the API still requires addressText (min 5), so we
    // send a clear pickup marker naming the branch instead of a customer address.
    const submitAddressText = isPickup ? `Pickup at ${branchName ?? "restaurant"}` : addressText;

    // Lazily persist the customer's name (kills the "Unnamed" problem on the
    // vendor board + rider card). Best-effort: don't block checkout on failure.
    if (needsName && customerName.trim()) {
      await runUpdateProfile({ name: customerName.trim() });
    }

    // Persist a fresh manual entry to the address book before placing the order,
    // if the customer opted in. Best-effort: a save failure shouldn't block checkout.
    if (!isPickup && !selectedAddressId && saveNewAddress) {
      await runSaveAddress({
        input: {
          label: addressText.slice(0, 40) || "Address",
          text: addressText,
          lat: deliveryLat,
          lng: deliveryLng,
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
        deliveryLat,
        deliveryLng,
        addressText: submitAddressText,
        contactPhone,
        customerNote: note.trim() || undefined,
        paymentMode,
        paymentMethodId: paymentMode === "card" ? paymentMethodId : undefined,
        tipAmount,
        redeemPoints,
        cutleryRequested,
        voucherCode: voucherCode ?? undefined,
        fulfillmentMode,
        // Send a scheduled slot when a time is set AND the customer is in a scheduling
        // context: pickup (its own picker above) or the delivery "scheduled" option. This
        // stops a stale slot leaking into a standard *delivery* order while still honouring
        // scheduled pickups, which the order model + order views support.
        scheduledFor:
          scheduledLocal && (isPickup || deliveryOption === "scheduled")
            ? new Date(scheduledLocal).toISOString()
            : undefined,
        deliveryOption,
      },
    });
    const order = result.data?.placeOrder;
    if (result.error || !order) {
      const parsed = parseGqlError(result.error, "Could not place the order");
      if (
        parsed.code === "UNAUTHENTICATED" ||
        /not authenticated|not authorized/i.test(parsed.message)
      ) {
        router.push("/login?next=/checkout");
        return;
      }
      // The cart points at a restaurant that's gone/unorderable — reset it and send the
      // customer back to browse rather than leaving them stuck on a dead checkout (#145).
      if (isStaleCartError(parsed)) {
        clear();
        resetExtras();
        router.push("/");
        return;
      }
      setError(friendlyMessage(parsed));
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

      {/* Guest checkout — verify phone inline instead of bouncing to /login. */}
      {!loggedIn && (
        <div className="mb-4 rounded-xl border border-kd-border bg-kd-surface p-4">
          <p className="text-sm font-semibold text-kd-fg">Verify your phone to order</p>
          <p className="mt-0.5 text-xs text-kd-fg-muted">
            No account needed — we&apos;ll text you a one-time code and keep your cart.
          </p>
          {guestStep === "phone" ? (
            <form onSubmit={onGuestRequestOtp} className="mt-3 flex gap-2">
              <Input
                type="tel"
                required
                placeholder="+923001234567"
                value={guestPhone}
                onChange={(e) => setGuestPhone(e.target.value)}
                aria-label="Phone number"
              />
              <Button type="submit">Send code</Button>
            </form>
          ) : (
            <form onSubmit={onGuestVerifyOtp} className="mt-3 space-y-2">
              {guestDevCode && (
                <div className="rounded-lg bg-kd-warning-soft px-3 py-2 text-xs text-kd-warning">
                  Dev mode — your code is{" "}
                  <span className="font-mono font-bold">{guestDevCode}</span>
                </div>
              )}
              <div className="flex gap-2">
                <Input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  required
                  placeholder="6-digit code"
                  value={guestCode}
                  onChange={(e) => setGuestCode(e.target.value.replace(/\D/g, ""))}
                  aria-label="Verification code"
                  className="font-mono tracking-widest"
                />
                <Button type="submit" disabled={verifyState.fetching || guestCode.length !== 6}>
                  {verifyState.fetching ? "Verifying…" : "Verify"}
                </Button>
              </div>
              <button
                type="button"
                onClick={() => {
                  setGuestStep("phone");
                  setGuestCode("");
                  setGuestDevCode(null);
                }}
                className="text-xs text-kd-fg-muted hover:text-kd-fg"
              >
                Use a different number
              </button>
            </form>
          )}
          {guestError && <p className="mt-2 text-sm text-kd-danger">{guestError}</p>}
        </div>
      )}

      <form onSubmit={submit} className="space-y-4">
        {needsName && (
          <div>
            <Label htmlFor="customer-name">Who should the rider ask for?</Label>
            <Input
              id="customer-name"
              required
              placeholder="Your name"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              className="mt-1"
            />
            <p className="mt-1 text-xs text-kd-fg-subtle">
              We&apos;ll show this to the restaurant and your rider.
            </p>
          </div>
        )}

        {/* Delivery | Pickup toggle (#54). Pickup waives the delivery fee and skips the
            delivery-address form; the customer collects at the branch with a pickup code. */}
        <div className="grid grid-cols-2 gap-2 rounded-xl border border-kd-border bg-kd-surface p-1">
          {(["delivery", "pickup"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setFulfillmentMode(mode)}
              aria-pressed={fulfillmentMode === mode}
              className={`rounded-lg px-3 py-2 text-sm font-medium capitalize transition ${
                fulfillmentMode === mode
                  ? "bg-kd-primary text-kd-primary-fg"
                  : "text-kd-fg-muted hover:text-kd-fg"
              }`}
            >
              {mode}
            </button>
          ))}
        </div>

        {!isPickup ? (
          <>
            <AddressSelector
              selectedId={selectedAddressId}
              onSelect={selectSavedAddress}
              onNew={startNewAddress}
              loggedIn={loggedIn}
              // Don't let the one-shot auto-pick overwrite an address the guest already
              // typed before verifying via OTP (#125 review): only auto-select when the
              // manual field is still empty.
              autoSelect={addressText.trim().length === 0}
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
          </>
        ) : (
          <div className="rounded-xl border border-kd-border bg-kd-surface p-4 text-sm">
            <p className="font-medium text-kd-fg">Pickup at {branchName}</p>
            <p className="mt-1 text-xs text-kd-fg-muted">
              No delivery fee. Collect at the counter and quote the pickup code you&apos;ll get
              after ordering.
              {quote && quote.distanceM > 0
                ? ` About ${(quote.distanceM / 1000).toFixed(1)} km away.`
                : ""}
            </p>
          </div>
        )}

        {/* Delivery-option selector (#98). Server-authoritative list — each option's price
            + ETA come from the quote, so the UI never invents either. Only shown for
            delivery (pickup has no rider leg to configure). Default = standard, so an
            untouched checkout is unchanged. */}
        {!isPickup && quote && quote.deliveryOptions.length > 0 && (
          <div className="rounded-xl border border-kd-border bg-kd-surface p-4">
            <p className="mb-3 text-sm font-semibold">Delivery option</p>
            <div className="space-y-2">
              {quote.deliveryOptions.map((opt) => {
                const selected = deliveryOption === opt.key;
                return (
                  <button
                    key={opt.key}
                    type="button"
                    disabled={!opt.available}
                    aria-pressed={selected}
                    onClick={() => setDeliveryOption(opt.key as "standard" | "scheduled")}
                    className={`flex w-full items-start justify-between gap-3 rounded-lg border p-3 text-left transition ${
                      selected
                        ? "border-kd-primary bg-kd-primary-soft"
                        : "border-kd-border hover:border-kd-fg-subtle"
                    } ${opt.available ? "" : "cursor-not-allowed opacity-50"}`}
                  >
                    <span className="min-w-0">
                      <span className="flex items-center gap-2 text-sm font-medium text-kd-fg">
                        {opt.label}
                        {opt.recommended && (
                          <span className="rounded bg-kd-surface-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase text-kd-fg-muted">
                            recommended
                          </span>
                        )}
                      </span>
                      <span className="mt-0.5 block text-xs text-kd-fg-muted">
                        {opt.description}
                      </span>
                      <span className="mt-0.5 block text-xs text-kd-fg-subtle">{opt.etaLabel}</span>
                    </span>
                    <span className="shrink-0 text-sm font-medium text-kd-fg">
                      {opt.priceMinor === 0 ? "Free" : formatRs(opt.priceMinor)}
                    </span>
                  </button>
                );
              })}
            </div>
            {/* When "Schedule for later" is picked, surface the slot picker inline. Empty
                slot still means ASAP — scheduling itself is groundwork (#54). */}
            {deliveryOption === "scheduled" && (
              <div className="mt-3 border-t border-kd-border pt-3">
                <Label htmlFor="schedule-slot">Preferred time</Label>
                <Input
                  id="schedule-slot"
                  type="datetime-local"
                  value={scheduledLocal}
                  onChange={(e) => setScheduledLocal(e.target.value)}
                  className="mt-1"
                />
                <p className="mt-1 text-xs text-kd-fg-subtle">
                  Leave blank to order as soon as possible.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Pickup scheduling (#54). The delivery-option selector above is delivery-only, so
            pickup keeps its own optional slot picker — a scheduled pickup is still supported
            by the order model and shown on the customer/restaurant order views. Empty = ASAP. */}
        {isPickup && (
          <div>
            <Label htmlFor="pickup-schedule">Schedule pickup for later (optional)</Label>
            <Input
              id="pickup-schedule"
              type="datetime-local"
              value={scheduledLocal}
              onChange={(e) => setScheduledLocal(e.target.value)}
              className="mt-1"
            />
            <p className="mt-1 text-xs text-kd-fg-subtle">Leave blank to order now.</p>
          </div>
        )}

        {/* Contact phone is needed for both modes. */}
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

        {quote && quote.loyaltyPointsBalance > 0 && (
          <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-kd-border bg-kd-surface p-4">
            <span className="text-sm">
              <span className="font-semibold text-kd-fg">Use loyalty points</span>
              <span className="mt-0.5 block text-xs text-kd-fg-muted">
                You have {quote.loyaltyPointsBalance.toLocaleString("en-PK")} points
                {useLoyalty && quote.loyaltyDiscountMinor > 0
                  ? ` · redeeming ${quote.loyaltyPointsRedeemed.toLocaleString("en-PK")} for ${formatRs(
                      quote.loyaltyDiscountMinor,
                    )} off`
                  : ""}
              </span>
            </span>
            <input
              type="checkbox"
              checked={useLoyalty}
              onChange={(e) => setUseLoyalty(e.target.checked)}
              className="size-4"
            />
          </label>
        )}

        <div className="rounded-xl border border-kd-border bg-kd-surface p-4">
          <p className="mb-3 text-sm font-semibold">Payment</p>
          <RadioGroup
            value={paymentMode}
            onValueChange={(v) => setPaymentMode(v as "cod" | "card" | "wallet")}
          >
            <Label
              htmlFor="pay-cod"
              className="flex cursor-pointer items-center gap-3 rounded-lg border border-kd-border p-3 has-data-[checked]:border-kd-primary has-data-[checked]:bg-kd-primary-soft"
            >
              <RadioGroupItem id="pay-cod" value="cod" />
              <span className="text-sm font-medium text-kd-fg">Cash on delivery</span>
            </Label>
            <Label
              htmlFor="pay-wallet"
              className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-kd-border p-3 has-data-[checked]:border-kd-primary has-data-[checked]:bg-kd-primary-soft"
            >
              <span className="flex items-center gap-3">
                <RadioGroupItem id="pay-wallet" value="wallet" />
                <span className="text-sm font-medium text-kd-fg">Wallet</span>
              </span>
              <span className="text-xs text-kd-fg-muted">{formatRs(walletBalanceMinor)}</span>
            </Label>
            <Label
              htmlFor="pay-card"
              className="flex cursor-pointer items-center gap-3 rounded-lg border border-kd-border p-3 has-data-[checked]:border-kd-primary has-data-[checked]:bg-kd-primary-soft"
            >
              <RadioGroupItem id="pay-card" value="card" />
              <span className="text-sm font-medium text-kd-fg">Pay now by card</span>
            </Label>
          </RadioGroup>
          {paymentMode === "wallet" && walletShort && (
            <p className="mt-3 border-t border-kd-border pt-3 text-xs text-kd-danger">
              Not enough balance.{" "}
              <Link href="/wallet" className="underline">
                Top up your wallet
              </Link>{" "}
              or pick another method.
            </p>
          )}
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

        <div className="rounded-xl border border-kd-border bg-kd-surface p-4">
          <p className="mb-2 text-sm font-semibold">Promo code</p>
          {voucherCode && !quote?.voucherError ? (
            <div className="flex items-center justify-between rounded-lg border border-kd-primary bg-kd-primary-soft px-3 py-2 text-sm">
              <span className="font-medium text-kd-fg">
                {quote?.voucherCode ?? voucherCode} applied
                {quote && quote.discountMinor > 0 ? ` · −${formatRs(quote.discountMinor)}` : ""}
              </span>
              <button
                type="button"
                className="text-xs font-semibold text-kd-primary underline"
                onClick={() => {
                  setVoucherCode(null);
                  setVoucherInput("");
                }}
              >
                Remove
              </button>
            </div>
          ) : (
            <div className="flex gap-2">
              <Input
                placeholder="e.g. WELCOME50"
                value={voucherInput}
                onChange={(e) => setVoucherInput(e.target.value.toUpperCase())}
                className="uppercase"
              />
              <Button
                type="button"
                variant="outline"
                disabled={!voucherInput.trim() || quoteState.fetching}
                onClick={() => setVoucherCode(voucherInput.trim())}
              >
                Apply
              </Button>
            </div>
          )}
          {quote?.voucherError && (
            <p className="mt-2 text-xs font-medium text-kd-danger">
              {VOUCHER_REJECTION_MESSAGE[quote.voucherError as VoucherRejectionCode] ??
                "That code isn't valid."}
            </p>
          )}
        </div>

        <div className="rounded-xl border border-kd-border bg-kd-surface p-4 text-sm">
          {quoteState.fetching && <p className="text-kd-fg-subtle">Calculating…</p>}
          {quoteError && (
            <div className="space-y-2">
              <p className="text-kd-danger">{quoteError}</p>
              {isStaleCartError(quoteParsed) && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    clear();
                    resetExtras();
                    router.push("/");
                  }}
                >
                  Choose a restaurant
                </Button>
              )}
            </div>
          )}
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
                {isPickup ? (
                  <span>Free (pickup)</span>
                ) : quote.membershipApplied && quote.membershipDeliverySavingMinor > 0 ? (
                  <span className="flex items-center gap-2">
                    <span className="text-kd-fg-subtle line-through">
                      {formatRs(quote.baseDeliveryFeeMinor)}
                    </span>
                    <span className="font-medium text-kd-success">
                      {quote.deliveryFeeMinor === 0 ? "Free" : formatRs(quote.deliveryFeeMinor)}
                    </span>
                  </span>
                ) : (
                  <span>{formatRs(quote.deliveryFeeMinor)}</span>
                )}
              </div>
              {quote.membershipApplied && quote.membershipDeliverySavingMinor > 0 && (
                <p className="text-xs font-medium text-kd-success">
                  KhaanaDo Pro saved you {formatRs(quote.membershipDeliverySavingMinor)} on delivery
                </p>
              )}
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
              {quote.discountMinor > 0 && (
                <div className="flex justify-between font-medium text-kd-primary">
                  <span>Discount{quote.voucherCode ? ` (${quote.voucherCode})` : ""}</span>
                  <span>−{formatRs(quote.discountMinor)}</span>
                </div>
              )}
              {quote.loyaltyDiscountMinor > 0 && (
                <div className="flex justify-between text-kd-success">
                  <span>Loyalty discount</span>
                  <span>-{formatRs(quote.loyaltyDiscountMinor)}</span>
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
          disabled={
            placeState.fetching ||
            !viewerLoaded ||
            quoteStale ||
            !quote ||
            !quote.meetsMinimum ||
            !quote.inRadius ||
            !loggedIn ||
            walletShort
          }
        >
          {placeState.fetching
            ? "Placing order…"
            : !loggedIn
              ? "Verify your phone to continue"
              : `Place order${quote ? ` · ${formatRs(quote.grandTotalMinor)}` : ""}`}
        </Button>
      </form>
    </main>
  );
}
