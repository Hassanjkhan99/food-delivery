"use client";

// Admin: promoted-deals approval queue (#22). Approve activates the campaign; reject
// requires an audited reason. "Run daily accrual" triggers the (idempotent) billing job
// that debits active campaigns and retires finished ones — no cron in this MVP.
import { useState } from "react";
import { useMutation, useQuery } from "urql";
import { graphql } from "@/graphql/generated";
import { formatRs } from "@fd/shared";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const QueueQuery = graphql(`
  query CampaignApprovalQueue {
    campaignApprovalQueue {
      id
      type
      dailyRateMinor
      label
      startsAt
      endsAt
      createdAt
      restaurant {
        id
        name
        tier
      }
    }
  }
`);

const ApproveMutation = graphql(`
  mutation ApproveCampaign($id: String!) {
    approveCampaign(id: $id) {
      id
      status
    }
  }
`);

const RejectMutation = graphql(`
  mutation RejectCampaign($id: String!, $reason: String!) {
    rejectCampaign(id: $id, reason: $reason) {
      id
      status
    }
  }
`);

const AccrualMutation = graphql(`
  mutation RunCampaignAccrual {
    runCampaignAccrual {
      campaignId
      amountMinor
      ended
    }
  }
`);

export default function AdminCampaignsPage() {
  const [{ data }, refetch] = useQuery({ query: QueueQuery, requestPolicy: "cache-and-network" });
  const [, approve] = useMutation(ApproveMutation);
  const [, reject] = useMutation(RejectMutation);
  const [, accrue] = useMutation(AccrualMutation);
  const [message, setMessage] = useState<string | null>(null);
  const refresh = () => refetch({ requestPolicy: "network-only" });

  return (
    <main className="max-w-2xl">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold">Promotions</h1>
        <Button
          size="sm"
          variant="outline"
          onClick={async () => {
            const r = await accrue({});
            const rows = r.data?.runCampaignAccrual ?? [];
            const billed = rows.filter((x) => x.amountMinor > 0);
            const total = billed.reduce((s, x) => s + x.amountMinor, 0);
            setMessage(
              `Accrual run: ${billed.length} charged (${formatRs(total)}), ${
                rows.filter((x) => x.ended).length
              } ended.`,
            );
            refresh();
          }}
        >
          Run daily accrual
        </Button>
      </div>
      {message && <p className="mb-3 text-sm text-kd-fg-muted">{message}</p>}

      {data?.campaignApprovalQueue.length === 0 && (
        <p className="text-sm text-kd-fg-muted">Nothing awaiting approval. 🎉</p>
      )}
      <div className="space-y-2">
        {data?.campaignApprovalQueue.map((c) => (
          <div key={c.id} className="rounded-xl border border-kd-border bg-kd-surface p-4 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-medium">
                {c.restaurant.name}
                <span className="ml-2 text-kd-fg-muted">
                  {c.type === "featured_slot" ? "Featured slot" : "Deal badge"}
                </span>
              </span>
              <Badge variant="secondary">
                {c.dailyRateMinor > 0 ? `${formatRs(c.dailyRateMinor)}/day` : "Free"}
              </Badge>
            </div>
            <p className="mt-1 text-xs text-kd-fg-subtle">
              {c.restaurant.tier === "chain" ? "Chain" : "Small business"}
              {c.label && ` · “${c.label}”`}
              {c.startsAt &&
                ` · from ${new Date(c.startsAt as unknown as string).toLocaleDateString()}`}
              {c.endsAt && ` · to ${new Date(c.endsAt as unknown as string).toLocaleDateString()}`}
            </p>
            <div className="mt-3 flex gap-2">
              <Button
                size="xs"
                onClick={async () => {
                  await approve({ id: c.id });
                  refresh();
                }}
              >
                Approve
              </Button>
              <Button
                size="xs"
                variant="outline"
                onClick={async () => {
                  const reason = prompt("Rejection reason:");
                  if (reason?.trim()) {
                    await reject({ id: c.id, reason });
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
        Approved featured slots appear in the customer &ldquo;Promoted&rdquo; rail; the daily
        accrual debits each active campaign once per day (restaurant payable → platform revenue).
      </p>
    </main>
  );
}
