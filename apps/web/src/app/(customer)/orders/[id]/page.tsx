"use client";

import { use, useEffect, useState } from "react";
import { useMutation, useQuery, useSubscription } from "urql";
import { graphql } from "@/graphql/generated";
import { formatRs, REVIEW_TAGS } from "@fd/shared";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { ReorderButton } from "@/components/ReorderButton";
import { REORDERABLE_STATUSES, type OrderItemSnapshot } from "@/lib/cart";

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
        id
        restaurant {
          name
          slug
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

// The happy-path stages the customer sees, in order. Each stage collapses one
// or more raw order statuses so the progress bar stays simple and readable.
type Stage = { key: string; label: string; statuses: string[] };
const STAGES: Stage[] = [
  { key: "placed", label: "Placed", statuses: ["pending_acceptance"] },
  { key: "accepted", label: "Accepted", statuses: ["accepted"] },
  { key: "preparing", label: "Preparing", statuses: ["preparing"] },
  { key: "ready", label: "Ready", statuses: ["ready_for_pickup", "rider_assigned"] },
  {
    key: "out_for_delivery",
    label: "Out for delivery",
    statuses: ["picked_up", "out_for_delivery", "reassigning"],
  },
  { key: "delivered", label: "Delivered", statuses: ["delivered"] },
];

// Terminal statuses that end the happy path unhappily. When the order lands on
// one of these we show a distinct notice instead of the staged tracker.
const TERMINAL_UNHAPPY: Record<string, { label: string; tone: "danger" | "warning" }> = {
  rejected: { label: "Restaurant rejected this order", tone: "danger" },
  auto_expired: { label: "Restaurant didn't respond in time", tone: "warning" },
  cancelled: { label: "Order cancelled", tone: "warning" },
};

// Statuses at which the rider is actively delivering — surface rider contact.
const OUT_FOR_DELIVERY_STATUSES = ["picked_up", "out_for_delivery"];

function stageIndexForStatus(status: string): number {
  const idx = STAGES.findIndex((s) => s.statuses.includes(status));
  // failed_delivery_attempt keeps the shopper on the "out for delivery" stage.
  if (idx === -1 && status === "failed_delivery_attempt") {
    return STAGES.findIndex((s) => s.key === "out_for_delivery");
  }
  return idx;
}

function formatStageTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

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
  if (!order) return <p className="text-kd-fg-muted">Order not found.</p>;

  const address = order.addressSnapshotJson as { text?: string } | null;

  // Map each completed stage to the earliest event timestamp for one of its
  // statuses — this gives a per-stage "done at" time straight from the event log.
  const stageTimes: Record<string, string> = {};
  for (const stage of STAGES) {
    const ev = order.events
      .filter((e) => stage.statuses.includes(e.toStatus))
      .sort(
        (a, b) =>
          new Date(a.createdAt as unknown as string).getTime() -
          new Date(b.createdAt as unknown as string).getTime(),
      )[0];
    if (ev) stageTimes[stage.key] = ev.createdAt as unknown as string;
  }

  const terminal = TERMINAL_UNHAPPY[order.status];
  const currentStageIdx = stageIndexForStatus(order.status);
  const isOutForDelivery = OUT_FOR_DELIVERY_STATUSES.includes(order.status);
  const failedAttempt = order.status === "failed_delivery_attempt";

  // TODO(rider-contact): the API contract does not expose the assigned rider on
  // Order (no rider relation / phone field). When the backend adds it (e.g.
  // Order.deliveryTask.rider { user { name phone } }), read it here and wire the
  // tel: link. Until then we surface the restaurant/support entry point instead.
  const rider = (order as { rider?: { name?: string; phone?: string } | null }).rider ?? null;

  return (
    <main className="mx-auto max-w-lg">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">{order.branch.restaurant.name}</h1>
          <p className="text-sm text-kd-fg-muted">{order.code}</p>
        </div>
        {order.status === "pending_acceptance" && (
          <div className="rounded-lg bg-kd-warning-soft px-3 py-2 text-right text-xs text-kd-warning">
            Restaurant has
            <br />
            <Countdown deadline={order.acceptDeadlineAt as unknown as string} /> to accept
          </div>
        )}
      </div>

      {/* Staged progress tracker (happy path). */}
      {!terminal && (
        <ol className="relative mb-6 space-y-5 border-l border-kd-border pl-5">
          {STAGES.map((stage, idx) => {
            const done = currentStageIdx > idx || order.status === "delivered";
            const current = currentStageIdx === idx && order.status !== "delivered";
            const time = stageTimes[stage.key];
            return (
              <li key={stage.key} className="relative">
                <span
                  className={`absolute top-1 -left-[26px] h-3 w-3 rounded-full ring-4 ring-kd-bg ${
                    done
                      ? "bg-kd-success"
                      : current
                        ? "animate-pulse bg-kd-primary"
                        : "bg-kd-border"
                  }`}
                />
                <div className="flex items-center gap-2">
                  <p
                    className={`text-sm font-medium ${
                      current
                        ? "text-kd-primary"
                        : done
                          ? "text-kd-fg"
                          : "text-kd-fg-subtle"
                    }`}
                  >
                    {stage.label}
                  </p>
                  {current && (
                    <Badge variant="secondary" className="border-transparent">
                      In progress
                    </Badge>
                  )}
                </div>
                {time && (
                  <p className="text-xs text-kd-fg-muted">{formatStageTime(time)}</p>
                )}
                {current && stage.key === "placed" && (
                  <p className="text-xs text-kd-fg-muted">Waiting for the restaurant to accept</p>
                )}
                {current &&
                  (stage.key === "preparing" || stage.key === "accepted") &&
                  order.prepEtaMinutes && (
                    <p className="text-xs text-kd-fg-muted">
                      Estimated {order.prepEtaMinutes} min prep time
                    </p>
                  )}
              </li>
            );
          })}
        </ol>
      )}

      {/* Delivery attempt failed — still on the road, reassuring copy. */}
      {failedAttempt && (
        <div className="mb-6 rounded-xl border border-kd-warning bg-kd-warning-soft p-4 text-sm text-kd-warning">
          A delivery attempt didn&apos;t succeed. We&apos;re sorting it out — hang tight or reach
          out below.
        </div>
      )}

      {/* Terminal unhappy state — replaces the tracker. */}
      {terminal && (
        <div
          className={`mb-6 rounded-xl border p-4 text-sm ${
            terminal.tone === "danger"
              ? "border-kd-danger bg-kd-danger-soft text-kd-danger"
              : "border-kd-warning bg-kd-warning-soft text-kd-warning"
          }`}
        >
          <p className="font-medium">{terminal.label}</p>
          {order.events.find((e) => e.toStatus === order.status)?.reason && (
            <p className="mt-1 text-kd-fg-muted">
              {order.events.find((e) => e.toStatus === order.status)?.reason}
            </p>
          )}
          {order.paymentMode !== "cod" && (
            <p className="mt-1 text-kd-fg-muted">
              Any charge for this order will be refunded to your original payment method.
            </p>
          )}
        </div>
      )}

      {/* Rider contact — shown while the order is out for delivery. */}
      {isOutForDelivery && (
        <div className="mb-6 rounded-xl border border-kd-border bg-kd-surface p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-kd-fg">
                {rider?.name ? `${rider.name} is on the way` : "Your rider is on the way"}
              </p>
              <p className="text-xs text-kd-fg-muted">
                {order.status === "out_for_delivery"
                  ? "Out for delivery now"
                  : "Picked up your order"}
              </p>
            </div>
            {rider?.phone ? (
              <Button size="sm" variant="outline" render={<a href={`tel:${rider.phone}`} />}>
                Call rider
              </Button>
            ) : (
              // TODO(rider-contact): enable a direct tel: link once the API exposes
              // the assigned rider's phone on Order. For now route to support.
              <Button size="sm" variant="outline" render={<a href="#order-help" />}>
                Contact
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Items */}
      <div className="rounded-xl border border-kd-border bg-kd-surface p-4 text-sm">
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
                  <p className="text-xs text-kd-fg-subtle">
                    {snap.modifiers.map((m) => m.optionName).join(", ")}
                  </p>
                )}
              </div>
              <span>{formatRs(i.lineTotalMinor)}</span>
            </div>
          );
        })}
        <Separator className="my-2" />
        <div className="flex justify-between text-kd-fg-muted">
          <span>Subtotal</span>
          <span>{formatRs(order.subtotalMinor)}</span>
        </div>
        <div className="flex justify-between text-kd-fg-muted">
          <span>Tax</span>
          <span>{formatRs(order.taxTotalMinor)}</span>
        </div>
        <div className="flex justify-between text-kd-fg-muted">
          <span>Delivery</span>
          <span>{formatRs(order.deliveryFeeMinor)}</span>
        </div>
        <div className="flex justify-between text-kd-fg-muted">
          <span>Platform fee</span>
          <span>{formatRs(order.platformFeeMinor)}</span>
        </div>
        <div className="mt-1 flex justify-between font-semibold">
          <span>Total ({order.paymentMode === "cod" ? "cash on delivery" : "paid by card"})</span>
          <span>{formatRs(order.grandTotalMinor)}</span>
        </div>
      </div>

      {/* Reorder — rebuild the cart from this order's items. Only offered once
          the order reaches a terminal state (matching the orders list) so an
          in-flight order can't be duplicated before it's fulfilled. Availability
          and pricing are re-validated at checkout via quoteCart. */}
      {REORDERABLE_STATUSES.has(order.status) && order.items.length > 0 && (
        <div className="mt-4">
          <ReorderButton
            size="default"
            variant="outline"
            className="w-full"
            source={{
              branch: {
                id: order.branch.id,
                slug: order.branch.restaurant.slug,
                name: order.branch.restaurant.name,
              },
              items: order.items.map((i) => ({
                qty: i.qty,
                notes: i.notes,
                menuSnapshotJson: i.menuSnapshotJson as OrderItemSnapshot["menuSnapshotJson"],
              })),
            }}
          >
            Reorder these items
          </ReorderButton>
        </div>
      )}

      {address?.text && (
        <p className="mt-4 text-sm text-kd-fg-muted">Delivering to: {address.text}</p>
      )}

      {order.status === "delivered" && !rated && (
        <div className="mt-6 rounded-xl border border-kd-border bg-kd-surface p-4 text-center">
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
                          ? "border-kd-fg bg-kd-fg text-kd-surface"
                          : "border-kd-border text-kd-fg-muted hover:border-kd-fg-subtle"
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
        <p className="mt-6 text-center text-sm text-kd-fg-muted">Thanks for the feedback! ⭐</p>
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

      {/* Help / support entry point — always available. */}
      <div
        id="order-help"
        className="mt-8 rounded-xl border border-kd-border bg-kd-surface-muted p-4 text-center"
      >
        <p className="text-sm font-medium text-kd-fg">Need help with this order?</p>
        <p className="mt-1 text-xs text-kd-fg-muted">
          Something wrong with your delivery, payment, or items? We&apos;re here to help.
        </p>
        {/* TODO(support): point at a real support channel (in-app chat / ticket)
            once one exists; mailto keeps a working entry point meanwhile. */}
        <Button
          size="sm"
          variant="outline"
          className="mt-3"
          render={
            <a
              href={`mailto:support@khaanado.com?subject=${encodeURIComponent(
                `Help with order ${order.code}`,
              )}`}
            />
          }
        >
          Get help
        </Button>
      </div>
    </main>
  );
}
