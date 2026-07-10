"use client";

import { useState } from "react";
import Link from "next/link";
import { HELP_FAQ } from "@fd/shared";

export default function HelpPage() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <main className="mx-auto max-w-lg">
      <h1 className="mb-2 text-2xl font-bold">Help center</h1>
      <p className="mb-6 text-sm text-kd-fg-muted">
        Have a problem with a specific order? Open it from{" "}
        <Link href="/orders" className="underline hover:text-kd-fg">
          Your orders
        </Link>{" "}
        and tap “Get help with this order” for order-specific options and refunds.
      </p>

      <div className="divide-y divide-kd-border rounded-xl border border-kd-border bg-kd-surface">
        {HELP_FAQ.map((item, idx) => {
          const isOpen = open === idx;
          return (
            <div key={item.q}>
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={() => setOpen(isOpen ? null : idx)}
                className="flex w-full items-center justify-between p-4 text-left"
              >
                <span className="text-sm font-medium text-kd-fg">{item.q}</span>
                <span className="text-kd-fg-subtle">{isOpen ? "−" : "+"}</span>
              </button>
              {isOpen && <p className="px-4 pb-4 text-sm text-kd-fg-muted">{item.a}</p>}
            </div>
          );
        })}
      </div>

      <p className="mt-6 text-center text-xs text-kd-fg-subtle">
        Still stuck? Reach us at{" "}
        <a href="mailto:support@herald.com" className="underline hover:text-kd-fg">
          support@herald.com
        </a>
        .
      </p>
    </main>
  );
}
