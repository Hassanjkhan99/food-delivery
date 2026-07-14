"use client";

// Tax-aware price display (#146). Renders a stored menu price under the customer's
// inclusive/before-tax preference using the shared money contract — never re-deriving tax.
// Presentation only: the payable total is always the server's. `taxInfo` comes from the
// branch (Branch.taxInfo); when omitted we fall back to the raw stored price (no tax context).
import { displayPriceMinor, formatRs, type Minor } from "@fd/shared";
import { usePriceDisplay } from "@/lib/price-display";

export type BranchTaxInfo = {
  rateBps: number;
  inclusive: boolean;
  label: string;
};

/** Resolve the amount to show + a short tax hint for the current display preference. */
export function useDisplayPrice(
  minor: Minor,
  taxInfo?: BranchTaxInfo | null,
): { minor: Minor; hint: string | null } {
  const mode = usePriceDisplay((s) => s.mode);
  if (!taxInfo || taxInfo.rateBps <= 0) return { minor, hint: null };
  const shown = displayPriceMinor(minor, taxInfo.rateBps, taxInfo.inclusive, mode);
  return { minor: shown, hint: mode === "inclusive" ? "incl. tax" : "+ tax" };
}

export function Price({
  minor,
  taxInfo,
  className,
  style,
  hint = true,
}: {
  minor: Minor;
  taxInfo?: BranchTaxInfo | null;
  className?: string;
  style?: React.CSSProperties;
  hint?: boolean;
}) {
  const { minor: shown, hint: hintText } = useDisplayPrice(minor, taxInfo);
  return (
    <span className={className} style={style}>
      {formatRs(shown)}
      {hint && hintText ? (
        <span className="ml-1 text-[10px] font-normal text-kd-fg-subtle">{hintText}</span>
      ) : null}
    </span>
  );
}

// Compact inclusive/before-tax toggle. Placed on price-bearing surfaces so the customer can
// flip presentation; the choice persists across sessions. Never changes any payable amount.
export function PriceDisplayToggle({ className }: { className?: string }) {
  const mode = usePriceDisplay((s) => s.mode);
  const setMode = usePriceDisplay((s) => s.setMode);
  return (
    <div
      className={`inline-flex items-center rounded-full border border-kd-border bg-kd-surface p-0.5 text-xs ${className ?? ""}`}
      role="group"
      aria-label="Price display"
    >
      {(["inclusive", "exclusive"] as const).map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => setMode(m)}
          aria-pressed={mode === m}
          className={`rounded-full px-2.5 py-1 transition ${
            mode === m ? "bg-kd-primary text-white" : "text-kd-fg-muted hover:text-kd-fg"
          }`}
        >
          {m === "inclusive" ? "Including tax" : "Before tax"}
        </button>
      ))}
    </div>
  );
}
