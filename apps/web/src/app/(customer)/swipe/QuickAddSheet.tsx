"use client";

// Quick modifier picker for a swipe-right add. Opens only when the featured dish has
// modifier groups; a dish with none skips straight to the cart. Validation mirrors
// r/[slug]/item-modal.tsx (single-select for maxSelect===1, multi-select up to maxSelect,
// minSelect enforced before the confirm button unlocks) but trimmed to a single-quantity,
// single-screen sheet — the swipe deck adds one of the featured dish per swipe, not an
// arbitrary qty, so there's no stepper here.
import { useMemo, useState } from "react";
import { formatRs } from "@fd/shared";
import { ItemImage } from "@/components/media/ItemImage";
import { itemImagePlaceholder } from "@/components/media/placeholders";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { SwipeMenuItem } from "./types";

export type QuickAddResult = {
  modifierOptionIds: string[];
  modifierNames: string[];
  unitPriceMinor: number;
};

export function QuickAddSheet({
  item,
  cuisineTags,
  onClose,
  onConfirm,
}: {
  item: SwipeMenuItem | null;
  cuisineTags: string[];
  onClose: () => void;
  onConfirm: (result: QuickAddResult) => void;
}) {
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  // Re-seed defaults (first option per required group) whenever a new dish opens. Adjusting
  // state during render (not an effect) per the "storing information from previous renders"
  // pattern — avoids the extra commit + cascading-render lint error a useEffect would trigger.
  const [seededFor, setSeededFor] = useState<string | null>(null);
  if (item && item.id !== seededFor) {
    const seed: Record<string, string[]> = {};
    for (const g of item.modifierGroups) {
      if (g.minSelect > 0 && g.options[0]) seed[g.id] = [g.options[0].id];
    }
    setSelected(seed);
    setSeededFor(item.id);
  }

  const toggle = (groupId: string, maxSelect: number, optionId: string) => {
    setSelected((prev) => {
      const current = prev[groupId] ?? [];
      if (current.includes(optionId)) {
        return { ...prev, [groupId]: current.filter((id) => id !== optionId) };
      }
      if (maxSelect === 1) return { ...prev, [groupId]: [optionId] };
      if (current.length >= maxSelect) return prev;
      return { ...prev, [groupId]: [...current, optionId] };
    });
  };

  const groupError = (g: SwipeMenuItem["modifierGroups"][number]): string | null => {
    const n = (selected[g.id] ?? []).length;
    if (n < g.minSelect) return g.minSelect === 1 ? "Choose 1" : `Choose at least ${g.minSelect}`;
    if (n > g.maxSelect) return `Choose at most ${g.maxSelect}`;
    return null;
  };

  const valid = useMemo(
    () => !item || item.modifierGroups.every((g) => groupError(g) === null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [item, selected],
  );

  const { delta, names } = useMemo(() => {
    let amount = 0;
    const chosenNames: string[] = [];
    if (item) {
      for (const g of item.modifierGroups) {
        for (const id of selected[g.id] ?? []) {
          const opt = g.options.find((o) => o.id === id);
          if (opt) {
            amount += opt.priceDeltaMinor;
            chosenNames.push(opt.name);
          }
        }
      }
    }
    return { delta: amount, names: chosenNames };
  }, [item, selected]);

  const total = (item?.priceMinor ?? 0) + delta;

  return (
    <Sheet open={!!item} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="bottom" className="max-h-[85vh] rounded-t-3xl pb-6">
        {item && (
          <>
            <SheetHeader className="flex-row items-center gap-3 space-y-0">
              <ItemImage
                url={item.imageUrl}
                name={item.name}
                fallbackSrc={itemImagePlaceholder(cuisineTags)}
                className="h-11 w-11 rounded-xl"
                sizes="44px"
              />
              <div className="min-w-0 flex-1 text-left">
                <SheetTitle>{item.name}</SheetTitle>
                <p className="text-xs text-kd-fg-muted">Choose your options</p>
              </div>
            </SheetHeader>

            <div className="flex-1 space-y-4 overflow-y-auto px-4">
              {item.modifierGroups.map((g) => {
                const err = groupError(g);
                return (
                  <fieldset key={g.id} className="space-y-2">
                    <legend className="mb-1 flex items-center gap-2 text-sm font-bold text-kd-fg">
                      {g.name}
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                          g.minSelect > 0
                            ? "bg-kd-accent-soft text-kd-warning"
                            : "bg-kd-surface-muted text-kd-fg-subtle",
                        )}
                      >
                        {g.minSelect > 0 ? "Required" : "Optional"}
                      </span>
                      {err && <span className="text-xs font-medium text-kd-danger">{err}</span>}
                    </legend>
                    <div className="flex flex-col gap-2">
                      {g.options.map((o) => {
                        const checked = (selected[g.id] ?? []).includes(o.id);
                        return (
                          <button
                            key={o.id}
                            type="button"
                            disabled={!o.isAvailable && !checked}
                            onClick={() => toggle(g.id, g.maxSelect, o.id)}
                            className={cn(
                              "flex items-center gap-3 rounded-xl border-[1.5px] px-3.5 py-3 text-left transition-colors active:scale-[0.99]",
                              checked
                                ? "border-kd-primary bg-kd-primary-soft"
                                : "border-kd-border bg-kd-surface",
                              !o.isAvailable && !checked && "opacity-40",
                            )}
                          >
                            <span
                              className={cn(
                                "grid h-[22px] w-[22px] shrink-0 place-items-center border-2",
                                g.maxSelect === 1 ? "rounded-full" : "rounded-md",
                                checked ? "border-kd-primary bg-kd-primary" : "border-kd-fg-subtle",
                              )}
                            >
                              {checked && (
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                                  <path
                                    d="m5 13 4 4L19 7"
                                    stroke="#fff"
                                    strokeWidth={3.5}
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                </svg>
                              )}
                            </span>
                            <span className="flex-1 text-sm font-medium text-kd-fg">{o.name}</span>
                            {o.priceDeltaMinor > 0 && (
                              <span className="text-sm font-semibold tabular-nums text-kd-fg-muted">
                                + {formatRs(o.priceDeltaMinor)}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </fieldset>
                );
              })}
            </div>

            <div className="px-4">
              <Button
                variant="brand"
                className="flex w-full items-center justify-between rounded-2xl py-6 text-base"
                disabled={!valid}
                onClick={() =>
                  onConfirm({
                    modifierOptionIds: Object.values(selected).flat(),
                    modifierNames: names,
                    unitPriceMinor: total,
                  })
                }
              >
                <span>Add to cart</span>
                <span className="rounded-full bg-white/20 px-2.5 py-1 text-sm tabular-nums">
                  {formatRs(total)}
                </span>
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
