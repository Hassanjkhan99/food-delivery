"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "urql";
import { MapPin, Pencil, Star, Trash2 } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/ui/form-field";
import { useDeliveryLocation } from "@/lib/location";
import {
  DeleteAddressMutation,
  MyAddressesQuery,
  SaveAddressMutation,
  UpdateAddressMutation,
} from "./address-graphql";

type FormState = {
  label: string;
  text: string;
  phone: string;
  notes: string;
  isDefault: boolean;
};

const EMPTY_FORM: FormState = {
  label: "",
  text: "",
  phone: "",
  notes: "",
  isDefault: false,
};

export default function AddressesPage() {
  const loc = useDeliveryLocation();
  const [{ data }, refetch] = useQuery({
    query: MyAddressesQuery,
    requestPolicy: "cache-and-network",
  });
  const [saveState, saveAddress] = useMutation(SaveAddressMutation);
  const [, updateAddress] = useMutation(UpdateAddressMutation);
  const [, deleteAddress] = useMutation(DeleteAddressMutation);

  // null = form hidden; "new" = adding; an id = editing that address.
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);

  const addresses = data?.myAddresses ?? [];

  function startAdd() {
    setForm(EMPTY_FORM);
    setEditing("new");
    setError(null);
  }

  function startEdit(a: NonNullable<typeof addresses>[number]) {
    setForm({
      label: a.label,
      text: a.text,
      phone: a.phone ?? "",
      notes: a.notes ?? "",
      isDefault: a.isDefault,
    });
    setEditing(a.id);
    setError(null);
  }

  function cancel() {
    setEditing(null);
    setError(null);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const phone = form.phone.trim() || undefined;
    const notes = form.notes.trim() || undefined;

    if (editing === "new") {
      // A freshly-saved address adopts the current delivery lat/lng (the pin the
      // customer is browsing with) — the backend keeps lat/lng required.
      const result = await saveAddress({
        input: {
          label: form.label.trim(),
          text: form.text.trim(),
          lat: loc.lat,
          lng: loc.lng,
          phone,
          notes,
          isDefault: form.isDefault,
        },
      });
      if (result.error) {
        setError(result.error.graphQLErrors[0]?.message ?? "Could not save address");
        return;
      }
    } else if (editing) {
      // Partial patch — lat/lng left untouched (we don't move an existing pin here).
      const result = await updateAddress({
        id: editing,
        input: {
          label: form.label.trim(),
          text: form.text.trim(),
          phone: phone ?? null,
          notes: notes ?? null,
          isDefault: form.isDefault,
        },
      });
      if (result.error) {
        setError(result.error.graphQLErrors[0]?.message ?? "Could not update address");
        return;
      }
    }
    setEditing(null);
    refetch({ requestPolicy: "network-only" });
  }

  async function makeDefault(id: string) {
    await updateAddress({ id, input: { isDefault: true } });
    refetch({ requestPolicy: "network-only" });
  }

  async function onDelete(id: string) {
    await deleteAddress({ id });
    if (editing === id) setEditing(null);
    refetch({ requestPolicy: "network-only" });
  }

  return (
    <main className="mx-auto max-w-md">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Saved addresses</h1>
        <Link href="/account" className="text-sm text-kd-primary hover:underline">
          Account
        </Link>
      </div>

      <div className="space-y-3">
        {addresses.map((a) => (
          <div
            key={a.id}
            className="flex items-start justify-between gap-3 rounded-xl border border-kd-border bg-kd-surface p-4"
          >
            <div className="flex min-w-0 items-start gap-3">
              <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-kd-fg-subtle" />
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-sm font-medium text-kd-fg">
                  {a.label}
                  {a.isDefault && (
                    <span className="rounded bg-kd-surface-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase text-kd-fg-muted">
                      default
                    </span>
                  )}
                </p>
                <p className="mt-0.5 text-xs text-kd-fg-muted">{a.text}</p>
                {a.phone && <p className="mt-0.5 text-xs text-kd-fg-subtle">{a.phone}</p>}
                {a.notes && <p className="mt-0.5 text-xs text-kd-fg-subtle">{a.notes}</p>}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {!a.isDefault && (
                <Button
                  variant="ghost"
                  size="sm"
                  title="Set as default"
                  onClick={() => makeDefault(a.id)}
                >
                  <Star className="h-4 w-4 text-kd-fg-subtle" />
                </Button>
              )}
              <Button variant="ghost" size="sm" title="Edit" onClick={() => startEdit(a)}>
                <Pencil className="h-4 w-4 text-kd-fg-subtle" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                title="Delete"
                onClick={() => onDelete(a.id)}
              >
                <Trash2 className="h-4 w-4 text-kd-fg-subtle" />
              </Button>
            </div>
          </div>
        ))}
        {addresses.length === 0 && (
          <p className="text-sm text-kd-fg-muted">No saved addresses yet.</p>
        )}
      </div>

      {editing === null ? (
        <Button className="mt-6 w-full" onClick={startAdd}>
          Add a new address
        </Button>
      ) : (
        <form
          onSubmit={onSubmit}
          className="mt-6 space-y-4 rounded-xl border border-kd-border bg-kd-surface p-4"
        >
          <p className="font-semibold">{editing === "new" ? "Add address" : "Edit address"}</p>

          <FormField label="Label" htmlFor="addr-label">
            <Input
              id="addr-label"
              required
              placeholder="Home, Work, Mom's place…"
              value={form.label}
              onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
              className="mt-1"
            />
          </FormField>

          <FormField
            label="Address"
            htmlFor="addr-text"
            hint={editing === "new" ? `Pinned near ${loc.label}` : undefined}
          >
            <Textarea
              id="addr-text"
              required
              minLength={5}
              rows={2}
              placeholder="House, street, sector, landmark…"
              value={form.text}
              onChange={(e) => setForm((f) => ({ ...f, text: e.target.value }))}
              className="mt-1"
            />
          </FormField>

          <FormField label="Contact phone (optional)" htmlFor="addr-phone">
            <Input
              id="addr-phone"
              type="tel"
              placeholder="+923001234567"
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              className="mt-1"
            />
          </FormField>

          <FormField label="Delivery instructions (optional)" htmlFor="addr-notes">
            <Textarea
              id="addr-notes"
              rows={2}
              placeholder="Ring the bell, leave at the gate…"
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              className="mt-1"
            />
          </FormField>

          <label className="flex items-center gap-2 text-sm text-kd-fg">
            <input
              type="checkbox"
              checked={form.isDefault}
              onChange={(e) => setForm((f) => ({ ...f, isDefault: e.target.checked }))}
            />
            Set as default address
          </label>

          {error && <p className="text-sm text-kd-danger">{error}</p>}

          <div className="flex gap-2">
            <Button type="submit" disabled={saveState.fetching} className="flex-1">
              {saveState.fetching ? "Saving…" : "Save"}
            </Button>
            <Button type="button" variant="outline" onClick={cancel}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      <Link href="/checkout" className={buttonVariants({ variant: "ghost", className: "mt-4 w-full" })}>
        Back to checkout
      </Link>
    </main>
  );
}
