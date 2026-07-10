"use client";

// Ticket triage (issue #14): assign, resolve with a resolutionCode, and inspect
// the evidence bundle (order + delivery events, payment, refunds) in one panel.
// For a COD cash_mismatch this shows declared-vs-expected via the delivery notes
// and payment amount, so the dispute is resolvable end-to-end here.
import Link from "next/link";
import { use, useState } from "react";
import { useMutation, useQuery } from "urql";
import { graphql } from "@/graphql/generated";
import { formatRs, ticketPlaybook, TICKET_RESOLUTION_CODES } from "@fd/shared";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { slaState, slaBadgeClass, ageLabel } from "../sla";

const TicketQuery = graphql(`
  query Ticket($id: String!) {
    ticket(id: $id) {
      id
      category
      subject
      body
      status
      resolutionCode
      resolutionNote
      assignedToName
      firstRespondedAt
      resolvedAt
      createdAt
      customer {
        id
        name
        phone
      }
      order {
        id
        code
      }
      evidence {
        id
        source
        label
        detail
        amountMinor
        createdAt
      }
    }
  }
`);

const AssignMutation = graphql(`
  mutation AssignTicketDetail($id: String!) {
    assignTicket(id: $id) {
      id
      status
      assignedToName
      firstRespondedAt
    }
  }
`);

const ResolveMutation = graphql(`
  mutation ResolveTicket($id: String!, $resolutionCode: String!, $note: String) {
    resolveTicket(id: $id, resolutionCode: $resolutionCode, note: $note) {
      id
      status
      resolutionCode
      resolvedAt
    }
  }
`);

const ReopenMutation = graphql(`
  mutation ReopenTicket($id: String!) {
    reopenTicket(id: $id) {
      id
      status
    }
  }
`);

const SOURCE_LABEL: Record<string, string> = {
  order: "Order",
  delivery: "Delivery",
  payment: "Payment",
  refund: "Refund",
};

export default function TicketTriagePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [{ data, fetching }, refetch] = useQuery({
    query: TicketQuery,
    variables: { id },
    requestPolicy: "cache-and-network",
  });
  const [, assign] = useMutation(AssignMutation);
  const [, resolve] = useMutation(ResolveMutation);
  const [, reopen] = useMutation(ReopenMutation);
  const [code, setCode] = useState<string>(TICKET_RESOLUTION_CODES[0]);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const refresh = () => refetch({ requestPolicy: "network-only" });

  const tk = data?.ticket;
  if (fetching && !tk) return <Skeleton className="h-72 rounded-2xl" />;
  if (!tk) return <p className="text-kd-fg-muted">Ticket not found.</p>;

  const pb = ticketPlaybook(tk.category);
  const isClosed = tk.status === "resolved" || tk.status === "closed";
  const sla = slaState({
    createdAt: tk.createdAt as unknown as string,
    firstRespondedAt: (tk.firstRespondedAt as unknown as string) ?? null,
    resolvedAt: (tk.resolvedAt as unknown as string) ?? null,
    firstResponseMin: pb.firstResponseMin,
    resolutionMin: pb.resolutionMin,
  });

  return (
    <main className="max-w-2xl">
      <Link href="/admin/tickets" className="mb-3 inline-block text-xs text-kd-fg-muted hover:text-kd-primary">
        ← Back to queue
      </Link>

      <div className="mb-4 flex items-start justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold">{tk.subject}</h1>
          <p className="mt-0.5 text-sm text-kd-fg-muted">
            {pb.label} · owner {pb.owner}
            {tk.customer && <> · {tk.customer.name ?? tk.customer.phone}</>}
            {tk.order && (
              <>
                {" · "}
                <Link href={`/admin/orders/${tk.order.id}`} className="hover:text-kd-primary">
                  {tk.order.code}
                </Link>
              </>
            )}
          </p>
        </div>
        <Badge variant="secondary">{tk.status}</Badge>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${slaBadgeClass(sla.level)}`}>
          {sla.label}
        </span>
        <span className="text-xs text-kd-fg-subtle">age {ageLabel(tk.createdAt as unknown as string)}</span>
        <span className="text-xs text-kd-fg-subtle">
          targets: response {pb.firstResponseMin}m · resolution {pb.resolutionMin}m
        </span>
        {tk.assignedToName && <span className="text-xs text-kd-fg-muted">→ {tk.assignedToName}</span>}
      </div>

      <p className="mb-4 rounded-xl border border-kd-border bg-kd-surface p-4 text-sm">{tk.body}</p>

      <div className="mb-4 rounded-xl border border-kd-border bg-kd-surface-muted p-3 text-xs text-kd-fg-muted">
        <span className="font-semibold text-kd-fg">Playbook:</span> {pb.action}
      </div>

      {/* actions */}
      {!isClosed ? (
        <div className="mb-6 rounded-xl border border-kd-border bg-kd-surface p-4">
          <div className="mb-3 flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                await assign({ id: tk.id });
                refresh();
              }}
            >
              {tk.assignedToName ? "Reassign to me" : "Assign to me"}
            </Button>
          </div>
          <p className="mb-2 text-sm font-semibold">Resolve</p>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="rounded-lg border border-kd-border bg-kd-surface px-2 py-1.5 text-sm"
            >
              {TICKET_RESOLUTION_CODES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              onClick={async () => {
                setError(null);
                const r = await resolve({ id: tk.id, resolutionCode: code, note: note || undefined });
                if (r.error) setError(r.error.graphQLErrors[0]?.message ?? "Resolve failed");
                else refresh();
              }}
            >
              Mark resolved
            </Button>
          </div>
          <Textarea
            className="mt-2"
            placeholder="Resolution note (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          {error && <p className="mt-2 text-sm text-kd-danger">{error}</p>}
        </div>
      ) : (
        <div className="mb-6 rounded-xl border border-kd-border bg-kd-surface p-4 text-sm">
          <p>
            Resolved as <span className="font-medium">{tk.resolutionCode}</span>
            {tk.resolutionNote && <> — {tk.resolutionNote}</>}
          </p>
          <Button
            size="sm"
            variant="outline"
            className="mt-3"
            onClick={async () => {
              await reopen({ id: tk.id });
              refresh();
            }}
          >
            Reopen
          </Button>
        </div>
      )}

      {/* evidence bundle */}
      <h2 className="mb-2 text-sm font-bold uppercase text-kd-fg-muted">Evidence bundle</h2>
      {tk.evidence.length === 0 ? (
        <p className="text-sm text-kd-fg-subtle">No linked order — nothing to assemble.</p>
      ) : (
        <div className="space-y-1">
          {tk.evidence.map((e) => (
            <div
              key={e.id}
              className="flex items-center justify-between rounded-lg bg-kd-surface px-3 py-2 text-sm"
            >
              <span className="min-w-0">
                <Badge variant="secondary" className="mr-2">
                  {SOURCE_LABEL[e.source] ?? e.source}
                </Badge>
                <span className="font-medium">{e.label}</span>
                {e.detail && <span className="ml-2 text-xs text-kd-fg-muted">({e.detail})</span>}
              </span>
              <span className="shrink-0 text-xs text-kd-fg-subtle">
                {e.amountMinor != null && (
                  <span className="mr-2 font-medium text-kd-fg">{formatRs(e.amountMinor)}</span>
                )}
                {new Date(e.createdAt as unknown as string).toLocaleTimeString()}
              </span>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
