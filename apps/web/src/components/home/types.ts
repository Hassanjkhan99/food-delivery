// Shape of one browseBranches hit as consumed by the home feed components. Declared
// locally (rather than derived from codegen) so the presentational components don't
// churn every time the GraphQL document changes — the page maps the query result onto
// this shape once.
export type FeedPhoto = {
  url: string;
  source: string;
  attributionHtml?: string | null;
} | null;

export type FeedHit = {
  branchId: string;
  distanceM: number;
  etaMinutes: number;
  priceBand: number;
  minOrderMinor: number;
  deliveryFeeMinor: number;
  isAcceptingOrders: boolean;
  isOpenNow: boolean;
  opensAtLabel: string | null;
  // Neighborhood/area line shown under the name (liquid-glass redesign). Branch address.
  addressText: string;
  // Busy mode (#46): extra prep minutes while the kitchen is slammed. > 0 surfaces an
  // amber "Kitchen's busy" chip and is already folded into the server ETA quote.
  prepBufferMinutes: number;
  photo: FeedPhoto;
  restaurant: {
    id: string;
    name: string;
    slug: string;
    tier: string;
    avgRating: number | null;
    ratingCount: number;
    cuisineTags: string[];
    primaryColor?: string | null;
    // Uploaded brand logo (theme.logoUrl); small glass badge beside the name when present.
    logoUrl?: string | null;
    // Promoted deals (#22): label of an active deal_badge campaign, else null.
    dealBadge?: string | null;
  };
  // True when this hit is shown via a paid featured-slot placement (#22).
  promoted?: boolean;
};

export type HomeBanner = {
  id: string;
  title: string;
  imageUrl: string;
  linkHref?: string | null;
};
