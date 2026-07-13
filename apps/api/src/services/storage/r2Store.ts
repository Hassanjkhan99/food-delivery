// Cloudflare R2 (S3-compatible) adapter for the ObjectStore seam (#142). Selected
// when STORAGE_DRIVER=r2. Clients PUT straight to a presigned bucket URL and read
// from the bucket's public base URL — the API never proxies bytes, so the server.ts
// /api/uploads and /files routes are unused under this driver.
//
// Note on size enforcement: presigned S3 PUT can't cap the body size the way the
// local adapter does, but presignUpload() already validates byteSize against the
// per-kind cap before we ever mint a URL, so an honest client can't exceed it and a
// dishonest one is bounded by the finalize head() check reading the real size back.
import { HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "../../env.js";
import type { ObjectStore } from "./objectStore.js";

let client: S3Client | null = null;
function s3(): S3Client {
  if (client) return client;
  const { endpoint, accessKeyId, secretAccessKey } = env.r2;
  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "STORAGE_DRIVER=r2 but R2_ENDPOINT / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY are not all set",
    );
  }
  client = new S3Client({
    region: "auto", // R2 ignores region but the SDK requires one.
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
  });
  return client;
}

export const r2Store: ObjectStore = {
  async presignPut(objectKey, contentType) {
    const cmd = new PutObjectCommand({
      Bucket: env.r2.bucket,
      Key: objectKey,
      ContentType: contentType,
    });
    return getSignedUrl(s3(), cmd, { expiresIn: 15 * 60 });
  },

  publicUrl(objectKey) {
    return `${env.r2.publicBaseUrl.replace(/\/$/, "")}/${objectKey}`;
  },

  async head(objectKey) {
    try {
      const res = await s3().send(new HeadObjectCommand({ Bucket: env.r2.bucket, Key: objectKey }));
      // R2 doesn't expose a SHA-256; leave it undefined (finalizeUpload stores it as
      // null). ETag is an MD5-ish value, not comparable to our local adapter's hash.
      return { exists: true, byteSize: res.ContentLength ?? 0 };
    } catch {
      return { exists: false, byteSize: 0 };
    }
  },
};
