"use client";

// Admin order escalation: inspect the event chain and override the status (audited).
import { use, useState } from "react";
import { useMutation, useQuery } from "urql";
import { graphql } from "@/graphql/generated";
import { formatRs } from "@fd/shared";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

const AdminOrderQuery = graphql(`
  query AdminOrder($id: String!) {
    order(id: $id) {
      id
      code
      status
      paymentMode
      grandTotalMinor
      contactPhone
      placedAt
      branch {
        restaurant {
          name
        }
      }
      events {
        id
        fromStatus
        toStatus
        actorRole
        reason
        createdAt
      }
    }
  }
`);

const OverrideMutation = graphql(`
  mutation Override($id: String!, $toStatus: String!, $reason: String!) {
    overrideOrderStatus(id: $id, toStatus: $toStatus, reason: $reason) {
      id
      status
    }
  }
`);

const STATUSES = [
  "accepted", "preparing", "ready_for_pickup", "rider_assigned", "picked_up",
  "out_for_delivery", "delivered", "cancelled", "rejected",
];

export default function AdminOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [{ data, fetching }, refetch] = useQuery({
    query: AdminOrderQuery,
    variables: { id },
    requestPolicy: "cache-and-network",
  });
  const [, override] = useMutation(OverrideMutation);
  const [toStatus, setToStatus] = useState("cancelled");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const order = data?.order;

  if (fetching && !order) return <Skeleton className="h-64 rounded-2xl" />;
  if (!order) return <p className="text-neutral-500">Order not found.</p>;

  return (
    <main className="max-w-2xl">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">{order.code}</h1>
          <p className="text-sm text-neutral-500">
            {order.branch.restaurant.name} · {formatRs(order.grandTotalMinor)} ·{" "}
            {order.paymentMode.toUpperCase()} · {order.contactPhone}
          </p>
        </div>
        <Badge>{order.status}</Badge>
      </div>

      <div className="mb-6 rounded-xl border border-neutral-200 bg-white p-4">
        <p className="mb-2 text-sm font-semibold">Status override (audited)</p>
        <div className="flex flex-wrap gap-2">
          <select
            value={toStatus}
            onChange={(e) => setToStatus(e.target.value)}
            className="rounded-lg border border-neutral-300 px-2 py-1.5 text-sm"
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <input
            className="flex-1 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm"
            placeholder="Reason (required, goes to the audit log)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <Button
            size="sm"
            disabled={!reason.trim()}
            onClick={async () => {
              setError(null);
              const r = await override({ id: order.id, toStatus, reason });
              if (r.error) setError(r.error.graphQLErrors[0]?.message ?? "Override failed");
              refetch({ requestPolicy: "network-only" });
            }}
          >
            Apply
          </Button>
        </div>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        <p className="mt-2 text-xs text-neutral-400">
          Illegal transitions are rejected by the state machine even for admins overriding
          from terminal states.
        </p>
      </div>

      <h2 className="mb-2 text-sm font-bold uppercase text-neutral-500">Event chain</h2>
      <div className="space-y-1">
        {order.events.map((e) => (
          <div key={e.id} className="flex items-center justify-between rounded-lg bg-white px-3 py-2 text-sm">
            <span>
              <span className="font-mono text-xs text-neutral-400">{e.fromStatus ?? "∅"} → </span>
              <span className="font-medium">{e.toStatus}</span>
              {e.reason && <span className="ml-2 text-xs text-neutral-500">({e.reason})</span>}
            </span>
            <span className="text-xs text-neutral-400">
              {e.actorRole} · {new Date(e.createdAt as unknown as string).toLocaleTimeString()}
            </span>
          </div>
        ))}
      </div>
    </main>
  );
}
