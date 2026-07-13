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
import { useLocationPing, IDLE_PING_INTERVAL_MS } from "@/components/rider/use-location-ping";

// Map the 0–100 trust score to a rider-facing standing label (#164). Bands are a
// first cut — trustScore itself is computed by riderTrustService (#28/#25); this only
// surfaces it. Higher = better standing / more shared-offer eligibility.
function trustLabel(score: number): { label: string; tone: "success" | "muted" | "warning" } {
  if (score >= 85) return { label: "Trusted", tone: "success" };
  if (score >= 60) return { label: "Good standing", tone: "muted" };
  return { label: "At risk", tone: "warning" };
}

// "updated Xs ago" for the online location-freshness line.
function relativeAge(iso: string | null | undefined): string {
  if (!iso) return "not shared yet";
  const secs = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 15) return "just now";
  if (secs < 60) return `${secs}s ago`;
  return `${Math.round(secs / 60)} min ago`;
}

const RiderHomeQuery = graphql(`
  query RiderHome {
    myRiderProfile {
      riderId
      isOnline
      riderType
      cashLimitMinor
      lastLocationAt
      trustScore
      codDisabled
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

  // Idle heartbeat (#163): while online (even with no active job) keep a slow location
  // ping running so dispatch has a fresh fix for proximity and the customer map gets a
  // head-start dot the moment a job lands. Stops when offline to protect battery. The
  // per-job page runs a faster ping during active delivery.
  const locationStatus = useLocationPing(!!profile?.isOnline, IDLE_PING_INTERVAL_MS);

  // Offered jobs await the rider's accept/decline. Legacy auto-assign creates
  // "assigned" directly, so those stay in the active list untouched.
  const offered = jobs.filter((j) => j.status === "offered");
  const active = jobs.filter((j) => ACTIVE.includes(j.status));
  const past = jobs.filter((j) => j.status !== "offered" && !ACTIVE.includes(j.status)).slice(0, 5);

  // The alert surfaces the FIRST actionable job: an offer (accept/decline) if any,
  // otherwise a freshly-assigned job the rider hasn't acknowledged yet.
  const alertOffer = offered[0];
  const freshAssigned = active.find((j) => j.status === "assigned" && !ackedThisSession.has(j.id));
  const alertJobRaw = alertOffer ?? freshAssigned;
  const alertMode: "offer" | "acknowledge" = alertOffer ? "offer" : "acknowledge";

  const alertJob: AlertJob | null = alertJobRaw
    ? {
        id: alertJobRaw.id,
        code: alertJobRaw.order.code,
        pickupName: alertJobRaw.order.branch.restaurant.name,
        dropText: (alertJobRaw.order.addressSnapshotJson as { text?: string })?.text ?? "",
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
          codBlocked={profile.codDisabled && alertJob.codAmountMinor > 0}
          onAccept={() => onAccept(alertJob.id)}
          onDecline={() => onDecline(alertJob.id)}
          onAcknowledge={() => acknowledge(alertJob.id)}
        />
      )}

      {/* COD-disabled banner (#164): a rider auto-blocked from cash orders (#25) sees this
          up front, not only when an accept fails. */}
      {profile.codDisabled && (
        <div className="rounded-2xl border border-kd-danger bg-kd-danger-soft p-4">
          <p className="text-sm font-semibold text-kd-danger">
            Cash-on-delivery is disabled on your account
          </p>
          <p className="mt-1 text-xs text-kd-danger">
            You can still take prepaid orders. Contact support to restore COD.
          </p>
        </div>
      )}

      <div className="rounded-2xl border border-kd-border bg-kd-surface p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-semibold">{profile.isOnline ? "You're online" : "You're offline"}</p>
            <p className="flex items-center gap-1.5 text-xs text-kd-fg-muted">
              <span>{profile.riderType} rider</span>
              <span aria-hidden>·</span>
              {(() => {
                const trust = trustLabel(profile.trustScore);
                const toneClass =
                  trust.tone === "success"
                    ? "text-kd-success"
                    : trust.tone === "warning"
                      ? "text-kd-warning"
                      : "text-kd-fg-muted";
                return (
                  <span className={`font-medium ${toneClass}`}>
                    {trust.label} · {profile.trustScore}
                  </span>
                );
              })()}
            </p>
          </div>
          <Button
            variant={profile.isOnline ? "destructive" : "default"}
            onClick={async () => {
              // Going online: request the location permission up front, tied to this
              // explicit tap, so the browser prompt has clear context and we can warn if
              // it's blocked. We still go online even if denied — the backend doesn't
              // require a fix — but the rider sees why customers can't track them.
              if (!profile.isOnline && typeof navigator !== "undefined" && navigator.geolocation) {
                navigator.geolocation.getCurrentPosition(
                  () => {},
                  () => {},
                  { timeout: 10_000 },
                );
              }
              await setAvailability({ online: !profile.isOnline });
              refetch({ requestPolicy: "network-only" });
            }}
          >
            {profile.isOnline ? "Go offline" : "Go online"}
          </Button>
        </div>

        {/* Location permission / freshness (#163). */}
        {profile.isOnline ? (
          locationStatus === "denied" ? (
            <p className="mt-3 rounded-lg bg-kd-warning-soft px-3 py-2 text-xs text-kd-warning">
              Location is blocked — customers can&apos;t see you move and you won&apos;t be matched
              to nearby orders. Enable location for this site in your browser settings, then reload.
            </p>
          ) : locationStatus === "unavailable" ? (
            <p className="mt-3 text-xs text-kd-fg-subtle">
              Live location isn&apos;t available on this device.
            </p>
          ) : (
            <p className="mt-3 text-xs text-kd-fg-muted">
              Sharing your location · updated {relativeAge(profile.lastLocationAt)}
            </p>
          )
        ) : (
          <p className="mt-3 text-xs text-kd-fg-subtle">
            We use your location to match nearby orders and let customers track you while you
            deliver.
          </p>
        )}
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
              // A COD-disabled rider can't take a cash offer — the server would reject
              // acceptTask anyway (#25), so block it here with a reason instead. (#164)
              const codBlocked = profile.codDisabled && j.codAmountMinor > 0;
              return (
                <div key={j.id} className="rounded-2xl border border-kd-border bg-kd-surface p-4">
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
                  {codBlocked && (
                    <p className="mt-1 text-xs text-kd-danger">
                      You can&apos;t take this — cash-on-delivery is disabled on your account.
                    </p>
                  )}
                  <div className="mt-3 flex gap-2">
                    <Button
                      className="flex-1"
                      disabled={busy || codBlocked}
                      onClick={() => onAccept(j.id)}
                    >
                      {busy ? "Accepting…" : "Accept"}
                    </Button>
                    <Button variant="outline" disabled={busy} onClick={() => onDecline(j.id)}>
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
