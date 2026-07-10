"use client";

import Link from "next/link";
import { useQuery } from "urql";
import { graphql } from "@/graphql/generated";
import { formatRs } from "@fd/shared";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ReorderButton } from "@/components/ReorderButton";
import { REORDERABLE_STATUSES, type OrderItemSnapshot } from "@/lib/cart";

const MyOrdersQuery = graphql(`
  query MyOrders {
    myOrders {
      id
      code
      status
      grandTotalMinor
      paymentMode
      placedAt
      branch {
        id
        restaurant {
          name
          slug
        }
      }
      items {
        id
        qty
        notes
        menuSnapshotJson
      }
    }
  }
`);

const STATUS_LABEL: Record<string, string> = {
  pending_acceptance: "Waiting for restaurant",
  accepted: "Accepted",
  preparing: "Preparing",
  ready_for_pickup: "Ready",
  rider_assigned: "Rider assigned",
  picked_up: "Picked up",
  out_for_delivery: "On the way",
  delivered: "Delivered",
  rejected: "Rejected",
  auto_expired: "Not accepted in time",
  cancelled: "Cancelled",
  failed_delivery_attempt: "Delivery attempt failed",
  reassigning: "Reassigning rider",
};

export default function OrdersPage() {
  const [{ data, fetching }] = useQuery({
    query: MyOrdersQuery,
    requestPolicy: "cache-and-network",
  });

  return (
    <main className="mx-auto max-w-lg">
      <h1 className="mb-6 text-2xl font-bold">Your orders</h1>
      {fetching && <Skeleton className="h-40 rounded-2xl" />}
      {data?.myOrders.length === 0 && <p className="text-kd-fg-muted">No orders yet.</p>}
      <div className="space-y-3">
        {data?.myOrders.map((o) => (
          <div
            key={o.id}
            className="rounded-xl border border-kd-border bg-kd-surface p-4 hover:border-kd-fg-subtle"
          >
            <Link href={`/orders/${o.id}`} className="flex items-center justify-between">
              <div>
                <p className="font-medium text-kd-fg">{o.branch.restaurant.name}</p>
                <p className="text-xs text-kd-fg-muted">
                  {o.code} · {new Date(o.placedAt as unknown as string).toLocaleString()}
                </p>
              </div>
              <div className="text-right">
                <Badge variant={o.status === "delivered" ? "default" : "secondary"}>
                  {STATUS_LABEL[o.status] ?? o.status}
                </Badge>
                <p className="mt-1 text-sm font-semibold">{formatRs(o.grandTotalMinor)}</p>
              </div>
            </Link>
            {REORDERABLE_STATUSES.has(o.status) && o.items.length > 0 && (
              <div className="mt-3 border-t border-kd-border pt-3">
                <ReorderButton
                  source={{
                    branch: {
                      id: o.branch.id,
                      slug: o.branch.restaurant.slug,
                      name: o.branch.restaurant.name,
                    },
                    items: o.items.map((i) => ({
                      qty: i.qty,
                      notes: i.notes,
                      menuSnapshotJson: i.menuSnapshotJson as OrderItemSnapshot["menuSnapshotJson"],
                    })),
                  }}
                />
              </div>
            )}
          </div>
        ))}
      </div>
    </main>
  );
}
