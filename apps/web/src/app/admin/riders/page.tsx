"use client";

// Admin rider verification queue + roster. Mirrors the restaurant approval page:
// pending riders await review (with their uploaded docs), approve/reject with reason,
// and trust scores can be recomputed on demand.
import { useMutation, useQuery } from "urql";
import { graphql } from "@/graphql/generated";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const RidersQuery = graphql(`
  query AdminRiders {
    riderVerificationQueue {
      id
      riderType
      verificationStatus
      trustScore
      vehicleType
      vehiclePlate
      trainingCompleted
      agreementAccepted
      user {
        name
        phone
      }
      verificationDocs {
        id
        kind
        asset {
          url
        }
      }
    }
    allRiders {
      id
      riderType
      verificationStatus
      trustScore
      sharedModeEnabled
      user {
        name
        phone
      }
    }
  }
`);

const ApproveMutation = graphql(`
  mutation ApproveRider($id: String!) {
    approveRider(id: $id) {
      id
      verificationStatus
    }
  }
`);
const RejectMutation = graphql(`
  mutation RejectRider($id: String!, $reason: String!) {
    rejectRider(id: $id, reason: $reason) {
      id
      verificationStatus
    }
  }
`);
const RecomputeMutation = graphql(`
  mutation RecomputeRiderTrust($id: String!) {
    recomputeRiderTrust(id: $id) {
      id
      trustScore
    }
  }
`);

function statusVariant(status: string): "default" | "secondary" | "destructive" {
  if (status === "verified") return "default";
  if (status === "rejected") return "destructive";
  return "secondary";
}

export default function AdminRidersPage() {
  const [{ data, error }, refetch] = useQuery({
    query: RidersQuery,
    requestPolicy: "cache-and-network",
  });
  const [, approve] = useMutation(ApproveMutation);
  const [, reject] = useMutation(RejectMutation);
  const [, recompute] = useMutation(RecomputeMutation);
  const refresh = () => refetch({ requestPolicy: "network-only" });

  const queue = data?.riderVerificationQueue ?? [];
  const all = data?.allRiders ?? [];

  return (
    <main className="max-w-3xl space-y-8">
      <section>
        <h1 className="mb-4 text-xl font-bold">Rider verification queue</h1>
        {error && <p className="text-sm text-kd-danger">{error.message}</p>}
        {queue.length === 0 && (
          <p className="rounded-xl bg-kd-surface p-6 text-center text-sm text-kd-fg-subtle">
            No riders awaiting verification.
          </p>
        )}
        <div className="space-y-2">
          {queue.map((r) => (
            <div
              key={r.id}
              className="rounded-xl border border-kd-border bg-kd-surface p-4 text-sm"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium">{r.user.name ?? "Unnamed rider"}</p>
                  <p className="text-xs text-kd-fg-muted">{r.user.phone}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{r.riderType}</Badge>
                  <Badge variant={statusVariant(r.verificationStatus)}>
                    {r.verificationStatus}
                  </Badge>
                  <span className="text-xs text-kd-fg-muted">trust {r.trustScore}</span>
                </div>
              </div>

              <div className="mt-2 text-xs text-kd-fg-muted">
                Vehicle: {r.vehicleType ?? "—"} {r.vehiclePlate ? `(${r.vehiclePlate})` : ""} ·
                Training: {r.trainingCompleted ? "✓" : "✗"} · Agreement:{" "}
                {r.agreementAccepted ? "✓" : "✗"}
              </div>

              {r.verificationDocs.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {r.verificationDocs.map((d) =>
                    d.asset.url ? (
                      <a
                        key={d.id}
                        href={d.asset.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs underline"
                      >
                        {d.kind}
                      </a>
                    ) : (
                      <span key={d.id} className="text-xs text-kd-fg-subtle">
                        {d.kind}
                      </span>
                    ),
                  )}
                </div>
              )}

              <div className="mt-3 flex gap-2">
                <Button
                  size="xs"
                  onClick={async () => {
                    const res = await approve({ id: r.id });
                    if (res.error) alert(res.error.graphQLErrors[0]?.message ?? "Approve failed");
                    refresh();
                  }}
                >
                  Approve
                </Button>
                <Button
                  size="xs"
                  variant="destructive"
                  onClick={async () => {
                    const reason = prompt("Rejection reason:");
                    if (reason?.trim()) {
                      await reject({ id: r.id, reason });
                      refresh();
                    }
                  }}
                >
                  Reject
                </Button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-4 text-lg font-bold">All riders</h2>
        <div className="space-y-2">
          {all.map((r) => (
            <div
              key={r.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-kd-border bg-kd-surface p-4 text-sm"
            >
              <div>
                <p className="font-medium">{r.user.name ?? "Unnamed rider"}</p>
                <p className="text-xs text-kd-fg-muted">{r.user.phone}</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline">{r.riderType}</Badge>
                <Badge variant={statusVariant(r.verificationStatus)}>
                  {r.verificationStatus}
                </Badge>
                {r.sharedModeEnabled && <Badge>shared</Badge>}
                <span className="text-xs text-kd-fg-muted">trust {r.trustScore}</span>
                <Button
                  size="xs"
                  variant="outline"
                  onClick={async () => {
                    await recompute({ id: r.id });
                    refresh();
                  }}
                >
                  Recompute
                </Button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
