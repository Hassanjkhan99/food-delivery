"use client";

// Restaurant support inbox (#160). Owner sees tickets tied to their orders and can post a
// reply to the customer (stored on SupportTicket.restaurantResponse).
import { useState } from "react";
import { useQuery, useMutation } from "urql";
import { graphql } from "@/graphql/generated";
import { useConsole } from "../useConsole";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const TicketsQuery = graphql(`
  query RestaurantTickets($restaurantId: String!) {
    restaurantTickets(restaurantId: $restaurantId) {
      id
      subject
      body
      category
      status
      restaurantResponse
      createdAt
      order {
        code
      }
    }
  }
`);

const RespondMutation = graphql(`
  mutation RespondToTicket($ticketId: String!, $body: String!) {
    respondToTicket(ticketId: $ticketId, body: $body) {
      id
      restaurantResponse
    }
  }
`);

type Ticket = {
  id: string;
  subject: string;
  body: string;
  category: string;
  status: string;
  restaurantResponse?: string | null;
  order?: { code: string } | null;
};

function TicketCard({ ticket, onSaved }: { ticket: Ticket; onSaved: () => void }) {
  const [, respond] = useMutation(RespondMutation);
  const [reply, setReply] = useState(ticket.restaurantResponse ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setBusy(true);
    setError(null);
    const r = await respond({ ticketId: ticket.id, body: reply });
    setBusy(false);
    if (r.error) setError(r.error.graphQLErrors[0]?.message ?? "Couldn't send your reply.");
    else onSaved();
  }

  return (
    <div className="rounded-xl border border-kd-border bg-kd-surface p-4 text-sm">
      <div className="mb-1 flex items-center justify-between">
        <span className="font-medium">{ticket.subject}</span>
        <Badge variant={ticket.status === "resolved" ? "default" : "secondary"}>
          {ticket.status}
        </Badge>
      </div>
      <p className="text-xs text-kd-fg-subtle">
        {ticket.category}
        {ticket.order?.code ? ` · order ${ticket.order.code}` : ""}
      </p>
      <p className="mt-2 text-kd-fg-muted">{ticket.body}</p>

      <div className="mt-3">
        <textarea
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          placeholder="Write a reply to the customer…"
          rows={2}
          className="w-full rounded-lg border border-kd-border bg-kd-surface px-2 py-1.5 text-sm"
        />
        {error && <p className="mt-1 text-sm text-kd-danger">{error}</p>}
        <div className="mt-2 flex items-center gap-3">
          <Button size="sm" disabled={busy || !reply.trim()} onClick={send}>
            {busy ? "Sending…" : ticket.restaurantResponse ? "Update reply" : "Send reply"}
          </Button>
          {ticket.restaurantResponse && <span className="text-xs text-kd-success">Replied.</span>}
        </div>
      </div>
    </div>
  );
}

export default function SupportPage() {
  const { restaurant, isOwner } = useConsole();
  const restaurantId = restaurant?.id ?? "";
  const [{ data, fetching }, refetch] = useQuery({
    query: TicketsQuery,
    variables: { restaurantId },
    pause: !restaurantId,
    requestPolicy: "cache-and-network",
  });

  if (!restaurant) return <p className="text-kd-fg-muted">Complete onboarding first.</p>;
  if (!isOwner)
    return <p className="text-kd-fg-muted">Only the restaurant owner can view support.</p>;

  const tickets = (data?.restaurantTickets ?? []) as Ticket[];

  return (
    <main className="max-w-2xl">
      <h1 className="mb-1 text-xl font-bold">Support</h1>
      <p className="mb-4 text-sm text-kd-fg-muted">
        Customer issues tied to your orders. Reply to keep them updated.
      </p>
      {fetching && tickets.length === 0 ? (
        <p className="text-sm text-kd-fg-muted">Loading…</p>
      ) : tickets.length === 0 ? (
        <p className="text-sm text-kd-fg-muted">No support tickets.</p>
      ) : (
        <div className="space-y-3">
          {tickets.map((t) => (
            <TicketCard
              key={t.id}
              ticket={t}
              onSaved={() => refetch({ requestPolicy: "network-only" })}
            />
          ))}
        </div>
      )}
    </main>
  );
}
