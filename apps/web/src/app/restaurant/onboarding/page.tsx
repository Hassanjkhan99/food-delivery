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

const OnboardMutation = graphql(`
  mutation SubmitOnboarding($name: String!, $addressText: String!, $lat: Float!, $lng: Float!, $minOrderMinor: Int!, $deliveryFeeMinor: Int!, $deliveryRadiusM: Int!) {
    submitOnboarding(name: $name, addressText: $addressText, lat: $lat, lng: $lng, minOrderMinor: $minOrderMinor, deliveryFeeMinor: $deliveryFeeMinor, deliveryRadiusM: $deliveryRadiusM) {
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
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (done) {
    return (
      <main className="mx-auto max-w-md py-16 text-center">
        <h1 className="text-2xl font-bold">Application submitted 🎉</h1>
        <p className="mt-2 text-neutral-600">
          Your restaurant is pending platform approval. You can set up your menu meanwhile —
          it goes live once an admin approves you.
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
      <p className="mb-6 text-sm text-neutral-500">
        You keep your kitchen, your riders and your prices — we bring the orders.
      </p>
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          const r = await submit({
            name: form.name,
            addressText: form.addressText,
            lat: DEFAULT_LOCATION.lat,
            lng: DEFAULT_LOCATION.lng,
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
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1" required minLength={3} />
        </div>
        <div>
          <Label>Branch address</Label>
          <Textarea value={form.addressText} onChange={(e) => setForm({ ...form, addressText: e.target.value })} className="mt-1" rows={2} required />
          <p className="mt-1 text-xs text-neutral-400">Pinned near {DEFAULT_LOCATION.label} in this pilot.</p>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <Label>Min order (Rs)</Label>
            <Input inputMode="numeric" value={form.minOrderRs} onChange={(e) => setForm({ ...form, minOrderRs: e.target.value })} className="mt-1" />
          </div>
          <div>
            <Label>Delivery fee (Rs)</Label>
            <Input inputMode="numeric" value={form.deliveryFeeRs} onChange={(e) => setForm({ ...form, deliveryFeeRs: e.target.value })} className="mt-1" />
          </div>
          <div>
            <Label>Radius (km)</Label>
            <Input inputMode="numeric" value={form.radiusKm} onChange={(e) => setForm({ ...form, radiusKm: e.target.value })} className="mt-1" />
          </div>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <Button type="submit" className="w-full" disabled={state.fetching}>
          {state.fetching ? "Submitting…" : "Submit for approval"}
        </Button>
      </form>
    </main>
  );
}
