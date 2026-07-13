// Offer-expiry sweeper (#168). Reclaims delivery offers/tasks stuck in `offered` when a
// rider never responds (app closed / offline), so the restaurant's board doesn't wait on a
// dead offer. Same serverless-cron shape as expire-orders: drive it with an external pinger
// every minute (see DEPLOY.md); Vercel Cron is only a daily backstop on the Hobby plan.
// Auth: `Authorization: Bearer $CRON_SECRET` or `?secret=$CRON_SECRET`; open if unset (dev).
import { sweepExpiredOffers } from "@fd/api";

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
  const result = await sweepExpiredOffers();
  return Response.json({ ok: true, ...result });
}
