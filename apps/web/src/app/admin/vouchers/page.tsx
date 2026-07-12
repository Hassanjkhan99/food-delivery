"use client";

import { useState } from "react";
import { useMutation, useQuery } from "urql";
import { graphql } from "@/graphql/generated";
import { formatRs } from "@fd/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

const VouchersQuery = graphql(`
  query AdminVouchers {
    vouchers {
      id
      code
      description
      type
      scope
      funder
      valueBps
      valueMinor
      maxDiscountMinor
      minOrderMinor
      firstOrderOnly
      perUserLimit
      totalBudgetMinor
      usedBudgetMinor
      remainingBudgetMinor
      usedCount
      active
    }
  }
`);

const CreateVoucherMutation = graphql(`
  mutation AdminCreateVoucher($input: VoucherInput!) {
    createVoucher(input: $input) {
      id
    }
  }
`);

const SetActiveMutation = graphql(`
  mutation AdminSetVoucherActive($id: String!, $active: Boolean!) {
    setVoucherActive(id: $id, active: $active) {
      id
      active
    }
  }
`);

type Type = "percentage" | "fixed" | "free_delivery";

// A single blank form; the value input's meaning depends on `type`.
const BLANK = {
  code: "",
  description: "",
  type: "percentage" as Type,
  funder: "platform",
  value: "", // percent (whole %) OR flat Rs, depending on type
  maxDiscount: "", // Rs cap for percentage
  minOrder: "", // Rs
  perUserLimit: "1",
  totalBudget: "", // Rs
  firstOrderOnly: true,
};

export default function AdminVouchersPage() {
  const [{ data, fetching }, refetch] = useQuery({
    query: VouchersQuery,
    requestPolicy: "cache-and-network",
  });
  const [, create] = useMutation(CreateVoucherMutation);
  const [, setActive] = useMutation(SetActiveMutation);
  const [form, setForm] = useState(BLANK);
  const [message, setMessage] = useState<string | null>(null);

  const vouchers = data?.vouchers ?? [];
  const rsToMinor = (v: string) => (v.trim() === "" ? undefined : Math.round(Number(v) * 100));

  async function submit() {
    setMessage(null);
    const type = form.type;
    const input = {
      code: form.code,
      description: form.description.trim() || undefined,
      type,
      funder: form.funder,
      // percentage → valueBps (1% = 100 bps); fixed → valueMinor; free_delivery → neither.
      valueBps: type === "percentage" ? Math.round(Number(form.value || 0) * 100) : undefined,
      valueMinor: type === "fixed" ? rsToMinor(form.value) : undefined,
      maxDiscountMinor: type === "percentage" ? rsToMinor(form.maxDiscount) : undefined,
      minOrderMinor: rsToMinor(form.minOrder),
      perUserLimit: form.perUserLimit.trim() === "" ? undefined : Number(form.perUserLimit),
      totalBudgetMinor: rsToMinor(form.totalBudget),
      firstOrderOnly: form.firstOrderOnly,
    };
    const r = await create({ input });
    if (r.error) {
      setMessage(r.error.graphQLErrors[0]?.message ?? "Create failed");
      return;
    }
    setMessage(`Created ${form.code.toUpperCase()}.`);
    setForm(BLANK);
    refetch({ requestPolicy: "network-only" });
  }

  return (
    <main className="max-w-3xl">
      <h1 className="mb-1 text-xl font-bold">Vouchers</h1>
      <p className="mb-4 text-sm text-kd-fg-muted">
        Platform-funded promo codes. Discounts post a balanced ledger entry against the funder at
        settlement.
      </p>

      <div className="mb-8 space-y-4 rounded-2xl border border-kd-border bg-kd-surface p-4 text-sm">
        <p className="font-semibold">New voucher</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Code</Label>
            <Input
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
              placeholder="WELCOME50"
              className="mt-1 uppercase"
            />
          </div>
          <div>
            <Label>Type</Label>
            <select
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value as Type })}
              className="mt-1 w-full rounded-lg border border-kd-border bg-kd-surface px-3 py-2"
            >
              <option value="percentage">Percentage off</option>
              <option value="fixed">Flat amount off</option>
              <option value="free_delivery">Free delivery</option>
            </select>
          </div>
          {form.type !== "free_delivery" && (
            <div>
              <Label>{form.type === "percentage" ? "Percent (%)" : "Amount off (Rs)"}</Label>
              <Input
                inputMode="numeric"
                value={form.value}
                onChange={(e) => setForm({ ...form, value: e.target.value })}
                className="mt-1"
              />
            </div>
          )}
          {form.type === "percentage" && (
            <div>
              <Label>Max discount (Rs)</Label>
              <Input
                inputMode="numeric"
                value={form.maxDiscount}
                onChange={(e) => setForm({ ...form, maxDiscount: e.target.value })}
                className="mt-1"
              />
            </div>
          )}
          <div>
            <Label>Min order (Rs)</Label>
            <Input
              inputMode="numeric"
              value={form.minOrder}
              onChange={(e) => setForm({ ...form, minOrder: e.target.value })}
              className="mt-1"
            />
          </div>
          <div>
            <Label>Per-user limit (blank = unlimited)</Label>
            <Input
              inputMode="numeric"
              value={form.perUserLimit}
              onChange={(e) => setForm({ ...form, perUserLimit: e.target.value })}
              className="mt-1"
            />
          </div>
          <div>
            <Label>Total budget (Rs, blank = none)</Label>
            <Input
              inputMode="numeric"
              value={form.totalBudget}
              onChange={(e) => setForm({ ...form, totalBudget: e.target.value })}
              className="mt-1"
            />
          </div>
          <div>
            <Label>Description</Label>
            <Input
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="mt-1"
            />
          </div>
        </div>
        <label className="flex items-center gap-2 text-kd-fg">
          <input
            type="checkbox"
            checked={form.firstOrderOnly}
            onChange={(e) => setForm({ ...form, firstOrderOnly: e.target.checked })}
          />
          First order only
        </label>
        {message && <p className="text-kd-fg-muted">{message}</p>}
        <Button className="w-full" disabled={!form.code.trim()} onClick={submit}>
          Create voucher
        </Button>
      </div>

      <h2 className="mb-2 text-sm font-semibold">All vouchers</h2>
      {fetching && vouchers.length === 0 ? (
        <Skeleton className="h-40 rounded-2xl" />
      ) : vouchers.length === 0 ? (
        <p className="text-sm text-kd-fg-muted">No vouchers yet.</p>
      ) : (
        <div className="space-y-2">
          {vouchers.map((v) => (
            <div
              key={v.id}
              className="flex items-center justify-between rounded-xl border border-kd-border bg-kd-surface p-3 text-sm"
            >
              <div>
                <p className="font-semibold">
                  {v.code}{" "}
                  <span className="text-xs font-normal text-kd-fg-muted">
                    ({v.type}
                    {v.type === "percentage" ? ` ${v.valueBps / 100}%` : ""}
                    {v.type === "fixed" ? ` ${formatRs(v.valueMinor)}` : ""})
                  </span>
                </p>
                <p className="text-xs text-kd-fg-muted">
                  Min {formatRs(v.minOrderMinor)} · used {v.usedCount}×
                  {v.perUserLimit != null ? ` · ${v.perUserLimit}/user` : ""}
                  {v.totalBudgetMinor != null
                    ? ` · budget ${formatRs(v.usedBudgetMinor)}/${formatRs(v.totalBudgetMinor)}`
                    : ""}
                  {v.firstOrderOnly ? " · first-order" : ""}
                </p>
              </div>
              <Button
                variant={v.active ? "outline" : "default"}
                size="sm"
                onClick={async () => {
                  await setActive({ id: v.id, active: !v.active });
                  refetch({ requestPolicy: "network-only" });
                }}
              >
                {v.active ? "Deactivate" : "Activate"}
              </Button>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
