// Shape the swipe deck renders against, mapped once from SwipeDeckQuery so the
// presentational components don't churn every time the GraphQL document changes
// (same pattern as components/home/types.ts's FeedHit).
import type { FeedPhoto } from "@/components/home/types";

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
