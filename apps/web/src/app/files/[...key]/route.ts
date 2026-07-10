// Public read endpoint for stored objects. handleLocalFileGet parses the object key from
// the "/files/..." pathname, so the catch-all segment just needs to live under /files.
import { handleLocalFileGet } from "@fd/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return handleLocalFileGet(request);
}
