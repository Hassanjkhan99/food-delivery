"use client";

// Admin KYC review queue (#152): approve or reject restaurant verification submissions.
import { useMutation, useQuery } from "urql";
import { graphql } from "@/graphql/generated";
import { Button } from "@/components/ui/button";

const QueueQuery = graphql(`
  query KycQueue {
    kycQueue {
      id
      restaurantId
      ownerName
      ownerCnic
      bankAccountName
      bankIban
      cnicAssetId
      status
      restaurant {
        name
        slug
      }
    }
  }
`);

const ReviewMutation = graphql(`
  mutation ReviewKyc($restaurantId: String!, $approve: Boolean!, $rejectionReason: String) {
    reviewKyc(restaurantId: $restaurantId, approve: $approve, rejectionReason: $rejectionReason) {
      id
      status
    }
  }
`);

export default function AdminKycPage() {
  const [{ data }, refetch] = useQuery({ query: QueueQuery, requestPolicy: "cache-and-network" });
  const [, review] = useMutation(ReviewMutation);
  const refresh = () => refetch({ requestPolicy: "network-only" });
  const queue = data?.kycQueue ?? [];

  return (
    <main className="max-w-3xl">
      <h1 className="mb-1 text-xl font-bold">KYC review</h1>
      <p className="mb-4 text-sm text-kd-fg-muted">
        Restaurants awaiting verification. Approving also makes the restaurant live.
      </p>
      {queue.length === 0 ? (
        <p className="text-sm text-kd-fg-muted">Nothing awaiting review.</p>
      ) : (
        <div className="space-y-2">
          {queue.map((k) => (
            <div
              key={k.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-kd-border bg-kd-surface p-4 text-sm"
            >
              <div>
                <p className="font-medium">
                  {k.restaurant.name}{" "}
                  <span className="text-xs text-kd-fg-subtle">/{k.restaurant.slug}</span>
                </p>
                <p className="mt-1 text-xs text-kd-fg-muted">
                  {k.ownerName} · CNIC {k.ownerCnic}
                  {k.bankIban ? ` · ${k.bankAccountName ?? ""} ${k.bankIban}` : ""}
                  {k.cnicAssetId ? " · scan attached" : " · no scan"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="xs"
                  onClick={async () => {
                    await review({ restaurantId: k.restaurantId, approve: true });
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
                      await review({
                        restaurantId: k.restaurantId,
                        approve: false,
                        rejectionReason: reason,
                      });
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
      )}
    </main>
  );
}
