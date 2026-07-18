"use client";

import Link from "next/link";
import { useQuery } from "urql";
import { graphql } from "@/graphql/generated";
import { formatRs } from "@fd/shared";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { OrderStatusPill } from "@/components/ui/status-pill";
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
        isOpenNow
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

export default function OrdersPage() {
  const [{ data, fetching }] = useQuery({
    query: MyOrdersQuery,
    requestPolicy: "cache-and-network",
  });

  return (
    <main className="mx-auto max-w-lg">
      <PageHeader title="Your orders" />
      {fetching && <Skeleton className="h-40 rounded-2xl" />}
      {data?.myOrders.length === 0 && (
        <EmptyState
          icon="🧾"
          title="No orders yet"
          description="Your past and in-progress orders will show up here."
        />
      )}
      <div className="space-y-3">
        {data?.myOrders.map((o) => (
          <div
            key={o.id}
            className="rounded-xl border border-kd-border bg-kd-surface hover:border-kd-fg-subtle"
          >
            <Link href={`/orders/${o.id}`} className="flex items-center justify-between p-4">
              <div>
                <p className="font-medium text-kd-fg">{o.branch.restaurant.name}</p>
                <p className="text-xs text-kd-fg-muted">
                  {o.code} · {new Date(o.placedAt as unknown as string).toLocaleString()}
                </p>
              </div>
              <div className="text-right">
                <OrderStatusPill status={o.status} />
                <p className="mt-1 text-sm font-semibold">{formatRs(o.grandTotalMinor)}</p>
              </div>
            </Link>
            {REORDERABLE_STATUSES.has(o.status) && o.items.length > 0 && (
              <div className="border-t border-kd-border px-4 py-3">
                <ReorderButton
                  source={{
                    branch: {
                      id: o.branch.id,
                      slug: o.branch.restaurant.slug,
                      name: o.branch.restaurant.name,
                      isOpenNow: o.branch.isOpenNow,
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
            <div className="border-t border-kd-border px-4 py-2 text-right">
              <Link
                href={`/help/${o.id}`}
                className="text-xs font-medium text-kd-fg-muted hover:text-kd-fg"
              >
                Get help with this order →
              </Link>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
