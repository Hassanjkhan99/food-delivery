"use client";

// Rider home: availability toggle + job queue. Polls 5s (SSE in M10).
import { useEffect } from "react";
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
    return fetching ? <Skeleton className="h-40 rounded-2xl" /> : (
      <p className="text-neutral-500">No rider profile for this account.</p>
    );
  }

  const jobs = data?.myJobs ?? [];
  const active = jobs.filter((j) => ACTIVE.includes(j.status));
  const past = jobs.filter((j) => !ACTIVE.includes(j.status)).slice(0, 5);

  return (
    <main className="space-y-4">
      <div className="flex items-center justify-between rounded-2xl border border-neutral-200 bg-white p-4">
        <div>
          <p className="font-semibold">{profile.isOnline ? "You're online" : "You're offline"}</p>
          <p className="text-xs text-neutral-500">{profile.riderType} rider</p>
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

      <section>
        <h2 className="mb-2 text-sm font-bold uppercase text-neutral-500">Active jobs</h2>
        {active.length === 0 && (
          <p className="rounded-xl bg-white p-6 text-center text-sm text-neutral-400">
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
                className="block rounded-2xl border border-neutral-200 bg-white p-4"
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold">{j.order.code}</span>
                  <Badge>{j.status.replace(/_/g, " ")}</Badge>
                </div>
                <p className="mt-1 text-sm text-neutral-600">
                  Pickup: {j.order.branch.restaurant.name}
                </p>
                <p className="text-sm text-neutral-600">Drop: {addr?.text ?? "—"}</p>
                {j.codAmountMinor > 0 && (
                  <p className="mt-1 text-sm font-semibold text-amber-700">
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
          <h2 className="mb-2 text-sm font-bold uppercase text-neutral-500">Recent</h2>
          <div className="space-y-1 opacity-70">
            {past.map((j) => (
              <div key={j.id} className="flex justify-between rounded-lg bg-white px-3 py-2 text-sm">
                <span>{j.order.code}</span>
                <span className="text-neutral-500">{j.status}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
