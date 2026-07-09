"use client";

import { RestaurantMiniCard } from "./RestaurantCard";
import type { FeedHit } from "./types";

/** A titled horizontally-scrolling row of compact restaurant cards. Renders nothing
 *  when it has fewer than 2 items (keeps thin/duplicate lanes off the page). */
export function Swimlane({ title, hits }: { title: string; hits: FeedHit[] }) {
  if (hits.length < 2) return null;
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-bold text-neutral-900">{title}</h2>
      <div className="-mx-4 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="flex gap-4">
          {hits.map((hit) => (
            <RestaurantMiniCard key={hit.branchId} hit={hit} />
          ))}
        </div>
      </div>
    </section>
  );
}
