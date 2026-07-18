"use client";

import * as React from "react";
import { Toast } from "@base-ui/react/toast";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * App-wide transient feedback. The app previously had **no** toast system (it used
 * `alert()` / `window.confirm()`); this is the replacement.
 *
 * Mount `<Toaster />` once (customer layout does this), then call `toast(...)` from
 * anywhere — the module-level manager and the mounted `<Toaster>` share one instance, so
 * callers don't need to be inside a provider.
 *
 *   toast.success("Order placed");
 *   toast.error("Payment failed", "Your card was declined.");
 */
export const toastManager = Toast.createToastManager();

type ToastInput = {
  title?: React.ReactNode;
  description?: React.ReactNode;
  type?: string;
  timeout?: number;
};

function make(type: string) {
  return (
    title: React.ReactNode,
    description?: React.ReactNode,
    opts?: Omit<ToastInput, "title" | "description" | "type">,
  ) => toastManager.add({ title, description, type, ...opts });
}

export const toast = Object.assign((input: ToastInput) => toastManager.add(input), {
  success: make("success"),
  error: make("error"),
  warning: make("warning"),
  info: make("info"),
});

// Left accent bar per type; default (no type) keeps the neutral glass border.
const TONE: Record<string, string> = {
  success: "border-l-kd-success",
  error: "border-l-kd-danger",
  warning: "border-l-kd-warning",
  info: "border-l-kd-info",
};

function ToastList() {
  const { toasts } = Toast.useToastManager();
  return toasts.map((t) => (
    <Toast.Root
      key={t.id}
      toast={t}
      className={cn(
        "kd-glass-solid flex items-start gap-3 rounded-xl border-l-4 border-l-kd-border p-3.5 pr-2 shadow-kd-lg",
        t.type && TONE[t.type],
      )}
    >
      <div className="min-w-0 flex-1">
        <Toast.Title className="text-sm font-semibold text-kd-fg" />
        <Toast.Description className="mt-0.5 text-sm text-kd-fg-muted" />
      </div>
      <Toast.Close
        aria-label="Dismiss"
        className="shrink-0 rounded-md p-1 text-kd-fg-subtle transition-colors hover:bg-kd-surface-muted hover:text-kd-fg"
      >
        <X className="h-4 w-4" />
      </Toast.Close>
    </Toast.Root>
  ));
}

/** Mount once near the app root. Self-contained (owns the provider + viewport). */
export function Toaster() {
  return (
    <Toast.Provider toastManager={toastManager}>
      <Toast.Portal>
        <Toast.Viewport className="fixed right-4 bottom-4 z-[100] flex w-[calc(100vw-2rem)] max-w-sm flex-col gap-2 outline-none">
          <ToastList />
        </Toast.Viewport>
      </Toast.Portal>
    </Toast.Provider>
  );
}
