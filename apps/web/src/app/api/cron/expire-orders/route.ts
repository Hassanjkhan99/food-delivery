// Order acceptance-SLA sweeper (was the in-process 5s interval in apps/api). On serverless
// there is no long-lived process, so this runs per-hit instead. Drive it with a scheduler:
//   - Vercel Cron (vercel.json) — but Hobby plan runs crons at most DAILY, too coarse for a
//     120s SLA, so use it only as a backstop.
//   - An external free pinger (e.g. cron-job.org) hitting this URL every minute is the real
//     driver on the free tier. See DEPLOY.md.
// Auth: Vercel Cron sends `Authorization: Bearer $CRON_SECRET`; external pingers pass
// `?secret=$CRON_SECRET`. If CRON_SECRET is unset the endpoint is open (fine for local dev).
import { sweepExpiredOrders } from "@fd/api";

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
  const expired = await sweepExpiredOrders();
  return Response.json({ ok: true, expired });
}
