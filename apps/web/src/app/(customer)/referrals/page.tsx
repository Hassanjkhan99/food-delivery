"use client";

import { useState } from "react";
import { useMutation, useQuery } from "urql";
import { Check, Copy, Gift, Share2 } from "lucide-react";
import { formatRs } from "@fd/shared";
import { graphql } from "@/graphql/generated";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const MyReferralQuery = graphql(`
  query MyReferral {
    myReferral {
      code
      invited
      qualified
      earnedMinor
      walletBalanceMinor
    }
  }
`);

const ApplyReferralMutation = graphql(`
  mutation ApplyReferralCode($code: String!) {
    applyReferralCode(code: $code) {
      code
      walletBalanceMinor
    }
  }
`);

export default function ReferralsPage() {
  const [{ data, fetching }, refetch] = useQuery({
    query: MyReferralQuery,
    requestPolicy: "cache-and-network",
  });
  const [applyState, applyReferral] = useMutation(ApplyReferralMutation);

  const [codeInput, setCodeInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);
  const [copied, setCopied] = useState(false);

  const summary = data?.myReferral;

  async function onCopy() {
    if (!summary?.code) return;
    // Optional chaining would swallow a missing Clipboard API and still flip the
    // checkmark, so bail early when it's unavailable (e.g. insecure context).
    if (!navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(summary.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Write rejected (permissions/insecure context) — the code is still visible.
    }
  }

  async function onShare() {
    if (!summary?.code) return;
    const text = `Join me on KhaanaDo! Use my code ${summary.code} to get credit on your first order.`;
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title: "KhaanaDo", text });
        return;
      } catch {
        // User dismissed the share sheet — fall through to copy.
      }
    }
    await onCopy();
  }

  async function onApply(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const result = await applyReferral({ code: codeInput.trim() });
    if (result.error) {
      setError(result.error.graphQLErrors[0]?.message ?? "Could not apply that code");
      return;
    }
    setApplied(true);
    setCodeInput("");
    refetch({ requestPolicy: "network-only" });
  }

  return (
    <main className="mx-auto max-w-md">
      <h1 className="mb-1 text-2xl font-bold">Invite friends</h1>
      <p className="mb-6 text-sm text-kd-fg-muted">
        Share your code. When a friend places their first order, you both get wallet credit.
      </p>

      <section className="rounded-xl border border-kd-border bg-kd-surface p-5">
        <div className="mb-3 flex items-center gap-2 text-kd-fg-muted">
          <Gift className="h-5 w-5 text-kd-primary" />
          <span className="text-sm font-medium">Your referral code</span>
        </div>

        {fetching && !summary ? (
          <p className="text-sm text-kd-fg-muted">Loading…</p>
        ) : summary ? (
          <>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded-lg border border-dashed border-kd-border bg-kd-surface-muted px-3 py-2 text-center text-lg font-bold tracking-widest text-kd-fg">
                {summary.code}
              </code>
              <Button variant="outline" size="sm" onClick={onCopy} aria-label="Copy code">
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
            <Button className="mt-3 w-full" onClick={onShare}>
              <Share2 className="mr-2 h-4 w-4" />
              Share invite
            </Button>

            <dl className="mt-5 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg bg-kd-surface-muted p-2">
                <dt className="text-xs text-kd-fg-subtle">Invited</dt>
                <dd className="text-lg font-bold text-kd-fg">{summary.invited}</dd>
              </div>
              <div className="rounded-lg bg-kd-surface-muted p-2">
                <dt className="text-xs text-kd-fg-subtle">Qualified</dt>
                <dd className="text-lg font-bold text-kd-fg">{summary.qualified}</dd>
              </div>
              <div className="rounded-lg bg-kd-surface-muted p-2">
                <dt className="text-xs text-kd-fg-subtle">Earned</dt>
                <dd className="text-lg font-bold text-kd-fg">{formatRs(summary.earnedMinor)}</dd>
              </div>
            </dl>

            <p className="mt-4 text-center text-sm text-kd-fg-muted">
              Wallet balance:{" "}
              <span className="font-semibold text-kd-fg">
                {formatRs(summary.walletBalanceMinor)}
              </span>
            </p>
          </>
        ) : (
          <p className="text-sm text-kd-fg-muted">Sign in to get your referral code.</p>
        )}
      </section>

      <form
        onSubmit={onApply}
        className="mt-6 space-y-3 rounded-xl border border-kd-border bg-kd-surface p-5"
      >
        <p className="font-semibold">Got a code from a friend?</p>
        <p className="text-xs text-kd-fg-subtle">
          Apply it before your first order to earn a welcome credit.
        </p>
        <div>
          <Label htmlFor="ref">Referral code</Label>
          <Input
            id="ref"
            autoCapitalize="characters"
            placeholder="ABC123"
            value={codeInput}
            onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
            className="mt-1 uppercase tracking-widest"
            required
          />
        </div>
        {error && <p className="text-sm text-kd-danger">{error}</p>}
        {applied && !error && (
          <p className="text-sm text-kd-success">
            Code applied! Your credit lands after your first delivered order.
          </p>
        )}
        <Button
          type="submit"
          variant="outline"
          disabled={applyState.fetching || codeInput.trim().length === 0}
          className="w-full"
        >
          {applyState.fetching ? "Applying…" : "Apply code"}
        </Button>
      </form>
    </main>
  );
}
