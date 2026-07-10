"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "urql";
import { graphql } from "@/graphql/generated";
import { Button, buttonVariants } from "@/components/ui/button";

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
      <nav className="mt-4 grid gap-2">
        <Link href="/membership" className={buttonVariants({ variant: "outline" })}>
          KhaanaDo Pro membership
        </Link>
        <Link href="/orders" className={buttonVariants({ variant: "outline" })}>
          My orders
        </Link>
        <Link href="/payment-methods" className={buttonVariants({ variant: "outline" })}>
          Payment methods
        </Link>
        <Link href="/addresses" className={buttonVariants({ variant: "outline" })}>
          Saved addresses
        </Link>
      </nav>
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
