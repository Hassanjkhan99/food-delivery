"use client";

import { use, useEffect, useState } from "react";
import { useMutation, useQuery, useSubscription } from "urql";
import { graphql } from "@/graphql/generated";
import { formatRs, REVIEW_TAGS } from "@fd/shared";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";

const OrderQuery = graphql(`
  query OrderDetail($id: String!) {
    order(id: $id) {
      id
      code
      status
      paymentMode
      subtotalMinor
      taxTotalMinor
      deliveryFeeMinor
      platformFeeMinor
      grandTotalMinor
      acceptDeadlineAt
      prepEtaMinutes
      placedAt
      addressSnapshotJson
      branch {
        restaurant {
          name
        }
      }
      items {
        id
        qty
        unitPriceMinor
        lineTotalMinor
        menuSnapshotJson
        notes
      }
      events {
        id
        toStatus
        reason
        createdAt
      }
    }
  }
`);

const CancelMutation = graphql(`
  mutation CancelOrder($id: String!) {
    cancelOrder(id: $id) {
      id
      status
    }
  }
`);

const OrderStatusSubscription = graphql(`
  subscription OrderStatusFeed($orderId: String!) {
    orderStatus(orderId: $orderId) {
      orderId
      status
    }
  }
`);

const RateMutation = graphql(`
  mutation RateOrder($orderId: String!, $stars: Int!, $tags: [String!], $comment: String) {
    rateOrder(orderId: $orderId, stars: $stars, tags: $tags, comment: $comment) {
      id
      stars
    }
  }
`);

const TIMELINE_LABEL: Record<string, string> = {
  pending_acceptance: "Order placed",
  accepted: "Restaurant accepted",
  preparing: "Preparing your food",
  ready_for_pickup: "Ready for pickup",
  rider_assigned: "Rider assigned",
  picked_up: "Rider picked up",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered 🎉",
  rejected: "Restaurant rejected",
  auto_expired: "Restaurant didn't respond in time",
  cancelled: "Cancelled",
  failed_delivery_attempt: "Delivery attempt failed",
  reassigning: "Finding a new rider",
};

const ACTIVE_STATUSES = [
  "pending_acceptance",
  "accepted",
  "preparing",
  "ready_for_pickup",
  "rider_assigned",
  "picked_up",
  "out_for_delivery",
  "reassigning",
];

function Countdown({ deadline }: { deadline: string }) {
  const [left, setLeft] = useState(() => Math.max(0, new Date(deadline).getTime() - Date.now()));
  useEffect(() => {
    const t = setInterval(
      () => setLeft(Math.max(0, new Date(deadline).getTime() - Date.now())),
      1_000,
    );
    return () => clearInterval(t);
  }, [deadline]);
  const s = Math.floor(left / 1_000);
  return (
    <span className="font-mono font-semibold">
      {Math.floor(s / 60)}:{String(s % 60).padStart(2, "0")}
    </span>
  );
}

export default function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [{ data, fetching }, refetch] = useQuery({
    query: OrderQuery,
    variables: { id },
    requestPolicy: "cache-and-network",
  });
  const [, cancel] = useMutation(CancelMutation);
  const [rateState, rate] = useMutation(RateMutation);
  const [stars, setStars] = useState(0);
  const [reviewTags, setReviewTags] = useState<string[]>([]);
  const [comment, setComment] = useState("");
  const [rated, setRated] = useState(false);
  const order = data?.order;

  const toggleTag = (value: string) =>
    setReviewTags((prev) =>
      prev.includes(value) ? prev.filter((t) => t !== value) : [...prev, value],
    );

  // Live status via SSE; a slow poll remains as a reconnect safety net.
  useSubscription(
    {
      query: OrderStatusSubscription,
      variables: { orderId: id },
      pause: !order || !ACTIVE_STATUSES.includes(order.status),
    },
    (_prev, event) => {
      refetch({ requestPolicy: "network-only" });
      return event;
    },
  );
  useEffect(() => {
    if (!order || !ACTIVE_STATUSES.includes(order.status)) return;
    const t = setInterval(() => refetch({ requestPolicy: "network-only" }), 30_000);
    return () => clearInterval(t);
  }, [order, refetch]);

  if (fetching && !order) return <Skeleton className="h-96 rounded-2xl" />;
  if (!order) return <p className="text-neutral-500">Order not found.</p>;

  const address = order.addressSnapshotJson as { text?: string } | null;

  return (
    <main className="mx-auto max-w-lg">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">{order.branch.restaurant.name}</h1>
          <p className="text-sm text-neutral-500">{order.code}</p>
        </div>
        {order.status === "pending_acceptance" && (
          <div className="rounded-lg bg-amber-50 px-3 py-2 text-right text-xs text-amber-800">
            Restaurant has
            <br />
            <Countdown deadline={order.acceptDeadlineAt as unknown as string} /> to accept
          </div>
        )}
      </div>

      {/* Timeline */}
      <ol className="relative mb-8 space-y-4 border-l border-neutral-200 pl-5">
        {order.events.map((e) => (
          <li key={e.id} className="relative">
            <span className="absolute -left-[26px] top-1 h-3 w-3 rounded-full bg-neutral-900" />
            <p className="text-sm font-medium text-neutral-900">
              {TIMELINE_LABEL[e.toStatus] ?? e.toStatus}
            </p>
            <p className="text-xs text-neutral-500">
              {new Date(e.createdAt as unknown as string).toLocaleTimeString()}
              {e.reason ? ` — ${e.reason}` : ""}
            </p>
          </li>
        ))}
      </ol>

      {/* Items */}
      <div className="rounded-xl border border-neutral-200 bg-white p-4 text-sm">
        {order.items.map((i) => {
          const snap = i.menuSnapshotJson as {
            name?: string;
            modifiers?: Array<{ optionName: string }>;
          };
          return (
            <div key={i.id} className="mb-2 flex justify-between">
              <div>
                <span>
                  {i.qty} × {snap.name}
                </span>
                {snap.modifiers && snap.modifiers.length > 0 && (
                  <p className="text-xs text-neutral-400">
                    {snap.modifiers.map((m) => m.optionName).join(", ")}
                  </p>
                )}
              </div>
              <span>{formatRs(i.lineTotalMinor)}</span>
            </div>
          );
        })}
        <Separator className="my-2" />
        <div className="flex justify-between text-neutral-500">
          <span>Subtotal</span>
          <span>{formatRs(order.subtotalMinor)}</span>
        </div>
        <div className="flex justify-between text-neutral-500">
          <span>Tax</span>
          <span>{formatRs(order.taxTotalMinor)}</span>
        </div>
        <div className="flex justify-between text-neutral-500">
          <span>Delivery</span>
          <span>{formatRs(order.deliveryFeeMinor)}</span>
        </div>
        <div className="flex justify-between text-neutral-500">
          <span>Platform fee</span>
          <span>{formatRs(order.platformFeeMinor)}</span>
        </div>
        <div className="mt-1 flex justify-between font-semibold">
          <span>Total ({order.paymentMode === "cod" ? "cash on delivery" : "paid by card"})</span>
          <span>{formatRs(order.grandTotalMinor)}</span>
        </div>
      </div>

      {address?.text && (
        <p className="mt-4 text-sm text-neutral-500">Delivering to: {address.text}</p>
      )}

      {order.status === "delivered" && !rated && (
        <div className="mt-6 rounded-xl border border-neutral-200 bg-white p-4 text-center">
          <p className="mb-2 text-sm font-medium">How was it?</p>
          <div className="mb-3 flex justify-center gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                onClick={() => setStars(n)}
                className="text-2xl"
                aria-label={`${n} stars`}
              >
                {n <= stars ? "★" : "☆"}
              </button>
            ))}
          </div>
          {stars > 0 && (
            <>
              <div className="mb-3 flex flex-wrap justify-center gap-2">
                {REVIEW_TAGS.map((tag) => {
                  const on = reviewTags.includes(tag.value);
                  return (
                    <button
                      key={tag.value}
                      type="button"
                      onClick={() => toggleTag(tag.value)}
                      aria-pressed={on}
                      className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                        on
                          ? "border-neutral-900 bg-neutral-900 text-white"
                          : "border-neutral-200 text-neutral-600 hover:border-neutral-400"
                      }`}
                    >
                      {tag.label}
                    </button>
                  );
                })}
              </div>
              <Textarea
                placeholder="Add a comment (optional)"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={2}
                className="mb-3"
              />
            </>
          )}
          <Button
            size="sm"
            disabled={stars === 0 || rateState.fetching}
            onClick={async () => {
              const r = await rate({
                orderId: order.id,
                stars,
                tags: reviewTags.length > 0 ? reviewTags : undefined,
                comment: comment.trim() || undefined,
              });
              if (!r.error) setRated(true);
            }}
          >
            Submit rating
          </Button>
        </div>
      )}
      {rated && (
        <p className="mt-6 text-center text-sm text-neutral-500">Thanks for the feedback! ⭐</p>
      )}

      {["pending_acceptance", "accepted"].includes(order.status) && (
        <Button
          variant="outline"
          className="mt-6 w-full"
          onClick={async () => {
            await cancel({ id: order.id });
            refetch({ requestPolicy: "network-only" });
          }}
        >
          Cancel order
        </Button>
      )}
    </main>
  );
}
