"use client";

import { useState } from "react";
import { useMutation } from "urql";
import { graphql } from "@/graphql/generated";
import { useConsole } from "../useConsole";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { HoursEditor } from "../HoursEditor";
import { RiderSharingPanel } from "../RiderSharingPanel";
import { BranchPinPicker } from "@/components/restaurant/BranchPinPicker";
import { DEFAULT_LOCATION } from "@/lib/location";

const SetAcceptingMutation = graphql(`
  mutation SetAccepting($branchId: String!, $accepting: Boolean!) {
    setAcceptingOrders(branchId: $branchId, accepting: $accepting) {
      id
      isAcceptingOrders
    }
  }
`);

const UpdateProfileMutation = graphql(`
  mutation UpdateRestaurantProfile($restaurantId: String!, $name: String, $cuisineTags: [String!]) {
    updateRestaurantProfile(restaurantId: $restaurantId, name: $name, cuisineTags: $cuisineTags) {
      id
      name
      cuisineTags
    }
  }
`);

const UpdateCommercialsMutation = graphql(`
  mutation UpdateBranchCommercials(
    $branchId: String!
    $minOrderMinor: Int
    $deliveryFeeMinor: Int
    $deliveryRadiusM: Int
    $lat: Float
    $lng: Float
  ) {
    updateBranchCommercials(
      branchId: $branchId
      minOrderMinor: $minOrderMinor
      deliveryFeeMinor: $deliveryFeeMinor
      deliveryRadiusM: $deliveryRadiusM
      lat: $lat
      lng: $lng
    ) {
      id
      lat
      lng
      minOrderMinor
      deliveryFeeMinor
      deliveryRadiusM
    }
  }
`);

// A branch still sitting on the shared pilot default (#200). Such branches need the owner to
// correct the pin — this is the low-risk, owner-driven backfill (no DB migration).
function isAtDefaultPin(lat: number, lng: number): boolean {
  return Math.abs(lat - DEFAULT_LOCATION.lat) < 1e-6 && Math.abs(lng - DEFAULT_LOCATION.lng) < 1e-6;
}

type ConsoleData = ReturnType<typeof useConsole>;
type Restaurant = NonNullable<ConsoleData["restaurant"]>;
type Branch = NonNullable<ConsoleData["branch"]>;

// Editable commercial profile. Kept in its own component and rendered with a `key` so its
// form state is seeded from props at mount (no setState-in-effect) and re-seeds if the
// underlying restaurant/branch changes. Rupees/km in the inputs; converted to minor
// units / metres on save.
function CommercialProfileForm({
  restaurant,
  branch,
  refetch,
}: {
  restaurant: Restaurant;
  branch: Branch;
  refetch: ConsoleData["refetch"];
}) {
  const [, updateProfile] = useMutation(UpdateProfileMutation);
  const [, updateCommercials] = useMutation(UpdateCommercialsMutation);

  const [name, setName] = useState(restaurant.name);
  const [cuisines, setCuisines] = useState(restaurant.cuisineTags.join(", "));
  const [minOrder, setMinOrder] = useState(String(branch.minOrderMinor / 100));
  const [fee, setFee] = useState(String(branch.deliveryFeeMinor / 100));
  const [radiusKm, setRadiusKm] = useState((branch.deliveryRadiusM / 1000).toFixed(1));
  // Branch map pin (#200). Seeded from the branch coords at mount (via the parent `key`).
  const [pin, setPin] = useState({ lat: branch.lat, lng: branch.lng });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function saveProfile() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const p = await updateProfile({
        restaurantId: restaurant.id,
        name,
        cuisineTags: cuisines
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      });
      const c = await updateCommercials({
        branchId: branch.id,
        minOrderMinor: Math.round(Number(minOrder) * 100),
        deliveryFeeMinor: Math.round(Number(fee) * 100),
        deliveryRadiusM: Math.round(Number(radiusKm) * 1000),
        lat: pin.lat,
        lng: pin.lng,
      });
      const err = p.error ?? c.error;
      if (err) {
        setError(err.graphQLErrors[0]?.message ?? "Couldn't save changes.");
      } else {
        setSaved(true);
        refetch({ requestPolicy: "network-only" });
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-xl border border-kd-border bg-kd-surface p-4 text-sm">
      <div className="mb-3 flex items-center justify-between">
        <p className="font-medium">Commercial profile</p>
        <Badge variant={restaurant.status === "approved" ? "default" : "secondary"}>
          {restaurant.status} · {restaurant.tier}
        </Badge>
      </div>

      <div className="space-y-3">
        <div>
          <Label htmlFor="name">Restaurant name</Label>
          <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="cuisines">Cuisine tags</Label>
          <Input
            id="cuisines"
            value={cuisines}
            onChange={(e) => setCuisines(e.target.value)}
            placeholder="biryani, bbq, desi"
          />
          <p className="mt-1 text-xs text-kd-fg-subtle">Comma-separated, up to 10.</p>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <Label htmlFor="minOrder">Min order (Rs)</Label>
            <Input
              id="minOrder"
              type="number"
              inputMode="decimal"
              value={minOrder}
              onChange={(e) => setMinOrder(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="fee">Delivery fee (Rs)</Label>
            <Input
              id="fee"
              type="number"
              inputMode="decimal"
              value={fee}
              onChange={(e) => setFee(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="radius">Radius (km)</Label>
            <Input
              id="radius"
              type="number"
              inputMode="decimal"
              value={radiusKm}
              onChange={(e) => setRadiusKm(e.target.value)}
            />
          </div>
        </div>

        <div>
          <Label>Branch location</Label>
          {isAtDefaultPin(branch.lat, branch.lng) && (
            <p className="mb-2 mt-1 rounded-lg border border-kd-warning bg-kd-warning-soft px-2 py-1.5 text-xs text-kd-warning-soft-fg">
              This branch is still on the shared pilot default pin. Drag the pin to your real
              location and save so delivery radius, distance and rider dispatch work correctly.
            </p>
          )}
          <p className="mb-2 mt-1 text-xs text-kd-fg-subtle">
            Drag the map so the pin sits on your branch, then save.
          </p>
          <BranchPinPicker lat={pin.lat} lng={pin.lng} onChange={setPin} disabled={saving} />
        </div>
      </div>

      {error && <p className="mt-3 text-sm text-kd-danger">{error}</p>}
      <div className="mt-3 flex items-center gap-3">
        <Button size="sm" onClick={saveProfile} disabled={saving}>
          {saving ? "Saving…" : "Save changes"}
        </Button>
        {saved && !error && <span className="text-xs text-kd-success">Saved.</span>}
      </div>
      <p className="mt-3 text-xs text-kd-fg-subtle">
        Tier and commission are managed by the platform.
      </p>
    </div>
  );
}

export default function SettingsPage() {
  const { restaurant, branch, refetch } = useConsole();
  const [, setAccepting] = useMutation(SetAcceptingMutation);

  if (!restaurant || !branch) return <p className="text-kd-fg-muted">Complete onboarding first.</p>;

  return (
    <main className="max-w-xl">
      <h1 className="mb-4 text-xl font-bold">Settings</h1>

      <div className="space-y-4">
        <div className="flex items-center justify-between rounded-xl border border-kd-border bg-kd-surface p-4">
          <div>
            <p className="font-medium">Accepting orders</p>
            <p className="text-xs text-kd-fg-muted">Pause during rush or when closing early.</p>
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

        <HoursEditor branchId={branch.id} />

        <CommercialProfileForm
          key={`${restaurant.id}:${branch.id}`}
          restaurant={restaurant}
          branch={branch}
          refetch={refetch}
        />

        <RiderSharingPanel restaurantId={restaurant.id} />
      </div>
    </main>
  );
}
