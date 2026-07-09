"use client";

// Theme editor with live preview: colors, font, card style, hero effect, logo/hero art.
import { useEffect, useState } from "react";
import { useClient, useMutation, useQuery } from "urql";
import { graphql } from "@/graphql/generated";
import { useConsole } from "../useConsole";
import { uploadFile } from "@/lib/upload";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { TiltCard } from "@/components/theme/TiltCard";
import { DEFAULT_THEME, FONT_STACKS, cardClasses, themeVars, type ThemeShape } from "@/components/theme/theme";

const ThemeQuery = graphql(`
  query RestaurantThemeQ($slug: String!) {
    branchBySlug(slug: $slug) {
      id
      restaurant {
        id
        theme {
          primaryColor
          accentColor
          backgroundColor
          textColor
          fontKey
          cardStyle
          heroEffect
          logoUrl
          heroUrl
        }
      }
    }
  }
`);

const UpdateThemeMutation = graphql(`
  mutation UpdateTheme($restaurantId: String!, $primaryColor: String, $accentColor: String, $backgroundColor: String, $textColor: String, $fontKey: String, $cardStyle: String, $heroEffect: String, $logoAssetId: String, $heroAssetId: String) {
    updateTheme(restaurantId: $restaurantId, primaryColor: $primaryColor, accentColor: $accentColor, backgroundColor: $backgroundColor, textColor: $textColor, fontKey: $fontKey, cardStyle: $cardStyle, heroEffect: $heroEffect, logoAssetId: $logoAssetId, heroAssetId: $heroAssetId) {
      id
    }
  }
`);

const CARD_STYLES = ["flat", "glass", "tilt3d"] as const;
const HERO_EFFECTS = ["none", "parallax", "depth"] as const;

export default function BrandingPage() {
  const { restaurant } = useConsole();
  const client = useClient();
  const [{ data }] = useQuery({
    query: ThemeQuery,
    variables: { slug: restaurant?.slug ?? "" },
    pause: !restaurant,
  });
  const [saveState, save] = useMutation(UpdateThemeMutation);

  const [theme, setTheme] = useState<ThemeShape>(DEFAULT_THEME);
  const [logoAssetId, setLogoAssetId] = useState<string | null>(null);
  const [heroAssetId, setHeroAssetId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const t = data?.branchBySlug?.restaurant.theme;
    if (t) setTheme({ ...DEFAULT_THEME, ...t } as ThemeShape);
  }, [data]);

  if (!restaurant) return <p className="text-neutral-500">Complete onboarding first.</p>;

  async function handleUpload(file: File, target: "logo" | "hero") {
    setMessage(null);
    try {
      const { assetId, url } = await uploadFile(client, file, "image");
      if (target === "logo") {
        setLogoAssetId(assetId);
        setTheme((t) => ({ ...t, logoUrl: url }));
      } else {
        setHeroAssetId(assetId);
        setTheme((t) => ({ ...t, heroUrl: url }));
      }
    } catch (e) {
      setMessage((e as Error).message);
    }
  }

  const colorField = (label: string, key: keyof ThemeShape) => (
    <div className="flex items-center justify-between">
      <Label>{label}</Label>
      <input
        type="color"
        value={theme[key] as string}
        onChange={(e) => setTheme({ ...theme, [key]: e.target.value })}
        className="h-8 w-14 cursor-pointer rounded border border-neutral-200"
      />
    </div>
  );

  return (
    <main className="grid max-w-5xl gap-6 lg:grid-cols-2">
      <div>
        <h1 className="mb-4 text-xl font-bold">Branding</h1>
        <div className="space-y-4 rounded-xl border border-neutral-200 bg-white p-4 text-sm">
          {colorField("Primary color", "primaryColor")}
          {colorField("Accent color", "accentColor")}
          {colorField("Background", "backgroundColor")}
          {colorField("Text color", "textColor")}

          <div className="flex items-center justify-between">
            <Label>Font</Label>
            <select
              value={theme.fontKey}
              onChange={(e) => setTheme({ ...theme, fontKey: e.target.value })}
              className="rounded-lg border border-neutral-300 px-2 py-1"
            >
              {Object.keys(FONT_STACKS).map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center justify-between">
            <Label>Card style</Label>
            <select
              value={theme.cardStyle}
              onChange={(e) => setTheme({ ...theme, cardStyle: e.target.value })}
              className="rounded-lg border border-neutral-300 px-2 py-1"
            >
              {CARD_STYLES.map((s) => (
                <option key={s} value={s}>{s === "tilt3d" ? "3D tilt" : s}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center justify-between">
            <Label>Hero effect</Label>
            <select
              value={theme.heroEffect}
              onChange={(e) => setTheme({ ...theme, heroEffect: e.target.value })}
              className="rounded-lg border border-neutral-300 px-2 py-1"
            >
              {HERO_EFFECTS.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center justify-between">
            <Label>Logo</Label>
            <input type="file" accept="image/*" className="text-xs" onChange={(e) => e.target.files?.[0] && handleUpload(e.target.files[0], "logo")} />
          </div>
          <div className="flex items-center justify-between">
            <Label>Hero image</Label>
            <input type="file" accept="image/*" className="text-xs" onChange={(e) => e.target.files?.[0] && handleUpload(e.target.files[0], "hero")} />
          </div>

          {message && <p className="text-red-600">{message}</p>}
          <Button
            className="w-full"
            disabled={saveState.fetching}
            onClick={async () => {
              const r = await save({
                restaurantId: restaurant.id,
                primaryColor: theme.primaryColor,
                accentColor: theme.accentColor,
                backgroundColor: theme.backgroundColor,
                textColor: theme.textColor,
                fontKey: theme.fontKey,
                cardStyle: theme.cardStyle,
                heroEffect: theme.heroEffect,
                logoAssetId,
                heroAssetId,
              });
              setMessage(r.error ? r.error.graphQLErrors[0]?.message ?? "Save failed" : "Saved — customers see it immediately.");
            }}
          >
            {saveState.fetching ? "Saving…" : "Save theme"}
          </Button>
        </div>
      </div>

      {/* Live preview */}
      <div>
        <h2 className="mb-4 text-xl font-bold">Live preview</h2>
        <div className="overflow-hidden rounded-2xl border border-neutral-200 p-4" style={themeVars(theme)}>
          <div
            className="mb-4 flex h-28 items-end rounded-2xl p-4"
            style={{
              background: theme.heroUrl
                ? `url(${theme.heroUrl}) center/cover`
                : `linear-gradient(135deg, ${theme.primaryColor}, ${theme.primaryColor}66)`,
            }}
          >
            <span className="text-2xl font-bold" style={{ color: theme.heroUrl ? "#fff" : "var(--brand-primary)" }}>
              {restaurant.name}
            </span>
          </div>
          <div className="space-y-2">
            {["Chicken Biryani — Rs 450", "Seekh Kabab — Rs 320"].map((label) =>
              theme.cardStyle === "tilt3d" ? (
                <TiltCard key={label} className={`w-full rounded-2xl p-4 text-left text-sm ${cardClasses("tilt3d")}`}>
                  <span className="font-medium">{label}</span>
                </TiltCard>
              ) : (
                <div key={label} className={`rounded-2xl p-4 text-sm ${cardClasses(theme.cardStyle)}`}>
                  <span className="font-medium">{label}</span>
                </div>
              ),
            )}
            <span
              className="inline-block rounded-full px-3 py-1 text-xs font-semibold"
              style={{ backgroundColor: "color-mix(in srgb, var(--brand-accent) 30%, transparent)" }}
            >
              Bestseller
            </span>
          </div>
        </div>
        <p className="mt-2 text-xs text-neutral-400">
          Hover the cards to feel the 3D tilt (when selected). Effects auto-disable for
          customers with reduced-motion preferences.
        </p>
      </div>
    </main>
  );
}
