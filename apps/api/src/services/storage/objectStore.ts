// ObjectStore seam (compliance-project pattern): the API never proxies file bodies —
// clients PUT directly to a presigned URL. Dev adapter = local disk served by this API;
// production swaps in S3/MinIO/R2 without touching the upload flow.
import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { SignJWT, jwtVerify } from "jose";
import { env } from "../../env.js";

export interface ObjectStore {
  /** URL the client PUTs the raw bytes to. */
  presignPut(objectKey: string, contentType: string, byteSizeLimit: number): Promise<string>;
  /** Public URL to read the object. */
  publicUrl(objectKey: string): string;
  /** Short-lived signed URL to read a private object (#119). */
  signedReadUrl(objectKey: string): Promise<string>;
  head(objectKey: string): Promise<{ exists: boolean; byteSize: number; sha256?: string }>;
}

const secret = () => new TextEncoder().encode(env.sessionSecret);

function diskPath(objectKey: string): string {
  const base = resolve(env.storageDir);
  const full = resolve(join(base, objectKey));
  if (!full.startsWith(base)) throw new Error("Invalid object key");
  return full;
}

export const localDiskStore: ObjectStore = {
  async presignPut(objectKey, contentType, byteSizeLimit) {
    // aud="upload" (#213): scope this token to the upload handler so a read token can't
    // be replayed to write, and vice-versa (both were signed with the same secret).
    const token = await new SignJWT({ objectKey, contentType, byteSizeLimit })
      .setProtectedHeader({ alg: "HS256" })
      .setAudience("upload")
      .setExpirationTime("15m")
      .sign(secret());
    return `${env.objectStoreBaseUrl}/api/uploads?token=${encodeURIComponent(token)}`;
  },

  publicUrl(objectKey) {
    return `${env.objectStoreBaseUrl}/files/${objectKey}`;
  },

  // Private-asset read URL (#119): a 15m HS256 token bound to this exact objectKey, which
  // handleLocalFileGet verifies before streaming a `private/` file.
  async signedReadUrl(objectKey) {
    // aud="read": distinct audience from upload tokens (#213).
    const token = await new SignJWT({ objectKey })
      .setProtectedHeader({ alg: "HS256" })
      .setAudience("read")
      .setExpirationTime("15m")
      .sign(secret());
    return `${env.objectStoreBaseUrl}/files/${objectKey}?token=${encodeURIComponent(token)}`;
  },

  async head(objectKey) {
    const path = diskPath(objectKey);
    if (!existsSync(path)) return { exists: false, byteSize: 0 };
    const s = await stat(path);
    const hash = createHash("sha256");
    await new Promise<void>((res, rej) => {
      createReadStream(path)
        .on("data", (c) => hash.update(c))
        .on("end", res)
        .on("error", rej);
    });
    return { exists: true, byteSize: s.size, sha256: hash.digest("hex") };
  },
};

/** HTTP handlers used by server.ts for the local adapter. */
export async function handleLocalUploadPut(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  if (!token) return new Response("Missing token", { status: 401 });
  let claims: { objectKey: string; contentType: string; byteSizeLimit: number };
  try {
    // audience:"upload" rejects a read-scoped token (which also lacks byteSizeLimit, so it
    // could otherwise write unbounded bytes) — #213.
    const { payload } = await jwtVerify(token, secret(), { audience: "upload" });
    claims = payload as never;
  } catch {
    return new Response("Invalid or expired upload token", { status: 401 });
  }
  // Defensive: an upload token must carry a numeric size cap.
  if (typeof claims.byteSizeLimit !== "number") {
    return new Response("Invalid upload token", { status: 401 });
  }
  const body = Buffer.from(await req.arrayBuffer());
  if (body.byteLength === 0) return new Response("Empty body", { status: 400 });
  if (body.byteLength > claims.byteSizeLimit) return new Response("Too large", { status: 413 });
  const path = diskPath(claims.objectKey);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, body);
  return new Response(null, { status: 200 });
}

export async function handleLocalFileGet(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const objectKey = decodeURIComponent(url.pathname.replace(/^\/files\//, ""));
  let path: string;
  try {
    path = diskPath(objectKey);
  } catch {
    return new Response("Bad key", { status: 400 });
  }
  // Private assets (#119): reads must present a valid signed token whose objectKey claim
  // matches the requested key. Public keys stream unauthenticated as before.
  if (objectKey.startsWith("private/")) {
    const token = url.searchParams.get("token");
    if (!token) return new Response("Missing token", { status: 401 });
    try {
      // audience:"read" rejects an upload-scoped token being replayed to read (#213).
      const { payload } = await jwtVerify(token, secret(), { audience: "read" });
      if ((payload as { objectKey?: string }).objectKey !== objectKey) {
        return new Response("Token does not match resource", { status: 401 });
      }
    } catch {
      return new Response("Invalid or expired token", { status: 401 });
    }
  }
  if (!existsSync(path)) return new Response("Not found", { status: 404 });
  const stream = createReadStream(path);
  // Private assets must not be cached by shared/browser caches (Codex #215/#213) — the
  // signed token is short-lived, but a `public` cache entry would outlive it. Public
  // assets keep the shared cache.
  const isPrivate = objectKey.startsWith("private/");
  return new Response(stream as never, {
    status: 200,
    headers: { "cache-control": isPrivate ? "private, no-store" : "public, max-age=3600" },
  });
}
