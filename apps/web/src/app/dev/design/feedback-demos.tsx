"use client";

import { useState } from "react";
import { Info } from "lucide-react";

import { toast, Toaster } from "@/components/ui/toast";
import { Tooltip } from "@/components/ui/tooltip";
import { Progress } from "@/components/ui/progress";
import { Avatar } from "@/components/ui/avatar";
import { Stepper } from "@/components/ui/stepper";
import { Button } from "@/components/ui/button";

/** Interactive (client) showcase for the feedback & overlay primitives. Renders its own
 *  <Toaster/> because /dev/design lives outside the (customer) layout that mounts one. */
export function FeedbackDemos() {
  const [pct, setPct] = useState(60);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="brand"
          onClick={() => toast.success("Order placed", "The kitchen has your order.")}
        >
          Success toast
        </Button>
        <Button
          variant="outline"
          onClick={() => toast.error("Payment failed", "Your card was declined.")}
        >
          Error toast
        </Button>
        <Button
          variant="outline"
          onClick={() => toast.info("Heads up", "Delivery may take longer in the rain.")}
        >
          Info toast
        </Button>
        <Tooltip content="Tooltips replace native title=">
          <button
            type="button"
            aria-label="More info"
            className="inline-grid size-8 place-items-center rounded-full border border-kd-border text-kd-fg-muted hover:text-kd-fg"
          >
            <Info className="h-4 w-4" />
          </button>
        </Tooltip>
      </div>

      <div className="max-w-sm space-y-2">
        <div className="flex items-center justify-between text-sm text-kd-fg-muted">
          <span>Progress</span>
          <span className="tabular-nums">{pct}%</span>
        </div>
        <Progress value={pct} />
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setPct((p) => Math.max(0, p - 20))}>
            −20
          </Button>
          <Button size="sm" variant="outline" onClick={() => setPct((p) => Math.min(100, p + 20))}>
            +20
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Avatar fallback="TJ" />
        <Avatar src="/Biryani/biryani-hero.jpg" alt="Sample" fallback="KB" />
        <Avatar size="lg" fallback="🍔" />
      </div>

      <Stepper
        current={2}
        steps={[
          { label: "Order placed", description: "12:04 PM" },
          { label: "Preparing", description: "12:07 PM" },
          { label: "On the way", description: "Now" },
          { label: "Delivered" },
        ]}
      />

      <Toaster />
    </div>
  );
}
