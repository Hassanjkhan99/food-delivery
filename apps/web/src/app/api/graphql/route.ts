// GraphQL Yoga mounted as a Next.js App Router handler. This is the collapsed-deploy
// counterpart of apps/api/src/server.ts: same schema, same request context, same cookie
// handling — but served from the web app so the whole stack is a single Vercel deployment
// and the session cookie stays first-party (no cross-site cookie problem).
//
// Subscriptions (graphql-sse) work when this runs as a single process (local `next dev`).
// On Vercel's per-invocation serverless functions the in-memory pubsub is not shared across
// invocations, so live push degrades — clients fall back to query refetching. See DEPLOY.md.
import { createYoga } from "graphql-yoga";
import { useCookies } from "@whatwg-node/server-plugin-cookies";
import { schema, buildContext } from "@fd/api";

const { handleRequest } = createYoga({
  schema,
  context: buildContext,
  // Must match the file route so Yoga's landing page / GraphiQL links resolve correctly.
  graphqlEndpoint: "/api/graphql",
  // Same-origin now, so CORS is unnecessary; hand Yoga the Fetch Response Next expects.
  fetchAPI: { Response },
  plugins: [useCookies()],
});

// Wrap so the exported handlers match Next's route-handler signature (its build-time type
// checker rejects Yoga's raw handleRequest, whose 2nd arg isn't Next's RouteContext).
// buildContext only reads `request`, so an empty server context is fine.
async function handler(request: Request): Promise<Response> {
  return handleRequest(request, {});
}

export { handler as GET, handler as POST, handler as OPTIONS };

// Prisma + node builtins → Node runtime, never Edge. force-dynamic so the schema is never
// statically evaluated at build time (no DATABASE_URL during `next build`).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
