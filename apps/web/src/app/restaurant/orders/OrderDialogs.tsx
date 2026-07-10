"use client";

// Vendor accept / reject sheets (#46) — replaces the prompt()/confirm() dialogs the board
// used to lean on. Accept offers one-tap prep-time chips (busy-mode buffer pre-applied);
// reject offers reason presets so staff never have to type mid-rush.
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

const PREP_CHIPS = [10, 15, 20, 25, 30, 45, 60] as const;

export function AcceptSheet({
  open,
  code,
  bufferMinutes,
  onConfirm,
  onClose,
}: {
  open: boolean;
  code: string;
  // Busy-mode buffer added to whatever chip the operator picks (Foodpanda pattern).
  bufferMinutes: number;
  onConfirm: (eta: number) => void | Promise<void>;
  onClose: () => void;
}) {
  const [base, setBase] = useState<number>(25);
  const eta = base + bufferMinutes;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Accept {code}</DialogTitle>
          <DialogDescription>How long until it&apos;s ready?</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-2">
          {PREP_CHIPS.map((m) => (
            <Button
              key={m}
              size="sm"
              variant={base === m ? "default" : "outline"}
              onClick={() => setBase(m)}
            >
              {m}m
            </Button>
          ))}
        </div>
        {bufferMinutes > 0 && (
          <p className="text-xs text-kd-warning">
            Busy mode: +{bufferMinutes}m applied → customer sees {eta}m.
          </p>
        )}
        <Button
          size="lg"
          className="w-full"
          onClick={async () => {
            await onConfirm(eta);
            onClose();
          }}
        >
          Accept · {eta}m
        </Button>
      </DialogContent>
    </Dialog>
  );
}

const REJECT_REASONS = [
  { key: "out_of_stock", label: "Out of stock" },
  { key: "closing_soon", label: "Closing soon" },
  { key: "too_busy", label: "Too busy" },
  { key: "other", label: "Other" },
] as const;

export function RejectSheet({
  open,
  code,
  onConfirm,
  onClose,
}: {
  open: boolean;
  code: string;
  onConfirm: (reason: string) => void | Promise<void>;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [other, setOther] = useState("");
  const label = REJECT_REASONS.find((r) => r.key === selected)?.label ?? "";
  const reason = selected === "other" ? other.trim() : label;
  const canSubmit = selected !== null && (selected !== "other" || other.trim().length > 0);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setSelected(null);
          setOther("");
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reject {code}</DialogTitle>
          <DialogDescription>Pick a reason — the customer is refunded.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-2">
          {REJECT_REASONS.map((r) => (
            <Button
              key={r.key}
              size="sm"
              variant={selected === r.key ? "default" : "outline"}
              onClick={() => setSelected(r.key)}
            >
              {r.label}
            </Button>
          ))}
        </div>
        {selected === "other" && (
          <Textarea
            autoFocus
            placeholder="What happened?"
            value={other}
            onChange={(e) => setOther(e.target.value)}
          />
        )}
        <Button
          size="lg"
          variant="destructive"
          className="w-full"
          disabled={!canSubmit}
          onClick={async () => {
            if (!canSubmit) return;
            await onConfirm(reason);
            setSelected(null);
            setOther("");
            onClose();
          }}
        >
          Reject order
        </Button>
      </DialogContent>
    </Dialog>
  );
}
