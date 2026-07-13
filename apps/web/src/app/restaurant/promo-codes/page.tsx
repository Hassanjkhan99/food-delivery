"use client";

// Restaurant-scoped promo codes (#159). Owners create/disable their own codes; the API
// forces scope+funder = restaurant so no platform-funded discount can be minted here.
import { useState } from "react";
import { useQuery, useMutation } from "urql";
import { graphql } from "@/graphql/generated";
import { formatRs } from "@fd/shared";
import { useConsole } from "../useConsole";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const VouchersQuery = graphql(`
  query RestaurantVouchers($restaurantId: String!) {
    restaurantVouchers(restaurantId: $restaurantId) {
      id
      code
      type
      valueBps
      valueMinor
      minOrderMinor
      perUserLimit
      totalBudgetMinor
      usedCount
      active
    }
  }
`);

const CreateMutation = graphql(`
  mutation CreateRestaurantVoucher(
    $restaurantId: String!
    $code: String!
    $type: String!
    $valueBps: Int
    $valueMinor: Int
    $minOrderMinor: Int
    $perUserLimit: Int
    $totalBudgetMinor: Int
  ) {
    createRestaurantVoucher(
      restaurantId: $restaurantId
      code: $code
      type: $type
      valueBps: $valueBps
      valueMinor: $valueMinor
      minOrderMinor: $minOrderMinor
      perUserLimit: $perUserLimit
      totalBudgetMinor: $totalBudgetMinor
    ) {
      id
    }
  }
`);

const SetActiveMutation = graphql(`
  mutation SetRestaurantVoucherActive($id: String!, $active: Boolean!) {
    setRestaurantVoucherActive(id: $id, active: $active) {
      id
      active
    }
  }
`);

function describe(v: {
  type: string;
  valueBps: number;
  valueMinor: number;
  minOrderMinor: number;
}) {
  const base =
    v.type === "percentage"
      ? `${v.valueBps / 100}% off`
      : v.type === "fixed"
        ? `${formatRs(v.valueMinor)} off`
        : "Free delivery";
  return v.minOrderMinor > 0 ? `${base} · min ${formatRs(v.minOrderMinor)}` : base;
}

export default function PromoCodesPage() {
  const { restaurant } = useConsole();
  const restaurantId = restaurant?.id ?? "";
  const [{ data, fetching }, refetch] = useQuery({
    query: VouchersQuery,
    variables: { restaurantId },
    pause: !restaurantId,
    requestPolicy: "cache-and-network",
  });
  const [, create] = useMutation(CreateMutation);
  const [, setActive] = useMutation(SetActiveMutation);

  const [code, setCode] = useState("");
  const [type, setType] = useState("percentage");
  const [value, setValue] = useState("");
  const [minOrder, setMinOrder] = useState("");
  const [perUser, setPerUser] = useState("");
  const [budget, setBudget] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!restaurant) return <p className="text-kd-fg-muted">Complete onboarding first.</p>;

  async function submit() {
    setBusy(true);
    setError(null);
    const num = Number(value);
    const r = await create({
      restaurantId,
      code,
      type,
      valueBps: type === "percentage" ? Math.round(num * 100) : undefined,
      valueMinor: type === "fixed" ? Math.round(num * 100) : undefined,
      minOrderMinor: minOrder ? Math.round(Number(minOrder) * 100) : undefined,
      perUserLimit: perUser ? Math.round(Number(perUser)) : undefined,
      totalBudgetMinor: budget ? Math.round(Number(budget) * 100) : undefined,
    });
    setBusy(false);
    if (r.error) {
      setError(r.error.graphQLErrors[0]?.message ?? "Couldn't create the code.");
      return;
    }
    setCode("");
    setValue("");
    setMinOrder("");
    setPerUser("");
    setBudget("");
    refetch({ requestPolicy: "network-only" });
  }

  const vouchers = data?.restaurantVouchers ?? [];

  return (
    <main className="max-w-2xl">
      <h1 className="mb-1 text-xl font-bold">Promo codes</h1>
      <p className="mb-4 text-sm text-kd-fg-muted">
        Codes you create here apply only at your restaurant and are funded by you.
      </p>

      <div className="mb-6 rounded-xl border border-kd-border bg-kd-surface p-4">
        <p className="mb-3 text-sm font-medium">New code</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="code">Code</Label>
            <Input
              id="code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="EIDSPECIAL"
            />
          </div>
          <div>
            <Label htmlFor="type">Type</Label>
            <select
              id="type"
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="mt-1 h-9 w-full rounded-md border border-kd-border bg-kd-surface px-2 text-sm"
            >
              <option value="percentage">Percentage</option>
              <option value="fixed">Fixed amount</option>
              <option value="free_delivery">Free delivery</option>
            </select>
          </div>
          {type !== "free_delivery" && (
            <div>
              <Label htmlFor="value">
                {type === "percentage" ? "Discount (%)" : "Discount (Rs)"}
              </Label>
              <Input
                id="value"
                type="number"
                inputMode="decimal"
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            </div>
          )}
          <div>
            <Label htmlFor="minOrder">Min order (Rs, optional)</Label>
            <Input
              id="minOrder"
              type="number"
              inputMode="decimal"
              value={minOrder}
              onChange={(e) => setMinOrder(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="perUser">Uses per customer (optional)</Label>
            <Input
              id="perUser"
              type="number"
              inputMode="numeric"
              value={perUser}
              onChange={(e) => setPerUser(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="budget">Total budget (Rs, optional)</Label>
            <Input
              id="budget"
              type="number"
              inputMode="decimal"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
            />
          </div>
        </div>
        {error && <p className="mt-3 text-sm text-kd-danger">{error}</p>}
        <Button className="mt-3" size="sm" disabled={busy || !code} onClick={submit}>
          {busy ? "Creating…" : "Create code"}
        </Button>
      </div>

      <p className="mb-2 text-sm font-medium">Your codes</p>
      {fetching && vouchers.length === 0 ? (
        <p className="text-sm text-kd-fg-muted">Loading…</p>
      ) : vouchers.length === 0 ? (
        <p className="text-sm text-kd-fg-muted">No promo codes yet.</p>
      ) : (
        <div className="space-y-2">
          {vouchers.map((v) => (
            <div
              key={v.id}
              className="flex items-center justify-between rounded-xl border border-kd-border bg-kd-surface p-3 text-sm"
            >
              <div>
                <span className="font-mono font-bold">{v.code}</span>{" "}
                <Badge variant={v.active ? "default" : "secondary"}>
                  {v.active ? "active" : "off"}
                </Badge>
                <p className="text-xs text-kd-fg-muted">
                  {describe(v)} · used {v.usedCount}
                  {v.perUserLimit ? ` · ${v.perUserLimit}/customer` : ""}
                  {v.totalBudgetMinor ? ` · budget ${formatRs(v.totalBudgetMinor)}` : ""}
                </p>
              </div>
              <Button
                size="xs"
                variant={v.active ? "outline" : "default"}
                onClick={async () => {
                  await setActive({ id: v.id, active: !v.active });
                  refetch({ requestPolicy: "network-only" });
                }}
              >
                {v.active ? "Disable" : "Enable"}
              </Button>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
