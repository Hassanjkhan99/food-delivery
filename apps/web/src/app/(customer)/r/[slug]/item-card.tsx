"use client";

// One menu-item card, shared by the Popular pseudo-section and every real category.
// Honors the three per-category display modes (list / grid / compact) and the theme
// card style (flat / glass / tilt3d). Items with no required modifier groups get a
// one-tap "+" quick-add; everything else opens the full modifier sheet. The "+" is a
// sibling of the card button (not nested) so we never emit an invalid button-in-button.
import { motion, useReducedMotion } from "framer-motion";
import { Plus, SlidersHorizontal } from "lucide-react";
import { cardClasses } from "@/components/theme/theme";
import { TiltCard } from "@/components/theme/TiltCard";
import { ItemImage } from "@/components/media/ItemImage";
import { Price, type BranchTaxInfo } from "@/components/price/Price";
import type { MenuItemForModal } from "./item-modal";

export type ItemForCard = MenuItemForModal & {
  isAvailable: boolean;
  // Timed-86 (#46/#110): when a currently-unavailable item is scheduled to come back.
  // The server re-arms items whose time has elapsed at read time, so a non-null value
  // here on an unavailable item is always still in the future → drives "Back at {time}".
  unavailableUntil?: string | null;
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

/** 86'd label for an unavailable item: "Back at {time}" when it's timed-86 (an
 *  unavailableUntil in the future), otherwise "Sold out". No now() comparison — the
 *  server has already re-armed anything whose time elapsed, so a set value is future.
 *  Formatted in Pakistan time (the restaurant's clock): the API stores timed-86 as
 *  end-of-day PKT, so a browser in another zone must not reinterpret it locally
 *  (Codex #230 — a PKT-midnight value would otherwise read as e.g. 2:00 PM in US ET). */
export function unavailableLabel(item: { unavailableUntil?: string | null }): string {
  if (!item.unavailableUntil) return "Sold out";
  const back = new Date(item.unavailableUntil).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Karachi",
  });
  return `Back at ${back}`;
}

/** Customization signal for the card: an item with a min-select group must be
 *  customized to order (amber "Required"); one with only optional groups just has
 *  add-ons (info). null → no modifiers, no pill. */
export function modifierHint(item: ItemForCard): "required" | "optional" | null {
  if (item.modifierGroups.length === 0) return null;
  return item.modifierGroups.some((g) => g.minSelect >= 1) ? "required" : "optional";
}

export function ItemCard({
  item,
  mode,
  cardStyle,
  accepting,
  onOpen,
  onQuickAdd,
  imageFallback,
  taxInfo,
}: {
  item: ItemForCard;
  mode: string;
  cardStyle: string;
  accepting: boolean;
  onOpen: (item: ItemForCard) => void;
  onQuickAdd: (item: ItemForCard) => void;
  imageFallback?: string | null;
  taxInfo?: BranchTaxInfo | null;
}) {
  const reduced = useReducedMotion();
  const compact = mode === "compact";
  const disabled = !item.isAvailable || !accepting;
  const showQuickAdd = !disabled && canQuickAdd(item);
  const tilt = cardStyle === "tilt3d" && !compact;
  const off = percentOff(item);
  const hint = modifierHint(item);

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
        {/* Customization signal (#46 modifiers): required-to-order vs optional add-ons. */}
        {hint && (
          <span
            className={`mt-1.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
              hint === "required"
                ? "bg-kd-warning-soft text-kd-warning-soft-fg"
                : "bg-kd-info-soft text-kd-info"
            }`}
          >
            <SlidersHorizontal className="h-2.5 w-2.5" />
            {hint === "required" ? "Customize · Required" : "Add-ons available"}
          </span>
        )}
      </div>
      <span className="flex shrink-0 flex-col items-end">
        {off != null && (
          <Price
            minor={item.compareAtPriceMinor!}
            taxInfo={taxInfo}
            hint={false}
            className="text-xs text-kd-fg-subtle line-through"
          />
        )}
        <Price
          minor={item.priceMinor}
          taxInfo={taxInfo}
          className="font-semibold"
          style={{ color: "var(--brand-primary)" }}
        />
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
      {/* 86'd items: a pill in the add-button slot (full opacity over the dimmed card) —
          "Back at {time}" when timed-86, otherwise "Sold out". Branch-closed items aren't
          "sold out", so this is gated on the item's own availability, not `disabled`. */}
      {!item.isAvailable && (
        <span
          className={`absolute z-10 whitespace-nowrap rounded-full bg-kd-surface px-2.5 py-1 text-[11px] font-bold text-kd-fg-muted shadow-md ring-1 ring-kd-border ${
            compact ? "right-3 top-1/2 -translate-y-1/2" : "bottom-2 right-2"
          }`}
        >
          {unavailableLabel(item)}
        </span>
      )}
    </div>
  );
}
