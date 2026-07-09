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
      }
    }
  }
`);

const LogoutMutation = graphql(`
  mutation Logout {
    logout
  }
`);

const LoyaltyQuery = graphql(`
  query AccountLoyalty {
    loyaltyAccount {
      pointsBalance
    }
    loyaltyLedger {
      id
      delta
      balanceAfter
      reason
      memo
      createdAt
    }
  }
`);

const REASON_LABEL: Record<string, string> = {
  earn: "Earned",
  redeem: "Redeemed",
  expire: "Expired",
  adjust: "Adjusted",
};

export default function AccountPage() {
  const router = useRouter();
  const [{ data }] = useQuery({ query: AccountViewerQuery, requestPolicy: "network-only" });
  const [{ data: loyaltyData }] = useQuery({
    query: LoyaltyQuery,
    requestPolicy: "cache-and-network",
  });
  const [, logout] = useMutation(LogoutMutation);
  const viewer = data?.viewer;
  const points = loyaltyData?.loyaltyAccount?.pointsBalance ?? 0;
  const ledger = loyaltyData?.loyaltyLedger ?? [];

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

      <section className="mt-6 rounded-xl border border-kd-border bg-kd-surface p-4">
        <div className="flex items-baseline justify-between">
          <p className="text-sm font-semibold text-kd-fg">Loyalty points</p>
          <p className="text-xl font-bold text-kd-primary">
            {points.toLocaleString("en-PK")}
            <span className="ml-1 text-xs font-normal text-kd-fg-muted">pts</span>
          </p>
        </div>
        <p className="mt-1 text-xs text-kd-fg-subtle">
          Earn 1 point per Rupee on delivered orders. Redeem at checkout for money off.
        </p>
        {ledger.length > 0 && (
          <ul className="mt-3 divide-y divide-kd-border border-t border-kd-border">
            {ledger.map((row) => (
              <li key={row.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="min-w-0">
                  <span className="block text-kd-fg">{REASON_LABEL[row.reason] ?? row.reason}</span>
                  {row.memo && (
                    <span className="block truncate text-xs text-kd-fg-subtle">{row.memo}</span>
                  )}
                </span>
                <span
                  className={
                    row.delta >= 0 ? "font-medium text-kd-success" : "font-medium text-kd-fg-muted"
                  }
                >
                  {row.delta >= 0 ? "+" : ""}
                  {row.delta.toLocaleString("en-PK")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

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
