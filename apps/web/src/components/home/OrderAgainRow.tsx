"use client";

import Link from "next/link";
import { RotateCcw } from "lucide-react";
import { RestaurantImage } from "@/components/media/RestaurantImage";
import type { FeedPhoto } from "./types";

export type ReorderTarget = {
  slug: string;
  name: string;
  photo: FeedPhoto;
  primaryColor?: string | null;
};

/** "Order it again" — the last few distinct restaurants the customer ordered from,
 *  one tap back to the menu. Appears only after a first order. */
export function OrderAgainRow({ targets }: { targets: ReorderTarget[] }) {
  if (targets.length === 0) return null;
  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 text-lg font-bold text-neutral-900">
        <RotateCcw className="h-4 w-4 text-rose-600" />
        Order it again
      </h2>
      <div className="-mx-4 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="flex gap-4">
          {targets.map((t) => (
            <Link key={t.slug} href={`/r/${t.slug}`} className="group block w-40 shrink-0">
              <div className="relative">
                <RestaurantImage
                  photo={t.photo}
                  name={t.name}
                  tint={t.primaryColor}
                  className="h-24 w-40 rounded-xl"
                  sizes="160px"
                />
                <span className="absolute inset-x-2 bottom-2 rounded-lg bg-white/95 py-1 text-center text-xs font-semibold text-neutral-900 opacity-0 transition-opacity group-hover:opacity-100">
                  Order again
                </span>
              </div>
              <p className="mt-1.5 truncate text-sm font-medium text-neutral-900">{t.name}</p>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
