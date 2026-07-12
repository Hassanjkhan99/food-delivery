// Presign -> client PUT -> finalize. MIME allowlist + per-kind size caps
// (10 MB images, 25 MB documents — compliance-project limits).
import { randomUUID } from "node:crypto";
import { prisma } from "@fd/db";
import { GraphQLError } from "graphql";
import { z } from "zod";
import { localDiskStore } from "./storage/objectStore.js";

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
});

export async function presignUpload(
  userId: string,
  input: { contentType: string; byteSize: number; kind: string },
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
  const objectKey = `${parsed.kind}/${randomUUID()}.${ext}`;

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

  const uploadUrl = await localDiskStore.presignPut(objectKey, parsed.contentType, rules.maxBytes);
  return { assetId: asset.id, uploadUrl };
}

export async function finalizeUpload(userId: string, assetId: string) {
  const asset = await prisma.mediaAsset.findUnique({ where: { id: assetId } });
  if (!asset || asset.ownerId !== userId)
    throw new GraphQLError("We couldn't find that upload.", {
      extensions: { code: "not_found" },
    });
  if (asset.status === "finalized") return asset;

  const head = await localDiskStore.head(asset.objectKey);
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
  return localDiskStore.publicUrl(objectKey);
}
