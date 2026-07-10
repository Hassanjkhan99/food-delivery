"use client";

import { useMutation, useQuery } from "urql";
import { graphql } from "@/graphql/generated";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const RestaurantsQuery = graphql(`
  query AdminRestaurants {
    allRestaurants {
      id
      name
      slug
      status
      tier
      avgRating
      ratingCount
    }
  }
`);

const ApproveMutation = graphql(`
  mutation Approve($id: String!) {
    approveRestaurant(id: $id) {
      id
      status
    }
  }
`);
const SuspendMutation = graphql(`
  mutation Suspend($id: String!, $reason: String!) {
    suspendRestaurant(id: $id, reason: $reason) {
      id
      status
    }
  }
`);
const SetTierMutation = graphql(`
  mutation SetTier($id: String!, $tier: String!) {
    setRestaurantTier(id: $id, tier: $tier) {
      id
      tier
    }
  }
`);

export default function AdminRestaurantsPage() {
  const [{ data }, refetch] = useQuery({
    query: RestaurantsQuery,
    requestPolicy: "cache-and-network",
  });
  const [, approve] = useMutation(ApproveMutation);
  const [, suspend] = useMutation(SuspendMutation);
  const [, setTier] = useMutation(SetTierMutation);
  const refresh = () => refetch({ requestPolicy: "network-only" });

  return (
    <main className="max-w-3xl">
      <h1 className="mb-4 text-xl font-bold">Restaurants</h1>
      <div className="space-y-2">
        {data?.allRestaurants.map((r) => (
          <div
            key={r.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-kd-border bg-kd-surface p-4 text-sm"
          >
            <div>
              <p className="font-medium">
                {r.name} <span className="text-xs text-kd-fg-subtle">/{r.slug}</span>
              </p>
              <div className="mt-1 flex gap-2">
                <Badge
                  variant={
                    r.status === "approved"
                      ? "default"
                      : r.status === "suspended"
                        ? "destructive"
                        : "secondary"
                  }
                >
                  {r.status}
                </Badge>
                {r.avgRating != null && (
                  <span className="text-xs text-kd-fg-muted">
                    ★ {r.avgRating.toFixed(1)} ({r.ratingCount})
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <select
                value={r.tier}
                className="rounded-lg border border-kd-border px-2 py-1 text-xs"
                onChange={async (e) => {
                  await setTier({ id: r.id, tier: e.target.value });
                  refresh();
                }}
              >
                <option value="small_business">small_business (lenient)</option>
                <option value="chain">chain (full commission)</option>
              </select>
              {r.status === "pending_approval" && (
                <Button
                  size="xs"
                  onClick={async () => {
                    await approve({ id: r.id });
                    refresh();
                  }}
                >
                  Approve
                </Button>
              )}
              {r.status === "approved" && (
                <Button
                  size="xs"
                  variant="destructive"
                  onClick={async () => {
                    const reason = prompt("Suspension reason:");
                    if (reason?.trim()) {
                      await suspend({ id: r.id, reason });
                      refresh();
                    }
                  }}
                >
                  Suspend
                </Button>
              )}
              {r.status === "suspended" && (
                <Button
                  size="xs"
                  variant="outline"
                  onClick={async () => {
                    await approve({ id: r.id });
                    refresh();
                  }}
                >
                  Reinstate
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
