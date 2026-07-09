"use client";

import { useMemo, useState } from "react";
import { useQuery } from "urql";
import { Search, WifiOff, X } from "lucide-react";
import { CUISINE_TAGS } from "@fd/shared";
import { graphql } from "@/graphql/generated";
import { useDeliveryLocation } from "@/lib/location";
import { AddressChip } from "@/components/home/AddressChip";
import { CuisineRail } from "@/components/home/CuisineRail";
import { PromoCarousel } from "@/components/home/PromoCarousel";
import { OrderAgainRow, type ReorderTarget } from "@/components/home/OrderAgainRow";
import { RestaurantCard } from "@/components/home/RestaurantCard";
import { Swimlane } from "@/components/home/Swimlane";
import { HomeSkeleton } from "@/components/home/HomeSkeleton";
import { useOnlineStatus, useScrollRestoration } from "@/components/home/hooks";
import { Button } from "@/components/ui/button";
import type { FeedHit } from "@/components/home/types";

const HomeQuery = graphql(`
  query Home($lat: Float!, $lng: Float!) {
    homeBanners {
      id
      title
      imageUrl
      linkHref
    }
    browseBranches(lat: $lat, lng: $lng) {
      distanceM
      etaMinutes
      branch {
        id
        minOrderMinor
        deliveryFeeMinor
        isAcceptingOrders
        isOpenNow
        opensAtLabel
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
          theme {
            primaryColor
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

// Ranking v1: open & accepting first, then nearest (browseBranches is already
// distance-sorted). Promoted slots hook in later (#22).
function rank(a: FeedHit, b: FeedHit): number {
  const openA = a.isOpenNow && a.isAcceptingOrders;
  const openB = b.isOpenNow && b.isAcceptingOrders;
  if (openA !== openB) return openA ? -1 : 1;
  return a.distanceM - b.distanceM;
}

export default function HomePage() {
  const loc = useDeliveryLocation();
  const online = useOnlineStatus();
  useScrollRestoration("home-feed");

  const [{ data, fetching, error }, refetch] = useQuery({
    query: HomeQuery,
    variables: { lat: loc.lat, lng: loc.lng },
  });
  const [{ data: viewerData }] = useQuery({ query: HomeViewerQuery });
  const loggedIn = Boolean(viewerData?.viewer?.user?.id);
  const [{ data: reorderData }] = useQuery({ query: OrderAgainQuery, pause: !loggedIn });

  const [activeCuisine, setActiveCuisine] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const hits: FeedHit[] = useMemo(
    () =>
      (data?.browseBranches ?? []).map((h) => ({
        branchId: h.branch.id,
        distanceM: h.distanceM,
        etaMinutes: h.etaMinutes,
        minOrderMinor: h.branch.minOrderMinor,
        deliveryFeeMinor: h.branch.deliveryFeeMinor,
        isAcceptingOrders: h.branch.isAcceptingOrders,
        isOpenNow: h.branch.isOpenNow,
        opensAtLabel: h.branch.opensAtLabel ?? null,
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
        },
      })),
    [data],
  );

  // Cuisines present in the feed, ordered by the platform taxonomy.
  const availableCuisines = useMemo(() => {
    const present = new Set(hits.flatMap((h) => h.restaurant.cuisineTags));
    return CUISINE_TAGS.filter((c) => present.has(c));
  }, [hits]);

  const filtering = activeCuisine !== null || search.trim().length > 0;

  const feed = useMemo(() => {
    const q = search.trim().toLowerCase();
    return hits
      .filter((h) => (activeCuisine ? h.restaurant.cuisineTags.includes(activeCuisine) : true))
      .filter((h) =>
        q
          ? h.restaurant.name.toLowerCase().includes(q) ||
            h.restaurant.cuisineTags.some((c) => c.toLowerCase().includes(q))
          : true,
      )
      .sort(rank);
  }, [hits, activeCuisine, search]);

  const topRated = useMemo(
    () =>
      [...hits]
        .filter((h) => h.restaurant.avgRating != null)
        .sort((a, b) => (b.restaurant.avgRating ?? 0) - (a.restaurant.avgRating ?? 0))
        .slice(0, 10),
    [hits],
  );
  const freeDelivery = useMemo(() => hits.filter((h) => h.deliveryFeeMinor === 0), [hits]);

  const reorderTargets: ReorderTarget[] = useMemo(() => {
    const seen = new Set<string>();
    const out: ReorderTarget[] = [];
    for (const o of reorderData?.myOrders ?? []) {
      const r = o.branch.restaurant;
      if (seen.has(r.slug)) continue;
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
  }, [reorderData]);

  return (
    <main className="space-y-6">
      {/* Top bar: address + search */}
      <div className="space-y-3">
        <AddressChip />
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search for restaurants or cuisines…"
            className="w-full rounded-xl border border-neutral-200 bg-white py-2.5 pl-9 pr-9 text-sm text-neutral-900 outline-none placeholder:text-neutral-400 focus:border-rose-300 focus:ring-2 focus:ring-rose-100"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              aria-label="Clear search"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-neutral-400 hover:bg-neutral-100"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {!online && (
        <div className="flex items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <WifiOff className="h-4 w-4" />
          You&apos;re offline — showing the last loaded restaurants.
        </div>
      )}

      {/* Loading */}
      {fetching && !data && <HomeSkeleton />}

      {/* Error */}
      {error && !data && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center">
          <p className="text-sm text-red-700">Couldn&apos;t load restaurants.</p>
          <Button
            variant="outline"
            className="mt-3"
            onClick={() => refetch({ requestPolicy: "network-only" })}
          >
            Try again
          </Button>
        </div>
      )}

      {data && (
        <>
          {/* Cuisine rail */}
          <CuisineRail
            cuisines={availableCuisines}
            active={activeCuisine}
            onSelect={setActiveCuisine}
          />

          {/* Rich extras only when not actively filtering/searching */}
          {!filtering && (
            <>
              {data.homeBanners.length > 0 && <PromoCarousel banners={data.homeBanners} />}
              <OrderAgainRow targets={reorderTargets} />
              <Swimlane title="Top rated near you" hits={topRated} />
              <Swimlane title="Free delivery" hits={freeDelivery} />
            </>
          )}

          {/* Empty */}
          {hits.length === 0 ? (
            <EmptyState label={loc.label} />
          ) : (
            <section className="space-y-3">
              <h2 className="text-lg font-bold text-neutral-900">
                {filtering
                  ? `${feed.length} result${feed.length === 1 ? "" : "s"}`
                  : "All restaurants"}
              </h2>
              {feed.length === 0 ? (
                <p className="rounded-xl bg-neutral-100 px-4 py-6 text-center text-sm text-neutral-500">
                  Nothing matches that filter. Try another cuisine or search term.
                </p>
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

function EmptyState({ label }: { label: string }) {
  const [email, setEmail] = useState("");
  const [done, setDone] = useState(false);
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-8 text-center">
      <div className="text-4xl">🛵</div>
      <h2 className="mt-3 text-lg font-bold text-neutral-900">
        No restaurants deliver to {label} yet
      </h2>
      <p className="mt-1 text-sm text-neutral-500">
        We&apos;re expanding fast. Leave your email and we&apos;ll tell you when we reach you.
      </p>
      {done ? (
        <p className="mt-4 text-sm font-medium text-emerald-600">
          Thanks — we&apos;ll be in touch! 🎉
        </p>
      ) : (
        <form
          className="mx-auto mt-4 flex max-w-sm gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (email.trim()) setDone(true);
          }}
        >
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@email.com"
            className="min-w-0 flex-1 rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm outline-none focus:border-rose-300 focus:ring-2 focus:ring-rose-100"
          />
          <Button type="submit">Notify me</Button>
        </form>
      )}
    </div>
  );
}
