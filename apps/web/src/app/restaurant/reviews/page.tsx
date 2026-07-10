"use client";

// Console reviews (#61): the owner sees their approved reviews and can post/edit a
// public reply. Responses auto-publish (no admin moderation — mirrors the auto-approve
// rating policy) and render on the customer reviews page (#38).
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "urql";
import { Star } from "lucide-react";
import { graphql } from "@/graphql/generated";
import { reviewTagLabel } from "@fd/shared";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useConsole } from "../useConsole";

const PAGE = 20;

const ReviewsQuery = graphql(`
  query ConsoleReviews($restaurantId: String!, $limit: Int, $offset: Int) {
    restaurantReviews(restaurantId: $restaurantId, limit: $limit, offset: $offset) {
      id
      stars
      tags
      comment
      createdAt
      response {
        id
        body
        createdAt
      }
    }
  }
`);

const RespondMutation = graphql(`
  mutation RespondToRating($ratingId: String!, $body: String!) {
    respondToRating(ratingId: $ratingId, body: $body) {
      id
      body
      createdAt
    }
  }
`);

type ReviewRow = {
  id: string;
  stars: number;
  tags: string[];
  comment?: string | null;
  createdAt: string;
  response?: { id: string; body: string; createdAt: string } | null;
};

function Stars({ n }: { n: number }) {
  return (
    <span className="inline-flex" aria-label={`${n} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          className={`h-4 w-4 ${
            i <= n ? "fill-kd-warning text-kd-warning" : "text-kd-fg-subtle"
          }`}
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

function ReviewCard({
  review,
  onSaved,
}: {
  review: ReviewRow;
  onSaved: () => void;
}) {
  const [, respond] = useMutation(RespondMutation);
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(review.response?.body ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const trimmed = body.trim();
    if (!trimmed) {
      setError("Response cannot be empty.");
      return;
    }
    setSaving(true);
    setError(null);
    const res = await respond({ ratingId: review.id, body: trimmed });
    setSaving(false);
    if (res.error) {
      setError("Could not save your response. Please try again.");
      return;
    }
    setEditing(false);
    onSaved();
  }

  return (
    <li className="rounded-2xl border border-kd-border bg-kd-surface p-4">
      <div className="flex items-center justify-between gap-2">
        <Stars n={review.stars} />
        <span className="text-xs text-kd-fg-subtle">{relativeDate(review.createdAt)}</span>
      </div>
      {review.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {review.tags.map((tag) => (
            <span
              key={tag}
              className="rounded-full bg-kd-surface-muted px-2 py-0.5 text-[11px] font-medium text-kd-fg-muted"
            >
              {reviewTagLabel(tag)}
            </span>
          ))}
        </div>
      )}
      {review.comment && <p className="mt-2 text-sm text-kd-fg">{review.comment}</p>}

      {/* Existing response (view mode) */}
      {review.response && !editing && (
        <div className="mt-3 rounded-xl border border-kd-border bg-kd-surface-muted p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-kd-primary">Your response</span>
            <span className="text-xs text-kd-fg-subtle">
              {relativeDate(review.response.createdAt)}
            </span>
          </div>
          <p className="mt-1 text-sm text-kd-fg">{review.response.body}</p>
          <button
            type="button"
            className="mt-2 text-xs font-medium text-kd-primary hover:underline"
            onClick={() => {
              setBody(review.response?.body ?? "");
              setEditing(true);
            }}
          >
            Edit response
          </button>
        </div>
      )}

      {/* Reply CTA (no response yet, not editing) */}
      {!review.response && !editing && (
        <button
          type="button"
          className="mt-3 text-sm font-medium text-kd-primary hover:underline"
          onClick={() => setEditing(true)}
        >
          Reply to this review
        </button>
      )}

      {/* Compose / edit */}
      {editing && (
        <div className="mt-3">
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={1000}
            rows={3}
            placeholder="Write a public reply…"
            aria-label="Response to review"
          />
          {error && <p className="mt-1 text-xs text-kd-danger">{error}</p>}
          <div className="mt-2 flex items-center gap-2">
            <Button size="sm" disabled={saving} onClick={save}>
              {saving ? "Saving…" : "Publish reply"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={saving}
              onClick={() => {
                setEditing(false);
                setError(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

export default function ConsoleReviewsPage() {
  const { restaurant } = useConsole();
  // Offset pagination: the server clamps each page to 50 rows, so we page through with
  // Previous/Next by advancing `offset` — this reaches reviews beyond the first 50.
  // Showing one page at a time keeps a reply-refetch updating the visible rows in place.
  const [offset, setOffset] = useState(0);
  const [{ data, fetching, error }, refetch] = useQuery({
    query: ReviewsQuery,
    variables: { restaurantId: restaurant?.id ?? "", limit: PAGE, offset },
    pause: !restaurant,
    requestPolicy: "cache-and-network",
  });

  const reviews = useMemo(
    () => (data?.restaurantReviews as ReviewRow[] | undefined) ?? [],
    [data],
  );

  if (!restaurant)
    return <p className="text-kd-fg-muted">Complete onboarding first.</p>;

  const page = Math.floor(offset / PAGE) + 1;
  const hasPrev = offset > 0;
  // A next page is likely available whenever this page filled PAGE rows.
  const hasNext = reviews.length >= PAGE;

  return (
    <main className="max-w-3xl">
      <h1 className="mb-1 text-xl font-bold">Reviews</h1>
      <p className="mb-4 text-sm text-kd-fg-muted">
        Reply to customer reviews. Replies are public and shown on your reviews page.
      </p>

      {error && (
        <p className="mb-4 rounded-xl border border-kd-danger bg-kd-danger-soft p-3 text-sm text-kd-danger">
          Could not load reviews. Please try again.
        </p>
      )}

      {fetching && reviews.length === 0 && <Skeleton className="h-40 rounded-2xl" />}

      {!fetching && reviews.length === 0 && !error && (
        <p className="text-sm text-kd-fg-subtle">
          {offset > 0 ? "No more reviews." : "No reviews yet."}
        </p>
      )}

      <ul className="space-y-3">
        {reviews.map((rev) => (
          <ReviewCard
            key={rev.id}
            review={rev}
            onSaved={() => refetch({ requestPolicy: "network-only" })}
          />
        ))}
      </ul>

      {(hasPrev || hasNext) && (
        <div className="mt-5 flex items-center justify-between">
          <Button
            variant="outline"
            disabled={fetching || !hasPrev}
            onClick={() => setOffset((o) => Math.max(o - PAGE, 0))}
          >
            Previous
          </Button>
          <span className="text-xs text-kd-fg-subtle">Page {page}</span>
          <Button
            variant="outline"
            disabled={fetching || !hasNext}
            onClick={() => setOffset((o) => o + PAGE)}
          >
            {fetching ? "Loading…" : "Next"}
          </Button>
        </div>
      )}
    </main>
  );
}
