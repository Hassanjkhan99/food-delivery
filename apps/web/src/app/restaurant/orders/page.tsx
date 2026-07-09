"use client";

// Live order board: New (120s countdown) / Preparing / Ready / Out / Recent.
// Polls every 5s until M10 replaces polling with SSE subscriptions.
import { useEffect, useState } from "react";
import { useMutation, useQuery, useSubscription } from "urql";
import { graphql } from "@/graphql/generated";
import { formatRs } from "@fd/shared";
import { useConsole } from "../useConsole";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

const BoardQuery = graphql(`
  query Board($branchId: String!) {
    boardOrders(branchId: $branchId) {
      id
      code
      status
      paymentMode
      grandTotalMinor
      customerNote
      acceptDeadlineAt
      prepEtaMinutes
      placedAt
      contactPhone
      items {
        id
        qty
        menuSnapshotJson
      }
    }
    branchRiders(branchId: $branchId) {
      id
      riderType
      isOnline
      user {
        name
      }
    }
  }
`);

const AcceptMutation = graphql(`
  mutation Accept($id: String!, $eta: Int!) {
    acceptOrder(id: $id, prepEtaMinutes: $eta) {
      id
      status
    }
  }
`);
const RejectMutation = graphql(`
  mutation Reject($id: String!, $reason: String!) {
    rejectOrder(id: $id, reason: $reason) {
      id
      status
    }
  }
`);
const StartPreparingMutation = graphql(`
  mutation StartPreparing($id: String!) {
    startPreparing(id: $id) {
      id
      status
    }
  }
`);
const MarkReadyMutation = graphql(`
  mutation MarkReady($id: String!) {
    markReady(id: $id) {
      id
      status
    }
  }
`);
const AssignRiderMutation = graphql(`
  mutation AssignRider($orderId: String!, $riderId: String!) {
    assignRider(orderId: $orderId, riderId: $riderId) {
      id
      status
    }
  }
`);

const BranchFeedSubscription = graphql(`
  subscription BranchFeed($branchId: String!) {
    branchOrderFeed(branchId: $branchId) {
      orderId
      status
    }
  }
`);

function Countdown({ deadline }: { deadline: string }) {
  const [left, setLeft] = useState(() => Math.max(0, new Date(deadline).getTime() - Date.now()));
  useEffect(() => {
    const t = setInterval(
      () => setLeft(Math.max(0, new Date(deadline).getTime() - Date.now())),
      1000,
    );
    return () => clearInterval(t);
  }, [deadline]);
  const s = Math.floor(left / 1000);
  return (
    <span className={`font-mono text-sm font-bold ${s < 30 ? "text-kd-danger" : "text-kd-warning"}`}>
      {Math.floor(s / 60)}:{String(s % 60).padStart(2, "0")}
    </span>
  );
}

type BoardOrder = {
  id: string;
  code: string;
  status: string;
  paymentMode: string;
  grandTotalMinor: number;
  customerNote?: string | null;
  acceptDeadlineAt: unknown;
  prepEtaMinutes?: number | null;
  items: Array<{ id: string; qty: number; menuSnapshotJson: unknown }>;
};

function OrderCard({ order, children }: { order: BoardOrder; children?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-kd-border bg-kd-surface p-3 text-sm shadow-sm">
      <div className="flex items-center justify-between">
        <span className="font-semibold">{order.code}</span>
        <Badge variant={order.paymentMode === "cod" ? "secondary" : "default"}>
          {order.paymentMode === "cod" ? "COD" : "PAID"} · {formatRs(order.grandTotalMinor)}
        </Badge>
      </div>
      <ul className="mt-1 text-kd-fg-muted">
        {order.items.map((i) => {
          const snap = i.menuSnapshotJson as { name?: string };
          return (
            <li key={i.id}>
              {i.qty} × {snap.name}
            </li>
          );
        })}
      </ul>
      {order.customerNote && (
        <p className="mt-1 text-xs italic text-kd-fg-subtle">“{order.customerNote}”</p>
      )}
      {children}
    </div>
  );
}

export default function OrdersBoardPage() {
  const { branch, restaurant } = useConsole();
  const [{ data, fetching }, refetch] = useQuery({
    query: BoardQuery,
    variables: { branchId: branch?.id ?? "" },
    pause: !branch,
    requestPolicy: "cache-and-network",
  });
  const [, accept] = useMutation(AcceptMutation);
  const [, reject] = useMutation(RejectMutation);
  const [, startPreparing] = useMutation(StartPreparingMutation);
  const [, markReady] = useMutation(MarkReadyMutation);
  const [, assignRider] = useMutation(AssignRiderMutation);

  // Live updates via SSE; a slow poll remains as a reconnect safety net.
  useSubscription(
    { query: BranchFeedSubscription, variables: { branchId: branch?.id ?? "" }, pause: !branch },
    (_prev, event) => {
      refetch({ requestPolicy: "network-only" });
      return event;
    },
  );
  useEffect(() => {
    if (!branch) return;
    const t = setInterval(() => refetch({ requestPolicy: "network-only" }), 30_000);
    return () => clearInterval(t);
  }, [branch, refetch]);

  if (!restaurant) {
    return fetching ? (
      <Skeleton className="h-64 rounded-2xl" />
    ) : (
      <p className="text-kd-fg-muted">
        No restaurant yet —{" "}
        <a href="/restaurant/onboarding" className="underline">
          complete onboarding
        </a>
        .
      </p>
    );
  }

  const orders = data?.boardOrders ?? [];
  const riders = data?.branchRiders ?? [];
  const byStatus = (statuses: string[]) => orders.filter((o) => statuses.includes(o.status));
  const done = byStatus([
    "delivered",
    "rejected",
    "cancelled",
    "auto_expired",
    "failed_delivery_attempt",
  ]).slice(0, 6);

  const refresh = () => refetch({ requestPolicy: "network-only" });

  return (
    <main>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold">{restaurant.name} — live board</h1>
        {!branch?.isAcceptingOrders && (
          <Badge variant="destructive">Paused — not accepting orders</Badge>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        {/* NEW */}
        <section>
          <h2 className="mb-2 text-sm font-bold uppercase text-kd-fg-muted">
            New ({byStatus(["pending_acceptance"]).length})
          </h2>
          <div className="space-y-2">
            {byStatus(["pending_acceptance"]).map((o) => (
              <OrderCard key={o.id} order={o}>
                <div className="mt-2 flex items-center justify-between">
                  <Countdown deadline={o.acceptDeadlineAt as string} />
                  <div className="flex gap-1">
                    <Button
                      size="xs"
                      onClick={async () => {
                        const eta = Number(prompt("Prep ETA in minutes:", "25") ?? "25");
                        if (Number.isFinite(eta) && eta > 0) {
                          await accept({ id: o.id, eta });
                          refresh();
                        }
                      }}
                    >
                      Accept
                    </Button>
                    <Button
                      size="xs"
                      variant="destructive"
                      onClick={async () => {
                        const reason = prompt("Rejection reason (required):");
                        if (reason?.trim()) {
                          await reject({ id: o.id, reason });
                          refresh();
                        }
                      }}
                    >
                      Reject
                    </Button>
                  </div>
                </div>
              </OrderCard>
            ))}
          </div>
        </section>

        {/* PREPARING */}
        <section>
          <h2 className="mb-2 text-sm font-bold uppercase text-kd-fg-muted">
            Preparing ({byStatus(["accepted", "preparing"]).length})
          </h2>
          <div className="space-y-2">
            {byStatus(["accepted", "preparing"]).map((o) => (
              <OrderCard key={o.id} order={o}>
                <div className="mt-2 flex items-center justify-between text-xs text-kd-fg-muted">
                  <span>ETA {o.prepEtaMinutes ?? "?"}m</span>
                  {o.status === "accepted" ? (
                    <Button
                      size="xs"
                      onClick={async () => {
                        await startPreparing({ id: o.id });
                        refresh();
                      }}
                    >
                      Start preparing
                    </Button>
                  ) : (
                    <Button
                      size="xs"
                      onClick={async () => {
                        await markReady({ id: o.id });
                        refresh();
                      }}
                    >
                      Mark ready
                    </Button>
                  )}
                </div>
              </OrderCard>
            ))}
          </div>
        </section>

        {/* READY */}
        <section>
          <h2 className="mb-2 text-sm font-bold uppercase text-kd-fg-muted">
            Ready ({byStatus(["ready_for_pickup"]).length})
          </h2>
          <div className="space-y-2">
            {byStatus(["ready_for_pickup"]).map((o) => (
              <OrderCard key={o.id} order={o}>
                <div className="mt-2">
                  <select
                    className="w-full rounded-lg border border-kd-border px-2 py-1 text-xs"
                    defaultValue=""
                    onChange={async (e) => {
                      if (e.target.value) {
                        await assignRider({ orderId: o.id, riderId: e.target.value });
                        refresh();
                      }
                    }}
                  >
                    <option value="" disabled>
                      Assign rider…
                    </option>
                    {riders.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.user.name ?? "Rider"} {r.isOnline ? "●" : "○"}
                      </option>
                    ))}
                  </select>
                </div>
              </OrderCard>
            ))}
          </div>
        </section>

        {/* OUT */}
        <section>
          <h2 className="mb-2 text-sm font-bold uppercase text-kd-fg-muted">
            Out ({byStatus(["rider_assigned", "picked_up", "out_for_delivery"]).length})
          </h2>
          <div className="space-y-2">
            {byStatus(["rider_assigned", "picked_up", "out_for_delivery"]).map((o) => (
              <OrderCard key={o.id} order={o}>
                <p className="mt-1 text-xs text-kd-fg-muted">{o.status.replace(/_/g, " ")}</p>
              </OrderCard>
            ))}
          </div>
        </section>

        {/* RECENT */}
        <section>
          <h2 className="mb-2 text-sm font-bold uppercase text-kd-fg-muted">Recent</h2>
          <div className="space-y-2 opacity-70">
            {done.map((o) => (
              <OrderCard key={o.id} order={o}>
                <p className="mt-1 text-xs text-kd-fg-muted">{o.status.replace(/_/g, " ")}</p>
              </OrderCard>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
