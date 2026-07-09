"use client";

import Link from "next/link";
import { useQuery } from "urql";
import { MapPin, Star, Timer } from "lucide-react";
import { graphql } from "@/graphql/generated";
import { formatRs } from "@fd/shared";
import { useDeliveryLocation } from "@/lib/location";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { RestaurantImage } from "@/components/media/RestaurantImage";

const BrowseQuery = graphql(`
  query Browse($lat: Float!, $lng: Float!) {
    browseBranches(lat: $lat, lng: $lng) {
      distanceM
      etaMinutes
      branch {
        id
        name
        minOrderMinor
        deliveryFeeMinor
        isAcceptingOrders
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
          theme {
            primaryColor
          }
        }
      }
    }
  }
`);

export default function HomePage() {
  if (typeof window !== "undefined") {
    // eslint-disable-next-line no-console
    console.log(
      "BQ_DEBUG",
      JSON.stringify({
        t: typeof BrowseQuery,
        kind: (BrowseQuery as { kind?: string })?.kind,
        hasDefs: Array.isArray((BrowseQuery as { definitions?: unknown[] })?.definitions),
        keys: Object.keys(BrowseQuery ?? {}),
      }),
    );
  }
  const loc = useDeliveryLocation();
  const [{ data, fetching, error }] = useQuery({
    query: BrowseQuery,
    variables: { lat: loc.lat, lng: loc.lng },
  });

  return (
    <main>
      <div className="mb-6 flex items-center gap-2 text-sm text-neutral-600">
        <MapPin className="h-4 w-4 text-rose-600" />
        Delivering to <span className="font-medium text-neutral-900">{loc.label}</span>
      </div>

      <h1 className="mb-4 text-2xl font-bold text-neutral-900">Restaurants near you</h1>

      {fetching && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-40 rounded-2xl" />
          ))}
        </div>
      )}

      {error && <p className="text-sm text-red-600">Could not load restaurants. Is the API up?</p>}

      {data && data.browseBranches.length === 0 && (
        <p className="text-neutral-500">No restaurants deliver to this location yet.</p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {data?.browseBranches.map((hit) => {
          const r = hit.branch.restaurant;
          return (
            <Link key={hit.branch.id} href={`/r/${r.slug}`}>
              <Card className="group h-full overflow-hidden rounded-2xl border-neutral-200 transition-shadow hover:shadow-md">
                <div className="relative">
                  <RestaurantImage
                    photo={hit.branch.photo}
                    name={r.name}
                    tint={r.theme?.primaryColor}
                    className="h-32 w-full transition-transform duration-300 group-hover:scale-[1.03]"
                  />
                  <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/55 to-transparent" />
                  <span className="absolute bottom-2 left-4 text-lg font-bold text-white drop-shadow">
                    {r.name}
                  </span>
                </div>
                <CardContent className="space-y-2 p-4">
                  <div className="flex items-center gap-3 text-sm text-neutral-600">
                    <span className="flex items-center gap-1">
                      <Timer className="h-4 w-4" /> {hit.etaMinutes}–{hit.etaMinutes + 10} min
                    </span>
                    {r.avgRating != null && (
                      <span className="flex items-center gap-1">
                        <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
                        {r.avgRating.toFixed(1)} ({r.ratingCount})
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500">
                    <span>Min {formatRs(hit.branch.minOrderMinor)}</span>
                    <span>·</span>
                    <span>Delivery {formatRs(hit.branch.deliveryFeeMinor)}</span>
                    <span>·</span>
                    <span>{(hit.distanceM / 1000).toFixed(1)} km</span>
                  </div>
                  <div className="flex gap-2">
                    {!hit.branch.isAcceptingOrders && <Badge variant="secondary">Paused</Badge>}
                    <Badge variant="outline">Delivered by restaurant</Badge>
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </main>
  );
}
