// Cuisine-aware image placeholders (#50 tier 3 alternative). When a restaurant/item has
// no real photo, we can stand in with an appetizing on-cuisine photo instead of the plain
// typography-gradient tile — but ONLY when it matches the cuisine, so a burger place never
// shows biryani. Add more cuisine photos here as they arrive; unmatched cuisines fall back
// to the gradient tile as before.
const BIRYANI_CUISINES = new Set(["Biryani", "Desi", "BBQ/Karahi"]);

function matchesBiryani(cuisineTags?: readonly string[] | null): boolean {
  return !!cuisineTags?.some((t) => BIRYANI_CUISINES.has(t));
}

/** Restaurant cover placeholder for photo-less branches, by cuisine (else null → gradient). */
export function restaurantCoverPlaceholder(cuisineTags?: readonly string[] | null): string | null {
  return matchesBiryani(cuisineTags) ? "/Biryani/biryani-restrant-cover-placeholder.jpg" : null;
}

/** Dish/item image placeholder for photo-less items, by the restaurant's cuisine. */
export function itemImagePlaceholder(cuisineTags?: readonly string[] | null): string | null {
  return matchesBiryani(cuisineTags) ? "/Biryani/gourmet-chicken-biryani-placeholder.jpg" : null;
}
