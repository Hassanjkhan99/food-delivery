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
    const token = await new SignJWT({ objectKey, contentType, byteSizeLimit })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("15m")
      .sign(secret());
    return `http://localhost:${env.apiPort}/uploads?token=${encodeURIComponent(token)}`;
  },

  publicUrl(objectKey) {
    return `http://localhost:${env.apiPort}/files/${objectKey}`;
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
    const { payload } = await jwtVerify(token, secret());
    claims = payload as never;
  } catch {
    return new Response("Invalid or expired upload token", { status: 401 });
  }
  const body = Buffer.from(await req.arrayBuffer());
  if (body.byteLength === 0) return new Response("Empty body", { status: 400 });
  if (body.byteLength > claims.byteSizeLimit) return new Response("Too large", { status: 413 });
  const path = diskPath(claims.objectKey);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, body);
  return new Response(null, { status: 200 });
}

export function handleLocalFileGet(req: Request): Response {
  const url = new URL(req.url);
  const objectKey = decodeURIComponent(url.pathname.replace(/^\/files\//, ""));
  let path: string;
  try {
    path = diskPath(objectKey);
  } catch {
    return new Response("Bad key", { status: 400 });
  }
  if (!existsSync(path)) return new Response("Not found", { status: 404 });
  const stream = createReadStream(path);
  return new Response(stream as never, {
    status: 200,
    headers: { "cache-control": "public, max-age=3600" },
  });
}
