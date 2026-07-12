"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation } from "urql";
import { graphql } from "@/graphql/generated";
import { OTP_RATE_LIMIT_PER_HOUR } from "@fd/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Wordmark } from "@/components/brand/Wordmark";

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

const OTP_LENGTH = 6;
const RESEND_SECONDS = 30;

// A code is submittable only when all six positions hold a digit (no placeholder
// spaces from editing a middle box).
const isComplete = (code: string) => code.length === OTP_LENGTH && !code.includes(" ");

/**
 * Six auto-advancing OTP boxes with paste support and backspace navigation.
 * Controlled: parent owns the joined `value` string; onChange fires on every edit.
 */
function OtpBoxes({
  value,
  onChange,
  onComplete,
  invalid,
}: {
  value: string;
  onChange: (v: string) => void;
  onComplete: (v: string) => void;
  invalid?: boolean;
}) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const digits = value.padEnd(OTP_LENGTH, " ").slice(0, OTP_LENGTH).split("");

  // Keep a fixed-length value with spaces as placeholders so editing a middle
  // digit never shifts later digits left. Trailing spaces are trimmed only so
  // the parent's `.length` check reflects "all six filled".
  function setAt(index: number, char: string) {
    const next = value.padEnd(OTP_LENGTH, " ").slice(0, OTP_LENGTH).split("");
    next[index] = char || " ";
    const joined = next.join("").replace(/\s+$/g, "");
    onChange(joined);
    return joined;
  }

  function handleChange(index: number, raw: string) {
    const char = raw.replace(/\D/g, "").slice(-1);
    if (!char) return;
    const joined = setAt(index, char);
    if (index < OTP_LENGTH - 1) refs.current[index + 1]?.focus();
    if (isComplete(joined)) onComplete(joined);
  }

  function handleKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace") {
      e.preventDefault();
      if (digits[index].trim()) {
        setAt(index, "");
      } else if (index > 0) {
        refs.current[index - 1]?.focus();
        setAt(index - 1, "");
      }
    } else if (e.key === "ArrowLeft" && index > 0) {
      refs.current[index - 1]?.focus();
    } else if (e.key === "ArrowRight" && index < OTP_LENGTH - 1) {
      refs.current[index + 1]?.focus();
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, OTP_LENGTH);
    if (!pasted) return;
    onChange(pasted);
    const focusIndex = Math.min(pasted.length, OTP_LENGTH - 1);
    refs.current[focusIndex]?.focus();
    if (pasted.length === OTP_LENGTH) onComplete(pasted);
  }

  return (
    <div className="flex justify-between gap-2" role="group" aria-label="One-time code">
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="text"
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          maxLength={1}
          aria-label={`Digit ${i + 1}`}
          aria-invalid={invalid || undefined}
          value={d.trim()}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onPaste={handlePaste}
          onFocus={(e) => e.target.select()}
          className={`h-12 w-full rounded-lg border bg-kd-surface text-center font-mono text-lg text-kd-fg outline-none transition-colors focus:border-kd-primary focus:ring-2 focus:ring-kd-primary/30 ${
            invalid ? "border-kd-danger" : "border-kd-border"
          }`}
        />
      ))}
    </div>
  );
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next");

  const [phone, setPhone] = useState("+92");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(false);
  const [resendIn, setResendIn] = useState(0);

  const [reqState, requestOtp] = useMutation(RequestOtpMutation);
  const [verState, verifyOtp] = useMutation(VerifyOtpMutation);

  // Resend countdown. Ticks once per second while > 0.
  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setInterval(() => setResendIn((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [resendIn]);

  function triggerShake() {
    setShake(true);
    setTimeout(() => setShake(false), 500);
  }

  async function sendCode() {
    setError(null);
    const result = await requestOtp({ phone });
    if (result.error) {
      const msg = result.error.graphQLErrors[0]?.message ?? "Failed to send code";
      setError(
        msg.toLowerCase().includes("too many")
          ? `Too many codes requested (limit ${OTP_RATE_LIMIT_PER_HOUR}/hour). Please try again later.`
          : msg,
      );
      triggerShake();
      return false;
    }
    setDevCode(result.data?.requestOtp?.devCode ?? null);
    setResendIn(RESEND_SECONDS);
    return true;
  }

  async function onRequest(e: React.FormEvent) {
    e.preventDefault();
    if (await sendCode()) {
      setCode("");
      setStep("code");
    }
  }

  async function submitCode(fullCode: string) {
    setError(null);
    const result = await verifyOtp({ phone, code: fullCode });
    const viewer = result.data?.verifyOtp;
    if (result.error || !viewer) {
      setError(result.error?.graphQLErrors[0]?.message ?? "Verification failed");
      setCode("");
      triggerShake();
      return;
    }
    router.push(next ?? viewer.home ?? "/");
    router.refresh();
  }

  function onVerify(e: React.FormEvent) {
    e.preventDefault();
    if (isComplete(code)) void submitCode(code);
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-kd-surface-muted p-4">
      {/* Local keyframe for the wrong-code shake (globals.css is off-limits per design rules). */}
      <style>{`@keyframes shake{0%,100%{transform:translateX(0)}20%,60%{transform:translateX(-6px)}40%,80%{transform:translateX(6px)}}`}</style>
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="flex justify-center text-2xl text-kd-fg">
            <Wordmark />
          </div>
          <p className="mt-1 text-sm text-kd-fg-muted">Food you love, delivered.</p>
        </div>

        <div
          className={`rounded-2xl border border-kd-border bg-kd-surface p-8 shadow-sm ${
            shake ? "animate-[shake_0.4s_ease-in-out]" : ""
          }`}
        >
          <h1 className="text-xl font-semibold text-kd-fg">
            {step === "phone" ? "Sign in or sign up" : "Enter your code"}
          </h1>
          <p className="mt-1 text-sm text-kd-fg-muted">
            {step === "phone" ? (
              "Enter your phone number to receive a one-time code."
            ) : (
              <>
                Code sent to <span className="font-medium text-kd-fg">{phone}</span>.{" "}
                <button
                  type="button"
                  onClick={() => {
                    setStep("phone");
                    setCode("");
                    setDevCode(null);
                    setError(null);
                  }}
                  className="text-kd-primary hover:underline"
                >
                  Edit
                </button>
              </>
            )}
          </p>

          {step === "phone" ? (
            <form onSubmit={onRequest} className="mt-6 space-y-4">
              <div>
                <Label htmlFor="phone">Phone</Label>
                <Input
                  id="phone"
                  type="tel"
                  autoComplete="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+923001234567"
                  className="mt-1"
                  autoFocus
                />
              </div>
              <Button type="submit" size="lg" className="w-full" disabled={reqState.fetching}>
                {reqState.fetching ? "Sending…" : "Send code"}
              </Button>
            </form>
          ) : (
            <form onSubmit={onVerify} className="mt-6 space-y-4">
              {devCode && (
                <div className="rounded-lg bg-kd-warning-soft px-3 py-2 text-sm text-kd-warning">
                  Dev mode — your code is{" "}
                  <span className="font-mono font-bold">{devCode}</span>
                </div>
              )}
              <OtpBoxes
                value={code}
                onChange={setCode}
                onComplete={(v) => void submitCode(v)}
                invalid={!!error}
              />
              <Button
                type="submit"
                size="lg"
                className="w-full"
                disabled={verState.fetching || !isComplete(code)}
              >
                {verState.fetching ? "Verifying…" : "Verify & continue"}
              </Button>
              <div className="text-center text-sm text-kd-fg-muted">
                {resendIn > 0 ? (
                  <span>Resend code in {resendIn}s</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => void sendCode()}
                    disabled={reqState.fetching}
                    className="text-kd-primary hover:underline disabled:opacity-50"
                  >
                    Resend code
                  </button>
                )}
              </div>
            </form>
          )}

          {error && (
            <p role="alert" className="mt-4 text-sm text-kd-danger">
              {error}
            </p>
          )}
        </div>
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
