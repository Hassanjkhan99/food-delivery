"use client";

// Restaurant/branch image with the full pipeline (#50): resolves an uploaded or
// Google-Places photo (decided server-side) and renders the typography fallback
// when there's none. Consumers never branch on source — they pass `photo` and a
// name. Sizing is caller-controlled via className (the box owns the aspect ratio,
// so there is no layout shift while the image loads).
import { useState } from "react";
import Image from "next/image";
import { cn } from "@/lib/utils";
import { fallbackGradient, initials } from "./fallback";

export type BranchPhoto = {
  url: string;
  source: string;
  attributionHtml?: string | null;
} | null;

export function RestaurantImage({
  photo,
  name,
  tint,
  className,
  sizes = "(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw",
}: {
  photo?: BranchPhoto;
  name: string;
  /** Brand color to tint the fallback tile (falls back to a name-hashed hue). */
  tint?: string | null;
  className?: string;
  sizes?: string;
}) {
  const [errored, setErrored] = useState(false);
  const show = photo && !errored;

  return (
    <div
      className={cn("relative overflow-hidden bg-neutral-100", className)}
      style={show ? undefined : { background: fallbackGradient(name, tint) }}
    >
      {show ? (
        <>
          <Image
            src={photo.url}
            alt={name}
            fill
            sizes={sizes}
            className="object-cover"
            // Google photos must not be cached by Next's optimizer (ToS): serve as-is.
            unoptimized={photo.source === "google"}
            onError={() => setErrored(true)}
          />
          {photo.source === "google" && photo.attributionHtml && (
            <span
              className="absolute right-1 bottom-1 max-w-[75%] truncate rounded bg-black/55 px-1.5 py-0.5 text-[10px] leading-tight text-white/90 [&_a]:underline"
              // Displaying Google's attribution markup is required by the Places ToS.
              dangerouslySetInnerHTML={{ __html: photo.attributionHtml }}
            />
          )}
        </>
      ) : (
        <span className="absolute inset-0 flex select-none items-center justify-center text-3xl font-bold text-white/90 drop-shadow-sm">
          {initials(name)}
        </span>
      )}
    </div>
  );
}
