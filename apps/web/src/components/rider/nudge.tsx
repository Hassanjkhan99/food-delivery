// Rider nudge cards (#165 / #47 target-spec 9): compact, high-contrast status cards that
// tell the rider one thing at a time. Colour follows the rider theme rules — yellow =
// attention, green = positive/safe, red = problem.
import type { ReactNode } from "react";

type Tone = "warning" | "success" | "danger";

const TONE_CLASS: Record<Tone, string> = {
  warning: "border-kd-warning bg-kd-warning-soft text-kd-warning",
  success: "border-kd-success bg-kd-success-soft text-kd-success",
  danger: "border-kd-danger bg-kd-danger-soft text-kd-danger",
};

export function NudgeCard({
  tone,
  icon,
  title,
  detail,
}: {
  tone: Tone;
  icon?: ReactNode;
  title: string;
  detail?: string;
}) {
  return (
    <div className={`flex items-start gap-2 rounded-2xl border p-3 ${TONE_CLASS[tone]}`}>
      {icon && <span className="mt-0.5 shrink-0">{icon}</span>}
      <div>
        <p className="text-sm font-semibold">{title}</p>
        {detail && <p className="mt-0.5 text-xs opacity-90">{detail}</p>}
      </div>
    </div>
  );
}
