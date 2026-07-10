"use client";

// Recent search terms, persisted in localStorage (#37). Modeled as an external store
// read via useSyncExternalStore (the house pattern for browser state — see
// components/home/hooks.ts) so there's no setState-in-effect and the list stays in
// sync across mounts/tabs. Most-recent first, de-duplicated case-insensitively, capped.
import { useCallback, useSyncExternalStore } from "react";

const KEY = "fd-recent-searches";
const MAX = 8;

const listeners = new Set<() => void>();
// Cached parsed snapshot so getSnapshot returns a stable reference between writes
// (useSyncExternalStore requires referential stability or it loops).
let cache: string[] = [];
let cacheRaw: string | null = null;

function read(): string[] {
  if (typeof window === "undefined") return [];
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch {
    return cache;
  }
  if (raw === cacheRaw) return cache;
  cacheRaw = raw;
  try {
    const parsed = raw ? JSON.parse(raw) : [];
    cache = Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    cache = [];
  }
  return cache;
}

function write(next: string[]) {
  cache = next;
  cacheRaw = JSON.stringify(next);
  try {
    window.localStorage.setItem(KEY, cacheRaw);
  } catch {
    // Storage disabled/full — recents just won't persist.
  }
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

export function useRecentSearches() {
  const recents = useSyncExternalStore(subscribe, read, () => cache);

  const add = useCallback((term: string) => {
    const t = term.trim();
    if (t.length < 2) return;
    const prev = read();
    write([t, ...prev.filter((x) => x.toLowerCase() !== t.toLowerCase())].slice(0, MAX));
  }, []);

  const remove = useCallback((term: string) => write(read().filter((x) => x !== term)), []);

  const clear = useCallback(() => write([]), []);

  return { recents, add, remove, clear };
}
