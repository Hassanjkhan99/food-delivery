"use client";

// Rider home: availability toggle + job queue. Polls 5s (SSE in M10).
import { useEffect, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useSubscription } from "urql";
import { graphql } from "@/graphql/generated";
import { formatRs } from "@fd/shared";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

const RiderHomeQuery = graphql(`
  query RiderHome {
    myRiderProfile {
      riderId
      isOnline
      riderType
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
  if (!profile) {
    return fetching ? (
      <Skeleton className="h-40 rounded-2xl" />
    ) : (
      <p className="text-kd-fg-muted">No rider profile for this account.</p>
    );
  }

  const jobs = data?.myJobs ?? [];
  // Offered jobs await the rider's accept/decline. Legacy auto-assign creates
  // "assigned" directly, so those stay in the active list untouched.
  const offered = jobs.filter((j) => j.status === "offered");
  const active = jobs.filter((j) => ACTIVE.includes(j.status));
  const past = jobs.filter(
    (j) => j.status !== "offered" && !ACTIVE.includes(j.status),
  ).slice(0, 5);

  async function onAccept(taskId: string) {
    setPendingId(taskId);
    setOfferError(null);
    const res = await acceptTask({ taskId });
    setPendingId(null);
    if (res.error) {
      // e.g. "Offer is no longer available" when re-offered/taken concurrently.
      setOfferError(res.error.graphQLErrors[0]?.message ?? "Could not accept this job.");
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

  return (
    <main className="space-y-4">
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
