// Scheduled-order promotion sweeper (#199). Promotes due scheduled ("pre-order") orders into
// the kitchen's New lane at scheduledFor − leadTime. Same serverless-cron shape as
// expire-orders / expire-offers: on serverless there is no long-lived process, so drive it with
// an external pinger every minute (see DEPLOY.md); Vercel Cron is only a daily backstop on Hobby.
// Auth: `Authorization: Bearer $CRON_SECRET` or `?secret=$CRON_SECRET`; open if unset (dev).
import { promoteScheduledOrders } from "@fd/api";

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
  const promoted = await promoteScheduledOrders();
  return Response.json({ ok: true, promoted });
}
