"use client";

// Assignment / offer alert (#47): a full-screen, attention-grabbing card that pops when
// a new task lands (SSE riderJobFeed drives the parent's refetch). Two modes:
//   - "acknowledge" (restaurant riders): dispatch is the restaurant's call, so the rider
//     just taps "Got it" — no decline.
//   - "offer" (shared/independent riders, #21): accept OR decline, with a countdown ring
//     that auto-declines when it runs out.
// Same component both ways, gated by `mode`, so #21 reuses it verbatim.
import { useEffect, useRef, useState } from "react";
import { formatRs } from "@fd/shared";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export type AlertJob = {
  id: string;
  code: string;
  pickupName: string;
  dropText: string;
  codAmountMinor: number;
};

// A short two-tone chime via WebAudio — no bundled asset needed and it plays on locked
// attention. Best-effort: browsers block audio until the rider has interacted with the
// app at least once (going online counts), and we swallow any AudioContext error.
function playChime() {
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ac = new Ctx();
    const now = ac.currentTime;
    [880, 1174].forEach((freq, i) => {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.frequency.value = freq;
      osc.type = "sine";
      const t = now + i * 0.18;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      osc.connect(gain).connect(ac.destination);
      osc.start(t);
      osc.stop(t + 0.18);
    });
    setTimeout(() => void ac.close(), 800);
  } catch {
    /* audio unavailable — the visual + vibration still fire */
  }
}

function vibrate() {
  try {
    navigator.vibrate?.([200, 100, 200]);
  } catch {
    /* not supported */
  }
}

export function AssignmentAlert({
  job,
  mode,
  busy = false,
  timeoutSeconds = 60,
  onAcknowledge,
  onAccept,
  onDecline,
}: {
  job: AlertJob;
  mode: "acknowledge" | "offer";
  busy?: boolean;
  timeoutSeconds?: number;
  onAcknowledge: () => void;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const [remaining, setRemaining] = useState(timeoutSeconds);
  // Fire the chime once per distinct job (guard against re-render loops).
  const alerted = useRef<string | null>(null);

  useEffect(() => {
    if (alerted.current === job.id) return;
    alerted.current = job.id;
    playChime();
    vibrate();
  }, [job.id]);

  // Countdown only matters for the accept/decline offer flow (auto-decline on expiry).
  // Deadline-based so we never setState synchronously in the effect body: the interval
  // computes remaining from a fixed deadline and fires onDecline once at zero.
  useEffect(() => {
    if (mode !== "offer") return;
    const deadline = Date.now() + timeoutSeconds * 1_000;
    const tick = () => {
      const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1_000));
      setRemaining(left);
      if (left <= 0) {
        clearInterval(t);
        onDecline();
      }
    };
    const t = setInterval(tick, 1_000);
    return () => clearInterval(t);
    // Reset per job; onDecline is stable enough for our use (called once at expiry).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.id, mode, timeoutSeconds]);

  const pct = mode === "offer" ? remaining / timeoutSeconds : 1;
  const ringDeg = Math.round(pct * 360);

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-between bg-kd-bg/95 p-5 supports-backdrop-filter:backdrop-blur-sm">
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        {mode === "offer" ? (
          <div
            className="mb-6 flex size-28 items-center justify-center rounded-full"
            style={{
              background: `conic-gradient(var(--kd-primary) ${ringDeg}deg, var(--kd-border) 0deg)`,
            }}
            role="timer"
            aria-label={`${remaining} seconds to respond`}
          >
            <div className="flex size-24 items-center justify-center rounded-full bg-kd-surface">
              <span className="text-3xl font-bold tabular-nums">{remaining}</span>
            </div>
          </div>
        ) : (
          <div className="mb-6 flex size-24 items-center justify-center rounded-full bg-kd-primary-soft text-4xl">
            🛵
          </div>
        )}

        <Badge variant="secondary" className="mb-2">
          {mode === "offer" ? "New offer" : "New assignment"}
        </Badge>
        <h2 className="text-2xl font-bold">{job.code}</h2>

        <div className="mt-6 w-full max-w-xs space-y-3 text-left">
          <div className="rounded-2xl border border-kd-border bg-kd-surface p-3">
            <p className="text-xs font-semibold uppercase text-kd-fg-muted">Pickup</p>
            <p className="font-medium">{job.pickupName}</p>
          </div>
          <div className="rounded-2xl border border-kd-border bg-kd-surface p-3">
            <p className="text-xs font-semibold uppercase text-kd-fg-muted">Drop</p>
            <p className="font-medium">{job.dropText || "—"}</p>
          </div>
          {job.codAmountMinor > 0 && (
            <p className="rounded-2xl bg-kd-warning-soft p-3 text-center font-semibold text-kd-warning">
              Collect {formatRs(job.codAmountMinor)} (COD)
            </p>
          )}
        </div>
      </div>

      <div className="space-y-2">
        {mode === "offer" ? (
          <div className="flex gap-3">
            <Button
              variant="outline"
              className="h-14 flex-1 text-base"
              disabled={busy}
              onClick={onDecline}
            >
              Decline
            </Button>
            <Button className="h-14 flex-1 text-base" disabled={busy} onClick={onAccept}>
              {busy ? "Accepting…" : "Accept"}
            </Button>
          </div>
        ) : (
          <Button
            className="h-14 w-full text-base"
            disabled={busy}
            onClick={onAcknowledge}
          >
            {busy ? "…" : "Got it — start job"}
          </Button>
        )}
      </div>
    </div>
  );
}
