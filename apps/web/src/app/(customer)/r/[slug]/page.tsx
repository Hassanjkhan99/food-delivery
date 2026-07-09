"use client";

import { use, useMemo, useState } from "react";
import { useQuery } from "urql";
import { Star, Timer } from "lucide-react";
import { graphql } from "@/graphql/generated";
import { formatRs } from "@fd/shared";
import { useCart } from "@/lib/cart";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ItemModal, type MenuItemForModal } from "./item-modal";

const BranchQuery = graphql(`
  query BranchDetail($slug: String!) {
    branchBySlug(slug: $slug) {
      id
      name
      addressText
      minOrderMinor
      deliveryFeeMinor
      isAcceptingOrders
      restaurant {
        id
        name
        slug
        avgRating
        ratingCount
        theme {
          primaryColor
          accentColor
          backgroundColor
          textColor
        }
      }
      activeMenu {
        id
        layoutJson
        categories {
          id
          name
          description
          items {
            id
            name
            description
            priceMinor
            isAvailable
            badges
            modifierGroups {
              id
              name
              minSelect
              maxSelect
              options {
                id
                name
                priceDeltaMinor
                isAvailable
              }
            }
          }
        }
      }
    }
  }
`);

export default function RestaurantPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const [{ data, fetching }] = useQuery({ query: BranchQuery, variables: { slug } });
  const [openItem, setOpenItem] = useState<MenuItemForModal | null>(null);
  const branch = data?.branchBySlug;

  const categories = useMemo(() => branch?.activeMenu?.categories ?? [], [branch]);

  if (fetching) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 rounded-2xl" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    );
  }
  if (!branch) return <p className="text-neutral-500">Restaurant not found.</p>;

  const r = branch.restaurant;
  const primary = r.theme?.primaryColor ?? "#171717";

  return (
    <main>
      {/* Hero — themed 3D treatment lands in M7; flat brand band for now */}
      <div
        className="mb-6 rounded-2xl p-6"
        style={{ background: `linear-gradient(120deg, ${primary}22, ${primary}08)` }}
      >
        <h1 className="text-3xl font-bold" style={{ color: primary }}>
          {r.name}
        </h1>
        <p className="mt-1 text-sm text-neutral-600">{branch.addressText}</p>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-neutral-700">
          {r.avgRating != null && (
            <span className="flex items-center gap-1">
              <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
              {r.avgRating.toFixed(1)} ({r.ratingCount})
            </span>
          )}
          <span className="flex items-center gap-1">
            <Timer className="h-4 w-4" /> Min order {formatRs(branch.minOrderMinor)}
          </span>
          <span>Delivery {formatRs(branch.deliveryFeeMinor)}</span>
          {!branch.isAcceptingOrders && <Badge variant="destructive">Currently paused</Badge>}
        </div>
      </div>

      {categories.map((cat) => (
        <section key={cat.id} className="mb-8">
          <h2 className="mb-1 text-xl font-semibold text-neutral-900">{cat.name}</h2>
          {cat.description && <p className="mb-3 text-sm text-neutral-500">{cat.description}</p>}
          <div className="grid gap-3 sm:grid-cols-2">
            {cat.items.map((item) => (
              <button
                key={item.id}
                disabled={!item.isAvailable || !branch.isAcceptingOrders}
                onClick={() => setOpenItem(item as MenuItemForModal)}
                className="flex items-start justify-between gap-3 rounded-xl border border-neutral-200 bg-white p-4 text-left transition hover:border-neutral-400 disabled:opacity-50"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-neutral-900">{item.name}</span>
                    {item.badges.map((b) => (
                      <Badge key={b} variant="secondary" className="text-[10px]">
                        {b}
                      </Badge>
                    ))}
                  </div>
                  {item.description && (
                    <p className="mt-1 line-clamp-2 text-sm text-neutral-500">{item.description}</p>
                  )}
                  {!item.isAvailable && (
                    <p className="mt-1 text-xs font-medium text-red-600">Unavailable</p>
                  )}
                </div>
                <span className="shrink-0 font-semibold" style={{ color: primary }}>
                  {formatRs(item.priceMinor)}
                </span>
              </button>
            ))}
          </div>
        </section>
      ))}

      {openItem && (
        <ItemModal
          item={openItem}
          branch={{ id: branch.id, slug: r.slug, name: r.name }}
          onClose={() => setOpenItem(null)}
        />
      )}
    </main>
  );
}
