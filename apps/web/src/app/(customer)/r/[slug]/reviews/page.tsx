"use client";

// Reviews surface for a restaurant: headline average, star-distribution bars, and a
// paginated list (stars, tags, comment, relative date). Data is Rating rows exposed
// via Restaurant.ratings / ratingDistribution (approved only — moderation gate is a
// later layer). Themed with the restaurant's brand vars so it reads as one journey.
import { use, useState } from "react";
import Link from "next/link";
import { useQuery } from "urql";
import { ArrowLeft, Star } from "lucide-react";
import { graphql } from "@/graphql/generated";
import { reviewTagLabel } from "@fd/shared";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { DEFAULT_THEME, themeVars, type ThemeShape } from "@/components/theme/theme";

const PAGE = 10;

const ReviewsQuery = graphql(`
  query RestaurantReviews($slug: String!, $limit: Int!) {
    branchBySlug(slug: $slug) {
      id
      restaurant {
        id
        name
        avgRating
        ratingCount
        ratingDistribution
        theme {
          primaryColor
          accentColor
          backgroundColor
          textColor
          fontKey
          cardStyle
          heroEffect
        }
        ratings(limit: $limit) {
          id
          stars
          tags
          comment
          createdAt
        }
      }
    }
  }
`);

function Stars({ n, className }: { n: number; className?: string }) {
  return (
    <span className={`inline-flex ${className ?? ""}`} aria-label={`${n} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          className={`h-4 w-4 ${i <= n ? "fill-amber-400 text-amber-400" : "text-neutral-300"}`}
        />
      ))}
    </span>
  );
}

function relativeDate(value: string): string {
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return "";
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)} wk ago`;
  if (days < 365) return `${Math.floor(days / 30)} mo ago`;
  return `${Math.floor(days / 365)} yr ago`;
}

export default function ReviewsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const [limit, setLimit] = useState(PAGE);
  const [{ data, fetching }] = useQuery({ query: ReviewsQuery, variables: { slug, limit } });

  const r = data?.branchBySlug?.restaurant;
  const theme: ThemeShape = { ...DEFAULT_THEME, ...(r?.theme ?? {}) } as ThemeShape;

  if (fetching && !r) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 rounded-2xl" />
        <Skeleton className="h-40 rounded-2xl" />
      </div>
    );
  }
  if (!r) return <p className="text-neutral-500">Restaurant not found.</p>;

  const dist = r.ratingDistribution; // index 0 => 1★ … index 4 => 5★
  const maxBucket = Math.max(1, ...dist);
  const reviews = r.ratings;
  const canLoadMore = reviews.length >= limit && reviews.length < r.ratingCount;

  return (
    <main className="-mx-4 -my-6 min-h-screen px-4 py-6" style={themeVars(theme)}>
      <Link
        href={`/r/${slug}`}
        className="mb-4 inline-flex items-center gap-1 text-sm font-medium opacity-70 hover:opacity-100"
      >
        <ArrowLeft className="h-4 w-4" /> {r.name}
      </Link>

      <h1 className="text-2xl font-bold" style={{ color: "var(--brand-primary)" }}>
        Reviews
      </h1>

      {/* Summary + distribution */}
      <section className="mt-4 flex flex-col gap-5 rounded-2xl border border-black/5 bg-white/60 p-5 sm:flex-row sm:items-center">
        <div className="flex flex-col items-center justify-center sm:w-40">
          <div className="text-5xl font-bold" style={{ color: "var(--brand-primary)" }}>
            {r.avgRating != null ? r.avgRating.toFixed(1) : "—"}
          </div>
          <Stars n={Math.round(r.avgRating ?? 0)} className="mt-1" />
          <div className="mt-1 text-xs opacity-60">
            {r.ratingCount} {r.ratingCount === 1 ? "review" : "reviews"}
          </div>
        </div>
        <div className="flex-1 space-y-1.5">
          {[5, 4, 3, 2, 1].map((star) => {
            const count = dist[star - 1] ?? 0;
            return (
              <div key={star} className="flex items-center gap-2 text-xs">
                <span className="w-3 tabular-nums opacity-70">{star}</span>
                <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-black/5">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${(count / maxBucket) * 100}%`,
                      backgroundColor: "var(--brand-primary)",
                    }}
                  />
                </div>
                <span className="w-6 text-right tabular-nums opacity-60">{count}</span>
              </div>
            );
          })}
        </div>
      </section>

      {/* List */}
      {reviews.length === 0 ? (
        <p className="py-12 text-center text-sm opacity-60">No reviews yet.</p>
      ) : (
        <ul className="mt-5 space-y-3">
          {reviews.map((rev) => (
            <li key={rev.id} className="rounded-2xl border border-black/5 bg-white/60 p-4">
              <div className="flex items-center justify-between gap-2">
                <Stars n={rev.stars} />
                <span className="text-xs opacity-50">{relativeDate(rev.createdAt)}</span>
              </div>
              {rev.tags.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {rev.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full px-2 py-0.5 text-[11px] font-medium"
                      style={{
                        backgroundColor: "color-mix(in srgb, var(--brand-accent) 22%, transparent)",
                      }}
                    >
                      {reviewTagLabel(tag)}
                    </span>
                  ))}
                </div>
              )}
              {rev.comment && <p className="mt-2 text-sm opacity-80">{rev.comment}</p>}
            </li>
          ))}
        </ul>
      )}

      {canLoadMore && (
        <div className="mt-5 flex justify-center">
          <Button variant="outline" disabled={fetching} onClick={() => setLimit((l) => l + PAGE)}>
            {fetching ? "Loading…" : "Load more"}
          </Button>
        </div>
      )}
    </main>
  );
}
