// Rider trust-score recompute (was the in-process hourly interval in apps/api). Coarse by
// nature, so Vercel Cron's daily Hobby cadence is acceptable here. Same auth as the
// expire-orders cron.
import { recomputeAllTrustScores } from "@fd/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const auth = request.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  const url = new URL(request.url);
  return url.searchParams.get("secret") === secret;
}

export async function GET(request: Request): Promise<Response> {
  if (!authorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const count = await recomputeAllTrustScores();
  return Response.json({ ok: true, count });
}
