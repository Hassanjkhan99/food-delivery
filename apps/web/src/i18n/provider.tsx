"use client";

// Client-side i18n context (#49). Deliberately tiny and dependency-free — see
// dictionaries.ts for the founder call on scaffolding-vs-next-intl. Persists the
// chosen locale to localStorage and reflects lang/dir onto <html> so RTL (Urdu)
// works app-wide without a server round-trip.
//
// The locale is read via useSyncExternalStore: the server snapshot is the default
// locale (stable SSR), and the client snapshot comes from localStorage — no
// setState-in-effect, so React never does a cascading render on mount.

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { DEFAULT_LOCALE, isLocale, isRtl, translate, type Locale } from "./dictionaries";

const STORAGE_KEY = "kd.locale";

type I18nContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string) => string;
  rtl: boolean;
};

const I18nContext = createContext<I18nContextValue | null>(null);

// --- external locale store (localStorage-backed) -------------------------------
const listeners = new Set<() => void>();

function readStoredLocale(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isLocale(stored)) return stored;
  } catch {
    // localStorage can throw (private mode) — fall through to the default.
  }
  return DEFAULT_LOCALE;
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  // Cross-tab sync: another tab changing the locale updates this one.
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

function writeLocale(next: Locale) {
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // best-effort persistence
  }
  listeners.forEach((cb) => cb());
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const locale = useSyncExternalStore<Locale>(
    subscribe,
    readStoredLocale, // client snapshot
    () => DEFAULT_LOCALE, // server snapshot (stable SSR)
  );

  const setLocale = useCallback((next: Locale) => writeLocale(next), []);

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      setLocale,
      t: (key: string) => translate(locale, key),
      rtl: isRtl(locale),
    }),
    [locale, setLocale],
  );

  // NOTE: lang/dir are intentionally NOT applied to the global <html> here. Switching
  // to Urdu must only mirror the customer surface — the restaurant/admin/rider/login
  // consoles are English/LTR and share the same browser (#129). CustomerLayout reads
  // `locale`/`rtl` from this context and sets lang/dir on its own subtree wrapper.
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** Access the i18n context. Safe outside a provider: falls back to English so a
 * component can never crash for lack of a provider (best-effort scaffolding). */
export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (ctx) return ctx;
  return {
    locale: DEFAULT_LOCALE,
    setLocale: () => {},
    t: (key: string) => translate(DEFAULT_LOCALE, key),
    rtl: false,
  };
}
