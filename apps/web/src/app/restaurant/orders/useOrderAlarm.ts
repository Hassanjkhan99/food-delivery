"use client";

// New-order alerting for the vendor board (#46). While one or more orders sit unaccepted,
// this drives three attention channels that survive a backgrounded tab:
//   1. a looping Web Audio beep (no asset needed — synthesised, so nothing to ship/license),
//   2. the browser tab title flashing "🔔 N new order(s)",
//   3. a one-shot browser Notification (best-effort; requires the user to have granted it).
// All of it stops the instant `count` hits 0 or the operator acknowledges. Everything is
// guarded so a missing API (SSR, older browser, denied permission) degrades to silence
// rather than throwing.

import { useEffect, useRef, useState } from "react";

// Two short square-wave chirps, repeated on an interval. Kept intentionally simple; a
// branded asset can replace this later (decision left to the founder — see PR body).
function playChirp(ctx: AudioContext) {
  const now = ctx.currentTime;
  for (const [i, freq] of [880, 1174].entries()) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.value = freq;
    const start = now + i * 0.18;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.2, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.15);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + 0.16);
  }
}

export function useOrderAlarm(count: number, label: string) {
  // The count that was current when the operator last acknowledged. Acknowledgement only
  // silences that exact backlog; any change in `count` (a new order arriving, or one being
  // handled and another waiting) makes ackedAt !== count again and re-arms the alarm.
  // Storing the count itself (rather than a boolean + effect) is React's recommended way
  // to derive "did this prop change" without a cascading-render effect.
  const [ackedAt, setAckedAt] = useState<number | null>(null);
  const [soundOn, setSoundOn] = useState(true);
  const ctxRef = useRef<AudioContext | null>(null);
  const baseTitleRef = useRef<string | null>(null);

  const acknowledged = ackedAt === count;
  const active = count > 0 && !acknowledged;

  // Sound loop.
  useEffect(() => {
    if (!active || !soundOn || typeof window === "undefined") return;
    const AudioCtor =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) return;
    let ctx = ctxRef.current;
    if (!ctx) {
      try {
        ctx = new AudioCtor();
        ctxRef.current = ctx;
      } catch {
        return; // Autoplay policy not yet satisfied — a later user gesture unlocks it.
      }
    }
    // A prior gesture may have suspended the context; try to resume, ignore failure.
    void ctx.resume?.().catch(() => {});
    const ring = () => {
      if (ctx && ctx.state === "running") playChirp(ctx);
    };
    ring();
    const t = setInterval(ring, 2000);
    return () => clearInterval(t);
  }, [active, soundOn]);

  // Tab-title flash.
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (baseTitleRef.current === null) baseTitleRef.current = document.title;
    const base = baseTitleRef.current;
    if (!active) {
      document.title = base;
      return;
    }
    let on = false;
    const flash = () => {
      on = !on;
      document.title = on ? `🔔 ${count} new order${count === 1 ? "" : "s"}` : base;
    };
    flash();
    const t = setInterval(flash, 1000);
    return () => {
      clearInterval(t);
      document.title = base;
    };
  }, [active, count]);

  // Browser notification (best-effort, one per rising edge of `count`).
  useEffect(() => {
    if (!active || typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission !== "granted") return;
    try {
      const n = new Notification(`${count} new order${count === 1 ? "" : "s"}`, {
        body: `${label} — tap to review and accept.`,
        tag: "kd-new-orders",
        renotify: true,
      } as NotificationOptions);
      const t = setTimeout(() => n.close(), 8000);
      return () => clearTimeout(t);
    } catch {
      // Some browsers throw for the constructor off a service worker; ignore.
    }
  }, [active, count, label]);

  function acknowledge() {
    setAckedAt(count);
  }

  function toggleSound() {
    // First enable also serves as the user gesture that unlocks the AudioContext.
    setSoundOn((s) => !s);
    if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "default") {
      void Notification.requestPermission().catch(() => {});
    }
  }

  return { active, soundOn, acknowledge, toggleSound };
}
