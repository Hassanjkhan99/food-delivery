"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw } from "lucide-react";
import { reorderIntoCart, useCart, type ReorderSource } from "@/lib/cart";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Props = {
  source: ReorderSource;
  /** Where to land after rebuilding the cart. Defaults to the cart page. */
  destination?: string;
  className?: string;
  size?: "sm" | "default" | "lg";
  variant?: "default" | "outline" | "ghost" | "secondary";
  children?: React.ReactNode;
};

/**
 * One-tap reorder: rebuilds the cart from a past order's snapshots and routes to
 * the cart. If a cart from a *different* branch is already in progress, we ask
 * before replacing it (reorder always starts a fresh single-branch cart).
 */
export function ReorderButton({
  source,
  destination = "/cart",
  className,
  size = "sm",
  variant = "outline",
  children,
}: Props) {
  const router = useRouter();
  const existingBranchId = useCart((s) => s.branchId);
  const existingLineCount = useCart((s) => s.lines.length);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wouldReplace =
    existingLineCount > 0 && existingBranchId != null && existingBranchId !== source.branch.id;
  // Block the reorder up front when the branch is closed by hours, rather than rebuilding
  // the cart and routing to checkout only to fail at placement (#125).
  const branchClosed = source.branch.isOpenNow === false;

  function run() {
    setError(null);
    const result = reorderIntoCart(source);
    if (result === "reordered") {
      router.push(destination);
      return;
    }
    setError(
      result === "empty"
        ? "These items are no longer available to reorder."
        : "Couldn't reorder — the restaurant is unavailable.",
    );
  }

  function onClick() {
    if (wouldReplace) {
      setConfirmOpen(true);
      return;
    }
    run();
  }

  return (
    <>
      <Button
        type="button"
        size={size}
        variant={variant}
        className={className}
        onClick={onClick}
        disabled={branchClosed}
      >
        <RotateCcw className="h-4 w-4" />
        {branchClosed ? "Closed right now" : (children ?? "Reorder")}
      </Button>
      {error && <p className="mt-2 text-sm text-kd-danger">{error}</p>}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Replace your cart?</DialogTitle>
            <DialogDescription>
              You already have items in your cart from another restaurant. Reordering will clear
              them and start a new cart from {source.branch.name}.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Keep my cart
            </Button>
            <Button
              onClick={() => {
                setConfirmOpen(false);
                run();
              }}
            >
              Replace &amp; reorder
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
