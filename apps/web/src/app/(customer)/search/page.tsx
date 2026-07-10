"use client";

// Dedicated search screen (#37, Foodpanda benchmark). Debounced input (250ms)
// drives searchMarketplace(query, lat, lng); results are tabbed Restaurants / Dishes.
// Idle state shows deletable recents + popular chips; dish rows deep-link into
// /r/[slug]?item=<id> (the restaurant page auto-opens that item's sheet). Zero-result
// state suggests broadening and links back to the full nearby feed — never a dead end.
import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "urql";
import { ArrowLeft, Clock, Search, Star, X } from "lucide-react";
import { formatRs } from "@fd/shared";
import { graphql } from "@/graphql/generated";
import { useDeliveryLocation } from "@/lib/location";
import { RestaurantImage } from "@/components/media/RestaurantImage";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useRecentSearches } from "./use-recent-searches";

// Editorial defaults — no analytics backing yet, so a curated list of common cravings.
// Terms must match real data: cuisine tags are matched exactly (e.g. the seed uses the
// "BBQ/Karahi" tag), and dish names match via `contains`, so a bare "BBQ" chip would
// land on a zero-result state.
const POPULAR_SEARCHES = ["Biryani", "Pizza", "Burger", "Karahi", "BBQ/Karahi", "Desserts", "Chinese"];

const SearchQuery = graphql(`
  query SearchMarketplace($query: String!, $lat: Float!, $lng: Float!) {
    searchMarketplace(query: $query, lat: $lat, lng: $lng) {
      restaurants {
        distanceM
        etaMinutes
        branch {
          id
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
            avgRating
            ratingCount
            cuisineTags
            theme {
              primaryColor
            }
          }
        }
      }
      items {
        distanceM
        item {
          id
          name
          priceMinor
          imageUrl
        }
        branch {
          id
          restaurant {
            name
            slug
            theme {
              primaryColor
            }
          }
        }
      }
    }
  }
`);

type Tab = "restaurants" | "dishes";

export default function SearchPage() {
  return (
    <Suspense fallback={<SearchSkeleton />}>
      <SearchScreen />
    </Suspense>
  );
}

function SearchScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const loc = useDeliveryLocation();
  const { recents, add, remove, clear } = useRecentSearches();

  const initial = params.get("q") ?? "";
  const [input, setInput] = useState(initial);
  const [debounced, setDebounced] = useState(initial);
  // null = follow the auto-pick (whichever tab has hits); a value = user's explicit choice.
  const [tabChoice, setTabChoice] = useState<Tab | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Autofocus so the keyboard is ready the moment the screen opens.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Debounce the input by 250ms before it hits the network / URL. A new term also
  // clears any manual tab pick so the auto-pick applies to the fresh results.
  useEffect(() => {
    const id = setTimeout(() => {
      setDebounced(input);
      setTabChoice(null);
    }, 250);
    return () => clearTimeout(id);
  }, [input]);

  // Keep ?q= in sync (shareable/back-button-friendly) without spamming history.
  useEffect(() => {
    const q = debounced.trim();
    router.replace(q ? `/search?q=${encodeURIComponent(q)}` : "/search", { scroll: false });
  }, [debounced, router]);

  // Commit a recent search only on an explicit intent (Enter, blur, or picking a
  // chip) — never on every keystroke, so the list stays a set of real queries.
  function commit(term: string) {
    if (term.trim().length >= 2) add(term);
  }

  const term = debounced.trim();
  const active = term.length >= 2;

  const [{ data, fetching }] = useQuery({
    query: SearchQuery,
    variables: { query: term, lat: loc.lat, lng: loc.lng },
    pause: !active,
  });

  const restaurants = data?.searchMarketplace.restaurants ?? [];
  const dishes = data?.searchMarketplace.items ?? [];
  const hasResults = restaurants.length > 0 || dishes.length > 0;

  // Auto-pick the tab with hits (prefer restaurants) unless the user chose one.
  const autoTab: Tab = restaurants.length === 0 && dishes.length > 0 ? "dishes" : "restaurants";
  const tab = tabChoice ?? autoTab;

  const showIdle = !active;
  const showSkeleton = active && fetching && !data;
  const showZero = active && !fetching && data != null && !hasResults;

  return (
    <main className="space-y-5">
      {/* Search bar */}
      <div className="flex items-center gap-2">
        <Link
          href="/"
          aria-label="Back"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-kd-fg-muted hover:bg-kd-surface-muted"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <form
          role="search"
          className="relative flex-1"
          onSubmit={(e) => {
            e.preventDefault();
            commit(input);
            inputRef.current?.blur();
          }}
        >
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-kd-fg-subtle" />
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onBlur={() => commit(input)}
            placeholder="Search restaurants or dishes…"
            aria-label="Search restaurants or dishes"
            className="w-full rounded-xl border border-kd-border bg-kd-surface py-2.5 pl-9 pr-9 text-sm text-kd-fg outline-none placeholder:text-kd-fg-subtle focus:border-kd-primary focus:ring-2 focus:ring-kd-primary-soft"
          />
          {input && (
            <button
              type="button"
              onClick={() => {
                setInput("");
                inputRef.current?.focus();
              }}
              aria-label="Clear search"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-kd-fg-subtle hover:bg-kd-surface-muted"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </form>
      </div>

      {showIdle && (
        <IdleState
          recents={recents}
          popular={POPULAR_SEARCHES}
          onPick={(t) => {
            setInput(t);
            commit(t);
            inputRef.current?.focus();
          }}
          onRemove={remove}
          onClear={clear}
        />
      )}

      {showSkeleton && <ResultsSkeleton />}

      {active && data && hasResults && (
        <>
          <div className="flex gap-1 border-b border-kd-border">
            <TabButton active={tab === "restaurants"} onClick={() => setTabChoice("restaurants")}>
              Restaurants ({restaurants.length})
            </TabButton>
            <TabButton active={tab === "dishes"} onClick={() => setTabChoice("dishes")}>
              Dishes ({dishes.length})
            </TabButton>
          </div>

          {tab === "restaurants" &&
            (restaurants.length > 0 ? (
              <ul className="space-y-2">
                {restaurants.map((hit) => (
                  <RestaurantRow key={hit.branch.id} hit={hit} />
                ))}
              </ul>
            ) : (
              <p className="px-1 py-6 text-center text-sm text-kd-fg-muted">
                No restaurants match. Try the Dishes tab.
              </p>
            ))}

          {tab === "dishes" &&
            (dishes.length > 0 ? (
              <ul className="space-y-2">
                {dishes.map((hit) => (
                  <DishRow key={`${hit.branch.id}-${hit.item.id}`} hit={hit} />
                ))}
              </ul>
            ) : (
              <p className="px-1 py-6 text-center text-sm text-kd-fg-muted">
                No dishes match. Try the Restaurants tab.
              </p>
            ))}
        </>
      )}

      {showZero && <ZeroState term={term} onClear={() => setInput("")} />}
    </main>
  );
}

type BranchShape = {
  id: string;
  deliveryFeeMinor: number;
  isAcceptingOrders: boolean;
  isOpenNow: boolean;
  opensAtLabel?: string | null;
  photo?: { url: string; source: string; attributionHtml?: string | null } | null;
  restaurant: {
    id: string;
    name: string;
    slug: string;
    avgRating?: number | null;
    ratingCount: number;
    cuisineTags: string[];
    theme?: { primaryColor: string } | null;
  };
};

function RestaurantRow({
  hit,
}: {
  hit: { distanceM: number; etaMinutes: number; branch: BranchShape };
}) {
  const r = hit.branch.restaurant;
  // Unavailable if outside opening hours OR manually paused — mirror the home/restaurant
  // pages so search never shows a normal ETA row for a branch that can't take orders.
  const closed = !hit.branch.isOpenNow || !hit.branch.isAcceptingOrders;
  return (
    <li>
      <Link
        href={`/r/${r.slug}`}
        className="flex items-center gap-3 rounded-2xl border border-kd-border bg-kd-surface p-2.5 transition-colors hover:bg-kd-surface-muted"
      >
        <RestaurantImage
          photo={hit.branch.photo ?? null}
          name={r.name}
          tint={r.theme?.primaryColor ?? null}
          className="h-16 w-16 shrink-0 rounded-xl"
          sizes="64px"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-kd-fg">{r.name}</p>
          {r.cuisineTags.length > 0 && (
            <p className="truncate text-sm text-kd-fg-muted">{r.cuisineTags.join(" · ")}</p>
          )}
          <div className="mt-0.5 flex items-center gap-2 text-xs text-kd-fg-muted tabular-nums">
            {r.avgRating != null && (
              <span className="flex items-center gap-0.5">
                <Star className="h-3 w-3 fill-kd-accent text-kd-accent" />
                {r.avgRating.toFixed(1)}
              </span>
            )}
            <span className="flex items-center gap-0.5">
              <Clock className="h-3 w-3" /> {hit.etaMinutes}–{hit.etaMinutes + 10} min
            </span>
            <span>· {(hit.distanceM / 1000).toFixed(1)} km</span>
            {closed && <span className="font-semibold text-kd-danger">· Closed</span>}
          </div>
        </div>
      </Link>
    </li>
  );
}

type DishHit = {
  distanceM: number;
  item: { id: string; name: string; priceMinor: number; imageUrl?: string | null };
  branch: { id: string; restaurant: { name: string; slug: string; theme?: { primaryColor: string } | null } };
};

function DishRow({ hit }: { hit: DishHit }) {
  const r = hit.branch.restaurant;
  return (
    <li>
      {/* Deep-link opens the exact item sheet on the restaurant page (?item=<id>). */}
      <Link
        href={`/r/${r.slug}?item=${encodeURIComponent(hit.item.id)}`}
        className="flex items-center gap-3 rounded-2xl border border-kd-border bg-kd-surface p-2.5 transition-colors hover:bg-kd-surface-muted"
      >
        <RestaurantImage
          photo={hit.item.imageUrl ? { url: hit.item.imageUrl, source: "uploaded" } : null}
          name={hit.item.name}
          className="h-16 w-16 shrink-0 rounded-xl"
          sizes="64px"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-kd-fg">{hit.item.name}</p>
          <p className="truncate text-sm text-kd-fg-muted">{r.name}</p>
          <p className="mt-0.5 text-sm font-medium text-kd-fg tabular-nums">
            {formatRs(hit.item.priceMinor)}
          </p>
        </div>
      </Link>
    </li>
  );
}

function IdleState({
  recents,
  popular,
  onPick,
  onRemove,
  onClear,
}: {
  recents: string[];
  popular: string[];
  onPick: (term: string) => void;
  onRemove: (term: string) => void;
  onClear: () => void;
}) {
  return (
    <div className="space-y-6">
      {recents.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-kd-fg">Recent searches</h2>
            <button
              type="button"
              onClick={onClear}
              className="text-xs font-medium text-kd-fg-muted hover:text-kd-fg"
            >
              Clear all
            </button>
          </div>
          <ul className="space-y-1">
            {recents.map((term) => (
              <li key={term} className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => onPick(term)}
                  className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1 py-1.5 text-left text-sm text-kd-fg hover:bg-kd-surface-muted"
                >
                  <Clock className="h-4 w-4 shrink-0 text-kd-fg-subtle" />
                  <span className="truncate">{term}</span>
                </button>
                <button
                  type="button"
                  onClick={() => onRemove(term)}
                  aria-label={`Remove ${term}`}
                  className="rounded-full p-1 text-kd-fg-subtle hover:bg-kd-surface-muted"
                >
                  <X className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-kd-fg">Popular searches</h2>
        <div className="flex flex-wrap gap-2">
          {popular.map((term) => (
            <button
              key={term}
              type="button"
              onClick={() => onPick(term)}
              className="rounded-full border border-kd-border bg-kd-surface px-3 py-1.5 text-sm text-kd-fg hover:border-kd-primary hover:text-kd-primary"
            >
              {term}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function ZeroState({ term, onClear }: { term: string; onClear: () => void }) {
  return (
    <div className="rounded-2xl border border-kd-border bg-kd-surface p-8 text-center">
      <div className="text-4xl">🔍</div>
      <h2 className="mt-3 text-lg font-bold text-kd-fg">No matches for “{term}”</h2>
      <p className="mt-1 text-sm text-kd-fg-muted">
        Try a shorter or different term — or browse everything that delivers to you.
      </p>
      <div className="mt-4 flex justify-center gap-2">
        <Button variant="outline" onClick={onClear}>
          Clear search
        </Button>
        <Link href="/" className={buttonVariants({ variant: "default" })}>
          Browse all restaurants
        </Link>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? "-mb-px border-b-2 border-kd-primary px-3 py-2 text-sm font-semibold text-kd-fg"
          : "-mb-px border-b-2 border-transparent px-3 py-2 text-sm font-medium text-kd-fg-muted hover:text-kd-fg"
      }
    >
      {children}
    </button>
  );
}

function ResultsSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-2xl border border-kd-border p-2.5">
          <Skeleton className="h-16 w-16 shrink-0 rounded-xl" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

function SearchSkeleton() {
  return (
    <main className="space-y-5">
      <Skeleton className="h-10 w-full rounded-xl" />
      <ResultsSkeleton />
    </main>
  );
}
