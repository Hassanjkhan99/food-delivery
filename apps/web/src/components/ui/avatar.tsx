"use client";

import * as React from "react";
import { Avatar as AvatarPrimitive } from "@base-ui/react/avatar";

import { cn } from "@/lib/utils";

/**
 * User/entity avatar on `@base-ui/react/avatar`. Shows `src` when it loads, otherwise the
 * `fallback` (usually initials). Distinct from `RestaurantImage` (which handles
 * feed/menu photography with brand-gradient fallbacks).
 */
const sizeClasses = {
  sm: "size-8 text-xs",
  default: "size-10 text-sm",
  lg: "size-12 text-base",
} as const;

function Avatar({
  src,
  alt,
  fallback,
  size = "default",
  className,
}: {
  src?: string | null;
  alt?: string;
  fallback: React.ReactNode;
  size?: keyof typeof sizeClasses;
  className?: string;
}) {
  return (
    <AvatarPrimitive.Root
      data-slot="avatar"
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full bg-kd-surface-muted font-semibold text-kd-fg-muted",
        sizeClasses[size],
        className,
      )}
    >
      {src && <AvatarPrimitive.Image src={src} alt={alt} className="size-full object-cover" />}
      <AvatarPrimitive.Fallback className="flex size-full items-center justify-center">
        {fallback}
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  );
}

export { Avatar };
