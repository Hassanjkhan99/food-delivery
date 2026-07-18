"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "urql";
import { ChevronRight, Search, WifiOff, X } from "lucide-react";
import { CUISINE_TAGS, type BrowseSort } from "@fd/shared";
import { graphql } from "@/graphql/generated";
import type { BrowseSort as GqlBrowseSort } from "@/graphql/generated/graphql";
import { useDeliveryLocation } from "@/lib/location";
import { AddressChip } from "@/components/home/AddressChip";
import { CuisineRail } from "@/components/home/CuisineRail";
import {
  ActiveFilterChips,
  BrowseControls,
  EMPTY_FILTER,
  activeFilterCount,
  type BrowseFilterState,
} from "@/components/home/BrowseControls";
import { PromoCarousel } from "@/components/home/PromoCarousel";
import { OrderAgainRow, type ReorderTarget } from "@/components/home/OrderAgainRow";
import { EngagementRail, EngagementRailSkeleton } from "@/components/home/EngagementRail";
import {
  RestaurantCard,
  RestaurantMiniCard,
  RestaurantRowCard,
} from "@/components/home/RestaurantCard";
import { Swimlane } from "@/components/home/Swimlane";
import { HomeSkeleton } from "@/components/home/HomeSkeleton";
import { useOnlineStatus, useScrollRestoration } from "@/components/home/hooks";
import { Button } from "@/components/ui/button";
import { AmbientBackground, GlassPanel } from "@/components/ui/glass";
import { Banner } from "@/components/ui/banner";
import type { FeedHit } from "@/components/home/types";

/** Time-of-day greeting. Read via useSyncExternalStore so the wall clock (a client-only
 *  mutable source) is sampled in getSnapshot — not during render — which keeps the
 *  react-hooks purity/set-state-in-effect rules happy and avoids a hydration mismatch:
 *  SSR + first paint use the neutral server snapshot, then it resolves on the client. */
function greetingForNow(): string {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}
const NO_OP_SUBSCRIBE = () => () => {};
function useGreeting(): string {
  return useSyncExternalStore(NO_OP_SUBSCRIBE, greetingForNow, () => "Welcome back");
}

const HomeQuery = graphql(`
  query Home($lat: Float!, $lng: Float!, $filter: BrowseFilter, $sort: BrowseSort) {
    homeBanners {
      id
      title
      imageUrl
      linkHref
    }
    featuredBranches {
      campaignId
      label
      slaCapped
      branch {
        id
      }
    }
    browseBranches(lat: $lat, lng: $lng, filter: $filter, sort: $sort) {
      distanceM
      etaMinutes
      priceBand
      branch {
        id
        addressText
        minOrderMinor
        deliveryFeeMinor
        isAcceptingOrders
        isOpenNow
        opensAtLabel
        prepBufferMinutes
        photo {
          url
          source
          attributionHtml
        }
        restaurant {
          id
          name
          slug
          tier
          avgRating
          ratingCount
          cuisineTags
          dealBadge
          isVerified
          theme {
            primaryColor
            accentColor
            logoUrl
          }
        }
      }
    }
  }
`);

const HomeViewerQuery = graphql(`
  query HomeViewer {
    viewer {
      user {
        id
      }
    }
  }
`);

const OrderAgainQuery = graphql(`
  query OrderAgain {
    myOrders {
      id
      status
      branch {
        id
        photo {
          url
          source
          attributionHtml
        }
        restaurant {
          id
          name
          slug
          theme {
            primaryColor
          }
        }
      }
    }
  }
`);

// Gamified deal / reward / habit-loop cards (UX-15 / #134). A single read model composes
// the signed-in customer's own loyalty / voucher / order / referral / membership state
// into a ranked rail — no client-side reward logic.
const EngagementCardsQuery = graphql(`
  query EngagementCards {
    engagementCards(limit: 5) {
      id
      kind
      title
      body
      accent
      ctaLabel
      href
      expiresAt
      priority
    }
  }
`);

const JoinWaitlistMutation = graphql(`
  mutation JoinWaitlist($email: String!, $areaLabel: String, $lat: Float, $lng: Float) {
    joinWaitlist(email: $email, areaLabel: $areaLabel, lat: $lat, lng: $lng) {
      id
      email
    }
  }
`);

// Map the filter-sheet state onto the browseBranches GraphQL input, omitting the
// "any"/off facets so the server only applies what the user actually chose.
function toFilterInput(f: BrowseFilterState) {
  return {
    freeDelivery: f.freeDelivery || undefined,
    openNow: f.openNow || undefined,
    minRating: f.minRating ?? undefined,
    maxPriceBand: f.maxPriceBand ?? undefined,
    cuisineTags: f.cuisineTags.length > 0 ? f.cuisineTags : undefined,
  };
}

export default function HomePage() {
  const loc = useDeliveryLocation();
  const online = useOnlineStatus();
  const router = useRouter();
  useScrollRestoration("home-feed");
  const greeting = useGreeting();

  const [sort, setSort] = useState<BrowseSort>("relevance");
  const [filter, setFilter] = useState<BrowseFilterState>(EMPTY_FILTER);

  const [{ data, fetching, error }, refetch] = useQuery({
    query: HomeQuery,
    // The generated BrowseSort enum has the same string values as our shared union;
    // cast at the wire boundary so the UI can keep the lighter string type.
    variables: {
      lat: loc.lat,
      lng: loc.lng,
      filter: toFilterInput(filter),
      sort: sort as GqlBrowseSort,
    },
  });
  // Revalidate the viewer in the background (cache-and-network) so the logged-in gate
  // for the reorder row reflects the current session — e.g. after a logout on this or
  // another tab — instead of a stale cached viewer keeping the reorder query alive. The
  // urql client is also reset on logout (see useResetGraphQLClient), so the two together
  // guarantee we never pause/unpause reorders off a stale identity. — #36 review round 2.
  const [{ data: viewerData }] = useQuery({
    query: HomeViewerQuery,
    requestPolicy: "cache-and-network",
  });
  const loggedIn = Boolean(viewerData?.viewer?.user?.id);
  const [{ data: reorderData }] = useQuery({ query: OrderAgainQuery, pause: !loggedIn });
  // Engagement rail (#134): signed-in only — every card is personal. Cache-and-network so
  // the rail reflects freshly earned points / new orders without a loading flash.
  const [{ data: engagementData, fetching: engagementFetching }] = useQuery({
    query: EngagementCardsQuery,
    pause: !loggedIn,
    requestPolicy: "cache-and-network",
  });

  const [activeCuisine, setActiveCuisine] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  // isOpenNow/opensAtLabel are computed from server time, but HomeQuery is cache-first,
  // so the open/closed overlays would go stale across an opening/closing boundary within
  // a session. Refresh in the background on window focus and on a lightweight timer so
  // time-based open state stays current (data-first: no loading flash). — #36 review.
  useEffect(() => {
    const refresh = () => refetch({ requestPolicy: "cache-and-network" });
    const onFocus = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("focus", refresh);
    const timer = window.setInterval(refresh, 5 * 60_000);
    return () => {
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("focus", refresh);
      window.clearInterval(timer);
    };
  }, [refetch]);

  const hits: FeedHit[] = useMemo(
    () =>
      (data?.browseBranches ?? []).map((h) => ({
        branchId: h.branch.id,
        distanceM: h.distanceM,
        etaMinutes: h.etaMinutes,
        priceBand: h.priceBand,
        minOrderMinor: h.branch.minOrderMinor,
        deliveryFeeMinor: h.branch.deliveryFeeMinor,
        isAcceptingOrders: h.branch.isAcceptingOrders,
        isOpenNow: h.branch.isOpenNow,
        opensAtLabel: h.branch.opensAtLabel ?? null,
        addressText: h.branch.addressText,
        prepBufferMinutes: h.branch.prepBufferMinutes,
        photo: h.branch.photo ?? null,
        restaurant: {
          id: h.branch.restaurant.id,
          name: h.branch.restaurant.name,
          slug: h.branch.restaurant.slug,
          tier: h.branch.restaurant.tier,
          avgRating: h.branch.restaurant.avgRating ?? null,
          ratingCount: h.branch.restaurant.ratingCount,
          cuisineTags: h.branch.restaurant.cuisineTags ?? [],
          primaryColor: h.branch.restaurant.theme?.primaryColor ?? null,
          accentColor: h.branch.restaurant.theme?.accentColor ?? null,
          logoUrl: h.branch.restaurant.theme?.logoUrl ?? null,
          dealBadge: h.branch.restaurant.dealBadge ?? null,
          isVerified: h.branch.restaurant.isVerified,
        },
      })),
    [data],
  );

  // Promoted rail (#22): active featured-slot placements, ordered by the server (spend,
  // SLA-capped last) and resolved against the deliverable feed so we never link to a
  // branch that doesn't reach this location.
  const promoted = useMemo(() => {
    const byBranch = new Map(hits.map((h) => [h.branchId, h]));
    const out: FeedHit[] = [];
    for (const f of data?.featuredBranches ?? []) {
      const hit = byBranch.get(f.branch.id);
      if (!hit) continue;
      out.push({
        ...hit,
        promoted: true,
        restaurant: { ...hit.restaurant, dealBadge: f.label ?? hit.restaurant.dealBadge },
      });
    }
    return out;
  }, [data, hits]);

  // Cuisines present in the feed, ordered by the platform taxonomy.
  const availableCuisines = useMemo(() => {
    const present = new Set(hits.flatMap((h) => h.restaurant.cuisineTags));
    return CUISINE_TAGS.filter((c) => present.has(c));
  }, [hits]);

  // If the selected cuisine is no longer offered nearby (e.g. after a location
  // change), fall back to "All" by deriving it — never filter on a stale value
  // that would strand the feed empty and hide the tag from the rail.
  const effectiveCuisine =
    activeCuisine && (availableCuisines as readonly string[]).includes(activeCuisine)
      ? activeCuisine
      : null;

  // "Filtering" (hide the rich swimlanes, show the flat result list) whenever any
  // server filter, the cuisine rail, a non-default sort, or a search term is active.
  const serverFiltering = activeFilterCount(filter) > 0 || sort !== "relevance";
  const filtering = serverFiltering || effectiveCuisine !== null || search.trim().length > 0;

  // The server already applied the sheet filters + sort; the cuisine rail and free-text
  // search refine the returned set client-side (order is preserved from the server).
  const feed = useMemo(() => {
    const q = search.trim().toLowerCase();
    return hits
      .filter((h) =>
        effectiveCuisine ? h.restaurant.cuisineTags.includes(effectiveCuisine) : true,
      )
      .filter((h) =>
        q
          ? h.restaurant.name.toLowerCase().includes(q) ||
            h.restaurant.cuisineTags.some((c) => c.toLowerCase().includes(q))
          : true,
      );
  }, [hits, effectiveCuisine, search]);

  const topRated = useMemo(
    () =>
      [...hits]
        .filter((h) => h.restaurant.avgRating != null)
        .sort((a, b) => (b.restaurant.avgRating ?? 0) - (a.restaurant.avgRating ?? 0))
        .slice(0, 10),
    [hits],
  );
  const freeDelivery = useMemo(() => hits.filter((h) => h.deliveryFeeMinor === 0), [hits]);

  // Promo banners deep-link into a restaurant (linkHref = "/r/<slug>"). Hide any banner
  // whose target restaurant doesn't deliver to the current area, otherwise the banner
  // dead-ends on a restaurant the server rejects at checkout. Banners with no /r/ link
  // (generic campaigns) are always kept. — #36 review round 2.
  const banners = useMemo(() => {
    const deliverable = new Set(hits.map((h) => h.restaurant.slug));
    return (data?.homeBanners ?? []).filter((b) => {
      const m = /^\/r\/([^/?#]+)/.exec(b.linkHref ?? "");
      return m ? deliverable.has(m[1]) : true;
    });
  }, [data, hits]);

  // Only surface reorder targets that (a) come from a successfully delivered order —
  // not in-flight/cancelled/rejected ones — and (b) actually deliver to the current
  // location, otherwise the row links to restaurants the server rejects at checkout.
  const reorderTargets: ReorderTarget[] = useMemo(() => {
    const deliverable = new Set(hits.map((h) => h.restaurant.slug));
    const seen = new Set<string>();
    const out: ReorderTarget[] = [];
    for (const o of reorderData?.myOrders ?? []) {
      if (o.status !== "delivered") continue;
      const r = o.branch.restaurant;
      if (!deliverable.has(r.slug) || seen.has(r.slug)) continue;
      seen.add(r.slug);
      out.push({
        slug: r.slug,
        name: r.name,
        photo: o.branch.photo ?? null,
        primaryColor: r.theme?.primaryColor ?? null,
      });
      if (out.length >= 5) break;
    }
    return out;
  }, [reorderData, hits]);

  // Engagement cards, minus any reorder card whose restaurant no longer delivers to the
  // current area — same dead-end guard the reorder row applies. A reorder card deep-links
  // to /r/<slug>; drop it unless that slug is in the deliverable feed. Other card kinds
  // (deal/reward/referral/membership) don't target a specific restaurant, so they stay.
  const engagementCards = useMemo(() => {
    const deliverable = new Set(hits.map((h) => h.restaurant.slug));
    return (engagementData?.engagementCards ?? []).filter((c) => {
      if (c.kind !== "reorder") return true;
      const m = /^\/r\/([^/?#]+)/.exec(c.href);
      return m ? deliverable.has(m[1]) : true;
    });
  }, [engagementData, hits]);

  return (
    <main className="relative isolate space-y-6">
      {/* Ambient blurred brand-color blobs — the backdrop the liquid-glass hero refracts. */}
      <AmbientBackground />

      {/* Hero: liquid-glass search over the ambient backdrop (no solid card). A time-aware
          greeting sits above the headline; the address chip and search bar are frosted glass. */}
      <section className="relative -mx-4 -mt-6 overflow-hidden px-4 pb-6 pt-6 sm:mx-0 sm:mt-0 sm:px-8 lg:min-h-[340px] lg:px-12 lg:py-12">
        {/* Warm accent wash in the top-right, layered under the glass (matches the mockup). */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            background:
              "radial-gradient(circle at 88% 12%, color-mix(in oklab, var(--kd-accent) 26%, transparent), transparent 58%)",
          }}
        />
        <div className="relative flex h-full flex-col justify-center lg:w-[64%]">
          <AddressChip />
          <p className="mt-4 text-kd-label font-semibold text-kd-fg-muted">{greeting} 👋</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-kd-fg sm:text-5xl lg:text-[56px] lg:leading-[64px]">
            What are you craving?
          </h1>
          {/* Instant in-feed filter for the quick case; Enter (or the search icon) jumps to
              the dedicated /search screen, which also matches dishes (#37). */}
          <form
            role="search"
            className="kd-glass-solid relative mt-6 flex max-w-[760px] items-center gap-2 rounded-full py-2 pl-5 pr-2 focus-within:ring-2 focus-within:ring-kd-primary"
            onSubmit={(e) => {
              e.preventDefault();
              const q = search.trim();
              router.push(q ? `/search?q=${encodeURIComponent(q)}` : "/search");
            }}
          >
            <Search className="h-6 w-6 shrink-0 text-kd-fg-muted" strokeWidth={1.75} aria-hidden />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search restaurants, cuisines or dishes…"
              aria-label="Search restaurants and dishes"
              className="h-11 min-w-0 flex-1 bg-transparent text-base text-kd-fg outline-none placeholder:text-kd-fg-subtle lg:h-12 lg:text-lg"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                aria-label="Clear search"
                className="shrink-0 rounded-full p-1 text-kd-fg-subtle hover:bg-kd-surface-muted"
              >
                <X className="h-5 w-5" />
              </button>
            )}
            <button
              type="submit"
              aria-label="Search"
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-kd-primary text-kd-primary-fg transition-transform hover:bg-kd-primary-hover active:scale-90 lg:h-12 lg:w-12"
            >
              <Search className="h-5 w-5" strokeWidth={2.2} aria-hidden />
            </button>
          </form>

          {/* Filter row lives in the hero, spaced below the search (was cramped against it). */}
          {data && (hits.length > 0 || serverFiltering) && (
            <div className="mt-5">
              <BrowseControls
                sort={sort}
                onSortChange={setSort}
                filter={filter}
                onFilterChange={setFilter}
              />
            </div>
          )}
        </div>
      </section>

      {!online && (
        <Banner tone="warning" icon={<WifiOff className="mt-0.5 h-4 w-4 shrink-0" />}>
          You&apos;re offline — showing the last loaded restaurants.
        </Banner>
      )}

      {/* Loading */}
      {fetching && !data && <HomeSkeleton />}

      {/* Error */}
      {error && !data && (
        <GlassPanel variant="strong" className="flex flex-col items-center p-8 text-center">
          <div className="mb-3 grid h-14 w-14 place-items-center rounded-full bg-kd-danger-soft text-2xl">
            ⚠️
          </div>
          <h2 className="text-kd-title font-bold text-kd-fg">Couldn&apos;t load restaurants</h2>
          <p className="mt-1 max-w-xs text-sm text-kd-fg-muted">
            Check your connection and try again — your cravings aren&apos;t going anywhere.
          </p>
          <Button
            variant="brand"
            className="mt-4"
            onClick={() => refetch({ requestPolicy: "network-only" })}
          >
            Try again
          </Button>
        </GlassPanel>
      )}

      {data && (
        <>
          {/* Cuisine rail */}
          <CuisineRail
            cuisines={availableCuisines}
            active={effectiveCuisine}
            onSelect={setActiveCuisine}
          />

          <ActiveFilterChips filter={filter} onFilterChange={setFilter} />

          {/* Rich extras only when not filtering/searching AND something delivers here —
              promos/reorder link into restaurants, so they'd dead-end in an empty area. */}
          {!filtering && hits.length > 0 && (
            <>
              {banners.length > 0 && <PromoCarousel banners={banners} />}
              <OrderAgainRow targets={reorderTargets} />
              {/* Gamified deals / rewards / habit loops (#134). Skeleton on first fetch;
                  the rail hides itself when the server returns no cards. */}
              {loggedIn &&
                (engagementData ? (
                  <EngagementRail cards={engagementCards} />
                ) : engagementFetching ? (
                  <EngagementRailSkeleton />
                ) : null)}
              {promoted.length > 0 && (
                <section className="space-y-3">
                  <h2 className="text-kd-heading font-extrabold tracking-tight text-kd-fg">
                    Promoted
                  </h2>
                  <div className="-mx-4 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    <div className="flex gap-4">
                      {promoted.map((hit) => (
                        <RestaurantMiniCard key={hit.branchId} hit={hit} />
                      ))}
                    </div>
                  </div>
                </section>
              )}
              {topRated.length > 0 && (
                <section className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h2 className="text-kd-heading font-extrabold tracking-tight text-kd-fg">
                      Top rated near you
                    </h2>
                    <button
                      type="button"
                      onClick={() => setSort("rating")}
                      className="flex items-center gap-0.5 text-sm font-semibold text-kd-primary hover:underline"
                    >
                      View all <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {topRated.slice(0, 6).map((hit) => (
                      <RestaurantRowCard key={hit.branchId} hit={hit} />
                    ))}
                  </div>
                </section>
              )}
              <Swimlane title="Free delivery" hits={freeDelivery} />
            </>
          )}

          {/* Empty. A genuinely empty area (no server filters, no results) gets the
              waitlist; zero results *because of* filters gets a clear-filters prompt. */}
          {hits.length === 0 && !serverFiltering ? (
            <EmptyState label={loc.label} lat={loc.lat} lng={loc.lng} />
          ) : (
            <section className="space-y-3">
              <h2 className="text-kd-heading font-extrabold tracking-tight text-kd-fg">
                {filtering
                  ? `${feed.length} result${feed.length === 1 ? "" : "s"}`
                  : "All restaurants"}
              </h2>
              {feed.length === 0 ? (
                <GlassPanel className="flex flex-col items-center px-4 py-10 text-center">
                  <div className="text-3xl">🔍</div>
                  <p className="mt-2 text-sm font-medium text-kd-fg">
                    No restaurants match — try clearing filters.
                  </p>
                  {(serverFiltering || effectiveCuisine !== null || search.trim().length > 0) && (
                    <Button
                      variant="outline"
                      className="mt-4"
                      onClick={() => {
                        setFilter(EMPTY_FILTER);
                        setSort("relevance");
                        setActiveCuisine(null);
                        setSearch("");
                      }}
                    >
                      Clear filters
                    </Button>
                  )}
                </GlassPanel>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {feed.map((hit) => (
                    <RestaurantCard key={hit.branchId} hit={hit} />
                  ))}
                </div>
              )}
            </section>
          )}
        </>
      )}
    </main>
  );
}

function EmptyState({ label, lat, lng }: { label: string; lat: number; lng: number }) {
  const [email, setEmail] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [{ fetching }, joinWaitlist] = useMutation(JoinWaitlistMutation);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const value = email.trim();
    if (!value) return;
    const result = await joinWaitlist({ email: value, areaLabel: label, lat, lng });
    if (result.error || !result.data?.joinWaitlist) {
      setError(
        result.error?.graphQLErrors[0]?.message ?? "Couldn't add you to the waitlist. Try again.",
      );
      return;
    }
    setDone(true);
  }

  return (
    <GlassPanel variant="strong" className="p-8 text-center">
      <div className="text-4xl">🛵</div>
      <h2 className="mt-3 text-lg font-bold text-kd-fg">No restaurants deliver to {label} yet</h2>
      <p className="mt-1 text-sm text-kd-fg-muted">
        We&apos;re expanding fast. Leave your email and we&apos;ll tell you when we reach you.
      </p>
      {done ? (
        <p className="mt-4 text-sm font-medium text-kd-success">
          Thanks — we&apos;ll be in touch! 🎉
        </p>
      ) : (
        <>
          <form className="mx-auto mt-4 flex max-w-sm gap-2" onSubmit={onSubmit}>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@email.com"
              className="min-w-0 flex-1 rounded-xl border border-kd-border bg-kd-surface px-3 py-2 text-sm text-kd-fg outline-none placeholder:text-kd-fg-subtle focus:border-kd-primary focus:ring-2 focus:ring-kd-primary-soft"
            />
            <Button type="submit" disabled={fetching}>
              {fetching ? "Adding…" : "Notify me"}
            </Button>
          </form>
          {error && <p className="mt-3 text-sm text-kd-danger">{error}</p>}
        </>
      )}
    </GlassPanel>
  );
}
