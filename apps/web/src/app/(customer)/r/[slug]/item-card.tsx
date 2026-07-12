"use client";

// One menu-item card, shared by the Popular pseudo-section and every real category.
// Honors the three per-category display modes (list / grid / compact) and the theme
// card style (flat / glass / tilt3d). Items with no required modifier groups get a
// one-tap "+" quick-add; everything else opens the full modifier sheet. The "+" is a
// sibling of the card button (not nested) so we never emit an invalid button-in-button.
import { motion, useReducedMotion } from "framer-motion";
import { Plus } from "lucide-react";
import { formatRs } from "@fd/shared";
import { cardClasses } from "@/components/theme/theme";
import { TiltCard } from "@/components/theme/TiltCard";
import { ItemImage } from "@/components/media/ItemImage";
import type { MenuItemForModal } from "./item-modal";

export type ItemForCard = MenuItemForModal & {
  isAvailable: boolean;
  badges: string[];
  imageUrl?: string | null;
  // Item-level offer (#53): original "was" price. Server only sends it when it's a real
  // discount (> priceMinor), so we can render the strike-through + % badge unconditionally.
  compareAtPriceMinor?: number | null;
};

/** Whole-number % off for an item offer, or null when there's no valid discount. */
export function percentOff(item: {
  priceMinor: number;
  compareAtPriceMinor?: number | null;
}): number | null {
  const was = item.compareAtPriceMinor;
  if (was == null || was <= item.priceMinor) return null;
  return Math.round(((was - item.priceMinor) / was) * 100);
}

/** No modifier group forces a choice → we can add straight to the cart. */
export function canQuickAdd(item: ItemForCard): boolean {
  return item.modifierGroups.every((g) => g.minSelect === 0);
}

export function ItemCard({
  item,
  mode,
  cardStyle,
  accepting,
  onOpen,
  onQuickAdd,
  imageFallback,
}: {
  item: ItemForCard;
  mode: string;
  cardStyle: string;
  accepting: boolean;
  onOpen: (item: ItemForCard) => void;
  onQuickAdd: (item: ItemForCard) => void;
  imageFallback?: string | null;
}) {
  const reduced = useReducedMotion();
  const compact = mode === "compact";
  const disabled = !item.isAvailable || !accepting;
  const showQuickAdd = !disabled && canQuickAdd(item);
  const tilt = cardStyle === "tilt3d" && !compact;
  const off = percentOff(item);

  const inner = (
    <>
      {!compact && (
        <ItemImage
          url={item.imageUrl}
          name={item.name}
          fallbackSrc={imageFallback}
          className="h-20 w-20 rounded-xl"
        />
      )}
      <div className="min-w-0 flex-1 text-left">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{item.name}</span>
          {off != null && (
            <span className="rounded-full bg-kd-danger px-2 py-0.5 text-[10px] font-semibold text-white">
              {off}% OFF
            </span>
          )}
          {item.badges.map((b) => (
            <span
              key={b}
              className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
              style={{
                backgroundColor: "color-mix(in srgb, var(--brand-accent) 25%, transparent)",
              }}
            >
              {b}
            </span>
          ))}
        </div>
        {!compact && item.description && (
          <p className="mt-1 line-clamp-2 text-sm text-kd-fg-muted">{item.description}</p>
        )}
        {!item.isAvailable && <p className="mt-1 text-xs font-medium text-kd-danger">Unavailable</p>}
      </div>
      <span className="flex shrink-0 flex-col items-end">
        {off != null && (
          <span className="text-xs text-kd-fg-subtle line-through">
            {formatRs(item.compareAtPriceMinor!)}
          </span>
        )}
        <span className="font-semibold" style={{ color: "var(--brand-primary)" }}>
          {formatRs(item.priceMinor)}
        </span>
      </span>
    </>
  );

  const shared = `flex w-full items-start justify-between gap-3 p-4 text-sm disabled:opacity-50 ${
    compact ? "" : `rounded-2xl ${cardClasses(cardStyle)}`
  }`;

  // Motion tilt card (pointer-tracked 3D) uses its own component; everything else is
  // a plain motion.button with a subtle hover/tap. Both are wrapped so the quick-add
  // button can sit alongside as a sibling.
  const card = tilt ? (
    <TiltCard className={shared} disabled={disabled} onClick={() => onOpen(item)}>
      {inner}
    </TiltCard>
  ) : (
    <motion.button
      type="button"
      className={shared}
      disabled={disabled}
      onClick={() => onOpen(item)}
      whileHover={reduced || compact ? undefined : { scale: 1.01 }}
      whileTap={reduced ? undefined : { scale: 0.99 }}
    >
      {inner}
    </motion.button>
  );

  return (
    <div className="relative">
      {card}
      {showQuickAdd && (
        <button
          type="button"
          aria-label={`Quick add ${item.name}`}
          onClick={() => onQuickAdd(item)}
          className={`absolute z-10 flex h-9 w-9 items-center justify-center rounded-full text-white shadow-md ring-2 ring-kd-surface transition hover:brightness-110 active:scale-95 ${
            compact ? "right-3 top-1/2 -translate-y-1/2" : "bottom-2 right-2"
          }`}
          style={{ backgroundColor: "var(--brand-primary)" }}
        >
          <Plus className="h-5 w-5" strokeWidth={3} />
        </button>
      )}
    </div>
  );
}
