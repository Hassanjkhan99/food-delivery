// Shape the swipe deck renders against, mapped once from SwipeDeckQuery so the
// presentational components don't churn every time the GraphQL document changes
// (same pattern as components/home/types.ts's FeedHit).
import { displayPriceMinor, type PriceDisplayMode } from "@fd/shared";
import type { FeedPhoto } from "@/components/home/types";

/** Branch tax context needed to show prices in the customer's chosen display mode.
 *  Mirrors components/price/Price.tsx's BranchTaxInfo (the subset the deck needs). */
export type SwipeTaxInfo = { rateBps: number; inclusive: boolean } | null;

export type SwipeModifierOption = {
  id: string;
  name: string;
  priceDeltaMinor: number;
  isAvailable: boolean;
};

export type SwipeModifierGroup = {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  options: SwipeModifierOption[];
};

export type SwipeMenuItem = {
  id: string;
  name: string;
  description?: string | null;
  priceMinor: number;
  compareAtPriceMinor?: number | null;
  isAvailable: boolean;
  imageUrl?: string | null;
  badges: string[];
  modifierGroups: SwipeModifierGroup[];
};

export type SwipeHit = {
  branchId: string;
  branchSlug: string;
  addressText: string;
  distanceM: number;
  etaMinutes: number;
  priceBand: number;
  minOrderMinor: number;
  deliveryFeeMinor: number;
  isAcceptingOrders: boolean;
  isOpenNow: boolean;
  opensAtLabel: string | null;
  photo: FeedPhoto;
  // Tax profile for this branch, so displayed prices can match the customer's
  // inclusive/exclusive preference and agree with the server-priced checkout (#146).
  taxInfo: SwipeTaxInfo;
  restaurant: {
    id: string;
    name: string;
    slug: string;
    avgRating: number | null;
    ratingCount: number;
    cuisineTags: string[];
    dealBadge: string | null;
    primaryColor: string | null;
    accentColor: string | null;
  };
  // Server-ranked popular items for this branch; index 0 is the card's "featured" dish
  // (the one swipe-right adds).
  popularItems: SwipeMenuItem[];
};

/** Convert a stored menu price to the amount to DISPLAY under the customer's tax-display
 *  mode. Presentation only — the cart always stores the raw price and the server reprices
 *  at quote/placeOrder. Falls back to the raw amount when the branch has no tax rate. */
export function displayMinor(minor: number, taxInfo: SwipeTaxInfo, mode: PriceDisplayMode): number {
  if (!taxInfo || taxInfo.rateBps <= 0) return minor;
  return displayPriceMinor(minor, taxInfo.rateBps, taxInfo.inclusive, mode);
}

/** Closed-by-hours takes priority over "temporarily paused" — mirrors
 *  components/home/RestaurantCard.tsx's local `availability()` helper. */
export function swipeAvailability(hit: SwipeHit): { closed: boolean; label: string | null } {
  if (!hit.isOpenNow) {
    return {
      closed: true,
      label: hit.opensAtLabel ? `Closed · opens ${hit.opensAtLabel}` : "Closed",
    };
  }
  if (!hit.isAcceptingOrders) return { closed: true, label: "Temporarily paused" };
  return { closed: false, label: null };
}
