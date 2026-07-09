"use client";

// Agent ticket queue (issue #14): filterable list with per-playbook SLA breach
// highlighting, assign, and click-through to a triage view. SLA state is derived
// client-side from the shared playbooks so the API stays a thin data layer.
import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery } from "urql";
import { graphql } from "@/graphql/generated";
import { ticketPlaybook, TICKET_PLAYBOOKS } from "@fd/shared";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { slaState, slaBadgeClass, ageLabel } from "./sla";

const TicketQueueQuery = graphql(`
  query TicketQueue($status: String, $category: String) {
    ticketQueue(status: $status, category: $category) {
      id
      category
      subject
      status
      assignedToName
      firstRespondedAt
      resolvedAt
      createdAt
      order {
        id
        code
      }
    }
  }
`);

const AssignTicketMutation = graphql(`
  mutation AssignTicket($id: String!) {
    assignTicket(id: $id) {
      id
      status
      assignedToName
      firstRespondedAt
    }
  }
`);

const STATUS_FILTERS = [
  { value: "", label: "All open" },
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In progress" },
  { value: "resolved", label: "Resolved" },
  { value: "closed", label: "Closed" },
] as const;

export default function AdminTicketsPage() {
  const [status, setStatus] = useState<string>("");
  const [category, setCategory] = useState<string>("");
  const [{ data, fetching }, refetch] = useQuery({
    query: TicketQueueQuery,
    variables: {
      status: status || undefined,
      category: category || undefined,
    },
    requestPolicy: "cache-and-network",
  });
  const [, assign] = useMutation(AssignTicketMutation);
  const refresh = () => refetch({ requestPolicy: "network-only" });

  const tickets = data?.ticketQueue ?? [];

  return (
    <main className="max-w-3xl">
      <h1 className="mb-1 text-xl font-bold">Support queue</h1>
      <p className="mb-4 text-sm text-kd-fg-muted">
        Oldest first. SLA targets follow the kickoff playbooks per category.
      </p>

      <div className="mb-4 flex flex-wrap gap-2">
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="rounded-lg border border-kd-border bg-kd-surface px-2 py-1.5 text-sm"
        >
          {STATUS_FILTERS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="rounded-lg border border-kd-border bg-kd-surface px-2 py-1.5 text-sm"
        >
          <option value="">All categories</option>
          {TICKET_PLAYBOOKS.map((p) => (
            <option key={p.category} value={p.category}>
              {p.label}
            </option>
          ))}
        </select>
      </div>

      {fetching && tickets.length === 0 && <Skeleton className="h-40 rounded-2xl" />}
      {!fetching && tickets.length === 0 && (
        <p className="text-sm text-kd-fg-muted">Queue is empty. 🎉</p>
      )}

      <div className="space-y-2">
        {tickets.map((tk) => {
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
            <div
              key={tk.id}
              className="rounded-xl border border-kd-border bg-kd-surface p-4 text-sm"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <Link
                    href={`/admin/tickets/${tk.id}`}
                    className="font-medium hover:text-kd-primary"
                  >
                    {tk.subject}
                  </Link>
                  <p className="mt-0.5 text-xs text-kd-fg-subtle">
                    {pb.label} · owner {pb.owner}
                    {tk.order && (
                      <>
                        {" · "}
                        <Link
                          href={`/admin/orders/${tk.order.id}`}
                          className="hover:text-kd-primary"
                        >
                          {tk.order.code}
                        </Link>
                      </>
                    )}
                  </p>
                </div>
                <Badge variant="secondary">{tk.status}</Badge>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span
                  className={`rounded-md px-2 py-0.5 text-xs font-medium ${slaBadgeClass(sla.level)}`}
                >
                  {sla.label}
                </span>
                <span className="text-xs text-kd-fg-subtle">
                  age {ageLabel(tk.createdAt as unknown as string)}
                </span>
                {tk.assignedToName && (
                  <span className="text-xs text-kd-fg-muted">→ {tk.assignedToName}</span>
                )}
                <span className="flex-1" />
                {!isClosed && (
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={async () => {
                      await assign({ id: tk.id });
                      refresh();
                    }}
                  >
                    {tk.assignedToName ? "Reassign to me" : "Assign to me"}
                  </Button>
                )}
                <Link href={`/admin/tickets/${tk.id}`}>
                  <Button size="xs">Triage</Button>
                </Link>
              </div>
            </div>
          );
        })}
      </div>
    </main>
  );
}
