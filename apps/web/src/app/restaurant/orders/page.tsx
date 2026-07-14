"use client";

// Live order board (vendor console v2, #46). New / Preparing / Ready / Out / Recent columns
// with countdowns and SSE updates. v2 adds: a looping new-order alarm (sound + tab flash +
// notification), proper accept/reject sheets (no more prompt()!), a per-order "86 an item"
// quick-action, a kitchen-ticket print slip, and a busy-mode buffer in the header.
import { useEffect, useState } from "react";
import { useMutation, useQuery, useSubscription } from "urql";
import { graphql } from "@/graphql/generated";
import {
  DEFAULT_UNAVAILABILITY_PREFERENCE,
  formatRs,
  unavailabilityPreferenceLabel,
} from "@fd/shared";
import { comboComponents } from "@/lib/orderSnapshot";
import { useConsole } from "../useConsole";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Bell, BellOff, Printer, Ban } from "lucide-react";
import { useOrderAlarm } from "./useOrderAlarm";
import { AcceptSheet, RejectSheet } from "./OrderDialogs";
import { EightySixSheet, type EightySixTarget } from "./EightySixSheet";
import { printKitchenTicket, type TicketOrder } from "./KitchenTicket";

const BoardQuery = graphql(`
  query Board($branchId: String!) {
    boardOrders(branchId: $branchId) {
      id
      code
      status
      paymentMode
      fulfillmentMode
      pickupCode
      scheduledFor
      grandTotalMinor
      customerNote
      cutleryRequested
      acceptDeadlineAt
      prepEtaMinutes
      placedAt
      contactPhone
      pickupPin
      customerName
      items {
        id
        qty
        notes
        menuSnapshotJson
      }
    }
    branchRiders(branchId: $branchId) {
      id
      riderType
      isOnline
      # #118: whether this rider is barred from COD, so the picker can disable them for a
      # COD order instead of letting assignRider fail with rider_cod_disabled.
      codDisabled
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
const SetBusyModeMutation = graphql(`
  mutation SetBusyMode($branchId: String!, $bufferMinutes: Int!) {
    setBusyMode(branchId: $branchId, bufferMinutes: $bufferMinutes) {
      id
      prepBufferMinutes
    }
  }
`);
const Set86Mutation = graphql(`
  mutation Set86($itemId: String!, $available: Boolean!, $until: String) {
    setItemAvailability(itemId: $itemId, available: $available, until: $until) {
      id
      isAvailable
    }
  }
`);
// Currently-86'd live items, so staff can restock without the owner-only menu page (#204).
const UnavailableItemsQuery = graphql(`
  query BranchUnavailableItems($branchId: String!) {
    branchUnavailableItems(branchId: $branchId) {
      id
      name
    }
  }
`);
const MarkCollectedMutation = graphql(`
  mutation MarkCollected($id: String!) {
    markCollected(id: $id) {
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
    <span
      className={`font-mono text-sm font-bold ${s < 30 ? "text-kd-danger" : "text-kd-warning"}`}
    >
      {Math.floor(s / 60)}:{String(s % 60).padStart(2, "0")}
    </span>
  );
}

type BoardItem = { id: string; qty: number; notes?: string | null; menuSnapshotJson: unknown };
type BoardOrder = {
  id: string;
  code: string;
  status: string;
  paymentMode: string;
  fulfillmentMode?: string | null;
  pickupCode?: string | null;
  scheduledFor?: unknown;
  grandTotalMinor: number;
  customerName?: string | null;
  customerNote?: string | null;
  cutleryRequested?: boolean | null;
  contactPhone?: string | null;
  acceptDeadlineAt: unknown;
  prepEtaMinutes?: number | null;
  placedAt?: unknown;
  pickupPin?: string | null;
  items: BoardItem[];
};

type ItemSnap = {
  menuItemId?: string;
  name?: string;
  modifiers?: Array<{ name?: string; optionName?: string } | string>;
};

// Distinct linked menu items on an order, for the "86 an item" picker.
function eightySixTargets(order: BoardOrder): EightySixTarget[] {
  const seen = new Map<string, string>();
  for (const it of order.items) {
    const snap = it.menuSnapshotJson as ItemSnap | null;
    if (snap?.menuItemId && snap.name && !seen.has(snap.menuItemId)) {
      seen.set(snap.menuItemId, snap.name);
    }
  }
  return [...seen.entries()].map(([menuItemId, name]) => ({ menuItemId, name }));
}

function toTicket(order: BoardOrder): TicketOrder {
  return {
    code: order.code,
    placedAt: order.placedAt ? String(order.placedAt) : null,
    paymentMode: order.paymentMode,
    grandTotalMinor: order.grandTotalMinor,
    customerNote: order.customerNote,
    cutleryRequested: order.cutleryRequested,
    items: order.items.map((it) => {
      const snap = it.menuSnapshotJson as ItemSnap | null;
      return {
        qty: it.qty,
        name: snap?.name ?? "Item",
        modifiers: snap?.modifiers ?? null,
        components: comboComponents(it.menuSnapshotJson),
        notes: it.notes,
      };
    }),
  };
}

// Handoff PIN shown to staff so they can read it out to the rider at pickup. The rider
// enters it in their app to confirm they're collecting the right order (#25).
function PickupPin({ pin }: { pin: string }) {
  return (
    <p className="mt-2 rounded-lg bg-kd-surface-muted p-2 text-center text-xs text-kd-fg-muted">
      Pickup PIN{" "}
      <span className="font-mono text-sm font-bold tracking-widest text-kd-fg">{pin}</span>
    </p>
  );
}

function OrderCard({ order, children }: { order: BoardOrder; children?: React.ReactNode }) {
  const isPickup = order.fulfillmentMode === "pickup";
  const scheduledFor = order.scheduledFor as string | null | undefined;
  return (
    <div className="rounded-xl border border-kd-border bg-kd-surface p-3 text-sm shadow-sm">
      <div className="flex items-center justify-between">
        <span className="font-semibold">{order.code}</span>
        <Badge variant={order.paymentMode === "cod" ? "secondary" : "default"}>
          {order.paymentMode === "cod" ? "COD" : "PAID"} · {formatRs(order.grandTotalMinor)}
        </Badge>
      </div>
      {order.customerName && (
        <p className="mt-0.5 text-xs text-kd-fg-muted">{order.customerName}</p>
      )}
      {(isPickup || scheduledFor) && (
        <div className="mt-1 flex flex-wrap gap-1">
          {isPickup && <Badge variant="outline">Pickup</Badge>}
          {scheduledFor && (
            <Badge variant="outline">
              {new Date(scheduledFor).toLocaleString([], {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
            </Badge>
          )}
        </div>
      )}
      <ul className="mt-1 space-y-0.5 text-kd-fg-muted">
        {order.items.map((i) => {
          const snap = i.menuSnapshotJson as {
            name?: string;
            unavailabilityPreference?: string;
          };
          const components = comboComponents(i.menuSnapshotJson);
          // Only surface a non-default preference — "remove item" is the norm and
          // would just add noise to every line.
          const pref = snap.unavailabilityPreference ?? DEFAULT_UNAVAILABILITY_PREFERENCE;
          return (
            <li key={i.id}>
              {i.qty} × {snap.name}
              {pref !== DEFAULT_UNAVAILABILITY_PREFERENCE && (
                <span className="ml-1 text-xs font-medium text-kd-warning">
                  (if out: {unavailabilityPreferenceLabel(pref)}
                  {pref === "contact_me" && order.contactPhone && (
                    <>
                      {" · "}
                      <a href={`tel:${order.contactPhone}`} className="underline">
                        {order.contactPhone}
                      </a>
                    </>
                  )}
                  )
                </span>
              )}
              {components.length > 0 && (
                // Combo line: show the frozen components so kitchen staff know what to make.
                <ul className="ml-4 mt-0.5 list-disc space-y-0.5 text-xs text-kd-fg-subtle">
                  {components.map((c, idx) => (
                    <li key={c.menuItemId ?? idx}>
                      {c.qty * i.qty} × {c.name}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
      {order.customerNote && (
        <p className="mt-1 text-xs italic text-kd-fg-subtle">“{order.customerNote}”</p>
      )}
      {!order.cutleryRequested && (
        <p className="mt-1 text-xs font-medium text-kd-warning">No cutlery / napkins</p>
      )}
      {children}
    </div>
  );
}

export default function OrdersBoardPage() {
  const { branch, restaurant, refetch: refetchConsole } = useConsole();
  const [{ data, fetching }, refetch] = useQuery({
    query: BoardQuery,
    variables: { branchId: branch?.id ?? "" },
    pause: !branch,
    requestPolicy: "cache-and-network",
  });
  const [{ data: unavailableData }, refetchUnavailable] = useQuery({
    query: UnavailableItemsQuery,
    variables: { branchId: branch?.id ?? "" },
    pause: !branch,
    requestPolicy: "cache-and-network",
  });
  const [, accept] = useMutation(AcceptMutation);
  const [, reject] = useMutation(RejectMutation);
  const [, startPreparing] = useMutation(StartPreparingMutation);
  const [, markReady] = useMutation(MarkReadyMutation);
  const [, assignRider] = useMutation(AssignRiderMutation);
  const [, setBusyMode] = useMutation(SetBusyModeMutation);
  const [, set86] = useMutation(Set86Mutation);
  const [, markCollected] = useMutation(MarkCollectedMutation);

  // Which order (if any) has an open accept / reject / 86 sheet.
  const [acceptFor, setAcceptFor] = useState<BoardOrder | null>(null);
  const [rejectFor, setRejectFor] = useState<BoardOrder | null>(null);
  const [eightySixFor, setEightySixFor] = useState<BoardOrder | null>(null);
  // Rider-assign error surfaced inline per order (#118): e.g. `rider_cod_disabled` when a
  // COD-disabled rider slips through, keyed by order id so it shows under the right card.
  const [assignError, setAssignError] = useState<Record<string, string>>({});

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

  const orders = data?.boardOrders ?? [];
  const byStatus = (statuses: string[]) => orders.filter((o) => statuses.includes(o.status));
  // Scheduled orders get their own lane (#158): a pre-order (scheduledFor set) shouldn't
  // clutter the immediate queue or trip the new-order alarm — it's for prep planning. The
  // card shows the target time; the restaurant accepts it when they start on it. (Auto-
  // promoting to New at scheduledFor − leadTime is a noted follow-up in orderService.ts.)
  const scheduledOrders = orders.filter(
    (o) => o.status === "pending_acceptance" && !!o.scheduledFor,
  );
  const newOrders = byStatus(["pending_acceptance"]).filter((o) => !o.scheduledFor);
  const busyBuffer = branch?.prepBufferMinutes ?? 0;

  // New-order alarm — must run every render (hooks can't be conditional), so it lives
  // above the early return below.
  const alarm = useOrderAlarm(newOrders.length, restaurant?.name ?? "New order");

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

  const riders = data?.branchRiders ?? [];
  const done = byStatus([
    "delivered",
    "rejected",
    "cancelled",
    "auto_expired",
    "failed_delivery_attempt",
  ]).slice(0, 6);

  const refresh = () => {
    refetch({ requestPolicy: "network-only" });
    refetchUnavailable({ requestPolicy: "network-only" });
  };
  const restock = async (itemId: string) => {
    await set86({ itemId, available: true });
    refresh();
  };
  const setBusy = async (minutes: number) => {
    if (!branch) return;
    await setBusyMode({ branchId: branch.id, bufferMinutes: minutes });
    // busyBuffer / the accept-sheet ETA come from the console branch, not the board query,
    // so refetch the console to pull the new prepBufferMinutes; refresh the board too.
    refetchConsole({ requestPolicy: "network-only" });
    refresh();
  };

  return (
    <main>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold">{restaurant.name} — live board</h1>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant={alarm.soundOn ? "outline" : "ghost"}
            onClick={alarm.toggleSound}
            title={alarm.soundOn ? "Mute new-order alarm" : "Unmute new-order alarm"}
          >
            {alarm.soundOn ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
            {alarm.soundOn ? "Alarm on" : "Muted"}
          </Button>
          {!branch?.isAcceptingOrders && (
            <Badge variant="destructive">Paused — not accepting orders</Badge>
          )}
        </div>
      </div>

      {/* Busy mode banner */}
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-kd-border bg-kd-surface px-3 py-2 text-sm">
        <span className="font-medium">Busy mode:</span>
        {busyBuffer > 0 ? (
          <Badge variant="destructive">+{busyBuffer}m on all ETAs</Badge>
        ) : (
          <span className="text-kd-fg-muted">off</span>
        )}
        <div className="ml-auto flex gap-1">
          {[10, 20, 30].map((m) => (
            <Button
              key={m}
              size="xs"
              variant={busyBuffer === m ? "default" : "outline"}
              onClick={() => setBusy(m)}
            >
              +{m}m
            </Button>
          ))}
          {busyBuffer > 0 && (
            <Button size="xs" variant="ghost" onClick={() => setBusy(0)}>
              Clear
            </Button>
          )}
        </div>
      </div>

      {/* 86'd items — staff can restock here without the owner-only menu page (#204). */}
      {(unavailableData?.branchUnavailableItems?.length ?? 0) > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-kd-border bg-kd-surface px-3 py-2 text-sm">
          <span className="font-medium">86&apos;d items:</span>
          {unavailableData!.branchUnavailableItems.map((it) => (
            <Button
              key={it.id}
              size="xs"
              variant="outline"
              onClick={() => restock(it.id)}
              title={`Restock ${it.name}`}
            >
              {it.name} — restock
            </Button>
          ))}
        </div>
      )}

      {/* New-order acknowledge bar */}
      {alarm.active && (
        <button
          onClick={alarm.acknowledge}
          className="mb-4 flex w-full items-center justify-center gap-2 rounded-xl bg-kd-primary px-4 py-3 font-bold text-white shadow-sm"
        >
          <Bell className="h-5 w-5 animate-bounce" />
          {newOrders.length} new order{newOrders.length === 1 ? "" : "s"} — tap to silence
        </button>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
        {/* SCHEDULED — future scheduledFor, prep-planning lane */}
        {scheduledOrders.length > 0 && (
          <section>
            <h2 className="mb-2 text-sm font-bold uppercase text-kd-fg-muted">
              Scheduled ({scheduledOrders.length})
            </h2>
            <div className="space-y-2">
              {scheduledOrders.map((o) => (
                <OrderCard key={o.id} order={o}>
                  <div className="mt-2 flex gap-1">
                    <Button size="xs" onClick={() => setAcceptFor(o)}>
                      Accept
                    </Button>
                    <Button size="xs" variant="destructive" onClick={() => setRejectFor(o)}>
                      Reject
                    </Button>
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => printKitchenTicket(toTicket(o))}
                      title="Print kitchen ticket"
                    >
                      <Printer className="h-3 w-3" /> Ticket
                    </Button>
                  </div>
                </OrderCard>
              ))}
            </div>
          </section>
        )}

        {/* NEW */}
        <section>
          <h2 className="mb-2 text-sm font-bold uppercase text-kd-fg-muted">
            New ({newOrders.length})
          </h2>
          <div className="space-y-2">
            {newOrders.map((o) => (
              <OrderCard key={o.id} order={o}>
                <div className="mt-2 flex items-center justify-between">
                  <Countdown deadline={o.acceptDeadlineAt as string} />
                  <div className="flex gap-1">
                    <Button size="xs" onClick={() => setAcceptFor(o)}>
                      Accept
                    </Button>
                    <Button size="xs" variant="destructive" onClick={() => setRejectFor(o)}>
                      Reject
                    </Button>
                  </div>
                </div>
                <div className="mt-1 flex gap-1">
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => setEightySixFor(o)}
                    title="Mark an item unavailable"
                  >
                    <Ban className="h-3 w-3" /> 86 item
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => printKitchenTicket(toTicket(o))}
                    title="Print kitchen ticket"
                  >
                    <Printer className="h-3 w-3" /> Ticket
                  </Button>
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
                  <div className="flex gap-1">
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => printKitchenTicket(toTicket(o))}
                      title="Print kitchen ticket"
                    >
                      <Printer className="h-3 w-3" />
                    </Button>
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
            {byStatus(["ready_for_pickup"]).map((o) =>
              o.fulfillmentMode === "pickup" ? (
                // Pickup (#54): no rider — verify the customer's code and mark collected.
                <OrderCard key={o.id} order={o}>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className="text-xs text-kd-fg-muted">
                      Code:{" "}
                      <span className="font-mono font-semibold text-kd-fg">
                        {o.pickupCode ?? "—"}
                      </span>
                    </span>
                    <Button
                      size="xs"
                      onClick={async () => {
                        await markCollected({ id: o.id });
                        refresh();
                      }}
                    >
                      Mark collected
                    </Button>
                  </div>
                </OrderCard>
              ) : (
                <OrderCard key={o.id} order={o}>
                  <div className="mt-2">
                    <select
                      className="w-full rounded-lg border border-kd-border px-2 py-1 text-xs"
                      defaultValue=""
                      onChange={async (e) => {
                        if (e.target.value) {
                          const res = await assignRider({ orderId: o.id, riderId: e.target.value });
                          // Surface the server guard (#118): a COD-disabled rider can't
                          // take a COD order (code `rider_cod_disabled`). Show the message
                          // and reset the picker rather than silently no-op.
                          if (res.error) {
                            setAssignError((m) => ({
                              ...m,
                              [o.id]: res.error?.graphQLErrors[0]?.message ?? "Couldn't assign.",
                            }));
                            e.target.value = "";
                            return;
                          }
                          setAssignError((m) => {
                            if (!(o.id in m)) return m;
                            const rest = { ...m };
                            delete rest[o.id];
                            return rest;
                          });
                          refresh();
                        }
                      }}
                    >
                      <option value="" disabled>
                        Assign rider…
                      </option>
                      {riders.map((r) => {
                        // #118: a COD-disabled rider can't take a COD order — disable and
                        // label them in the picker so dispatch never tries the assign.
                        const codBlocked = o.paymentMode === "cod" && r.codDisabled;
                        return (
                          <option key={r.id} value={r.id} disabled={codBlocked}>
                            {r.user.name ?? "Rider"} {r.isOnline ? "●" : "○"}
                            {codBlocked ? " · no COD" : ""}
                          </option>
                        );
                      })}
                    </select>
                    {assignError[o.id] && (
                      <p className="mt-1 text-xs text-kd-danger">{assignError[o.id]}</p>
                    )}
                  </div>
                  {o.pickupPin && <PickupPin pin={o.pickupPin} />}
                </OrderCard>
              ),
            )}
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
                {o.status === "rider_assigned" && o.pickupPin && <PickupPin pin={o.pickupPin} />}
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

      {/* Sheets */}
      <AcceptSheet
        open={acceptFor !== null}
        code={acceptFor?.code ?? ""}
        bufferMinutes={busyBuffer}
        onClose={() => setAcceptFor(null)}
        onConfirm={async (eta) => {
          if (acceptFor) {
            await accept({ id: acceptFor.id, eta });
            refresh();
          }
        }}
      />
      <RejectSheet
        open={rejectFor !== null}
        code={rejectFor?.code ?? ""}
        onClose={() => setRejectFor(null)}
        onConfirm={async (reason) => {
          if (rejectFor) {
            await reject({ id: rejectFor.id, reason });
            refresh();
          }
        }}
      />
      <EightySixSheet
        open={eightySixFor !== null}
        items={eightySixFor ? eightySixTargets(eightySixFor) : []}
        onClose={() => setEightySixFor(null)}
        onConfirm={async (menuItemId, until) => {
          await set86({ itemId: menuItemId, available: false, until });
          refresh();
        }}
      />
    </main>
  );
}
