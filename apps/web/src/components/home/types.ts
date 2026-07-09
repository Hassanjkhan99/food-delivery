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
  };
};

export type HomeBanner = {
  id: string;
  title: string;
  imageUrl: string;
  linkHref?: string | null;
};
