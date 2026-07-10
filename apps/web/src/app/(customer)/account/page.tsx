"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "urql";
import { CreditCard, Wallet } from "lucide-react";
import { graphql } from "@/graphql/generated";
import { useResetGraphQLClient } from "@/lib/urql";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

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
        email
        phone
        marketingOptOut
      }
    }
    mySessions {
      id
      userAgent
      createdAt
      isCurrent
    }
  }
`);

const LogoutMutation = graphql(`
  mutation Logout {
    logout
  }
`);

const UpdateProfileMutation = graphql(`
  mutation AccountUpdateProfile($name: String, $email: String) {
    updateProfile(name: $name, email: $email) {
      id
      name
      email
    }
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

const SetMarketingOptOutMutation = graphql(`
  mutation SetMarketingOptOut($optOut: Boolean!) {
    setMarketingOptOut(optOut: $optOut) {
      id
      marketingOptOut
    }
  }
`);

const RevokeSessionMutation = graphql(`
  mutation RevokeSession($sessionId: String!) {
    revokeSession(sessionId: $sessionId)
  }
`);

const REASON_LABEL: Record<string, string> = {
  earn: "Earned",
  redeem: "Redeemed",
  expire: "Expired",
  adjust: "Adjusted",
};

// Best-effort device label from the stored user-agent string.
function deviceLabel(ua?: string | null): string {
  if (!ua) return "Unknown device";
  if (/iPhone|iPad|iOS/i.test(ua)) return "iOS device";
  if (/Android/i.test(ua)) return "Android device";
  if (/Mac OS X|Macintosh/i.test(ua)) return "Mac";
  if (/Windows/i.test(ua)) return "Windows PC";
  if (/Linux/i.test(ua)) return "Linux";
  return ua.slice(0, 40);
}

export default function AccountPage() {
  const router = useRouter();
  const resetClient = useResetGraphQLClient();
  const [{ data }, refetch] = useQuery({
    query: AccountViewerQuery,
    requestPolicy: "network-only",
  });
  const [{ data: loyaltyData }] = useQuery({
    query: LoyaltyQuery,
    requestPolicy: "cache-and-network",
  });
  const [, logout] = useMutation(LogoutMutation);
  const [updateState, updateProfile] = useMutation(UpdateProfileMutation);
  const [, revokeSession] = useMutation(RevokeSessionMutation);
  const [{ fetching: optOutPending }, setMarketingOptOut] = useMutation(SetMarketingOptOutMutation);

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");

  const viewer = data?.viewer;
  const sessions = data?.mySessions ?? [];
  const optedOut = viewer?.user?.marketingOptOut ?? false;
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

  function startEdit() {
    setName(viewer?.user?.name ?? "");
    setEmail(viewer?.user?.email ?? "");
    setEditing(true);
  }

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    // Send null (not undefined) for a cleared field so the resolver actually
    // wipes it; the editor is pre-filled, so an empty box means intentional clear.
    await updateProfile({ name: name.trim() || null, email: email.trim() || null });
    setEditing(false);
    refetch({ requestPolicy: "network-only" });
  }

  async function revoke(sessionId: string, isCurrent: boolean) {
    await revokeSession({ sessionId });
    if (isCurrent) {
      router.push("/");
      router.refresh();
      return;
    }
    refetch({ requestPolicy: "network-only" });
  }

  return (
    <main className="mx-auto max-w-md space-y-6">
      <h1 className="text-2xl font-bold">Account</h1>

      <section className="rounded-xl border border-kd-border bg-kd-surface p-4">
        {editing ? (
          <form onSubmit={saveProfile} className="space-y-3">
            <div>
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                className="mt-1"
                autoFocus
              />
            </div>
            <div>
              <Label htmlFor="email">Email (optional)</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="mt-1"
              />
            </div>
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={updateState.fetching}>
                {updateState.fetching ? "Saving…" : "Save"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setEditing(false)}
              >
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <div className="flex items-start justify-between text-sm">
            <div>
              <p className="font-medium text-kd-fg">
                {viewer.user?.name ?? (
                  <span className="text-kd-fg-muted italic">Add your name</span>
                )}
              </p>
              <p className="text-kd-fg-muted">{viewer.user?.phone}</p>
              {viewer.user?.email && <p className="text-kd-fg-muted">{viewer.user.email}</p>}
              <p className="mt-2 text-xs text-kd-fg-subtle">
                Roles: {viewer.roles?.map((r) => r?.role).join(", ") || "customer"}
              </p>
            </div>
            <Button type="button" size="sm" variant="outline" onClick={startEdit}>
              Edit
            </Button>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-bold uppercase text-kd-fg-muted">Active devices</h2>
        <div className="space-y-2">
          {sessions.map((s) => (
            <div
              key={s.id}
              className="flex items-center justify-between rounded-xl border border-kd-border bg-kd-surface p-3 text-sm"
            >
              <div>
                <p className="flex items-center gap-2 font-medium text-kd-fg">
                  {deviceLabel(s.userAgent)}
                  {s.isCurrent && <Badge variant="secondary">This device</Badge>}
                </p>
                <p className="text-xs text-kd-fg-subtle">
                  Since {new Date(s.createdAt as string).toLocaleDateString()}
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void revoke(s.id, s.isCurrent)}
              >
                {s.isCurrent ? "Sign out" : "Revoke"}
              </Button>
            </div>
          ))}
        </div>
      </section>

      {/* Wallet + payment methods (#55) */}
      <nav className="space-y-2">
        <Link
          href="/wallet"
          className="flex items-center gap-3 rounded-xl border border-kd-border bg-kd-surface p-4 text-sm font-medium text-kd-fg hover:border-kd-primary"
        >
          <Wallet className="h-5 w-5 text-kd-fg-subtle" />
          Wallet
        </Link>
        <Link
          href="/payment-methods"
          className="flex items-center gap-3 rounded-xl border border-kd-border bg-kd-surface p-4 text-sm font-medium text-kd-fg hover:border-kd-primary"
        >
          <CreditCard className="h-5 w-5 text-kd-fg-subtle" />
          Payment methods
        </Link>
      </nav>

      {/* Marketing notification preference (#56) */}
      <div className="flex items-start justify-between gap-4 rounded-xl border border-kd-border bg-kd-surface p-4">
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
            if (!res.data?.setMarketingOptOut) refetch({ requestPolicy: "network-only" });
          }}
        >
          {optedOut ? "Opted out" : "On"}
        </Button>
      </div>

      {/* Loyalty points balance + ledger (FP-07 / #57) */}
      <section className="rounded-xl border border-kd-border bg-kd-surface p-4">
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
        className="w-full"
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
