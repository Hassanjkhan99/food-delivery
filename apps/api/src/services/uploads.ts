// Presign -> client PUT -> finalize. MIME allowlist + per-kind size caps
// (10 MB images, 25 MB documents — compliance-project limits).
import { randomUUID } from "node:crypto";
import { prisma } from "@fd/db";
import { GraphQLError } from "graphql";
import { z } from "zod";
import { objectStore } from "./storage/store.js";

const KIND_RULES = {
  image: {
    mimes: ["image/jpeg", "image/png", "image/webp"],
    maxBytes: 10 * 1024 * 1024,
  },
  document: {
    mimes: ["application/pdf"],
    maxBytes: 25 * 1024 * 1024,
  },
  csv: {
    mimes: ["text/csv", "application/vnd.ms-excel", "text/plain"],
    maxBytes: 2 * 1024 * 1024,
  },
} as const;

export type UploadKind = keyof typeof KIND_RULES;

const presignSchema = z.object({
  contentType: z.string().min(3).max(100),
  byteSize: z.number().int().positive(),
  kind: z.enum(["image", "document", "csv"]),
  // Sensitive uploads (KYC/CNIC scans, rider verification docs) opt into a `private/`
  // key prefix so reads are served via short-lived signed URLs, not the public path (#119).
  private: z.boolean().optional(),
});

export async function presignUpload(
  userId: string,
  input: { contentType: string; byteSize: number; kind: string; private?: boolean },
) {
  const parsed = presignSchema.parse(input);
  const rules = KIND_RULES[parsed.kind];
  if (!rules.mimes.includes(parsed.contentType as never)) {
    throw new GraphQLError(`That file type isn't supported for ${parsed.kind} uploads.`, {
      extensions: { code: "validation_error" },
    });
  }
  if (parsed.byteSize > rules.maxBytes) {
    throw new GraphQLError(
      `This file is too large. The maximum size is ${Math.round(rules.maxBytes / 1024 / 1024)} MB.`,
      { extensions: { code: "limit_reached" } },
    );
  }

  const ext = parsed.contentType.split("/")[1]?.replace(/[^a-z0-9]/gi, "") ?? "bin";
  // Private assets get a `private/` prefix so objectStore can gate reads behind a signed
  // URL; public assets (menu/hero/POD photos, menu-source docs/CSV) keep the flat key (#119).
  const objectKey = parsed.private
    ? `private/${parsed.kind}/${randomUUID()}.${ext}`
    : `${parsed.kind}/${randomUUID()}.${ext}`;

  const asset = await prisma.mediaAsset.create({
    data: {
      ownerType: "user",
      ownerId: userId,
      objectKey,
      contentType: parsed.contentType,
      byteSize: parsed.byteSize,
      status: "pending",
    },
  });

  const uploadUrl = await objectStore.presignPut(objectKey, parsed.contentType, rules.maxBytes);
  return { assetId: asset.id, uploadUrl };
}

export async function finalizeUpload(userId: string, assetId: string) {
  const asset = await prisma.mediaAsset.findUnique({ where: { id: assetId } });
  if (!asset || asset.ownerId !== userId)
    throw new GraphQLError("We couldn't find that upload.", {
      extensions: { code: "not_found" },
    });
  if (asset.status === "finalized") return asset;

  const head = await objectStore.head(asset.objectKey);
  if (!head.exists)
    throw new GraphQLError("We haven't received your upload yet. Please try again in a moment.", {
      extensions: { code: "invalid_state" },
    });

  return prisma.mediaAsset.update({
    where: { id: assetId },
    data: { status: "finalized", byteSize: head.byteSize, sha256: head.sha256 },
  });
}

export function assetUrl(objectKey: string): string {
  return objectStore.publicUrl(objectKey);
}

// Read URL that respects sensitivity (#119): a `private/` key yields a short-lived signed
// URL (fresh per read), everything else uses the plain public URL. Callers serving asset
// URLs to clients should prefer this over the sync `assetUrl`.
export async function assetReadUrl(objectKey: string): Promise<string> {
  return objectKey.startsWith("private/")
    ? objectStore.signedReadUrl(objectKey)
    : objectStore.publicUrl(objectKey);
}
