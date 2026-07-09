"use client";

// Menu-item image (#50, tiers 1+3): uploaded dish photo or the typography
// fallback. No Google tier — Places has no per-dish imagery. Box owns the aspect
// ratio (no layout shift). Decorative: the item name is already shown as text
// beside it, so the tile itself is aria-hidden.
import { useState } from "react";
import Image from "next/image";
import { cn } from "@/lib/utils";
import { fallbackGradient, initials } from "./fallback";

export function ItemImage({
  url,
  name,
  className,
  sizes = "96px",
}: {
  url?: string | null;
  name: string;
  className?: string;
  sizes?: string;
}) {
  const [errored, setErrored] = useState(false);
  const show = url && !errored;

  return (
    <div
      aria-hidden
      className={cn("relative shrink-0 overflow-hidden bg-neutral-100", className)}
      style={show ? undefined : { background: fallbackGradient(name) }}
    >
      {show ? (
        <Image
          src={url}
          alt={name}
          fill
          sizes={sizes}
          className="object-cover"
          onError={() => setErrored(true)}
        />
      ) : (
        <span className="absolute inset-0 flex select-none items-center justify-center text-sm font-semibold text-white/90">
          {initials(name)}
        </span>
      )}
    </div>
  );
}
