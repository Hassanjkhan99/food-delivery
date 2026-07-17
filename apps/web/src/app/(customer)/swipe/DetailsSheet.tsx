"use client";

// Swipe-up (or tap the ⬆ action button) bottom sheet: the restaurant's summary plus its
// popular items, with the same "Add" affordance the card itself offers. onAdd re-enters
// the parent's tryAdd flow (which may still route to the conflict dialog or modifier
// sheet) rather than committing directly — this sheet doesn't know cart state.
import { Star } from "lucide-react";
import { formatRs } from "@fd/shared";
import { RestaurantImage } from "@/components/media/RestaurantImage";
import { restaurantCoverPlaceholder, itemImagePlaceholder } from "@/components/media/placeholders";
import { ItemImage } from "@/components/media/ItemImage";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { swipeAvailability, type SwipeHit } from "./types";

export function DetailsSheet({
  hit,
  onClose,
  onAdd,
}: {
  hit: SwipeHit | null;
  onClose: () => void;
  onAdd: () => void;
}) {
  const r = hit?.restaurant;
  const featured = hit?.popularItems[0];
  const avail = hit ? swipeAvailability(hit) : null;

  return (
    <Sheet open={!!hit} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="bottom" className="max-h-[88vh] gap-0 rounded-t-3xl p-0">
        {hit && r && (
          <>
            <RestaurantImage
              photo={hit.photo}
              name={r.name}
              tint={r.primaryColor}
              fallbackSrc={restaurantCoverPlaceholder(r.cuisineTags)}
              className="h-40 w-full flex-none rounded-t-3xl"
            />
            <div className="flex-1 overflow-y-auto px-5 pb-6 pt-4">
              <h2 className="text-xl font-bold tracking-tight text-kd-fg">{r.name}</h2>
              <div className="mt-1.5 flex items-center gap-2 text-sm tabular-nums text-kd-fg-muted">
                <span className="flex items-center gap-1 font-bold text-kd-fg">
                  <Star className="h-3.5 w-3.5 fill-kd-accent text-kd-accent" />
                  {r.avgRating != null ? r.avgRating.toFixed(1) : "New"}
                  {r.avgRating != null && (
                    <span className="font-medium text-kd-fg-muted">
                      ({r.ratingCount.toLocaleString("en-US")})
                    </span>
                  )}
                </span>
                <span className="text-kd-fg-subtle">·</span>
                <span>
                  {hit.etaMinutes}–{hit.etaMinutes + 10} min
                </span>
                <span className="text-kd-fg-subtle">·</span>
                <span>{(hit.distanceM / 1000).toFixed(1)} km</span>
              </div>
              <p className="mt-3 text-sm text-kd-fg-muted">{r.cuisineTags.join(" · ")}</p>

              <div className="my-4 h-px bg-kd-border" />
              <p className="mb-2.5 text-[11px] font-bold uppercase tracking-wide text-kd-fg-subtle">
                Popular items
              </p>
              <div className="flex flex-col gap-3">
                {hit.popularItems.slice(0, 5).map((item) => (
                  <div key={item.id} className="flex items-center gap-3">
                    <ItemImage
                      url={item.imageUrl}
                      name={item.name}
                      fallbackSrc={itemImagePlaceholder(r.cuisineTags)}
                      className="h-9 w-9 rounded-lg"
                      sizes="36px"
                    />
                    <span className="flex-1 truncate text-sm font-medium text-kd-fg">
                      {item.name}
                    </span>
                    <span className="text-sm font-semibold tabular-nums text-kd-fg-muted">
                      {formatRs(item.priceMinor)}
                    </span>
                  </div>
                ))}
              </div>

              {featured && avail && (
                <Button
                  variant={avail.closed ? "secondary" : "brand"}
                  disabled={avail.closed}
                  onClick={onAdd}
                  className="mt-5 w-full py-6 text-base"
                >
                  {avail.closed
                    ? avail.label
                    : `Add ${featured.name} · ${formatRs(featured.priceMinor)}`}
                </Button>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
