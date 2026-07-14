"use client";

import { useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import { useQuery } from "urql";
import { MapPin, Plus } from "lucide-react";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { MyAddressesQuery } from "./address-graphql";

// A saved address as surfaced by the AddressSelector.
export type SavedAddress = {
  id: string;
  label: string;
  text: string;
  lat: number;
  lng: number;
  phone?: string | null;
  notes?: string | null;
  isDefault: boolean;
};

// Sentinel radio value for the "enter a new address" option.
const NEW_ADDRESS = "__new__";

type Props = {
  /** Called when the user picks a saved address (prefill delivery fields). */
  onSelect: (addr: SavedAddress) => void;
  /** Called when the user switches to entering a brand-new address. */
  onNew: () => void;
  /** The id of the currently selected saved address, or null while entering new. */
  selectedId: string | null;
  /**
   * Whether the viewer is authenticated. The query is paused while signed out so a
   * guest who verifies inline (OTP) on checkout gets their saved addresses fetched
   * once the session lands — instead of the query resolving empty and never re-running (#125).
   */
  loggedIn?: boolean;
  /**
   * Whether to auto-pick the default/first saved address on load. The checkout passes
   * false once the guest has typed a manual address, so a post-OTP fetch doesn't clobber
   * it (#125 review). Defaults to true.
   */
  autoSelect?: boolean;
};

/**
 * Lets the customer pick one of their saved addresses to prefill the checkout
 * delivery fields, or choose to enter a new one. Mirrors the myPaymentMethods
 * radio-picker pattern used on this checkout page. Degrades gracefully when the
 * customer has no saved addresses (or isn't logged in): it simply shows the
 * "new address" branch and the manual fields stay in charge.
 */
export function AddressSelector({
  onSelect,
  onNew,
  selectedId,
  loggedIn = true,
  autoSelect = true,
}: Props) {
  const [{ data, fetching }] = useQuery({
    query: MyAddressesQuery,
    requestPolicy: "cache-and-network",
    // Pause until authenticated so the query executes (not just resolves empty) once a
    // guest verifies inline on checkout (#125).
    pause: !loggedIn,
  });
  const addresses = useMemo<SavedAddress[]>(
    () => (data?.myAddresses ?? []) as SavedAddress[],
    [data],
  );

  // Auto-select the default (or first) saved address once, on initial load, so
  // checkout starts prefilled. A ref (not state) guards the one-shot so we don't
  // trigger a cascading render, and after that we respect the user's choice.
  const autoPicked = useRef(false);
  useEffect(() => {
    if (autoPicked.current || addresses.length === 0 || !autoSelect) return;
    autoPicked.current = true;
    onSelect(addresses.find((a) => a.isDefault) ?? addresses[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addresses, autoSelect]);

  if (fetching && addresses.length === 0) {
    return <p className="text-sm text-kd-fg-subtle">Loading saved addresses…</p>;
  }

  if (addresses.length === 0) {
    // Nothing saved yet — the manual entry fields below stand alone.
    return null;
  }

  const value = selectedId ?? NEW_ADDRESS;

  return (
    <div className="rounded-xl border border-kd-border bg-kd-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-semibold">Deliver to</p>
        <Link href="/addresses" className="text-xs text-kd-primary hover:underline">
          Manage
        </Link>
      </div>
      <RadioGroup
        value={value}
        onValueChange={(v) => {
          if (v === NEW_ADDRESS) {
            onNew();
            return;
          }
          const addr = addresses.find((a) => a.id === v);
          if (addr) onSelect(addr);
        }}
      >
        {addresses.map((a) => (
          <Label
            key={a.id}
            htmlFor={`addr-${a.id}`}
            className="flex cursor-pointer items-start gap-3 rounded-lg border border-kd-border p-3 has-data-[checked]:border-kd-primary has-data-[checked]:bg-kd-primary-soft"
          >
            <RadioGroupItem id={`addr-${a.id}`} value={a.id} className="mt-0.5" />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5 text-sm font-medium text-kd-fg">
                <MapPin className="h-3.5 w-3.5 shrink-0 text-kd-fg-subtle" />
                {a.label}
                {a.isDefault && (
                  <span className="rounded bg-kd-surface-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase text-kd-fg-muted">
                    default
                  </span>
                )}
              </span>
              <span className="mt-0.5 block truncate text-xs text-kd-fg-muted">{a.text}</span>
              {a.phone && <span className="mt-0.5 block text-xs text-kd-fg-subtle">{a.phone}</span>}
            </span>
          </Label>
        ))}
        <Label
          htmlFor="addr-new"
          className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-kd-border p-3 has-data-[checked]:border-kd-primary has-data-[checked]:bg-kd-primary-soft"
        >
          <RadioGroupItem id="addr-new" value={NEW_ADDRESS} />
          <span className="flex items-center gap-1.5 text-sm font-medium text-kd-fg">
            <Plus className="h-3.5 w-3.5 text-kd-fg-subtle" />
            Enter a new address
          </span>
        </Label>
      </RadioGroup>
    </div>
  );
}
