"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  DEFAULT_UNAVAILABILITY_PREFERENCE,
  UNAVAILABILITY_PREFERENCES,
  formatRs,
  type UnavailabilityPreference,
} from "@fd/shared";
import { useCart, type CartLine } from "@/lib/cart";
import { ItemImage } from "@/components/media/ItemImage";
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
  imageUrl?: string | null;
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

// When editing a cart line we pre-fill the sheet from its stored config and, on
// submit, replace that line in place instead of appending a new one.
export type EditContext = {
  lineId: string;
  qty: number;
  modifierOptionIds: string[];
  notes?: string;
  unavailabilityPreference?: UnavailabilityPreference;
};

export function ItemModal({
  item,
  branch,
  edit,
  onClose,
}: {
  item: MenuItemForModal;
  branch: { id: string; slug: string; name: string };
  edit?: EditContext;
  onClose: () => void;
}) {
  const router = useRouter();
  const addLine = useCart((s) => s.addLine);
  const updateLine = useCart((s) => s.updateLine);
  const clearCart = useCart((s) => s.clear);

  // Seed initial state from the edit context (round-trips a cart line, #39).
  const [qty, setQty] = useState(edit?.qty ?? 1);
  const [notes, setNotes] = useState(edit?.notes ?? "");
  const [unavailPref, setUnavailPref] = useState<UnavailabilityPreference>(
    edit?.unavailabilityPreference ?? DEFAULT_UNAVAILABILITY_PREFERENCE,
  );
  const [selected, setSelected] = useState<Record<string, string[]>>(() => {
    // Reconstruct per-group selections from a flat list of option ids.
    if (!edit) return {};
    const chosen = new Set(edit.modifierOptionIds);
    const seed: Record<string, string[]> = {};
    for (const g of item.modifierGroups) {
      const ids = g.options.filter((o) => chosen.has(o.id)).map((o) => o.id);
      if (ids.length) seed[g.id] = ids;
    }
    return seed;
  });
  const [conflict, setConflict] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [shakeGroupId, setShakeGroupId] = useState<string | null>(null);

  // One ref per group so we can scroll the first unsatisfied one into view.
  const groupRefs = useRef<Record<string, HTMLFieldSetElement | null>>({});

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

  // Per-group validity + a hint string, so we can highlight the offending group
  // inline instead of relying on a disabled-button tooltip.
  const groupError = (g: MenuItemForModal["modifierGroups"][number]): string | null => {
    const n = (selected[g.id] ?? []).length;
    if (n < g.minSelect)
      return g.minSelect === 1 ? "Choose 1" : `Choose at least ${g.minSelect}`;
    if (n > g.maxSelect) return `Choose at most ${g.maxSelect}`;
    return null;
  };

  const firstInvalidGroup = useMemo(
    () => item.modifierGroups.find((g) => groupError(g) !== null) ?? null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [item, selected],
  );
  const valid = firstInvalidGroup === null;

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

  function submit(clearFirst = false) {
    // Guard: never let a required group slip through silently. Scroll to the
    // first offender, shake it, and reveal inline hints.
    if (!valid && firstInvalidGroup) {
      setShowErrors(true);
      const el = groupRefs.current[firstInvalidGroup.id];
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
      setShakeGroupId(firstInvalidGroup.id);
      window.setTimeout(() => setShakeGroupId(null), 500);
      return;
    }

    const config: Omit<CartLine, "lineId"> = {
      menuItemId: item.id,
      name: item.name,
      qty,
      unitPriceMinor: unitPrice,
      modifierOptionIds: Object.values(selected).flat(),
      modifierNames: delta.names,
      notes: notes.trim() || undefined,
      unavailabilityPreference: unavailPref,
    };

    if (edit) {
      updateLine(edit.lineId, config);
      onClose();
      return;
    }
    if (clearFirst) clearCart();
    const result = addLine(branch, config);
    if (result === "branch_conflict") {
      setConflict(true);
      return;
    }
    onClose();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        // Full-height sheet feel on mobile with a photo header + sticky footer;
        // a centered card from sm up. Padding is removed so the header photo can
        // bleed to the edges; inner sections re-add their own.
        className="flex max-h-[92vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-md"
      >
        {item.imageUrl && (
          <ItemImage
            url={item.imageUrl}
            name={item.name}
            className="h-40 w-full rounded-none sm:h-48"
            sizes="(max-width: 640px) 100vw, 448px"
          />
        )}

        <div className="flex-1 overflow-y-auto px-6 pt-4">
          <DialogHeader>
            <DialogTitle>{item.name}</DialogTitle>
            {item.description && <DialogDescription>{item.description}</DialogDescription>}
          </DialogHeader>

          <div className="mt-4 space-y-4">
            {item.modifierGroups.map((g) => {
              const err = groupError(g);
              const invalid = showErrors && err !== null;
              return (
                <motion.fieldset
                  key={g.id}
                  ref={(el: HTMLFieldSetElement | null) => {
                    groupRefs.current[g.id] = el;
                  }}
                  animate={shakeGroupId === g.id ? { x: [0, -6, 6, -4, 4, 0] } : { x: 0 }}
                  transition={{ duration: 0.4 }}
                  className={`space-y-2 rounded-lg ${
                    invalid ? "ring-1 ring-kd-danger ring-offset-2 ring-offset-kd-surface" : ""
                  }`}
                >
                  <legend className="text-sm font-semibold text-kd-fg">
                    {g.name}{" "}
                    <span className="font-normal text-kd-fg-muted">
                      {g.minSelect > 0 ? "(required)" : "(optional)"}
                      {g.maxSelect > 1 ? ` · up to ${g.maxSelect}` : ""}
                    </span>
                    {invalid && (
                      <span className="ml-2 font-medium text-kd-danger" role="alert">
                        {err}
                      </span>
                    )}
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
                            className="accent-kd-primary"
                          />
                          {o.name}
                        </span>
                        {o.priceDeltaMinor > 0 && (
                          <span className="text-kd-fg-muted">+{formatRs(o.priceDeltaMinor)}</span>
                        )}
                      </label>
                    );
                  })}
                </motion.fieldset>
              );
            })}

            {/* Special instructions */}
            <div className="space-y-1">
              <Textarea
                placeholder="Add a note (e.g. no onions, extra spicy)"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                maxLength={300}
              />
              <p className="text-xs text-kd-fg-subtle">
                The restaurant will try to accommodate requests but can&apos;t guarantee them.
              </p>
            </div>

            {/* Unavailability preference (#39) */}
            <fieldset className="space-y-2">
              <legend className="text-sm font-semibold text-kd-fg">
                If this item is unavailable
              </legend>
              {UNAVAILABILITY_PREFERENCES.map((p) => {
                const checked = unavailPref === p.value;
                return (
                  <label
                    key={p.value}
                    className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                      checked ? "border-kd-fg bg-kd-surface-muted" : "border-kd-border"
                    }`}
                  >
                    <input
                      type="radio"
                      name="unavailability-preference"
                      checked={checked}
                      onChange={() => setUnavailPref(p.value)}
                      className="accent-kd-primary"
                    />
                    {p.label}
                  </label>
                );
              })}
            </fieldset>
          </div>
        </div>

        {/* Sticky footer: qty stepper + running-total add button. Always visible,
            even on a 360px viewport, because the scroll lives above it. */}
        <div className="border-t border-kd-border bg-kd-surface px-6 py-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center rounded-lg border border-kd-border">
              <Button
                variant="ghost"
                size="sm"
                aria-label="Decrease quantity"
                onClick={() => setQty(Math.max(1, qty - 1))}
              >
                −
              </Button>
              <span className="w-8 text-center text-sm font-medium">{qty}</span>
              <Button
                variant="ghost"
                size="sm"
                aria-label="Increase quantity"
                onClick={() => setQty(qty + 1)}
              >
                +
              </Button>
            </div>
            <Button className="flex-1" onClick={() => submit()} aria-invalid={!valid}>
              {edit ? "Update" : "Add"} {qty} · {formatRs(unitPrice * qty)}
            </Button>
          </div>

          {conflict && (
            <div className="mt-3 rounded-lg bg-kd-warning-soft p-3 text-sm text-kd-fg">
              Your cart has items from another restaurant.
              <div className="mt-2 flex gap-2">
                <Button size="sm" variant="destructive" onClick={() => submit(true)}>
                  Clear cart &amp; add
                </Button>
                <Button size="sm" variant="outline" onClick={() => router.push("/cart")}>
                  View cart
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
