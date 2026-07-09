// Tier 2 of the restaurant image pipeline (#50): live-fetch a venue photo from
// Google Places when a branch has a googlePlaceId but no uploaded hero.
//
// Google Places ToS constraints, enforced here:
//   - The API key stays server-side (never returned to the client).
//   - We do NOT store the photo bytes. We resolve Google's redirect to the
//     keyless googleusercontent URL and hand that (short-lived) URL to the client
//     to render directly. Attribution is required and returned alongside.
//   - We cache only the resolved *reference* (URL + attribution) in memory for a
//     short TTL to keep per-call billing sane — never the image data.
import { env } from "../env.js";
import { logger } from "../logger.js";

export type PlacePhoto = { url: string; attributionHtml: string | null };

type CacheEntry = { value: PlacePhoto | null; expiresAt: number };
const cache = new Map<string, CacheEntry>();
const TTL_MS = 30 * 60 * 1000; // keyless googleusercontent URLs are short-lived
const MAX_WIDTH = 1200;

/**
 * Resolve a displayable venue photo for a Google place. Returns null when no key
 * is configured, the place has no photos, or anything fails — callers degrade to
 * the typography fallback. Never throws.
 */
export async function getPlacePhoto(placeId: string): Promise<PlacePhoto | null> {
  const key = env.googlePlacesApiKey;
  if (!key || !placeId) return null;

  const cached = cache.get(placeId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  let value: PlacePhoto | null = null;
  try {
    // 1. Place Details -> first photo reference + its required attribution.
    const detailsUrl = new URL("https://maps.googleapis.com/maps/api/place/details/json");
    detailsUrl.searchParams.set("place_id", placeId);
    detailsUrl.searchParams.set("fields", "photos");
    detailsUrl.searchParams.set("key", key);

    const detailsRes = await fetch(detailsUrl, { signal: AbortSignal.timeout(4000) });
    const details = (await detailsRes.json()) as {
      status?: string;
      result?: { photos?: { photo_reference: string; html_attributions?: string[] }[] };
    };
    const photo = details.result?.photos?.[0];

    if (details.status === "OK" && photo?.photo_reference) {
      // 2. Photo endpoint returns a 302 to a keyless googleusercontent URL.
      const photoUrl = new URL("https://maps.googleapis.com/maps/api/place/photo");
      photoUrl.searchParams.set("maxwidth", String(MAX_WIDTH));
      photoUrl.searchParams.set("photo_reference", photo.photo_reference);
      photoUrl.searchParams.set("key", key);

      const photoRes = await fetch(photoUrl, {
        redirect: "manual",
        signal: AbortSignal.timeout(4000),
      });
      const location = photoRes.headers.get("location");
      if (location) {
        value = { url: location, attributionHtml: photo.html_attributions?.[0] ?? null };
      }
    } else if (details.status && details.status !== "OK") {
      logger.warn({ placeId, status: details.status }, "places photo lookup non-OK");
    }
  } catch (err) {
    logger.warn({ placeId, err: String(err) }, "places photo lookup failed; falling back");
    value = null;
  }

  cache.set(placeId, { value, expiresAt: Date.now() + TTL_MS });
  return value;
}
