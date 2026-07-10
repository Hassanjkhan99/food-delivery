"use client";

// Compact locale toggle (#49). Cycles English <-> Urdu; flipping to Urdu switches
// the whole app to RTL via the provider. Kept keyboard-accessible with a clear
// aria-label so it satisfies the a11y icon-button requirement in the same pass.

import { Languages } from "lucide-react";
import { LOCALES, LOCALE_LABELS } from "./dictionaries";
import { useI18n } from "./provider";

export function LocaleSwitcher({ className }: { className?: string }) {
  const { locale, setLocale } = useI18n();
  const next = LOCALES[(LOCALES.indexOf(locale) + 1) % LOCALES.length]!;

  return (
    <button
      type="button"
      onClick={() => setLocale(next)}
      aria-label={`Switch language, current ${LOCALE_LABELS[locale]}`}
      title={`Switch to ${LOCALE_LABELS[next]}`}
      className={
        "flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-kd-fg-muted transition-colors hover:text-kd-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kd-primary focus-visible:ring-offset-2 " +
        (className ?? "")
      }
    >
      <Languages className="h-5 w-5" aria-hidden />
      <span className="text-sm font-medium">{LOCALE_LABELS[locale]}</span>
    </button>
  );
}
