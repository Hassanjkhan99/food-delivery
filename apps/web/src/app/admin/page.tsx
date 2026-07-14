"use client";

// Admin command center (#135). The live-ops landing view: a prioritised
// "Attention needed" decisions queue that deep-links into the existing admin
// workflows, marketplace-health tiles, and a money/risk snapshot. All backed by
// the real `commandCenter` GraphQL query (no mocks). There is no admin realtime
// topic yet, so counts are refreshed by bounded polling every 15s (follow-up:
// wire the `admin:*` SSE topics from the issue).
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useQuery } from "urql";
import { AlertTriangle, ArrowUpRight, Bike, Clock, Store, TrendingUp } from "lucide-react";
import { graphql } from "@/graphql/generated";
import { formatRs } from "@fd/shared";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const CommandCenterQuery = graphql(`
  query AdminCommandCenter {
    commandCenter {
      health {
        ordersToday
        gmvTodayMinor
        activeOrders
        acceptanceSlaPct
        avgAcceptanceSeconds
        cancellationRatePct
        ridersOnline
        ridersTotal
        restaurantsLive
        restaurantsTotal
        slaRiskOrders
      }
      money {
        codOutstandingMinor
        refundLiabilityMinor
        pendingPayoutMinor
      }
      attention {
        key
        kind
        severity
        title
        detail
        count
        href
      }
    }
  }
`);

const POLL_MS = 15_000;

function HealthTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-kd-border bg-kd-surface p-4">
      <p className="text-2xl font-bold tabular-nums">{value}</p>
      <p className="text-xs text-kd-fg-muted">{label}</p>
      {sub && <p className="mt-1 text-[11px] text-kd-fg-subtle">{sub}</p>}
    </div>
  );
}

export default function AdminCommandCenterPage() {
  const router = useRouter();
  const [{ data, fetching, error }, refetch] = useQuery({
    query: CommandCenterQuery,
    requestPolicy: "cache-and-network",
  });
  const [orderId, setOrderId] = useState("");

  // Bounded polling stand-in for admin realtime (see file header + issue #135).
  useEffect(() => {
    const t = setInterval(() => refetch({ requestPolicy: "network-only" }), POLL_MS);
    return () => clearInterval(t);
  }, [refetch]);

  const cc = data?.commandCenter;

  if (fetching && !cc) {
    return (
      <main className="space-y-6">
        <Skeleton className="h-40 rounded-2xl" />
        <Skeleton className="h-64 rounded-2xl" />
      </main>
    );
  }

  const h = cc?.health;
  const m = cc?.money;
  const attention = cc?.attention ?? [];

  return (
    <main className="max-w-5xl space-y-8">
      <header>
        <h1 className="text-xl font-bold">Command center</h1>
        <p className="text-sm text-kd-fg-muted">
          Live marketplace health and the decisions waiting on you. Refreshes every 15s.
        </p>
      </header>

      {error && (
        <p className="rounded-xl bg-kd-danger-soft p-4 text-sm text-kd-danger">{error.message}</p>
      )}

      {/* ── Attention needed ─────────────────────────────────────────────── */}
      <section>
        <h2 className="mb-3 flex items-center gap-2 text-lg font-bold">
          <AlertTriangle className="h-5 w-5 text-kd-danger" />
          Attention needed
        </h2>
        {attention.length === 0 ? (
          <p className="rounded-xl border border-kd-border bg-kd-surface p-6 text-center text-sm text-kd-fg-subtle">
            All clear — no approvals, refunds, or escalations are waiting. The marketplace is
            healthy.
          </p>
        ) : (
          <div className="space-y-2">
            {attention.map((a) => {
              const critical = a.severity === "critical";
              return (
                <Link
                  key={a.key}
                  href={a.href}
                  className={`flex items-center justify-between gap-4 rounded-xl border p-4 transition-colors ${
                    critical
                      ? "border-kd-danger/40 bg-kd-danger-soft hover:bg-kd-danger-soft/80"
                      : "border-kd-border bg-kd-warning-soft hover:brightness-[0.98]"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <span
                      className={`mt-0.5 inline-flex h-8 min-w-8 items-center justify-center rounded-lg px-2 text-sm font-bold ${
                        critical ? "bg-kd-danger text-white" : "bg-kd-warning text-white"
                      }`}
                    >
                      {a.count}
                    </span>
                    <div>
                      <p
                        className={`text-sm font-semibold ${
                          critical ? "text-kd-danger" : "text-kd-warning-soft-fg"
                        }`}
                      >
                        {a.title}
                      </p>
                      <p className="text-xs text-kd-fg-muted">{a.detail}</p>
                    </div>
                  </div>
                  <ArrowUpRight className="h-4 w-4 shrink-0 text-kd-fg-subtle" />
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Live marketplace health ──────────────────────────────────────── */}
      <section>
        <h2 className="mb-3 flex items-center gap-2 text-lg font-bold">
          <TrendingUp className="h-5 w-5" />
          Live marketplace health
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <HealthTile label="Orders today" value={String(h?.ordersToday ?? 0)} />
          <HealthTile label="GMV today (delivered)" value={formatRs(h?.gmvTodayMinor ?? 0)} />
          <HealthTile label="Active orders" value={String(h?.activeOrders ?? 0)} />
          <HealthTile
            label="Acceptance SLA (120s)"
            value={`${(h?.acceptanceSlaPct ?? 100).toFixed(0)}%`}
            sub={
              h?.avgAcceptanceSeconds != null
                ? `avg ${h.avgAcceptanceSeconds.toFixed(0)}s to accept`
                : "no accepts yet today"
            }
          />
          <HealthTile
            label="Cancellation rate"
            value={`${(h?.cancellationRatePct ?? 0).toFixed(1)}%`}
          />
          <HealthTile
            label="Riders online"
            value={`${h?.ridersOnline ?? 0} / ${h?.ridersTotal ?? 0}`}
            sub="online / total"
          />
          <HealthTile
            label="Restaurants live"
            value={`${h?.restaurantsLive ?? 0} / ${h?.restaurantsTotal ?? 0}`}
            sub="approved / total"
          />
          <HealthTile
            label="Orders near SLA"
            value={String(h?.slaRiskOrders ?? 0)}
            sub="pending, close to deadline"
          />
        </div>
      </section>

      {/* ── Money / risk snapshot ────────────────────────────────────────── */}
      <section>
        <h2 className="mb-3 flex items-center gap-2 text-lg font-bold">
          <Clock className="h-5 w-5" />
          Money &amp; risk
        </h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-kd-border bg-kd-surface p-4">
            <p className="text-2xl font-bold tabular-nums">
              {formatRs(m?.codOutstandingMinor ?? 0)}
            </p>
            <p className="text-xs text-kd-fg-muted">COD outstanding</p>
            <p className="mt-1 text-[11px] text-kd-fg-subtle">Cash on undelivered COD tasks</p>
          </div>
          <Link
            href="/admin/refunds"
            className="rounded-2xl border border-kd-border bg-kd-surface p-4 transition-colors hover:bg-kd-surface-muted"
          >
            <p className="text-2xl font-bold tabular-nums">
              {formatRs(m?.refundLiabilityMinor ?? 0)}
            </p>
            <p className="text-xs text-kd-fg-muted">Refund liability</p>
            <p className="mt-1 text-[11px] text-kd-fg-subtle">Pending refunds →</p>
          </Link>
          <Link
            href="/admin/payouts"
            className="rounded-2xl border border-kd-border bg-kd-surface p-4 transition-colors hover:bg-kd-surface-muted"
          >
            <p className="text-2xl font-bold tabular-nums">
              {formatRs(m?.pendingPayoutMinor ?? 0)}
            </p>
            <p className="text-xs text-kd-fg-muted">Pending payouts</p>
            <p className="mt-1 text-[11px] text-kd-fg-subtle">Awaiting settlement →</p>
          </Link>
        </div>
      </section>

      {/* ── Quick order escalation ───────────────────────────────────────── */}
      <section className="max-w-md">
        <h2 className="mb-3 flex items-center gap-2 text-lg font-bold">
          <Store className="h-5 w-5" />
          Order escalation
        </h2>
        <div className="flex gap-2">
          <Input
            placeholder="Order id…"
            value={orderId}
            onChange={(e) => setOrderId(e.target.value)}
          />
          <Button
            disabled={!orderId.trim()}
            onClick={() => router.push(`/admin/orders/${orderId.trim()}`)}
          >
            Open
          </Button>
        </div>
      </section>

      <p className="flex items-center gap-2 text-[11px] text-kd-fg-subtle">
        <Bike className="h-3.5 w-3.5" />
        Ops list / zone map is a follow-up (issue #135): today the roster lives on the Riders page.
      </p>
    </main>
  );
}
