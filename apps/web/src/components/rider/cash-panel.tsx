"use client";

// Cash-in-hand panel (#47): today's collected COD vs the rider's cash limit, with a
// warning band as it fills. Limit enforcement (gating new assignments) is the fraud
// issue #25 — this only surfaces the number so the rider knows when to deposit.
import { formatRs } from "@fd/shared";
import { cn } from "@/lib/utils";

export function CashPanel({
  collectedMinor,
  limitMinor,
  deliveriesToday,
}: {
  collectedMinor: number;
  limitMinor: number;
  deliveriesToday: number;
}) {
  const pct = limitMinor > 0 ? Math.min(100, (collectedMinor / limitMinor) * 100) : 0;
  const near = pct >= 80;
  const over = limitMinor > 0 && collectedMinor >= limitMinor;

  return (
    <section className="rounded-2xl border border-kd-border bg-kd-surface p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold uppercase text-kd-fg-muted">Cash in hand</h2>
        <span className="text-xs text-kd-fg-subtle">{deliveriesToday} today</span>
      </div>
      <p className="mt-1 text-2xl font-bold tabular-nums">
        {formatRs(collectedMinor)}
        <span className="ml-1 text-sm font-normal text-kd-fg-muted">
          / {formatRs(limitMinor)} limit
        </span>
      </p>
      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-kd-surface-muted">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            over ? "bg-kd-danger" : near ? "bg-kd-warning" : "bg-kd-success",
          )}
          style={{ width: `${Math.max(pct, collectedMinor > 0 ? 4 : 0)}%` }}
        />
      </div>
      {over ? (
        <p className="mt-2 text-sm font-medium text-kd-danger">
          Cash limit reached — deposit collected cash before taking more COD jobs.
        </p>
      ) : near ? (
        <p className="mt-2 text-sm font-medium text-kd-warning">
          Approaching your cash limit — plan a deposit soon.
        </p>
      ) : null}
    </section>
  );
}
