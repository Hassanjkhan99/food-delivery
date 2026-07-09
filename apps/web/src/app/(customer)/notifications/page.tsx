"use client";

// In-app inbox (#56): the customer's order updates + promo offers, newest first, with
// read/unread state and a mark-all-read action. Deep-links route to the order or the
// promo target. Guarded so missing/empty data can't crash the view.
import Link from "next/link";
import { useMutation, useQuery } from "urql";
import { Bell, CheckCheck, Tag } from "lucide-react";
import { graphql } from "@/graphql/generated";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

const MyNotificationsQuery = graphql(`
  query MyNotifications {
    myNotifications {
      id
      kind
      title
      body
      linkHref
      read
      createdAt
    }
  }
`);

const MarkAllReadMutation = graphql(`
  mutation MarkAllNotificationsRead {
    markAllNotificationsRead
  }
`);

const MarkReadMutation = graphql(`
  mutation MarkNotificationRead($id: String!) {
    markNotificationRead(id: $id)
  }
`);

export default function NotificationsPage() {
  const [{ data, fetching }, refetch] = useQuery({
    query: MyNotificationsQuery,
    requestPolicy: "cache-and-network",
  });
  const [, markAllRead] = useMutation(MarkAllReadMutation);
  const [, markRead] = useMutation(MarkReadMutation);

  const items = data?.myNotifications ?? [];
  const hasUnread = items.some((n) => !n.read);

  return (
    <main className="mx-auto max-w-lg">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Notifications</h1>
        {hasUnread && (
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              await markAllRead({});
              refetch({ requestPolicy: "network-only" });
            }}
          >
            <CheckCheck className="mr-1 h-4 w-4" />
            Mark all read
          </Button>
        )}
      </div>

      {fetching && items.length === 0 && <Skeleton className="h-40 rounded-2xl" />}

      {!fetching && items.length === 0 && (
        <div className="rounded-xl border border-kd-border bg-kd-surface p-8 text-center text-kd-fg-muted">
          <Bell className="mx-auto mb-2 h-6 w-6 text-kd-fg-subtle" />
          <p>You have no notifications yet.</p>
        </div>
      )}

      <ul className="space-y-2">
        {items.map((n) => {
          const inner = (
            <div
              className={`flex gap-3 rounded-xl border p-4 ${
                n.read
                  ? "border-kd-border bg-kd-surface"
                  : "border-kd-primary/40 bg-kd-primary/5"
              }`}
            >
              <div className="mt-0.5 text-kd-fg-subtle">
                {n.kind === "promo" ? <Tag className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate font-medium text-kd-fg">{n.title}</p>
                  {!n.read && (
                    <span className="h-2 w-2 shrink-0 rounded-full bg-kd-primary" aria-hidden />
                  )}
                </div>
                <p className="mt-0.5 text-sm text-kd-fg-muted">{n.body}</p>
                <p className="mt-1 text-xs text-kd-fg-subtle">
                  {new Date(n.createdAt as unknown as string).toLocaleString()}
                </p>
              </div>
            </div>
          );

          const onOpen = () => {
            if (!n.read) {
              markRead({ id: n.id });
            }
          };

          return (
            <li key={n.id}>
              {n.linkHref ? (
                <Link href={n.linkHref} onClick={onOpen} className="block">
                  {inner}
                </Link>
              ) : (
                <button type="button" onClick={onOpen} className="block w-full text-left">
                  {inner}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </main>
  );
}
