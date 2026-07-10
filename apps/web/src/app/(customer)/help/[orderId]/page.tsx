"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "urql";
import { graphql } from "@/graphql/generated";
import { formatRs, HELP_CATEGORIES, helpCategoryLabel } from "@fd/shared";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";

const OrderHelpQuery = graphql(`
  query OrderHelp($id: String!) {
    order(id: $id) {
      id
      code
      status
      paymentMode
      grandTotalMinor
      branch {
        restaurant {
          name
        }
      }
      items {
        id
        qty
        lineTotalMinor
        menuSnapshotJson
      }
    }
    ticketsForOrder(orderId: $id) {
      id
      category
      status
      body
      resolutionNote
      createdAt
      refund {
        id
        status
        amountMinor
        destination
      }
    }
  }
`);

const CreateHelpTicketMutation = graphql(`
  mutation CreateHelpTicket(
    $orderId: String!
    $category: String!
    $note: String
    $items: [HelpItemSelectionInput!]
  ) {
    createHelpTicket(orderId: $orderId, category: $category, note: $note, items: $items) {
      id
      status
    }
  }
`);

// Statuses at which "Where is my order?" self-service is meaningful (still moving).
const LIVE_STATUSES = [
  "pending_acceptance",
  "accepted",
  "preparing",
  "ready_for_pickup",
  "rider_assigned",
  "picked_up",
  "out_for_delivery",
  "reassigning",
  "failed_delivery_attempt",
];

const STATUS_RECAP: Record<string, string> = {
  pending_acceptance: "Waiting for the restaurant to accept your order.",
  accepted: "The restaurant accepted your order and will start preparing it.",
  preparing: "Your food is being prepared.",
  ready_for_pickup: "Your order is ready and waiting for a rider.",
  rider_assigned: "A rider has been assigned and is heading to the restaurant.",
  picked_up: "The rider has picked up your order.",
  out_for_delivery: "Your order is on the way to you.",
  reassigning: "We're assigning a new rider — hang tight.",
  failed_delivery_attempt: "A delivery attempt didn't succeed. We're sorting it out.",
  delivered: "Your order was delivered.",
  cancelled: "This order was cancelled.",
  rejected: "The restaurant couldn't accept this order.",
  auto_expired: "The restaurant didn't respond in time.",
};

const TICKET_STATUS_LABEL: Record<string, string> = {
  open: "Open",
  in_progress: "In progress",
  resolved: "Resolved",
  closed: "Closed",
};

export default function OrderHelpPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = use(params);
  const [{ data, fetching }, refetch] = useQuery({
    query: OrderHelpQuery,
    variables: { id: orderId },
    requestPolicy: "cache-and-network",
  });
  const [createState, createTicket] = useMutation(CreateHelpTicketMutation);

  const [category, setCategory] = useState<string | null>(null);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");
  const [filed, setFiled] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const order = data?.order;
  const tickets = data?.ticketsForOrder ?? [];

  if (fetching && !order) return <Skeleton className="h-96 rounded-2xl" />;
  if (!order) return <p className="text-kd-fg-muted">Order not found.</p>;

  const cat = HELP_CATEGORIES.find((c) => c.value === category) ?? null;
  const isLive = LIVE_STATUSES.includes(order.status);

  const toggleItem = (id: string) =>
    setSelectedItems((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const resetPicker = () => {
    setCategory(null);
    setSelectedItems(new Set());
    setNote("");
    setError(null);
  };

  const submit = async () => {
    if (!cat) return;
    setError(null);
    if (cat.needsItems && selectedItems.size === 0) {
      setError("Please select at least one affected item.");
      return;
    }
    const res = await createTicket({
      orderId: order.id,
      category: cat.value,
      note: note.trim() || undefined,
      items: cat.needsItems ? [...selectedItems].map((orderItemId) => ({ orderItemId })) : undefined,
    });
    if (res.error) {
      setError(res.error.graphQLErrors[0]?.message ?? "Something went wrong. Please try again.");
      return;
    }
    setFiled(true);
    resetPicker();
    refetch({ requestPolicy: "network-only" });
  };

  // Amount a missing/wrong-items complaint would refund, from selected lineTotals.
  const selectedRefund = order.items
    .filter((i) => selectedItems.has(i.id))
    .reduce((sum, i) => sum + i.lineTotalMinor, 0);

  return (
    <main className="mx-auto max-w-lg">
      <div className="mb-6">
        <Link href={`/orders/${order.id}`} className="text-sm text-kd-fg-muted hover:text-kd-fg">
          ← Back to order
        </Link>
        <h1 className="mt-2 text-2xl font-bold">Help with your order</h1>
        <p className="text-sm text-kd-fg-muted">
          {order.branch.restaurant.name} · {order.code}
        </p>
      </div>

      {/* Self-service deflection: live status recap for "where is my order". */}
      <div className="mb-6 rounded-xl border border-kd-info bg-kd-info-soft p-4">
        <p className="text-sm font-medium text-kd-fg">Where is my order?</p>
        <p className="mt-1 text-sm text-kd-fg-muted">
          {STATUS_RECAP[order.status] ?? "We're tracking your order."}
        </p>
        {isLive && (
          <Button
            size="sm"
            variant="outline"
            className="mt-3"
            render={<Link href={`/orders/${order.id}`} />}
          >
            View live tracking
          </Button>
        )}
      </div>

      {/* Existing tickets for this order — customer-visible status + resolution. */}
      {tickets.length > 0 && (
        <div className="mb-6 space-y-3">
          <h2 className="text-sm font-semibold text-kd-fg">Your help requests</h2>
          {tickets.map((tk) => (
            <div key={tk.id} className="rounded-xl border border-kd-border bg-kd-surface p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-kd-fg">
                  {helpCategoryLabel(tk.category)}
                </span>
                <Badge variant={tk.status === "resolved" ? "default" : "secondary"}>
                  {TICKET_STATUS_LABEL[tk.status] ?? tk.status}
                </Badge>
              </div>
              <p className="mt-1 whitespace-pre-line text-xs text-kd-fg-muted">{tk.body}</p>
              {tk.resolutionNote ? (
                <div className="mt-3 rounded-lg bg-kd-success-soft p-3 text-sm text-kd-success">
                  {tk.resolutionNote}
                </div>
              ) : tk.refund && tk.refund.status === "refund_pending" ? (
                <p className="mt-2 text-xs text-kd-fg-subtle">
                  A refund of {formatRs(tk.refund.amountMinor)} is being reviewed.
                </p>
              ) : (
                <p className="mt-2 text-xs text-kd-fg-subtle">
                  We&apos;ve received this and will get back to you.
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {filed && (
        <div className="mb-6 rounded-xl border border-kd-success bg-kd-success-soft p-4 text-sm text-kd-success">
          Thanks — your request has been filed. You&apos;ll see the resolution above once it&apos;s
          reviewed.
        </div>
      )}

      {/* Stage-aware issue picker. */}
      {!category && (
        <div className="rounded-xl border border-kd-border bg-kd-surface p-4">
          <h2 className="mb-3 text-sm font-semibold text-kd-fg">What went wrong?</h2>
          <div className="space-y-2">
            {HELP_CATEGORIES.map((c) => (
              <button
                key={c.value}
                type="button"
                onClick={() => {
                  setCategory(c.value);
                  setFiled(false);
                  setError(null);
                }}
                className="flex w-full items-center justify-between rounded-lg border border-kd-border p-3 text-left hover:border-kd-fg-subtle"
              >
                <div>
                  <p className="text-sm font-medium text-kd-fg">{c.label}</p>
                  <p className="text-xs text-kd-fg-muted">{c.blurb}</p>
                </div>
                <span className="text-kd-fg-subtle">→</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Structured intake for the chosen category. */}
      {cat && (
        <div className="rounded-xl border border-kd-border bg-kd-surface p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-kd-fg">{cat.label}</h2>
            <button
              type="button"
              onClick={resetPicker}
              className="text-xs text-kd-fg-muted hover:text-kd-fg"
            >
              Change
            </button>
          </div>

          {cat.needsItems && (
            <>
              <p className="mb-2 text-xs text-kd-fg-muted">Which items? Select all that apply.</p>
              <div className="space-y-2">
                {order.items.map((i) => {
                  const snap = i.menuSnapshotJson as { name?: string } | null;
                  const on = selectedItems.has(i.id);
                  return (
                    <label
                      key={i.id}
                      className={`flex cursor-pointer items-center justify-between rounded-lg border p-3 text-sm ${
                        on ? "border-kd-primary bg-kd-primary-soft" : "border-kd-border"
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() => toggleItem(i.id)}
                          className="h-4 w-4 accent-kd-primary"
                        />
                        <span className="text-kd-fg">
                          {i.qty} × {snap?.name ?? "Item"}
                        </span>
                      </span>
                      <span className="text-kd-fg-muted">{formatRs(i.lineTotalMinor)}</span>
                    </label>
                  );
                })}
              </div>
              {cat.autoRefund && selectedItems.size > 0 && (
                <>
                  <Separator className="my-3" />
                  <p className="text-xs text-kd-fg-muted">
                    We&apos;ll request a refund of{" "}
                    <span className="font-semibold text-kd-fg">{formatRs(selectedRefund)}</span> for
                    the selected items, reviewed by our team.
                  </p>
                </>
              )}
            </>
          )}

          <Textarea
            placeholder="Add any details (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            className="mt-3"
          />

          {error && <p className="mt-2 text-xs text-kd-danger">{error}</p>}

          <Button
            className="mt-4 w-full"
            disabled={createState.fetching}
            onClick={submit}
          >
            {cat.autoRefund && selectedItems.size > 0 ? "Submit & request refund" : "Submit request"}
          </Button>
        </div>
      )}

      {/* Generic FAQ lives behind the contextual flow. */}
      <div className="mt-8 text-center">
        <Link href="/help" className="text-sm text-kd-fg-muted underline hover:text-kd-fg">
          Browse help articles
        </Link>
      </div>
    </main>
  );
}
