"use client";

import Link from "next/link";
import { Trash2 } from "lucide-react";
import { formatRs } from "@fd/shared";
import { cartSubtotal, useCart } from "@/lib/cart";
import { Button, buttonVariants } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

export default function CartPage() {
  const { branchId, branchName, branchSlug, lines, removeLine, setQty } = useCart();

  if (lines.length === 0 || !branchId) {
    return (
      <main className="py-16 text-center">
        <p className="text-lg text-neutral-500">Your cart is empty.</p>
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
      <p className="mb-6 text-sm text-neutral-500">
        From <Link href={`/r/${branchSlug}`} className="font-medium text-neutral-900 underline">{branchName}</Link>
      </p>

      <div className="space-y-3">
        {lines.map((l) => (
          <div key={l.lineId} className="flex items-start justify-between gap-3 rounded-xl border border-neutral-200 bg-white p-4">
            <div className="min-w-0">
              <p className="font-medium text-neutral-900">{l.name}</p>
              {l.modifierNames.length > 0 && (
                <p className="text-xs text-neutral-500">{l.modifierNames.join(", ")}</p>
              )}
              {l.notes && <p className="text-xs italic text-neutral-400">“{l.notes}”</p>}
              <div className="mt-2 flex items-center gap-2">
                <div className="flex items-center rounded-lg border border-neutral-200">
                  <Button variant="ghost" size="sm" onClick={() => setQty(l.lineId, l.qty - 1)}>−</Button>
                  <span className="w-6 text-center text-sm">{l.qty}</span>
                  <Button variant="ghost" size="sm" onClick={() => setQty(l.lineId, l.qty + 1)}>+</Button>
                </div>
                <Button variant="ghost" size="sm" onClick={() => removeLine(l.lineId)}>
                  <Trash2 className="h-4 w-4 text-neutral-400" />
                </Button>
              </div>
            </div>
            <span className="shrink-0 font-semibold">{formatRs(l.unitPriceMinor * l.qty)}</span>
          </div>
        ))}
      </div>

      <Separator className="my-6" />

      <div className="space-y-1 text-sm">
        <div className="flex justify-between">
          <span className="text-neutral-500">Subtotal (estimate)</span>
          <span>{formatRs(subtotal)}</span>
        </div>
        <p className="text-xs text-neutral-400">
          Tax, delivery and platform fee are computed at checkout.
        </p>
      </div>

      <Link href="/checkout" className={buttonVariants({ size: "lg", className: "mt-6 w-full" })}>
        Go to checkout
      </Link>
    </main>
  );
}
