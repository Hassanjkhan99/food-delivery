"use client";

import { useState } from "react";
import { useMutation, useQuery } from "urql";
import { graphql } from "@/graphql/generated";
import { useConsole } from "../useConsole";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const RidersQuery = graphql(`
  query BranchRiders($branchId: String!) {
    branchRiders(branchId: $branchId) {
      id
      riderType
      verificationStatus
      isOnline
      user {
        name
        phone
      }
    }
  }
`);

const InviteRiderMutation = graphql(`
  mutation InviteRider($branchId: String!, $phone: String!, $name: String!) {
    inviteRider(branchId: $branchId, phone: $phone, name: $name) {
      id
    }
  }
`);

export default function RidersPage() {
  const { branch } = useConsole();
  const [{ data }, refetch] = useQuery({
    query: RidersQuery,
    variables: { branchId: branch?.id ?? "" },
    pause: !branch,
    requestPolicy: "cache-and-network",
  });
  const [inviteState, invite] = useMutation(InviteRiderMutation);
  const [phone, setPhone] = useState("+92");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (!branch) return <p className="text-kd-fg-muted">Complete onboarding first.</p>;

  return (
    <main className="max-w-xl">
      <h1 className="mb-4 text-xl font-bold">Rider roster</h1>

      <div className="space-y-2">
        {data?.branchRiders.map((r) => (
          <div
            key={r.id}
            className="flex items-center justify-between rounded-xl border border-kd-border bg-kd-surface p-3 text-sm"
          >
            <div>
              <p className="font-medium">{r.user.name ?? "Unnamed rider"}</p>
              <p className="text-xs text-kd-fg-muted">{r.user.phone}</p>
            </div>
            <div className="flex gap-2">
              <Badge variant={r.isOnline ? "default" : "secondary"}>
                {r.isOnline ? "Online" : "Offline"}
              </Badge>
              <Badge variant="outline">{r.riderType}</Badge>
            </div>
          </div>
        ))}
        {data?.branchRiders.length === 0 && (
          <p className="text-sm text-kd-fg-muted">No riders yet — invite your first below.</p>
        )}
      </div>

      <form
        className="mt-8 space-y-3 rounded-xl border border-kd-border bg-kd-surface p-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          const r = await invite({ branchId: branch.id, phone, name });
          if (r.error) {
            setError(r.error.graphQLErrors[0]?.message ?? "Invite failed");
            return;
          }
          setPhone("+92");
          setName("");
          refetch({ requestPolicy: "network-only" });
        }}
      >
        <p className="font-semibold">Invite a rider</p>
        <div>
          <Label>Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1" required />
        </div>
        <div>
          <Label>Phone</Label>
          <Input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="mt-1"
            required
          />
          <p className="mt-1 text-xs text-kd-fg-subtle">They sign in with this number via OTP.</p>
        </div>
        {error && <p className="text-sm text-kd-danger">{error}</p>}
        <Button type="submit" disabled={inviteState.fetching} className="w-full">
          {inviteState.fetching ? "Inviting…" : "Invite rider"}
        </Button>
      </form>
    </main>
  );
}
