"use client";

import { useEffect, useSyncExternalStore } from "react";

/**
 * Remembers the window scroll position for a key and restores it on mount, so the
 * feed returns to where the customer was after they open a restaurant and come back.
 * (Next restores scroll for history navigation; this also covers soft re-mounts.)
 */
export function useScrollRestoration(key: string) {
  useEffect(() => {
    const stored = sessionStorage.getItem(`scroll:${key}`);
    if (stored) {
      const y = Number(stored);
      // Wait a frame so the list has painted before we jump.
      requestAnimationFrame(() => window.scrollTo(0, y));
    }
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() =>
        sessionStorage.setItem(`scroll:${key}`, String(window.scrollY)),
      );
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
    };
  }, [key]);
}

function subscribeOnline(callback: () => void) {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

/** Tracks online/offline via useSyncExternalStore. Server snapshot is optimistic
 *  (true) to avoid a hydration flash. */
export function useOnlineStatus() {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
}
