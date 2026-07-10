"use client";

import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "urql";
import { graphql } from "@/graphql/generated";
import { useResetGraphQLClient } from "@/lib/urql";
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
      }
    }
  }
`);

const LogoutMutation = graphql(`
  mutation Logout {
    logout
  }
`);

export default function AccountPage() {
  const router = useRouter();
  const resetClient = useResetGraphQLClient();
  const [{ data }] = useQuery({ query: AccountViewerQuery, requestPolicy: "network-only" });
  const [, logout] = useMutation(LogoutMutation);
  const viewer = data?.viewer;

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
      <Button
        variant="outline"
        className="mt-6 w-full"
        onClick={async () => {
          await logout({});
          // Drop the urql cache so a cached viewer/myOrders can't render the previous
          // customer's data on a shared browser (#36 review), then refresh the tree.
          resetClient();
          router.push("/");
          router.refresh();
        }}
      >
        Sign out
      </Button>
    </main>
  );
}
