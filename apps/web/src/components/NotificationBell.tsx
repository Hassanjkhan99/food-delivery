"use client";

// Header bell + unread badge (#56). Reads the initial unread count, then rides the
// notificationFeed SSE subscription for live updates (same realtime path as orders).
// Renders nothing unread-specific when the user is signed out (query 401s → no data).
import Link from "next/link";
import { useQuery, useSubscription } from "urql";
import { Bell } from "lucide-react";
import { graphql } from "@/graphql/generated";

const UnreadCountQuery = graphql(`
  query UnreadNotificationCount {
    unreadNotificationCount
  }
`);

const NotificationFeedSubscription = graphql(`
  subscription NotificationFeed {
    notificationFeed {
      userId
      unreadCount
    }
  }
`);

export function NotificationBell() {
  const [{ data }] = useQuery({
    query: UnreadCountQuery,
    requestPolicy: "cache-and-network",
  });

  // Live badge: each pushed event carries the fresh unread count.
  const [{ data: sub }] = useSubscription(
    { query: NotificationFeedSubscription },
    (_prev, event) => event,
  );

  const count = sub?.notificationFeed?.unreadCount ?? data?.unreadNotificationCount ?? 0;

  return (
    <Link
      href="/notifications"
      aria-label={count > 0 ? `Notifications, ${count} unread` : "Notifications"}
      className="relative flex items-center text-kd-fg-muted hover:text-kd-fg"
    >
      <Bell className="h-5 w-5" />
      {count > 0 && (
        <span className="absolute -right-2 -top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-kd-primary px-1 text-[10px] font-bold text-white">
          {count > 9 ? "9+" : count}
        </span>
      )}
    </Link>
  );
}
