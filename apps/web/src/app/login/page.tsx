"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation } from "urql";
import { graphql } from "@/graphql/generated";

const RequestOtpMutation = graphql(`
  mutation RequestOtp($phone: String!) {
    requestOtp(phone: $phone) {
      devCode
    }
  }
`);

const VerifyOtpMutation = graphql(`
  mutation VerifyOtp($phone: String!, $code: String!) {
    verifyOtp(phone: $phone, code: $code) {
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

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next");

  const [phone, setPhone] = useState("+92");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [reqState, requestOtp] = useMutation(RequestOtpMutation);
  const [verState, verifyOtp] = useMutation(VerifyOtpMutation);

  async function onRequest(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const result = await requestOtp({ phone });
    if (result.error) {
      setError(result.error.graphQLErrors[0]?.message ?? "Failed to send code");
      return;
    }
    setDevCode(result.data?.requestOtp?.devCode ?? null);
    setStep("code");
  }

  async function onVerify(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const result = await verifyOtp({ phone, code });
    const viewer = result.data?.verifyOtp;
    if (result.error || !viewer) {
      setError(result.error?.graphQLErrors[0]?.message ?? "Verification failed");
      return;
    }
    router.push(next ?? viewer.home ?? "/");
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-50 p-4">
      <div className="w-full max-w-sm rounded-2xl border border-neutral-200 bg-white p-8 shadow-sm">
        <h1 className="text-xl font-semibold text-neutral-900">Sign in</h1>
        <p className="mt-1 text-sm text-neutral-500">
          {step === "phone"
            ? "Enter your phone number to receive a one-time code."
            : `Code sent to ${phone}.`}
        </p>

        {step === "phone" ? (
          <form onSubmit={onRequest} className="mt-6 space-y-4">
            <label className="block">
              <span className="text-sm font-medium text-neutral-700">Phone</span>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+923001234567"
                className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900"
                autoFocus
              />
            </label>
            <button
              type="submit"
              disabled={reqState.fetching}
              className="w-full rounded-lg bg-neutral-900 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
            >
              {reqState.fetching ? "Sending…" : "Send code"}
            </button>
          </form>
        ) : (
          <form onSubmit={onVerify} className="mt-6 space-y-4">
            {devCode && (
              <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                Dev mode — your code is <span className="font-mono font-bold">{devCode}</span>
              </div>
            )}
            <label className="block">
              <span className="text-sm font-medium text-neutral-700">6-digit code</span>
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-center font-mono text-lg tracking-[0.5em] outline-none focus:border-neutral-900"
                autoFocus
              />
            </label>
            <button
              type="submit"
              disabled={verState.fetching || code.length !== 6}
              className="w-full rounded-lg bg-neutral-900 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
            >
              {verState.fetching ? "Verifying…" : "Verify & sign in"}
            </button>
            <button
              type="button"
              onClick={() => {
                setStep("phone");
                setCode("");
                setDevCode(null);
              }}
              className="w-full text-center text-sm text-neutral-500 hover:text-neutral-800"
            >
              Use a different number
            </button>
          </form>
        )}

        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
