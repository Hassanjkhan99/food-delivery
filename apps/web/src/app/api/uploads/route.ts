// Direct-PUT target for presigned uploads (local-disk object-store adapter). The client
// PUTs raw bytes here with a short-lived token; the handler validates the token and writes
// to STORAGE_DIR. On Vercel the only writable path is /tmp, which is ephemeral — set
// STORAGE_DIR=/tmp/storage there and expect uploads to vanish on redeploy. Swap in
// S3/R2 (the ObjectStore seam) for durable storage. See DEPLOY.md.
import { handleLocalUploadPut } from "@fd/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PUT(request: Request): Promise<Response> {
  return handleLocalUploadPut(request);
}
