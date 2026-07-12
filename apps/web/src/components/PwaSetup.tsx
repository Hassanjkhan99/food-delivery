"use client";

// Registers the service worker after load (all roles share the shell).
import { useEffect } from "react";

export function PwaSetup() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    // In dev the SW caches the app shell aggressively, which serves a stale HTML
    // document against fresh client JS → hydration mismatches, stale styles, and
    // an offline shell on uncached routes. Only register in production; in dev,
    // tear down any SW + caches a previous run left behind so the page is clean.
    if (process.env.NODE_ENV !== "production") {
      void navigator.serviceWorker
        .getRegistrations()
        .then((regs) => Promise.all(regs.map((r) => r.unregister())))
        .catch(() => {});
      if (typeof caches !== "undefined") {
        void caches
          .keys()
          .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
          .catch(() => {});
      }
      return;
    }

    const register = () => navigator.serviceWorker.register("/sw.js").catch(() => {});
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
  }, []);
  return null;
}
