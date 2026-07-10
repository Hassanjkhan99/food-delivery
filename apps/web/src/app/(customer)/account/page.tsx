"use client";

import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "urql";
import { graphql } from "@/graphql/generated";
import { Button } from "@/components/ui/button";

const AccountViewerQuery = graphql(`
  query AccountViewer {
    viewer {
      home
      roles {
        role
        restaurantId
      }
      user {
        id
        name
        phone
        marketingOptOut
      }
    }
  }
`);

const LogoutMutation = graphql(`
  mutation Logout {
    logout
  }
`);

const SetMarketingOptOutMutation = graphql(`
  mutation SetMarketingOptOut($optOut: Boolean!) {
    setMarketingOptOut(optOut: $optOut) {
      id
      marketingOptOut
    }
  }
`);

export default function AccountPage() {
  const router = useRouter();
  const [{ data }, refetchAccount] = useQuery({
    query: AccountViewerQuery,
    requestPolicy: "network-only",
  });
  const [, logout] = useMutation(LogoutMutation);
  const [{ fetching: optOutPending }, setMarketingOptOut] = useMutation(SetMarketingOptOutMutation);
  const viewer = data?.viewer;
  const optedOut = viewer?.user?.marketingOptOut ?? false;

  if (!viewer) {
    return (
      <main className="py-16 text-center">
        <p className="text-kd-fg-muted">You are not signed in.</p>
        <Button className="mt-4" onClick={() => router.push("/login")}>
          Sign in
        </Button>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-sm">
      <h1 className="mb-6 text-2xl font-bold">Account</h1>
      <div className="rounded-xl border border-kd-border bg-kd-surface p-4 text-sm">
        <p className="font-medium text-kd-fg">{viewer.user?.name ?? "Unnamed"}</p>
        <p className="text-kd-fg-muted">{viewer.user?.phone}</p>
        <p className="mt-2 text-xs text-kd-fg-subtle">
          Roles: {viewer.roles?.map((r) => r?.role).join(", ") || "customer"}
        </p>
      </div>

      <div className="mt-4 flex items-start justify-between gap-4 rounded-xl border border-kd-border bg-kd-surface p-4">
        <div className="text-sm">
          <p className="font-medium text-kd-fg">Marketing notifications</p>
          <p className="mt-0.5 text-xs text-kd-fg-muted">
            Promotional offers in your inbox. Order updates are always sent.
          </p>
        </div>
        <Button
          variant={optedOut ? "outline" : "default"}
          size="sm"
          className="shrink-0"
          disabled={optOutPending}
          onClick={async () => {
            const res = await setMarketingOptOut({ optOut: !optedOut });
            // Refetch unless the normalized cache already reflected the new value, so
            // the label and the next toggle payload never derive from stale state.
            if (!res.data?.setMarketingOptOut) refetchAccount({ requestPolicy: "network-only" });
          }}
        >
          {optedOut ? "Opted out" : "On"}
        </Button>
      </div>

      <Button
        variant="outline"
        className="mt-6 w-full"
        onClick={async () => {
          await logout({});
          router.push("/");
          router.refresh();
        }}
      >
        Sign out
      </Button>
    </main>
  );
}
