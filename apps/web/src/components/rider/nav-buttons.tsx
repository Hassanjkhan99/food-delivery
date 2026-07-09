"use client";

// Navigation handoff (#47): opens the platform maps app at a coordinate. Uses the
// universal `https://maps.google.com/?q=lat,lng` form which every installed maps app
// (Google Maps, Apple Maps via the browser, etc.) can resolve, and which also works
// on desktop for the two-browser demo. Rendered per-leg (pickup / drop) so the rider
// navigates each in one tap.
import { NavigationIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

export function mapsUrl(lat: number, lng: number): string {
  return `https://maps.google.com/?q=${lat},${lng}`;
}

export function NavButton({
  lat,
  lng,
  label,
  variant = "outline",
}: {
  lat?: number | null;
  lng?: number | null;
  label: string;
  variant?: "default" | "outline";
}) {
  // Guard: a missing/invalid coordinate must not render a dead link that navigates
  // to "?q=null,null". Show a disabled hint instead.
  const hasCoords =
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng);

  if (!hasCoords) {
    return (
      <Button variant="outline" className="w-full" disabled>
        <NavigationIcon className="size-4" />
        {label} — no location
      </Button>
    );
  }

  return (
    <Button
      variant={variant}
      className="w-full"
      render={
        <a href={mapsUrl(lat, lng)} target="_blank" rel="noopener noreferrer">
          <NavigationIcon className="size-4" />
          {label}
        </a>
      }
    />
  );
}
