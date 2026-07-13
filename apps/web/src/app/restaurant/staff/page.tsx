"use client";

// Staff management (#156). Owner-only: invite staff by phone, view the roster, revoke.
// Staff get the restaurant_staff role — order board only (nav gating + owner-only mutations).
import { useState } from "react";
import { useQuery, useMutation } from "urql";
import { graphql } from "@/graphql/generated";
import { useConsole } from "../useConsole";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const StaffQuery = graphql(`
  query RestaurantStaff($restaurantId: String!) {
    restaurantStaff(restaurantId: $restaurantId) {
      roleId
      userId
      name
      phone
    }
  }
`);

const InviteMutation = graphql(`
  mutation InviteStaff($restaurantId: String!, $phone: String!, $name: String) {
    inviteStaff(restaurantId: $restaurantId, phone: $phone, name: $name) {
      userId
      phone
    }
  }
`);

const RemoveMutation = graphql(`
  mutation RemoveStaff($restaurantId: String!, $userId: String!) {
    removeStaff(restaurantId: $restaurantId, userId: $userId)
  }
`);

export default function StaffPage() {
  const { restaurant, isOwner } = useConsole();
  const restaurantId = restaurant?.id ?? "";
  const [{ data, fetching }, refetch] = useQuery({
    query: StaffQuery,
    variables: { restaurantId },
    pause: !restaurantId || !isOwner,
    requestPolicy: "cache-and-network",
  });
  const [, invite] = useMutation(InviteMutation);
  const [, remove] = useMutation(RemoveMutation);
  const [phone, setPhone] = useState("+92");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!restaurant) return <p className="text-kd-fg-muted">Complete onboarding first.</p>;
  if (!isOwner)
    return <p className="text-kd-fg-muted">Only the restaurant owner can manage staff.</p>;

  async function onInvite() {
    setBusy(true);
    setError(null);
    const r = await invite({ restaurantId, phone, name: name.trim() || undefined });
    setBusy(false);
    if (r.error) {
      setError(r.error.graphQLErrors[0]?.message ?? "Couldn't add staff.");
      return;
    }
    setPhone("+92");
    setName("");
    refetch({ requestPolicy: "network-only" });
  }

  const staff = data?.restaurantStaff ?? [];

  return (
    <main className="max-w-xl">
      <h1 className="mb-1 text-xl font-bold">Staff</h1>
      <p className="mb-4 text-sm text-kd-fg-muted">
        Staff can run the order board (accept, prepare, mark ready). Menu, wallet, promotions and
        settings stay owner-only.
      </p>

      <div className="mb-6 rounded-xl border border-kd-border bg-kd-surface p-4">
        <p className="mb-3 text-sm font-medium">Add staff</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="phone">Phone</Label>
            <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="name">Name (optional)</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
        </div>
        {error && <p className="mt-3 text-sm text-kd-danger">{error}</p>}
        <Button className="mt-3" size="sm" disabled={busy || phone.length < 6} onClick={onInvite}>
          {busy ? "Adding…" : "Add staff"}
        </Button>
      </div>

      <p className="mb-2 text-sm font-medium">Team</p>
      {fetching && staff.length === 0 ? (
        <p className="text-sm text-kd-fg-muted">Loading…</p>
      ) : staff.length === 0 ? (
        <p className="text-sm text-kd-fg-muted">No staff yet.</p>
      ) : (
        <div className="space-y-2">
          {staff.map((s) => (
            <div
              key={s.roleId}
              className="flex items-center justify-between rounded-xl border border-kd-border bg-kd-surface p-3 text-sm"
            >
              <div>
                <span className="font-medium">{s.name ?? "Staff"}</span>
                <span className="ml-2 font-mono text-xs text-kd-fg-muted">{s.phone}</span>
              </div>
              <Button
                size="xs"
                variant="outline"
                onClick={async () => {
                  await remove({ restaurantId, userId: s.userId });
                  refetch({ requestPolicy: "network-only" });
                }}
              >
                Remove
              </Button>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
