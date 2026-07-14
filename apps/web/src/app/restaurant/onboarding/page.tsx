"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "urql";
import { graphql } from "@/graphql/generated";
import { DEFAULT_LOCATION } from "@/lib/location";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { BranchPinPicker } from "@/components/restaurant/BranchPinPicker";

const OnboardMutation = graphql(`
  mutation SubmitOnboarding(
    $name: String!
    $addressText: String!
    $lat: Float!
    $lng: Float!
    $minOrderMinor: Int!
    $deliveryFeeMinor: Int!
    $deliveryRadiusM: Int!
  ) {
    submitOnboarding(
      name: $name
      addressText: $addressText
      lat: $lat
      lng: $lng
      minOrderMinor: $minOrderMinor
      deliveryFeeMinor: $deliveryFeeMinor
      deliveryRadiusM: $deliveryRadiusM
    ) {
      id
      status
    }
  }
`);

export default function OnboardingPage() {
  const router = useRouter();
  const [state, submit] = useMutation(OnboardMutation);
  const [form, setForm] = useState({
    name: "",
    addressText: "",
    minOrderRs: "500",
    deliveryFeeRs: "80",
    radiusKm: "5",
  });
  // Real branch map pin (#200). Seeded at DEFAULT_LOCATION as the initial map centre, but the
  // owner must move it to their actual branch and tick the confirm box before we submit —
  // otherwise every branch would share one geo point and break radius/ETA/dispatch.
  const [pin, setPin] = useState({ lat: DEFAULT_LOCATION.lat, lng: DEFAULT_LOCATION.lng });
  const [pinConfirmed, setPinConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // The pin must actually move off the seeded default before it can be confirmed/submitted —
  // otherwise an owner could tick the box while the branch still sits on the shared pilot
  // coordinate, recreating the radius/ETA/dispatch bug this feature fixes (#200 Codex review).
  const pinMoved = pin.lat !== DEFAULT_LOCATION.lat || pin.lng !== DEFAULT_LOCATION.lng;

  if (done) {
    return (
      <main className="mx-auto max-w-md py-16 text-center">
        <h1 className="text-2xl font-bold">Application submitted 🎉</h1>
        <p className="mt-2 text-kd-fg-muted">
          Your restaurant is pending platform approval. You can set up your menu meanwhile — it goes
          live once an admin approves you.
        </p>
        <Button className="mt-6" onClick={() => router.push("/restaurant/menu")}>
          Set up my menu
        </Button>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-md">
      <h1 className="mb-1 text-xl font-bold">Bring your restaurant online</h1>
      <p className="mb-6 text-sm text-kd-fg-muted">
        You keep your kitchen, your riders and your prices — we bring the orders.
      </p>
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          if (!pinMoved) {
            setError("Please move the map pin to your branch's real location before submitting.");
            return;
          }
          if (!pinConfirmed) {
            setError("Please place your branch pin on the map and confirm it.");
            return;
          }
          const r = await submit({
            name: form.name,
            addressText: form.addressText,
            lat: pin.lat,
            lng: pin.lng,
            minOrderMinor: Math.round(Number(form.minOrderRs) * 100),
            deliveryFeeMinor: Math.round(Number(form.deliveryFeeRs) * 100),
            deliveryRadiusM: Math.round(Number(form.radiusKm) * 1000),
          });
          if (r.error) {
            setError(r.error.graphQLErrors[0]?.message ?? "Submission failed");
            return;
          }
          setDone(true);
        }}
      >
        <div>
          <Label>Restaurant name</Label>
          <Input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="mt-1"
            required
            minLength={3}
          />
        </div>
        <div>
          <Label>Branch address</Label>
          <Textarea
            value={form.addressText}
            onChange={(e) => setForm({ ...form, addressText: e.target.value })}
            className="mt-1"
            rows={2}
            required
          />
          <p className="mt-1 text-xs text-kd-fg-subtle">
            Type the address, then drop the exact pin below.
          </p>
        </div>
        <div>
          <Label>Branch location on the map</Label>
          <p className="mb-2 mt-1 text-xs text-kd-fg-subtle">
            Drag the map so the pin sits on your branch (or use your current location). This sets
            your delivery radius, distance and rider dispatch — please be precise.
          </p>
          <BranchPinPicker
            lat={pin.lat}
            lng={pin.lng}
            onChange={(next) => {
              setPin(next);
              // Moving the pin invalidates a prior confirmation so the owner re-confirms the
              // final spot.
              setPinConfirmed(false);
            }}
          />
          <label className="mt-2 flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={pinConfirmed}
              disabled={!pinMoved}
              onChange={(e) => setPinConfirmed(e.target.checked)}
            />
            <span className={pinMoved ? undefined : "text-kd-fg-subtle"}>
              This pin is my branch&apos;s real location.
              {!pinMoved && " (Move the pin first.)"}
            </span>
          </label>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <Label>Min order (Rs)</Label>
            <Input
              inputMode="numeric"
              value={form.minOrderRs}
              onChange={(e) => setForm({ ...form, minOrderRs: e.target.value })}
              className="mt-1"
            />
          </div>
          <div>
            <Label>Delivery fee (Rs)</Label>
            <Input
              inputMode="numeric"
              value={form.deliveryFeeRs}
              onChange={(e) => setForm({ ...form, deliveryFeeRs: e.target.value })}
              className="mt-1"
            />
          </div>
          <div>
            <Label>Radius (km)</Label>
            <Input
              inputMode="numeric"
              value={form.radiusKm}
              onChange={(e) => setForm({ ...form, radiusKm: e.target.value })}
              className="mt-1"
            />
          </div>
        </div>
        {error && <p className="text-sm text-kd-danger">{error}</p>}
        <Button
          type="submit"
          className="w-full"
          disabled={state.fetching || !pinMoved || !pinConfirmed}
        >
          {state.fetching ? "Submitting…" : "Submit for approval"}
        </Button>
      </form>
    </main>
  );
}
