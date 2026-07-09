"use client";

// "86 an item on this order" quick-action (#46). From a NEW order card the operator can
// mark any line item unavailable in <=3 taps (open sheet → pick item → pick duration),
// which flips MenuItem.isAvailable so customers stop being able to add it immediately.
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export type EightySixTarget = { menuItemId: string; name: string };

export function EightySixSheet({
  open,
  items,
  onConfirm,
  onClose,
}: {
  open: boolean;
  items: EightySixTarget[];
  // `until` mirrors the API arg: "today" (back tomorrow) or "manual" (indefinite).
  onConfirm: (menuItemId: string, until: "today" | "manual") => void | Promise<void>;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<EightySixTarget | null>(null);
  const close = () => {
    setPicked(null);
    onClose();
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>86 an item</DialogTitle>
          <DialogDescription>
            {picked
              ? `How long is "${picked.name}" unavailable?`
              : "Which item ran out?"}
          </DialogDescription>
        </DialogHeader>
        {!picked ? (
          <div className="flex flex-col gap-2">
            {items.length === 0 && (
              <p className="text-sm text-kd-fg-muted">No linked menu items on this order.</p>
            )}
            {items.map((it) => (
              <Button
                key={it.menuItemId}
                variant="outline"
                className="justify-start"
                onClick={() => setPicked(it)}
              >
                {it.name}
              </Button>
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <Button
              variant="destructive"
              onClick={async () => {
                await onConfirm(picked.menuItemId, "today");
                close();
              }}
            >
              Unavailable today
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                await onConfirm(picked.menuItemId, "manual");
                close();
              }}
            >
              Until I turn it back on
            </Button>
            <Button variant="ghost" onClick={() => setPicked(null)}>
              ← Back
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
