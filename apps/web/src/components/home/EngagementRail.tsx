"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, Gift, PiggyBank, RotateCcw, Sparkles, Tag, Ticket, X } from "lucide-react";
import { cn } from "@/lib/utils";

/** One engagement card as returned by the `engagementCards` read model. */
export type EngagementCard = {
  id: string;
  kind: string;
  title: string;
  body?: string | null;
  accent: string;
  ctaLabel: string;
  href: string;
  expiresAt?: string | null;
  priority: number;
};

// Accent → surface treatment (UX-13 offer palette). Red = urgent deal, yellow = reward/
// savings, neutral = habit/upsell. Kept to soft-tinted surfaces so the rail motivates
// without shouting (product principle in #134: helpful, not a casino).
const ACCENT_STYLES: Record<string, { card: string; icon: string; cta: string }> = {
  red: {
    card: "border-kd-danger-soft bg-kd-danger-soft/60",
    icon: "bg-kd-danger/10 text-kd-danger",
    cta: "text-kd-danger",
  },
  yellow: {
    card: "border-kd-accent-soft bg-kd-accent-soft/60",
    icon: "bg-kd-accent/15 text-kd-warning-soft-fg",
    cta: "text-kd-warning-soft-fg",
  },
  neutral: {
    card: "border-kd-border bg-kd-surface",
    icon: "bg-kd-primary-soft text-kd-primary",
    cta: "text-kd-primary",
  },
};

// Icon per card kind — a small visual anchor, never a "badge with no value".
const KIND_ICON: Record<string, typeof Tag> = {
  deal: Tag,
  reorder: RotateCcw,
  reward: Sparkles,
  saved: PiggyBank,
  referral: Gift,
  membership: Ticket,
};

function accentOf(accent: string) {
  return ACCENT_STYLES[accent] ?? ACCENT_STYLES.neutral;
}

/**
 * Horizontal rail of gamified deal / reward / habit-loop flashcards (UX-15 / #134).
 * Lives on Home between the reorder row and the main feed. Renders nothing when the
 * server returns no cards, so an empty rail never adds noise. Cards are dismissible for
 * the session (client-only) — dismissal never mutates server state.
 */
export function EngagementRail({ cards }: { cards: EngagementCard[] }) {
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const visible = useMemo(() => cards.filter((c) => !dismissed.has(c.id)), [cards, dismissed]);

  if (visible.length === 0) return null;

  return (
    <section className="space-y-3" aria-label="Deals and rewards for you">
      <h2 className="flex items-center gap-2 text-lg font-bold text-kd-fg">
        <Sparkles className="h-4 w-4 text-kd-primary" />
        For you
      </h2>
      <div className="-mx-4 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="flex gap-4">
          {visible.map((card) => {
            const styles = accentOf(card.accent);
            const Icon = KIND_ICON[card.kind] ?? Sparkles;
            return (
              <article
                key={card.id}
                className={cn(
                  "relative flex w-72 shrink-0 flex-col rounded-2xl border p-4 shadow-sm transition-shadow hover:shadow-md",
                  styles.card,
                )}
              >
                <button
                  type="button"
                  onClick={() => setDismissed((prev) => new Set(prev).add(card.id))}
                  aria-label={`Dismiss: ${card.title}`}
                  className="absolute right-2 top-2 rounded-full p-1 text-kd-fg-subtle transition-colors hover:bg-black/5 hover:text-kd-fg"
                >
                  <X className="h-4 w-4" />
                </button>
                <span
                  className={cn(
                    "flex h-9 w-9 items-center justify-center rounded-full",
                    styles.icon,
                  )}
                >
                  <Icon className="h-5 w-5" />
                </span>
                <h3 className="mt-3 pr-6 text-sm font-bold leading-snug text-kd-fg">
                  {card.title}
                </h3>
                {card.body && (
                  <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-kd-fg-muted">
                    {card.body}
                  </p>
                )}
                <Link
                  href={card.href}
                  className={cn(
                    "mt-auto inline-flex items-center gap-1 pt-3 text-sm font-semibold hover:underline",
                    styles.cta,
                  )}
                >
                  {card.ctaLabel}
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/** 3-card skeleton for the initial fetch (matches the card footprint). */
export function EngagementRailSkeleton() {
  return (
    <section className="space-y-3" aria-hidden>
      <div className="h-6 w-24 animate-pulse rounded bg-kd-surface-muted" />
      <div className="-mx-4 overflow-hidden px-4">
        <div className="flex gap-4">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-40 w-72 shrink-0 animate-pulse rounded-2xl border border-kd-border bg-kd-surface-muted"
            />
          ))}
        </div>
      </div>
    </section>
  );
}
