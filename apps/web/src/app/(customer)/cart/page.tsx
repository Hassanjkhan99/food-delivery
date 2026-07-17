"use client";

import { useState } from "react";
import Link from "next/link";
import { Pencil, Tag, Trash2, UtensilsCrossed, X } from "lucide-react";
import {
  DEFAULT_UNAVAILABILITY_PREFERENCE,
  formatRs,
  unavailabilityPreferenceLabel,
} from "@fd/shared";
import { cartSubtotal, useCart, useCartExtras } from "@/lib/cart";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

// Preset tip chips in minor units (Rs 0 / 50 / 100).
const TIP_PRESETS = [0, 5000, 10000] as const;

export default function CartPage() {
  const { branchId, branchName, branchSlug, lines, removeLine, setQty } = useCart();
  const { tipAmount, cutleryRequested, voucherCode, setTip, setCutlery, setVoucherCode } =
    useCartExtras();
  // Local promo field text. The applied code lives in the cart-extras store and is
  // carried to checkout, where the server validates eligibility and re-prices (#52).
  const [promoInput, setPromoInput] = useState(voucherCode ?? "");

  // Whether the current tip matches a preset (else it's a custom amount).
  const isPreset = (TIP_PRESETS as readonly number[]).includes(tipAmount);

  if (lines.length === 0 || !branchId) {
    return (
      <main className="py-16 text-center">
        <h1 className="mb-2 text-2xl font-bold">Your cart</h1>
        <p className="text-lg text-kd-fg-muted">Your cart is empty.</p>
        <Link href="/" className={buttonVariants({ className: "mt-4" })}>
          Browse restaurants
        </Link>
      </main>
    );
  }

  const subtotal = cartSubtotal(lines);

  return (
    <main className="mx-auto max-w-lg">
      <h1 className="mb-1 text-2xl font-bold">Your cart</h1>
      <p className="mb-6 text-sm text-kd-fg-muted">
        From{" "}
        <Link href={`/r/${branchSlug}`} className="font-medium text-kd-fg underline">
          {branchName}
        </Link>
      </p>

      <div className="space-y-3">
        {lines.map((l) => (
          <div
            key={l.lineId}
            className="flex items-start justify-between gap-3 rounded-xl border border-kd-border bg-kd-surface p-4"
          >
            <div className="min-w-0">
              <p className="font-medium text-kd-fg">{l.name}</p>
              {l.modifierNames.length > 0 && (
                <p className="text-xs text-kd-fg-muted">{l.modifierNames.join(", ")}</p>
              )}
              {l.notes && <p className="text-xs italic text-kd-fg-subtle">“{l.notes}”</p>}
              <p className="text-xs text-kd-fg-subtle">
                If unavailable:{" "}
                {unavailabilityPreferenceLabel(
                  l.unavailabilityPreference ?? DEFAULT_UNAVAILABILITY_PREFERENCE,
                )}
              </p>
              <div className="mt-2 flex items-center gap-2">
                <div className="flex items-center rounded-lg border border-kd-border">
                  <Button variant="ghost" size="sm" onClick={() => setQty(l.lineId, l.qty - 1)}>
                    −
                  </Button>
                  <span className="w-6 text-center text-sm">{l.qty}</span>
                  <Button variant="ghost" size="sm" onClick={() => setQty(l.lineId, l.qty + 1)}>
                    +
                  </Button>
                </div>
                {/* Edit round-trips through the restaurant page, which holds the
                    item's modifier groups needed to pre-fill the sheet (#39). */}
                <Link
                  href={`/r/${branchSlug}?edit=${l.lineId}`}
                  aria-label={`Edit ${l.name}`}
                  className={buttonVariants({ variant: "ghost", size: "sm" })}
                >
                  <Pencil className="h-4 w-4 text-kd-fg-subtle" />
                </Link>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Remove ${l.name}`}
                  onClick={() => removeLine(l.lineId)}
                >
                  <Trash2 className="h-4 w-4 text-kd-fg-subtle" />
                </Button>
              </div>
            </div>
            <span className="shrink-0 font-semibold">{formatRs(l.unitPriceMinor * l.qty)}</span>
          </div>
        ))}
      </div>

      {/* Tip the rider */}
      <div className="mt-6 rounded-xl border border-kd-border bg-kd-surface p-4">
        <p className="text-sm font-semibold text-kd-fg">Tip your rider</p>
        <p className="mt-0.5 text-xs text-kd-fg-muted">
          100% goes to the rider. Collected in cash for COD orders.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {TIP_PRESETS.map((preset) => (
            <Button
              key={preset}
              type="button"
              variant={isPreset && tipAmount === preset ? "default" : "outline"}
              size="sm"
              onClick={() => setTip(preset)}
            >
              {preset === 0 ? "No tip" : formatRs(preset)}
            </Button>
          ))}
        </div>
        <div className="mt-3">
          <Label htmlFor="custom-tip" className="text-xs text-kd-fg-muted">
            Custom amount (Rs)
          </Label>
          <Input
            id="custom-tip"
            type="number"
            min={0}
            inputMode="numeric"
            placeholder="e.g. 150"
            // Show rupees; store minor units. Blank when a preset is active.
            value={isPreset ? "" : String(Math.round(tipAmount / 100))}
            onChange={(e) => {
              const rupees = Number(e.target.value);
              setTip(Number.isFinite(rupees) && rupees > 0 ? rupees * 100 : 0);
            }}
            className="mt-1"
          />
        </div>
      </div>

      {/* Cutlery toggle (default on) */}
      <label
        htmlFor="cutlery"
        className="mt-3 flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-kd-border bg-kd-surface p-4"
      >
        <span className="flex items-center gap-3">
          <UtensilsCrossed className="h-5 w-5 shrink-0 text-kd-fg-muted" />
          <span>
            <span className="block text-sm font-semibold text-kd-fg">Send cutlery</span>
            <span className="block text-xs text-kd-fg-muted">
              Skip it to cut single-use plastic waste.
            </span>
          </span>
        </span>
        <input
          id="cutlery"
          type="checkbox"
          checked={cutleryRequested}
          onChange={(e) => setCutlery(e.target.checked)}
          className="h-5 w-5 shrink-0 accent-kd-primary"
        />
      </label>

      {/* Promo code (#52). Applied here as a passthrough — the server validates
          eligibility and computes the real discount at checkout. */}
      <div className="mt-3 rounded-xl border border-kd-border bg-kd-surface p-4">
        <p className="flex items-center gap-2 text-sm font-semibold text-kd-fg">
          <Tag className="h-4 w-4 text-kd-fg-muted" /> Promo code
        </p>
        {voucherCode ? (
          <div className="mt-3 flex items-center justify-between gap-2 rounded-lg bg-kd-primary/10 px-3 py-2">
            <span className="text-sm font-medium text-kd-fg">
              <span className="font-semibold">{voucherCode}</span> will apply at checkout
            </span>
            <Button
              variant="ghost"
              size="sm"
              aria-label="Remove promo code"
              onClick={() => {
                setVoucherCode(null);
                setPromoInput("");
              }}
            >
              <X className="h-4 w-4 text-kd-fg-subtle" />
            </Button>
          </div>
        ) : (
          <div className="mt-3 flex gap-2">
            <Input
              value={promoInput}
              onChange={(e) => setPromoInput(e.target.value.toUpperCase())}
              placeholder="e.g. WELCOME50"
              className="uppercase"
              aria-label="Promo code"
            />
            <Button
              variant="outline"
              disabled={!promoInput.trim()}
              onClick={() => setVoucherCode(promoInput)}
            >
              Apply
            </Button>
          </div>
        )}
      </div>

      <Separator className="my-6" />

      <div className="space-y-1 text-sm">
        <div className="flex justify-between">
          <span className="text-kd-fg-muted">Subtotal (estimate)</span>
          <span>{formatRs(subtotal)}</span>
        </div>
        {tipAmount > 0 && (
          <div className="flex justify-between">
            <span className="text-kd-fg-muted">Rider tip</span>
            <span>{formatRs(tipAmount)}</span>
          </div>
        )}
        <div className="flex justify-between pt-1 font-semibold text-kd-fg">
          <span>Estimated total</span>
          <span>{formatRs(subtotal + tipAmount)}</span>
        </div>
        <p className="text-xs text-kd-fg-subtle">
          Tax, delivery and platform fee are computed at checkout.
        </p>
      </div>

      <Link href="/checkout" className={buttonVariants({ size: "lg", className: "mt-6 w-full" })}>
        Go to checkout
      </Link>
    </main>
  );
}
