"use client";

// Rider home: availability toggle + cash panel + job queue, with a full-screen
// assignment/offer alert (#47) when a new task lands. SSE riderJobFeed drives refetch.
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useSubscription } from "urql";
import { graphql } from "@/graphql/generated";
import { formatRs } from "@fd/shared";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { CashPanel } from "@/components/rider/cash-panel";
import { AssignmentAlert, type AlertJob } from "@/components/rider/assignment-alert";

const RiderHomeQuery = graphql(`
  query RiderHome {
    myRiderProfile {
      riderId
      isOnline
      riderType
      cashLimitMinor
    }
    myCashSummary {
      todayCodCollectedMinor
      cashLimitMinor
      deliveriesToday
    }
    myJobs {
      id
      status
      offeredAt
      codAmountMinor
      order {
        id
        code
        status
        addressSnapshotJson
        branch {
          name
          addressText
          restaurant {
            name
          }
        }
      }
    }
  }
`);

const SetAvailabilityMutation = graphql(`
  mutation SetRiderAvailability($online: Boolean!) {
    setAvailability(online: $online)
  }
`);

const AcceptTaskMutation = graphql(`
  mutation RiderAcceptTask($taskId: String!) {
    acceptTask(taskId: $taskId) {
      id
      status
    }
  }
`);

const DeclineTaskMutation = graphql(`
  mutation RiderDeclineTask($taskId: String!) {
    declineTask(taskId: $taskId)
  }
`);

const RiderFeedSubscription = graphql(`
  subscription RiderFeed {
    riderJobFeed {
      orderId
      status
    }
  }
`);

const ACTIVE = ["assigned", "arrived_pickup", "picked_up"];

// Assignments the rider has already acknowledged this session, so the full-screen
// alert fires once per new assignment rather than on every refetch. Session-scoped
// (not persisted) — a reload re-surfaces an unstarted job, which is the safe default.
const ackedThisSession = new Set<string>();

export default function RiderHomePage() {
  const [{ data, fetching }, refetch] = useQuery({
    query: RiderHomeQuery,
    requestPolicy: "cache-and-network",
  });
  const [, setAvailability] = useMutation(SetAvailabilityMutation);
  const [, acceptTask] = useMutation(AcceptTaskMutation);
  const [, declineTask] = useMutation(DeclineTaskMutation);
  // Tracks the task currently being accepted/declined so we can disable the
  // controls and show a pending state (prevents double-submit on a swipe).
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [offerError, setOfferError] = useState<string | null>(null);
  const [ackTick, setAckTick] = useState(0); // re-render when the ack set changes

  // Live job feed via SSE; slow poll as a reconnect safety net.
  useSubscription(
    { query: RiderFeedSubscription, pause: !data?.myRiderProfile },
    (_prev, event) => {
      refetch({ requestPolicy: "network-only" });
      return event;
    },
  );
  useEffect(() => {
    const t = setInterval(() => refetch({ requestPolicy: "network-only" }), 30_000);
    return () => clearInterval(t);
  }, [refetch]);

  const profile = data?.myRiderProfile;
  const jobs = useMemo(() => data?.myJobs ?? [], [data?.myJobs]);

  // Offered jobs await the rider's accept/decline. Legacy auto-assign creates
  // "assigned" directly, so those stay in the active list untouched.
  const offered = jobs.filter((j) => j.status === "offered");
  const active = jobs.filter((j) => ACTIVE.includes(j.status));
  const past = jobs
    .filter((j) => j.status !== "offered" && !ACTIVE.includes(j.status))
    .slice(0, 5);

  // The alert surfaces the FIRST actionable job: an offer (accept/decline) if any,
  // otherwise a freshly-assigned job the rider hasn't acknowledged yet.
  const alertOffer = offered[0];
  const freshAssigned = active.find(
    (j) => j.status === "assigned" && !ackedThisSession.has(j.id),
  );
  const alertJobRaw = alertOffer ?? freshAssigned;
  const alertMode: "offer" | "acknowledge" = alertOffer ? "offer" : "acknowledge";

  const alertJob: AlertJob | null = alertJobRaw
    ? {
        id: alertJobRaw.id,
        code: alertJobRaw.order.code,
        pickupName: alertJobRaw.order.branch.restaurant.name,
        dropText:
          (alertJobRaw.order.addressSnapshotJson as { text?: string })?.text ?? "",
        codAmountMinor: alertJobRaw.codAmountMinor,
      }
    : null;

  async function onAccept(taskId: string) {
    setPendingId(taskId);
    setOfferError(null);
    const res = await acceptTask({ taskId });
    setPendingId(null);
    if (res.error) {
      // e.g. "Offer is no longer available" when re-offered/taken concurrently.
      setOfferError(res.error.graphQLErrors[0]?.message ?? "Could not accept this job.");
    } else {
      // The accept promoted this task offered→assigned. Mark it acknowledged so the
      // refetch doesn't immediately re-surface it as a "fresh assignment" alert.
      acknowledge(taskId);
    }
    refetch({ requestPolicy: "network-only" });
  }

  async function onDecline(taskId: string) {
    setPendingId(taskId);
    setOfferError(null);
    const res = await declineTask({ taskId });
    setPendingId(null);
    if (res.error) {
      setOfferError(res.error.graphQLErrors[0]?.message ?? "Could not decline this job.");
    }
    refetch({ requestPolicy: "network-only" });
  }

  function acknowledge(taskId: string) {
    ackedThisSession.add(taskId);
    setAckTick((n) => n + 1);
  }
  // ackTick keeps the linter honest that the ack set drives rendering.
  void ackTick;

  if (!profile) {
    return fetching ? (
      <Skeleton className="h-40 rounded-2xl" />
    ) : (
      <p className="text-kd-fg-muted">No rider profile for this account.</p>
    );
  }

  const cash = data?.myCashSummary;

  return (
    <main className="space-y-4">
      {alertJob && (
        <AssignmentAlert
          job={alertJob}
          mode={alertMode}
          busy={pendingId === alertJob.id}
          onAccept={() => onAccept(alertJob.id)}
          onDecline={() => onDecline(alertJob.id)}
          onAcknowledge={() => acknowledge(alertJob.id)}
        />
      )}

      <div className="flex items-center justify-between rounded-2xl border border-kd-border bg-kd-surface p-4">
        <div>
          <p className="font-semibold">{profile.isOnline ? "You're online" : "You're offline"}</p>
          <p className="text-xs text-kd-fg-muted">{profile.riderType} rider</p>
        </div>
        <Button
          variant={profile.isOnline ? "destructive" : "default"}
          onClick={async () => {
            await setAvailability({ online: !profile.isOnline });
            refetch({ requestPolicy: "network-only" });
          }}
        >
          {profile.isOnline ? "Go offline" : "Go online"}
        </Button>
      </div>

      <CashPanel
        collectedMinor={cash?.todayCodCollectedMinor ?? 0}
        limitMinor={cash?.cashLimitMinor ?? profile.cashLimitMinor}
        deliveriesToday={cash?.deliveriesToday ?? 0}
      />

      {offered.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-bold uppercase text-kd-fg-muted">New offers</h2>
          {offerError && (
            <p className="mb-2 rounded-lg bg-kd-danger-soft px-3 py-2 text-sm text-kd-danger">
              {offerError}
            </p>
          )}
          <div className="space-y-2">
            {offered.map((j) => {
              const addr = j.order.addressSnapshotJson as { text?: string };
              const busy = pendingId === j.id;
              return (
                <div
                  key={j.id}
                  className="rounded-2xl border border-kd-border bg-kd-surface p-4"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">{j.order.code}</span>
                    <Badge variant="secondary">Offer</Badge>
                  </div>
                  <p className="mt-1 text-sm text-kd-fg-muted">
                    Pickup: {j.order.branch.restaurant.name}
                  </p>
                  <p className="text-sm text-kd-fg-muted">Drop: {addr?.text ?? "—"}</p>
                  {j.codAmountMinor > 0 && (
                    <p className="mt-1 text-sm font-semibold text-kd-warning">
                      Collect {formatRs(j.codAmountMinor)} (COD)
                    </p>
                  )}
                  <div className="mt-3 flex gap-2">
                    <Button
                      className="flex-1"
                      disabled={busy}
                      onClick={() => onAccept(j.id)}
                    >
                      {busy ? "Accepting…" : "Accept"}
                    </Button>
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() => onDecline(j.id)}
                    >
                      Decline
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-2 text-sm font-bold uppercase text-kd-fg-muted">Active jobs</h2>
        {active.length === 0 && (
          <p className="rounded-xl bg-kd-surface p-6 text-center text-sm text-kd-fg-subtle">
            No active jobs — new assignments appear here.
          </p>
        )}
        <div className="space-y-2">
          {active.map((j) => {
            const addr = j.order.addressSnapshotJson as { text?: string };
            return (
              <Link
                key={j.id}
                href={`/rider/jobs/${j.id}`}
                className="block rounded-2xl border border-kd-border bg-kd-surface p-4"
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold">{j.order.code}</span>
                  <Badge>{j.status.replace(/_/g, " ")}</Badge>
                </div>
                <p className="mt-1 text-sm text-kd-fg-muted">
                  Pickup: {j.order.branch.restaurant.name}
                </p>
                <p className="text-sm text-kd-fg-muted">Drop: {addr?.text ?? "—"}</p>
                {j.codAmountMinor > 0 && (
                  <p className="mt-1 text-sm font-semibold text-kd-warning">
                    Collect {formatRs(j.codAmountMinor)} (COD)
                  </p>
                )}
              </Link>
            );
          })}
        </div>
      </section>

      {past.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-bold uppercase text-kd-fg-muted">Recent</h2>
          <div className="space-y-1 opacity-70">
            {past.map((j) => (
              <div
                key={j.id}
                className="flex justify-between rounded-lg bg-kd-surface px-3 py-2 text-sm"
              >
                <span>{j.order.code}</span>
                <span className="text-kd-fg-muted">{j.status}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
