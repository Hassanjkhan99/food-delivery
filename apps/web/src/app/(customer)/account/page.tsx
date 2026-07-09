"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "urql";
import { graphql } from "@/graphql/generated";
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

const RevokeSessionMutation = graphql(`
  mutation RevokeSession($sessionId: String!) {
    revokeSession(sessionId: $sessionId)
  }
`);

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
  const [{ data }, refetch] = useQuery({
    query: AccountViewerQuery,
    requestPolicy: "network-only",
  });
  const [, logout] = useMutation(LogoutMutation);
  const [updateState, updateProfile] = useMutation(UpdateProfileMutation);
  const [, revokeSession] = useMutation(RevokeSessionMutation);

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");

  const viewer = data?.viewer;
  const sessions = data?.mySessions ?? [];

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
    await updateProfile({ name: name.trim() || undefined, email: email.trim() || undefined });
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

      <Button
        variant="outline"
        className="w-full"
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
