"use client";

// Restaurant console: promoted deals & featured placements (#22). Create a campaign
// (featured slot or deal badge), see the tiered daily rate, submit for approval. The
// server computes the rate and enforces a wallet balance check on submit.
import { useState } from "react";
import { useMutation, useQuery } from "urql";
import { graphql } from "@/graphql/generated";
import { formatRs } from "@fd/shared";
import { useConsole } from "../useConsole";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const CampaignsQuery = graphql(`
  query MyCampaigns($restaurantId: String!) {
    featuredSlotRate(restaurantId: $restaurantId)
    walletBalance(restaurantId: $restaurantId)
    myCampaigns(restaurantId: $restaurantId) {
      id
      type
      status
      dailyRateMinor
      label
      rejectedReason
      startsAt
      endsAt
      createdAt
    }
  }
`);

const CreateCampaignMutation = graphql(`
  mutation CreateCampaign(
    $restaurantId: String!
    $type: String!
    $label: String
    $startsAt: DateTime
    $endsAt: DateTime
  ) {
    createCampaign(
      restaurantId: $restaurantId
      type: $type
      label: $label
      startsAt: $startsAt
      endsAt: $endsAt
    ) {
      id
    }
  }
`);

const SubmitCampaignMutation = graphql(`
  mutation SubmitCampaign($id: String!) {
    submitCampaign(id: $id) {
      id
      status
    }
  }
`);

const CancelCampaignMutation = graphql(`
  mutation CancelCampaign($id: String!) {
    cancelCampaign(id: $id) {
      id
      status
    }
  }
`);

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline"> = {
  active: "default",
  pending_approval: "secondary",
  draft: "outline",
  rejected: "outline",
  ended: "outline",
};

export default function CampaignsPage() {
  const { restaurant } = useConsole();
  const restaurantId = restaurant?.id ?? "";
  const [{ data }, refetch] = useQuery({
    query: CampaignsQuery,
    variables: { restaurantId },
    pause: !restaurant,
    requestPolicy: "cache-and-network",
  });
  const [, create] = useMutation(CreateCampaignMutation);
  const [, submit] = useMutation(SubmitCampaignMutation);
  const [, cancel] = useMutation(CancelCampaignMutation);

  const [type, setType] = useState("featured_slot");
  const [label, setLabel] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const refresh = () => refetch({ requestPolicy: "network-only" });

  if (!restaurant) return <p className="text-kd-fg-muted">Complete onboarding first.</p>;

  const rate = data?.featuredSlotRate ?? 0;
  const balance = data?.walletBalance ?? 0;

  async function onCreate() {
    setMessage(null);
    const r = await create({
      restaurantId,
      type,
      label: label.trim() || undefined,
      startsAt: startsAt ? new Date(startsAt).toISOString() : undefined,
      endsAt: endsAt ? new Date(endsAt).toISOString() : undefined,
    });
    if (r.error) {
      setMessage(r.error.graphQLErrors[0]?.message ?? "Couldn't create campaign.");
      return;
    }
    setLabel("");
    setStartsAt("");
    setEndsAt("");
    setMessage("Draft created. Submit it for approval below.");
    refresh();
  }

  return (
    <main className="max-w-2xl">
      <h1 className="mb-1 text-xl font-bold">Promotions</h1>
      <p className="mb-4 text-sm text-kd-fg-muted">
        Buy a featured slot on the home feed, or paint a deal badge on your cards. Featured
        slots bill{" "}
        <span className="font-semibold text-kd-fg">{formatRs(rate)}/day</span> at your{" "}
        {restaurant.tier === "chain" ? "chain" : "small-business"} tier
        {rate === 0 && " (free on your tier)"}. Deal badges are free.
      </p>

      <div className="mb-6 space-y-4 rounded-2xl border border-kd-border bg-kd-surface p-4 text-sm">
        <div>
          <Label>Type</Label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="mt-1 w-full rounded-lg border border-kd-border bg-kd-surface px-3 py-2 text-sm text-kd-fg outline-none focus:border-kd-primary"
          >
            <option value="featured_slot">Featured slot (home feed)</option>
            <option value="deal_badge">Deal badge (on cards)</option>
          </select>
        </div>
        <div>
          <Label>Promo label (optional)</Label>
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. 20% off this week"
            className="mt-1"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Starts (optional)</Label>
            <Input
              type="date"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
              className="mt-1"
            />
          </div>
          <div>
            <Label>Ends (optional)</Label>
            <Input
              type="date"
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
              className="mt-1"
            />
          </div>
        </div>
        {message && <p className="text-kd-fg-muted">{message}</p>}
        <Button className="w-full" onClick={onCreate}>
          Create draft
        </Button>
        <p className="text-xs text-kd-fg-subtle">
          Wallet balance {formatRs(balance)} — a paid featured slot needs at least one day&apos;s
          rate available to submit.
        </p>
      </div>

      <h2 className="mb-2 font-semibold">Your campaigns</h2>
      <div className="space-y-2">
        {data?.myCampaigns.map((c) => (
          <div key={c.id} className="rounded-xl border border-kd-border bg-kd-surface p-4 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-medium">
                {c.type === "featured_slot" ? "Featured slot" : "Deal badge"}
                {c.label && <span className="ml-2 text-kd-fg-muted">“{c.label}”</span>}
              </span>
              <Badge variant={STATUS_VARIANT[c.status] ?? "outline"}>
                {c.status.replace(/_/g, " ")}
              </Badge>
            </div>
            <p className="mt-1 text-xs text-kd-fg-subtle">
              {c.dailyRateMinor > 0 ? `${formatRs(c.dailyRateMinor)}/day` : "Free"}
              {c.startsAt &&
                ` · from ${new Date(c.startsAt as unknown as string).toLocaleDateString()}`}
              {c.endsAt &&
                ` · to ${new Date(c.endsAt as unknown as string).toLocaleDateString()}`}
            </p>
            {c.status === "rejected" && c.rejectedReason && (
              <p className="mt-1 text-xs text-kd-danger">Rejected: {c.rejectedReason}</p>
            )}
            <div className="mt-3 flex gap-2">
              {(c.status === "draft" || c.status === "rejected") && (
                <Button
                  size="xs"
                  onClick={async () => {
                    const r = await submit({ id: c.id });
                    if (r.error)
                      setMessage(r.error.graphQLErrors[0]?.message ?? "Couldn't submit.");
                    refresh();
                  }}
                >
                  Submit for approval
                </Button>
              )}
              {c.status !== "ended" && c.status !== "rejected" && (
                <Button
                  size="xs"
                  variant="outline"
                  onClick={async () => {
                    await cancel({ id: c.id });
                    refresh();
                  }}
                >
                  {c.status === "active" ? "End" : "Cancel"}
                </Button>
              )}
            </div>
          </div>
        ))}
        {data?.myCampaigns.length === 0 && (
          <p className="text-sm text-kd-fg-subtle">No campaigns yet.</p>
        )}
      </div>
    </main>
  );
}
