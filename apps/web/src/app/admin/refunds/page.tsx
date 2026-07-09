"use client";

import { useMutation, useQuery } from "urql";
import { graphql } from "@/graphql/generated";
import { formatRs } from "@fd/shared";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const RefundQueueQuery = graphql(`
  query RefundQueue {
    refundQueue {
      id
      amountMinor
      destination
      reason
      createdAt
      order {
        id
        code
        paymentMode
        grandTotalMinor
        branch {
          restaurant {
            name
          }
        }
      }
    }
  }
`);

const DecideRefundMutation = graphql(`
  mutation DecideRefund($id: String!, $approve: Boolean!, $reason: String) {
    decideRefund(id: $id, approve: $approve, reason: $reason) {
      id
      status
    }
  }
`);

export default function AdminRefundsPage() {
  const [{ data }, refetch] = useQuery({
    query: RefundQueueQuery,
    requestPolicy: "cache-and-network",
  });
  const [, decide] = useMutation(DecideRefundMutation);
  const refresh = () => refetch({ requestPolicy: "network-only" });

  return (
    <main className="max-w-2xl">
      <h1 className="mb-4 text-xl font-bold">Refund workbench</h1>
      {data?.refundQueue.length === 0 && (
        <p className="text-sm text-kd-fg-muted">Queue is empty. 🎉</p>
      )}
      <div className="space-y-2">
        {data?.refundQueue.map((r) => (
          <div key={r.id} className="rounded-xl border border-kd-border bg-kd-surface p-4 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-medium">
                {r.order.code} — {r.order.branch.restaurant.name}
              </span>
              <Badge variant="secondary">
                {formatRs(r.amountMinor)} → {r.destination}
              </Badge>
            </div>
            <p className="mt-1 text-kd-fg-muted">{r.reason}</p>
            <p className="mt-1 text-xs text-kd-fg-subtle">
              Order total {formatRs(r.order.grandTotalMinor)} · {r.order.paymentMode.toUpperCase()}
            </p>
            <div className="mt-3 flex gap-2">
              <Button
                size="xs"
                onClick={async () => {
                  await decide({ id: r.id, approve: true });
                  refresh();
                }}
              >
                Approve refund
              </Button>
              <Button
                size="xs"
                variant="outline"
                onClick={async () => {
                  const reason = prompt("Rejection reason:");
                  if (reason?.trim()) {
                    await decide({ id: r.id, approve: false, reason });
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
      <p className="mt-4 text-xs text-kd-fg-subtle">
        Approved card refunds go back via the payment provider; wallet refunds credit the
        customer&apos;s prepaid balance. The restaurant bears the cost per the cancellation policy.
      </p>
    </main>
  );
}
