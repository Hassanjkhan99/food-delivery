"use client";

// The cart is branch-scoped (lib/cart.ts). Swiping right on a dish from a different
// restaurant than the one already in the cart needs an explicit "clear and start over"
// confirmation, mirroring the inline banner item-modal.tsx shows for the same
// branch_conflict case — this is the deck's full-screen equivalent since a swipe already
// committed to leaving the card, so there's no menu page to show an inline banner on.
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export function ConflictDialog({
  existingName,
  newName,
  onConfirm,
  onCancel,
}: {
  existingName: string | null;
  newName: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const open = !!newName;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent showCloseButton={false} className="rounded-3xl p-6 text-center">
        <div className="mx-auto grid h-13 w-13 place-items-center rounded-2xl bg-kd-accent-soft text-2xl">
          🛒
        </div>
        <DialogTitle className="mt-3.5 text-lg font-bold tracking-tight text-kd-fg">
          Start a new cart?
        </DialogTitle>
        <p className="mt-2 text-sm leading-relaxed text-kd-fg-muted">
          Your cart has items from <strong className="text-kd-fg">{existingName}</strong>. Adding
          from <strong className="text-kd-fg">{newName}</strong> will clear it.
        </p>
        <div className="mt-5 flex flex-col gap-2.5">
          <Button variant="brand" className="w-full py-5" onClick={onConfirm}>
            Start new cart
          </Button>
          <Button variant="outline" className="w-full py-5" onClick={onCancel}>
            Keep {existingName}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
