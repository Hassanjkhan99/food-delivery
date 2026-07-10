"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { formatRs } from "@fd/shared";
import { useCart } from "@/lib/cart";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

export type MenuItemForModal = {
  id: string;
  name: string;
  description?: string | null;
  priceMinor: number;
  modifierGroups: Array<{
    id: string;
    name: string;
    minSelect: number;
    maxSelect: number;
    options: Array<{
      id: string;
      name: string;
      priceDeltaMinor: number;
      isAvailable: boolean;
    }>;
  }>;
};

export function ItemModal({
  item,
  branch,
  orderable = true,
  disabledLabel,
  onClose,
}: {
  item: MenuItemForModal;
  branch: { id: string; slug: string; name: string };
  // When the branch is closed-by-hours or paused, the sheet stays browsable but the
  // add button is disabled so a deep-link (?item=) can never write to the cart — this
  // is the same guard `orderable` applies to ItemCard on the page.
  orderable?: boolean;
  disabledLabel?: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const addLine = useCart((s) => s.addLine);
  const clearCart = useCart((s) => s.clear);
  const [qty, setQty] = useState(1);
  const [notes, setNotes] = useState("");
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [conflict, setConflict] = useState(false);

  const toggle = (group: MenuItemForModal["modifierGroups"][number], optionId: string) => {
    setSelected((prev) => {
      const current = prev[group.id] ?? [];
      if (current.includes(optionId)) {
        return { ...prev, [group.id]: current.filter((id) => id !== optionId) };
      }
      // Single-select groups replace; multi-select appends up to max.
      if (group.maxSelect === 1) return { ...prev, [group.id]: [optionId] };
      if (current.length >= group.maxSelect) return prev;
      return { ...prev, [group.id]: [...current, optionId] };
    });
  };

  const validation = useMemo(() => {
    for (const g of item.modifierGroups) {
      const n = (selected[g.id] ?? []).length;
      if (n < g.minSelect) return `Choose at least ${g.minSelect} of '${g.name}'`;
      if (n > g.maxSelect) return `Choose at most ${g.maxSelect} of '${g.name}'`;
    }
    return null;
  }, [item, selected]);

  const delta = useMemo(() => {
    let d = 0;
    const names: string[] = [];
    for (const g of item.modifierGroups) {
      for (const id of selected[g.id] ?? []) {
        const opt = g.options.find((o) => o.id === id);
        if (opt) {
          d += opt.priceDeltaMinor;
          names.push(opt.name);
        }
      }
    }
    return { amount: d, names };
  }, [item, selected]);

  const unitPrice = item.priceMinor + delta.amount;

  function addToCart(clearFirst = false) {
    // Hard guard: a closed/paused branch must never build a cart, even via a stale deep-link.
    if (!orderable) return;
    if (clearFirst) clearCart();
    const result = addLine(branch, {
      menuItemId: item.id,
      name: item.name,
      qty,
      unitPriceMinor: unitPrice,
      modifierOptionIds: Object.values(selected).flat(),
      modifierNames: delta.names,
      notes: notes.trim() || undefined,
    });
    if (result === "branch_conflict") {
      setConflict(true);
      return;
    }
    onClose();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{item.name}</DialogTitle>
          {item.description && <DialogDescription>{item.description}</DialogDescription>}
        </DialogHeader>

        {item.modifierGroups.map((g) => (
          <fieldset key={g.id} className="space-y-2">
            <legend className="text-sm font-semibold text-kd-fg">
              {g.name}{" "}
              <span className="font-normal text-kd-fg-muted">
                {g.minSelect > 0 ? "(required)" : "(optional)"}
                {g.maxSelect > 1 ? ` · up to ${g.maxSelect}` : ""}
              </span>
            </legend>
            {g.options.map((o) => {
              const checked = (selected[g.id] ?? []).includes(o.id);
              return (
                <label
                  key={o.id}
                  className={`flex cursor-pointer items-center justify-between rounded-lg border px-3 py-2 text-sm ${
                    checked ? "border-kd-fg bg-kd-surface-muted" : "border-kd-border"
                  } ${!o.isAvailable ? "opacity-40" : ""}`}
                >
                  <span className="flex items-center gap-2">
                    <input
                      type={g.maxSelect === 1 ? "radio" : "checkbox"}
                      checked={checked}
                      disabled={!o.isAvailable}
                      onChange={() => toggle(g, o.id)}
                      name={g.id}
                    />
                    {o.name}
                  </span>
                  {o.priceDeltaMinor > 0 && (
                    <span className="text-kd-fg-muted">+{formatRs(o.priceDeltaMinor)}</span>
                  )}
                </label>
              );
            })}
          </fieldset>
        ))}

        <Textarea
          placeholder="Special instructions (optional)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
        />

        <div className="flex items-center justify-between gap-3 pt-2">
          <div className="flex items-center rounded-lg border border-kd-border">
            <Button variant="ghost" size="sm" onClick={() => setQty(Math.max(1, qty - 1))}>
              −
            </Button>
            <span className="w-8 text-center text-sm font-medium">{qty}</span>
            <Button variant="ghost" size="sm" onClick={() => setQty(qty + 1)}>
              +
            </Button>
          </div>
          <Button
            className="flex-1"
            disabled={!orderable || validation !== null}
            onClick={() => addToCart()}
            title={(!orderable ? disabledLabel : validation) ?? undefined}
          >
            {orderable ? `Add ${qty} · ${formatRs(unitPrice * qty)}` : (disabledLabel ?? "Unavailable")}
          </Button>
        </div>
        {orderable && validation && <p className="text-xs text-kd-warning">{validation}</p>}

        {conflict && (
          <div className="rounded-lg bg-kd-warning-soft p-3 text-sm text-kd-fg">
            Your cart has items from another restaurant.
            <div className="mt-2 flex gap-2">
              <Button size="sm" variant="destructive" onClick={() => addToCart(true)}>
                Clear cart & add
              </Button>
              <Button size="sm" variant="outline" onClick={() => router.push("/cart")}>
                View cart
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
