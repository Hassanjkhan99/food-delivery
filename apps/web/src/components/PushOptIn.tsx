"use client";

// Push-notification opt-in control (#13). Renders only when web push is configured
// (NEXT_PUBLIC_VAPID_PUBLIC_KEY set) and supported by the browser — so it's invisible
// until launch flips the key on. Persists the browser subscription via GraphQL so the
// server-side web-push channel has somewhere to deliver.
import { useEffect, useState, useSyncExternalStore } from "react";
import { useMutation } from "urql";
import { graphql } from "@/graphql/generated";
import { Button } from "@/components/ui/button";
import {
  currentEndpoint,
  pushConfigured,
  pushSupported,
  subscribeBrowser,
  unsubscribeBrowser,
} from "@/lib/push";

const SavePushSubscriptionMutation = graphql(`
  mutation SavePushSubscription($endpoint: String!, $p256dh: String!, $auth: String!) {
    savePushSubscription(endpoint: $endpoint, p256dh: $p256dh, auth: $auth)
  }
`);

const DeletePushSubscriptionMutation = graphql(`
  mutation DeletePushSubscription($endpoint: String!) {
    deletePushSubscription(endpoint: $endpoint)
  }
`);

// Capability is a client-only fact (needs window/navigator). useSyncExternalStore lets
// us read it without a setState-in-effect: the server snapshot is false, the client
// snapshot is the real value, so hydration stays consistent.
const noopSubscribe = () => () => {};

export function PushOptIn() {
  const supported = useSyncExternalStore(
    noopSubscribe,
    () => pushConfigured() && pushSupported(),
    () => false,
  );
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [, savePush] = useMutation(SavePushSubscriptionMutation);
  const [, deletePush] = useMutation(DeletePushSubscriptionMutation);

  useEffect(() => {
    if (!supported) return;
    // setState lives in the async callback, not the effect body — no cascading render.
    void currentEndpoint().then((ep) => setSubscribed(Boolean(ep)));
  }, [supported]);

  // Feature not configured or unsupported browser → render nothing.
  if (!supported) return null;

  async function enable() {
    setBusy(true);
    try {
      const sub = await subscribeBrowser();
      if (sub) {
        await savePush(sub);
        setSubscribed(true);
      }
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    try {
      const endpoint = await unsubscribeBrowser();
      if (endpoint) await deletePush({ endpoint });
      setSubscribed(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-start justify-between gap-4 rounded-xl border border-kd-border bg-kd-surface p-4">
      <div className="text-sm">
        <p className="font-medium text-kd-fg">Push notifications</p>
        <p className="mt-0.5 text-xs text-kd-fg-muted">
          Get order updates on this device even when the app is closed.
        </p>
      </div>
      <Button
        variant={subscribed ? "outline" : "default"}
        size="sm"
        className="shrink-0"
        disabled={busy}
        onClick={() => void (subscribed ? disable() : enable())}
      >
        {busy ? "…" : subscribed ? "On" : "Enable"}
      </Button>
    </div>
  );
}
