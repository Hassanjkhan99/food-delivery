// SLA computation for the support queue (issue #14). Pure + client-safe: given a
// ticket's timestamps and its playbook targets, derive a breach level and label.
// "First response" runs createdAt → firstRespondedAt (or now); "resolution" runs
// createdAt → resolvedAt (or now). Whichever is worse drives the row's color.

export type SlaLevel = "ok" | "warning" | "breached" | "done";

const MIN_MS = 60_000;

function minutesSince(from: string, to: string | null): number {
  const start = new Date(from).getTime();
  const end = to ? new Date(to).getTime() : Date.now();
  return (end - start) / MIN_MS;
}

/**
 * Classify a single elapsed/target pair. Warn at 75% of target. When `met` is
 * set, the milestone was hit at `elapsedMin`: if that was within target it's
 * `done`, otherwise the miss stands (breached) so a late first response is not
 * silently cleared to "within SLA".
 */
function levelFor(elapsedMin: number, targetMin: number, met: boolean): SlaLevel {
  if (elapsedMin >= targetMin) return "breached";
  if (met) return "done";
  if (elapsedMin >= targetMin * 0.75) return "warning";
  return "ok";
}

const WORST: Record<SlaLevel, number> = { done: 0, ok: 1, warning: 2, breached: 3 };

export function slaState(input: {
  createdAt: string;
  firstRespondedAt: string | null;
  resolvedAt: string | null;
  firstResponseMin: number;
  resolutionMin: number;
}): { level: SlaLevel; label: string } {
  // Fully resolved tickets stop both clocks.
  if (input.resolvedAt) {
    return { level: "done", label: "Resolved" };
  }

  const frElapsed = minutesSince(input.createdAt, input.firstRespondedAt);
  const frLevel = levelFor(frElapsed, input.firstResponseMin, input.firstRespondedAt !== null);

  const resElapsed = minutesSince(input.createdAt, null);
  const resLevel = levelFor(resElapsed, input.resolutionMin, false);

  const worst = WORST[frLevel] >= WORST[resLevel] ? frLevel : resLevel;
  const driver = WORST[frLevel] >= WORST[resLevel] ? "response" : "resolution";

  if (worst === "breached") {
    return { level: "breached", label: `SLA breached (${driver})` };
  }
  if (worst === "warning") {
    return { level: "warning", label: `SLA at risk (${driver})` };
  }
  if (frLevel === "done") {
    return { level: "ok", label: "Responded, within SLA" };
  }
  return { level: "ok", label: "Within SLA" };
}

/** kd-token utility classes per SLA level (no hardcoded colors). */
export function slaBadgeClass(level: SlaLevel): string {
  switch (level) {
    case "breached":
      return "bg-kd-danger-soft text-kd-danger";
    case "warning":
      return "bg-kd-warning-soft text-kd-warning";
    case "done":
      return "bg-kd-success-soft text-kd-success";
    default:
      return "bg-kd-info-soft text-kd-info";
  }
}

/** Compact human age like "4m", "2h", "3d". */
export function ageLabel(createdAt: string): string {
  const mins = minutesSince(createdAt, null);
  if (mins < 60) return `${Math.max(0, Math.round(mins))}m`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h`;
  return `${Math.round(mins / (60 * 24))}d`;
}
