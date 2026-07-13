"use client";

// Shared-rider dispatch controls (#161). The API (sharedRiderPolicy query +
// setSharedRiderPolicy mutation) is already owner-scoped; this is the missing console UI.
import { useState } from "react";
import { useQuery, useMutation } from "urql";
import { graphql } from "@/graphql/generated";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const PolicyQuery = graphql(`
  query SharedRiderPolicy($restaurantId: String!) {
    sharedRiderPolicy(restaurantId: $restaurantId) {
      id
      sharingEnabled
      vetoActive
      maxActiveJobs
      maxPickupMeters
      maxIncrementalDelaySec
      codTrustThreshold
    }
  }
`);

const SetPolicyMutation = graphql(`
  mutation SetSharedRiderPolicy(
    $restaurantId: String!
    $sharingEnabled: Boolean
    $vetoActive: Boolean
    $maxActiveJobs: Int
    $maxPickupMeters: Int
    $maxIncrementalDelaySec: Int
    $codTrustThreshold: Int
  ) {
    setSharedRiderPolicy(
      restaurantId: $restaurantId
      sharingEnabled: $sharingEnabled
      vetoActive: $vetoActive
      maxActiveJobs: $maxActiveJobs
      maxPickupMeters: $maxPickupMeters
      maxIncrementalDelaySec: $maxIncrementalDelaySec
      codTrustThreshold: $codTrustThreshold
    ) {
      id
      sharingEnabled
      vetoActive
      maxActiveJobs
      maxPickupMeters
      maxIncrementalDelaySec
      codTrustThreshold
    }
  }
`);

type Policy = {
  sharingEnabled: boolean;
  vetoActive: boolean;
  maxActiveJobs: number;
  maxPickupMeters: number;
  maxIncrementalDelaySec: number;
  codTrustThreshold: number;
};

const DEFAULTS: Policy = {
  sharingEnabled: false,
  vetoActive: false,
  maxActiveJobs: 1,
  maxPickupMeters: 1500,
  maxIncrementalDelaySec: 300,
  codTrustThreshold: 70,
};

// Keyed child: seeds inputs from the loaded policy at mount (no setState-in-effect).
function SharingControls({ restaurantId, policy }: { restaurantId: string; policy: Policy }) {
  const [, setPolicy] = useMutation(SetPolicyMutation);
  const [sharing, setSharing] = useState(policy.sharingEnabled);
  const [veto, setVeto] = useState(policy.vetoActive);
  const [maxJobs, setMaxJobs] = useState(String(policy.maxActiveJobs));
  const [maxKm, setMaxKm] = useState((policy.maxPickupMeters / 1000).toFixed(1));
  const [maxDelayMin, setMaxDelayMin] = useState(
    String(Math.round(policy.maxIncrementalDelaySec / 60)),
  );
  const [codTrust, setCodTrust] = useState(String(policy.codTrustThreshold));
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggleSharing() {
    setBusy(true);
    setError(null);
    const next = !sharing;
    const r = await setPolicy({ restaurantId, sharingEnabled: next });
    setBusy(false);
    if (r.error) setError(r.error.graphQLErrors[0]?.message ?? "Couldn't update sharing.");
    else setSharing(next);
  }

  async function toggleVeto() {
    setBusy(true);
    setError(null);
    const next = !veto;
    const r = await setPolicy({ restaurantId, vetoActive: next });
    setBusy(false);
    if (r.error) setError(r.error.graphQLErrors[0]?.message ?? "Couldn't update pause.");
    else setVeto(next);
  }

  async function saveLimits() {
    setBusy(true);
    setError(null);
    setSaved(false);
    const r = await setPolicy({
      restaurantId,
      maxActiveJobs: Math.round(Number(maxJobs)),
      maxPickupMeters: Math.round(Number(maxKm) * 1000),
      maxIncrementalDelaySec: Math.round(Number(maxDelayMin) * 60),
      codTrustThreshold: Math.round(Number(codTrust)),
    });
    setBusy(false);
    if (r.error) setError(r.error.graphQLErrors[0]?.message ?? "Couldn't save limits.");
    else setSaved(true);
  }

  return (
    <div className="rounded-xl border border-kd-border bg-kd-surface p-4 text-sm">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-medium">Share idle riders</p>
          <p className="text-xs text-kd-fg-muted">
            Lend your idle riders to nearby restaurants when you have spare capacity. Your own
            orders always take priority.
          </p>
        </div>
        <Button
          variant={sharing ? "destructive" : "default"}
          size="sm"
          disabled={busy}
          onClick={toggleSharing}
        >
          {sharing ? "Stop sharing" : "Start sharing"}
        </Button>
      </div>

      {sharing && (
        <div className="mt-4 space-y-4 border-t border-kd-border pt-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">Pause for this shift</p>
              <p className="text-xs text-kd-fg-muted">
                Temporarily stop lending without losing your limits below.
              </p>
            </div>
            <Button
              variant={veto ? "default" : "secondary"}
              size="sm"
              disabled={busy}
              onClick={toggleVeto}
            >
              {veto ? "Resume" : "Pause"}
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="maxJobs">Max shared jobs / rider</Label>
              <Input
                id="maxJobs"
                type="number"
                inputMode="numeric"
                value={maxJobs}
                onChange={(e) => setMaxJobs(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="maxKm">Max pickup distance (km)</Label>
              <Input
                id="maxKm"
                type="number"
                inputMode="decimal"
                value={maxKm}
                onChange={(e) => setMaxKm(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="maxDelay">Max extra delay (min)</Label>
              <Input
                id="maxDelay"
                type="number"
                inputMode="numeric"
                value={maxDelayMin}
                onChange={(e) => setMaxDelayMin(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="codTrust">Min rider trust for COD</Label>
              <Input
                id="codTrust"
                type="number"
                inputMode="numeric"
                value={codTrust}
                onChange={(e) => setCodTrust(e.target.value)}
              />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button size="sm" variant="outline" disabled={busy} onClick={saveLimits}>
              {busy ? "Saving…" : "Save limits"}
            </Button>
            {saved && !error && <span className="text-xs text-kd-success">Saved.</span>}
          </div>
        </div>
      )}

      {error && <p className="mt-3 text-sm text-kd-danger">{error}</p>}
    </div>
  );
}

export function RiderSharingPanel({ restaurantId }: { restaurantId: string }) {
  const [{ data, fetching }] = useQuery({
    query: PolicyQuery,
    variables: { restaurantId },
    requestPolicy: "cache-and-network",
  });
  if (fetching && !data) return null;
  const policy = data?.sharedRiderPolicy ?? DEFAULTS;
  return <SharingControls key={restaurantId} restaurantId={restaurantId} policy={policy} />;
}
