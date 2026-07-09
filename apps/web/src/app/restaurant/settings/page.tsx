"use client";

import { useMutation } from "urql";
import { graphql } from "@/graphql/generated";
import { formatRs } from "@fd/shared";
import { useConsole } from "../useConsole";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const SetAcceptingMutation = graphql(`
  mutation SetAccepting($branchId: String!, $accepting: Boolean!) {
    setAcceptingOrders(branchId: $branchId, accepting: $accepting) {
      id
      isAcceptingOrders
    }
  }
`);

export default function SettingsPage() {
  const { restaurant, branch, refetch } = useConsole();
  const [, setAccepting] = useMutation(SetAcceptingMutation);

  if (!restaurant || !branch) return <p className="text-neutral-500">Complete onboarding first.</p>;

  return (
    <main className="max-w-xl">
      <h1 className="mb-4 text-xl font-bold">Settings</h1>

      <div className="space-y-4">
        <div className="flex items-center justify-between rounded-xl border border-neutral-200 bg-white p-4">
          <div>
            <p className="font-medium">Accepting orders</p>
            <p className="text-xs text-neutral-500">Pause during rush or when closing early.</p>
          </div>
          <Button
            variant={branch.isAcceptingOrders ? "destructive" : "default"}
            size="sm"
            onClick={async () => {
              await setAccepting({ branchId: branch.id, accepting: !branch.isAcceptingOrders });
              refetch({ requestPolicy: "network-only" });
            }}
          >
            {branch.isAcceptingOrders ? "Pause" : "Resume"}
          </Button>
        </div>

        <div className="rounded-xl border border-neutral-200 bg-white p-4 text-sm">
          <p className="mb-2 font-medium">Commercial profile</p>
          <div className="grid grid-cols-2 gap-2 text-neutral-600">
            <span>Status</span>
            <Badge variant={restaurant.status === "approved" ? "default" : "secondary"} className="justify-self-end">
              {restaurant.status}
            </Badge>
            <span>Tier</span><span className="text-right">{restaurant.tier}</span>
            <span>Minimum order</span><span className="text-right">{formatRs(branch.minOrderMinor)}</span>
            <span>Delivery fee</span><span className="text-right">{formatRs(branch.deliveryFeeMinor)}</span>
            <span>Delivery radius</span><span className="text-right">{(branch.deliveryRadiusM / 1000).toFixed(1)} km</span>
          </div>
          <p className="mt-3 text-xs text-neutral-400">
            Tier and commission are managed by the platform. Contact support to change commercial terms.
          </p>
        </div>
      </div>
    </main>
  );
}
