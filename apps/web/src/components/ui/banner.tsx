import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { AlertCircle, AlertTriangle, CheckCircle2, Info, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Inline status banner / alert. Consolidates the ~30 hand-rolled
 * `rounded-xl bg-kd-*-soft` message blocks. Four tones map to the status tokens; each
 * shows a default Lucide icon (pass `icon` to override, or `icon={null}` to drop it).
 */
const bannerVariants = cva("flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-sm", {
  variants: {
    tone: {
      info: "border-kd-info/30 bg-kd-info-soft text-kd-info",
      success: "border-kd-success/30 bg-kd-success-soft text-kd-success",
      warning: "border-kd-warning/40 bg-kd-warning-soft text-kd-warning-soft-fg",
      danger: "border-kd-danger/30 bg-kd-danger-soft text-kd-danger",
    },
  },
  defaultVariants: { tone: "info" },
});

const TONE_ICON: Record<NonNullable<VariantProps<typeof bannerVariants>["tone"]>, LucideIcon> = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: AlertCircle,
};

function Banner({
  tone = "info",
  icon,
  title,
  children,
  className,
  ...props
}: Omit<React.ComponentProps<"div">, "title"> &
  VariantProps<typeof bannerVariants> & {
    icon?: React.ReactNode;
    title?: React.ReactNode;
  }) {
  const DefaultIcon = TONE_ICON[tone ?? "info"];
  // `icon` omitted → default tone icon; `icon={null}` → no icon; else the given node.
  const leading = icon === undefined ? <DefaultIcon className="mt-0.5 h-4 w-4 shrink-0" /> : icon;

  return (
    <div
      role="status"
      data-slot="banner"
      className={cn(bannerVariants({ tone }), className)}
      {...props}
    >
      {leading}
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cn(title && "mt-0.5 opacity-90")}>{children}</div>}
      </div>
    </div>
  );
}

export { Banner, bannerVariants };
