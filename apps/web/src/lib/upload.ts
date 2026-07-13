"use client";

// Presign -> direct PUT -> finalize. The GraphQL API never sees file bodies.
import type { Client } from "urql";
import { graphql } from "@/graphql/generated";

const PresignMutation = graphql(`
  mutation Presign($contentType: String!, $byteSize: Int!, $kind: String!, $private: Boolean) {
    presignUpload(contentType: $contentType, byteSize: $byteSize, kind: $kind, private: $private) {
      assetId
      uploadUrl
    }
  }
`);

const FinalizeMutation = graphql(`
  mutation Finalize($assetId: String!) {
    finalizeUpload(assetId: $assetId) {
      id
      url
      status
    }
  }
`);

export async function uploadFile(
  client: Client,
  file: File,
  kind: "image" | "document" | "csv",
  // Sensitive uploads (KYC/CNIC, rider verification docs) pass true so the asset gets a
  // private, signed-read object key instead of a world-readable public one (#119).
  isPrivate = false,
): Promise<{ assetId: string; url: string }> {
  const presign = await client
    .mutation(PresignMutation, {
      contentType: file.type || "text/csv",
      byteSize: file.size,
      kind,
      private: isPrivate,
    })
    .toPromise();
  const target = presign.data?.presignUpload;
  if (presign.error || !target) {
    throw new Error(presign.error?.graphQLErrors[0]?.message ?? "Presign failed");
  }

  const put = await fetch(target.uploadUrl, { method: "PUT", body: file });
  if (!put.ok) throw new Error(`Upload failed (${put.status})`);

  const fin = await client.mutation(FinalizeMutation, { assetId: target.assetId }).toPromise();
  const asset = fin.data?.finalizeUpload;
  if (fin.error || !asset) {
    throw new Error(fin.error?.graphQLErrors[0]?.message ?? "Finalize failed");
  }
  return { assetId: target.assetId, url: asset.url ?? "" };
}
