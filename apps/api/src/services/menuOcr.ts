// Menu OCR import (#177): pluggable seam that turns an uploaded photo/PDF menu into
// reviewable draft rows. Real OCR needs an external provider (Google Vision / AWS
// Textract / Tesseract) — a cost + key decision not yet made — so this ships as
// SCAFFOLDING ONLY. The driver is chosen once from env (MENU_OCR_DRIVER), mirroring
// STORAGE_DRIVER / NOTIFY_* gating. Default "none" = no OCR, empty preview + a clear
// "connect an OCR provider" status; nothing is called and nothing costs money.
//
// The extracted rows reuse the CSV import's CsvRow shape on purpose: a photo/PDF preview
// feeds the exact same review UI + import pipeline as CSV, so a real provider that fills
// in `extractRows` needs ZERO new UI or import code.
import { prisma } from "@fd/db";
import { GraphQLError } from "graphql";
import { env } from "../env.js";
import type { CsvRow } from "./menuImport.js";

/** A finalized upload the provider should read (photo or PDF menu). */
export type MenuOcrAsset = {
  objectKey: string;
  contentType: string;
};

export type MenuOcrStatus = "ok" | "not_configured" | "unsupported" | "failed";

export type MenuOcrResult = {
  /** Parsed rows in the SAME shape as CSV import, ready for the review UI. */
  rows: CsvRow[];
  /** Machine-readable outcome; drives the UI banner. "ok" only when rows were extracted. */
  status: MenuOcrStatus;
  /** Human-readable, owner-facing explanation (safe to show verbatim). */
  message: string;
  /** The configured driver, for diagnostics ("none" when OCR is off). */
  driver: string;
};

/**
 * The seam a real OCR integration implements. Keep it tiny: given a finalized
 * photo/PDF asset, return draft rows shaped like CSV import. A provider is free to
 * return partial rows with per-row `error` set (same convention as CSV) so the owner
 * can fix them in the existing review grid before importing.
 */
export interface MenuOcrProvider {
  /** Stable id, e.g. "none" | "vision" | "textract" | "tesseract". */
  readonly name: string;
  /** True when the provider has everything it needs (flag on + creds present). */
  isConfigured(): boolean;
  /** Extract menu rows from the asset. Only called when isConfigured() is true. */
  extractRows(asset: MenuOcrAsset): Promise<CsvRow[]>;
}

/**
 * Default no-op provider. Never extracts anything and reports that it's unconfigured,
 * so the whole feature is a safe, free no-op until a real driver is wired up.
 */
export const noopOcrProvider: MenuOcrProvider = {
  name: "none",
  isConfigured() {
    return false;
  },
  async extractRows() {
    return [];
  },
};

/**
 * Registry of available providers. A real driver is added here and selected via
 * MENU_OCR_DRIVER. Today only the no-op stub exists — this is scaffolding (#177).
 */
const providers: Record<string, MenuOcrProvider> = {
  none: noopOcrProvider,
};

/** The active provider, chosen once from env. Unknown driver names fall back to no-op. */
export const menuOcrProvider: MenuOcrProvider = providers[env.menuOcrDriver] ?? noopOcrProvider;

/**
 * Preview a photo/PDF menu as draft rows. Owner-gating happens in the resolver; this
 * only loads + validates the asset and routes it through the active provider.
 *
 * With the default "none" driver this returns an empty preview and a friendly
 * "connect an OCR provider" status — no error, mirroring how a disabled notification
 * channel is a no-op.
 */
export async function previewMenuOcrAsset(userId: string, assetId: string): Promise<MenuOcrResult> {
  const asset = await prisma.mediaAsset.findUnique({ where: { id: assetId } });
  if (!asset || asset.ownerId !== userId)
    throw new GraphQLError("We couldn't find that file.", {
      extensions: { code: "not_found" },
    });
  if (asset.status !== "finalized")
    throw new GraphQLError(
      "This file hasn't finished uploading yet. Please try again in a moment.",
      { extensions: { code: "invalid_state" } },
    );

  const isImage = asset.contentType.startsWith("image/");
  const isPdf = asset.contentType === "application/pdf";
  if (!isImage && !isPdf)
    return {
      rows: [],
      status: "unsupported",
      message: "Automatic transcription only works on photo or PDF menus.",
      driver: menuOcrProvider.name,
    };

  const provider = menuOcrProvider;
  if (!provider.isConfigured())
    return {
      rows: [],
      status: "not_configured",
      message:
        "Automatic menu transcription isn't set up yet. Connect an OCR provider to " +
        "extract items from photo or PDF menus, or add items with CSV import in the meantime.",
      driver: provider.name,
    };

  // A real provider runs here. Failures degrade to a status instead of a hard error so
  // the owner can fall back to CSV/manual entry.
  try {
    const rows = await provider.extractRows({
      objectKey: asset.objectKey,
      contentType: asset.contentType,
    });
    return {
      rows,
      status: "ok",
      message: rows.length
        ? `Found ${rows.length} item${rows.length === 1 ? "" : "s"}. Review and edit before importing.`
        : "We couldn't read any menu items from this file. Try a clearer photo or use CSV import.",
      driver: provider.name,
    };
  } catch {
    return {
      rows: [],
      status: "failed",
      message:
        "We couldn't transcribe this menu automatically. Please try again or use CSV import.",
      driver: provider.name,
    };
  }
}
