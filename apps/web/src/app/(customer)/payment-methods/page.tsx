"use client";

import { useState } from "react";
import { useMutation, useQuery } from "urql";
import { CreditCard, Trash2 } from "lucide-react";
import { graphql } from "@/graphql/generated";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const MethodsQuery = graphql(`
  query MyPaymentMethods {
    myPaymentMethods {
      id
      brand
      last4
      expMonth
      expYear
      isDefault
    }
  }
`);

const AddMethodMutation = graphql(`
  mutation AddPaymentMethod($card: CardInput!) {
    addPaymentMethod(card: $card) {
      id
      brand
      last4
    }
  }
`);

const RemoveMethodMutation = graphql(`
  mutation RemovePaymentMethod($id: String!) {
    removePaymentMethod(id: $id)
  }
`);

export default function PaymentMethodsPage() {
  const [{ data }, refetch] = useQuery({ query: MethodsQuery, requestPolicy: "cache-and-network" });
  const [addState, addMethod] = useMutation(AddMethodMutation);
  const [, removeMethod] = useMutation(RemoveMethodMutation);

  const [number, setNumber] = useState("");
  const [exp, setExp] = useState("");
  const [cvc, setCvc] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function onAdd(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const [mm, yy] = exp.split("/").map((s) => s.trim());
    const result = await addMethod({
      card: {
        number: number.replace(/\s/g, ""),
        expMonth: Number(mm),
        expYear: 2000 + Number(yy),
        cvc,
      },
    });
    if (result.error) {
      setError(result.error.graphQLErrors[0]?.message ?? "Could not save card");
      return;
    }
    setNumber("");
    setExp("");
    setCvc("");
    refetch({ requestPolicy: "network-only" });
  }

  return (
    <main className="mx-auto max-w-md">
      <h1 className="mb-6 text-2xl font-bold">Payment methods</h1>

      <div className="space-y-3">
        {data?.myPaymentMethods.map((m) => (
          <div
            key={m.id}
            className="flex items-center justify-between rounded-xl border border-neutral-200 bg-white p-4"
          >
            <div className="flex items-center gap-3">
              <CreditCard className="h-6 w-6 text-neutral-400" />
              <div>
                <p className="text-sm font-medium capitalize">
                  {m.brand} •••• {m.last4}
                  {m.isDefault && (
                    <span className="ml-2 rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-neutral-500">
                      default
                    </span>
                  )}
                </p>
                <p className="text-xs text-neutral-500">
                  Expires {String(m.expMonth).padStart(2, "0")}/{m.expYear % 100}
                </p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                await removeMethod({ id: m.id });
                refetch({ requestPolicy: "network-only" });
              }}
            >
              <Trash2 className="h-4 w-4 text-neutral-400" />
            </Button>
          </div>
        ))}
        {data?.myPaymentMethods.length === 0 && (
          <p className="text-sm text-neutral-500">No saved cards yet.</p>
        )}
      </div>

      <form onSubmit={onAdd} className="mt-8 space-y-4 rounded-xl border border-neutral-200 bg-white p-4">
        <p className="font-semibold">Add a card</p>
        <p className="text-xs text-neutral-400">
          Mock gateway — try 4242 4242 4242 4242. (4000 0000 0000 0002 simulates a decline.)
        </p>
        <div>
          <Label htmlFor="num">Card number</Label>
          <Input
            id="num"
            inputMode="numeric"
            placeholder="4242 4242 4242 4242"
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            className="mt-1"
            required
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="exp">Expiry (MM/YY)</Label>
            <Input
              id="exp"
              placeholder="12/30"
              value={exp}
              onChange={(e) => setExp(e.target.value)}
              className="mt-1"
              required
            />
          </div>
          <div>
            <Label htmlFor="cvc">CVC</Label>
            <Input
              id="cvc"
              inputMode="numeric"
              placeholder="123"
              value={cvc}
              onChange={(e) => setCvc(e.target.value)}
              className="mt-1"
              required
            />
          </div>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <Button type="submit" disabled={addState.fetching} className="w-full">
          {addState.fetching ? "Saving…" : "Save card"}
        </Button>
      </form>
    </main>
  );
}
