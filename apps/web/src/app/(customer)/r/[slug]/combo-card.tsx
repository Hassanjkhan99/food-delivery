"use client";

// One combo / meal deal card (#53), shown in the "Deals" pseudo-section at the top of
// the menu. A combo is a fixed bundle of items sold at one price; the customer adds it
// to the cart as a single line (comboId), which the server re-prices and snapshots. We
// show the bundle price, the strike-through a-la-carte total, and a "% off" badge — all
// server-computed (originalPriceMinor), so the saving can't be spoofed.
import { motion, useReducedMotion } from "framer-motion";
import { Plus } from "lucide-react";
import { formatRs } from "@fd/shared";
import { cardClasses } from "@/components/theme/theme";
import { ItemImage } from "@/components/media/ItemImage";

export type ComboForCard = {
  id: string;
  name: string;
  description?: string | null;
  priceMinor: number;
  originalPriceMinor: number;
  isAvailable: boolean;
  imageUrl?: string | null;
  items: { id: string; qty: number; menuItem: { id: string; name: string } }[];
};

/** Whole-number % off for a combo vs its a-la-carte total, or null if no saving. */
export function comboPercentOff(combo: ComboForCard): number | null {
  const { originalPriceMinor: was, priceMinor } = combo;
  if (was <= priceMinor) return null;
  return Math.round(((was - priceMinor) / was) * 100);
}

export function ComboCard({
  combo,
  cardStyle,
  accepting,
  onAdd,
}: {
  combo: ComboForCard;
  cardStyle: string;
  accepting: boolean;
  onAdd: (combo: ComboForCard) => void;
}) {
  const reduced = useReducedMotion();
  const disabled = !combo.isAvailable || !accepting;
  const off = comboPercentOff(combo);
  // "Burger ×1, Fries ×1, Drink ×1" — the frozen component list, guarded for empties.
  const contents = (combo.items ?? [])
    .map((ci) => `${ci.menuItem?.name ?? "Item"}${ci.qty > 1 ? ` ×${ci.qty}` : ""}`)
    .join(", ");

  return (
    <div className="relative">
      <div className={`flex w-full items-start justify-between gap-3 rounded-2xl p-4 text-sm ${cardClasses(cardStyle)} ${disabled ? "opacity-50" : ""}`}>
        <ItemImage url={combo.imageUrl} name={combo.name} className="h-20 w-20 rounded-xl" />
        <div className="min-w-0 flex-1 text-left">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{combo.name}</span>
            {off != null && (
              <span className="rounded-full bg-kd-danger px-2 py-0.5 text-[10px] font-semibold text-white">
                {off}% OFF
              </span>
            )}
          </div>
          {combo.description && (
            <p className="mt-1 line-clamp-2 text-sm opacity-60">{combo.description}</p>
          )}
          {contents && <p className="mt-1 line-clamp-2 text-xs opacity-50">{contents}</p>}
          {!combo.isAvailable && (
            <p className="mt-1 text-xs font-medium text-kd-danger">Unavailable</p>
          )}
        </div>
        <span className="flex shrink-0 flex-col items-end">
          {off != null && (
            <span className="text-xs line-through opacity-50">
              {formatRs(combo.originalPriceMinor)}
            </span>
          )}
          <span className="font-semibold" style={{ color: "var(--brand-primary)" }}>
            {formatRs(combo.priceMinor)}
          </span>
        </span>
      </div>
      {!disabled && (
        <motion.button
          type="button"
          aria-label={`Add ${combo.name}`}
          onClick={() => onAdd(combo)}
          whileTap={reduced ? undefined : { scale: 0.95 }}
          className="absolute bottom-2 right-2 z-10 flex h-8 w-8 items-center justify-center rounded-full text-white shadow-md transition hover:brightness-110"
          style={{ backgroundColor: "var(--brand-primary)" }}
        >
          <Plus className="h-4 w-4" strokeWidth={3} />
        </motion.button>
      )}
    </div>
  );
}
