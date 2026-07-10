"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "urql";
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

const JoinWaitlistMutation = graphql(`
  mutation JoinWaitlist($email: String!, $areaLabel: String, $lat: Float, $lng: Float) {
    joinWaitlist(email: $email, areaLabel: $areaLabel, lat: $lat, lng: $lng) {
      id
      email
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

  // If the selected cuisine is no longer offered nearby (e.g. after a location
  // change), fall back to "All" by deriving it — never filter on a stale value
  // that would strand the feed empty and hide the tag from the rail.
  const effectiveCuisine =
    activeCuisine && (availableCuisines as readonly string[]).includes(activeCuisine)
      ? activeCuisine
      : null;

  const filtering = effectiveCuisine !== null || search.trim().length > 0;

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
      )
      .sort(rank);
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

  return (
    <main className="space-y-6">
      {/* Top bar: address + search */}
      <div className="space-y-3">
        <AddressChip />
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-kd-fg-subtle" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search for restaurants or cuisines…"
            className="w-full rounded-xl border border-kd-border bg-kd-surface py-2.5 pl-9 pr-9 text-sm text-kd-fg outline-none placeholder:text-kd-fg-subtle focus:border-kd-primary focus:ring-2 focus:ring-kd-primary-soft"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              aria-label="Clear search"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-kd-fg-subtle hover:bg-kd-surface-muted"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {!online && (
        <div className="flex items-center gap-2 rounded-xl bg-kd-warning-soft px-3 py-2 text-sm text-kd-warning">
          <WifiOff className="h-4 w-4" />
          You&apos;re offline — showing the last loaded restaurants.
        </div>
      )}

      {/* Loading */}
      {fetching && !data && <HomeSkeleton />}

      {/* Error */}
      {error && !data && (
        <div className="rounded-2xl border border-kd-danger-soft bg-kd-danger-soft p-6 text-center">
          <p className="text-sm text-kd-danger">Couldn&apos;t load restaurants.</p>
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
            active={effectiveCuisine}
            onSelect={setActiveCuisine}
          />

          {/* Rich extras only when not filtering/searching AND something delivers here —
              promos/reorder link into restaurants, so they'd dead-end in an empty area. */}
          {!filtering && hits.length > 0 && (
            <>
              {banners.length > 0 && <PromoCarousel banners={banners} />}
              <OrderAgainRow targets={reorderTargets} />
              <Swimlane title="Top rated near you" hits={topRated} />
              <Swimlane title="Free delivery" hits={freeDelivery} />
            </>
          )}

          {/* Empty */}
          {hits.length === 0 ? (
            <EmptyState label={loc.label} lat={loc.lat} lng={loc.lng} />
          ) : (
            <section className="space-y-3">
              <h2 className="text-lg font-bold text-kd-fg">
                {filtering
                  ? `${feed.length} result${feed.length === 1 ? "" : "s"}`
                  : "All restaurants"}
              </h2>
              {feed.length === 0 ? (
                <p className="rounded-xl bg-kd-surface-muted px-4 py-6 text-center text-sm text-kd-fg-muted">
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
    <div className="rounded-2xl border border-kd-border bg-kd-surface p-8 text-center">
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
    </div>
  );
}
