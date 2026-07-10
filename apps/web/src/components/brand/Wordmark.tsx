// Herald brand mark: a heraldic shield crest (chevron + roundel — a mock coat of arms)
// paired with the "Herald" wordmark set in Cinzel, an inscriptional Roman serif that carries
// the medieval feel. The crest scales with the surrounding font-size (em units), so one
// component works in the compact header and the larger login hero. Purely presentational —
// safe in both server and client components.

/** Shield-and-chevron crest. Stroke follows currentColor (the brand foreground); the chevron
 *  and roundel use the rose accent so the mark reads on light and dark surfaces alike. */
export function HeraldCrest({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path
        d="M4 5 H20 V11 C20 16 16 19.5 12 21.5 C8 19.5 4 16 4 11 Z"
        className="fill-kd-primary-soft stroke-current"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="8" r="1.4" className="fill-kd-primary" />
      <path
        d="M7.5 14.4 L12 10.6 L16.5 14.4"
        className="stroke-kd-primary"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ""}`}>
      <HeraldCrest className="h-[1.15em] w-[1.15em] shrink-0" />
      <span
        style={{ fontFamily: "var(--font-herald), Georgia, serif" }}
        className="font-semibold tracking-[0.12em]"
      >
        Herald
      </span>
    </span>
  );
}
