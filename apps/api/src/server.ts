import "./env.js";
import { createServer } from "node:http";
import { createYoga } from "graphql-yoga";
import { useCookies } from "@whatwg-node/server-plugin-cookies";
import { env } from "./env.js";
import { buildContext } from "./context.js";
import { schema } from "./schema/index.js";
import { startExpirySweeper } from "./jobs/expirePendingOrders.js";
import { startRiderTrustJob } from "./jobs/recomputeRiderTrust.js";

const yoga = createYoga({
  schema,
  context: buildContext,
  graphqlEndpoint: "/graphql",
  plugins: [useCookies()],
  cors: {
    origin: [env.webOrigin],
    credentials: true,
  },
});

const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": env.webOrigin,
  "access-control-allow-methods": "GET, PUT, OPTIONS",
  "access-control-allow-headers": "content-type",
};

// Local-disk object store routes (dev adapter): direct client PUT + public GET.
// A real S3/MinIO deployment replaces these with the bucket's own endpoints.
const server = createServer(async (req, res) => {
  const url = req.url ?? "/";
  if (url.startsWith("/api/uploads") || url.startsWith("/files/")) {
    const { handleLocalUploadPut, handleLocalFileGet } =
      await import("./services/storage/objectStore.js");
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const request = new Request(`http://localhost:${env.apiPort}${url}`, {
      method: req.method,
      body: ["PUT", "POST"].includes(req.method ?? "")
        ? new Uint8Array(Buffer.concat(chunks))
        : undefined,
    });
    const response =
      req.method === "OPTIONS"
        ? new Response(null, { status: 204 })
        : req.method === "PUT" && url.startsWith("/api/uploads")
          ? await handleLocalUploadPut(request)
          : req.method === "GET" && url.startsWith("/files/")
            ? handleLocalFileGet(request)
            : new Response("Method not allowed", { status: 405 });
    res.writeHead(response.status, { ...CORS_HEADERS, ...Object.fromEntries(response.headers) });
    if (response.body) {
      const buf = Buffer.from(await response.arrayBuffer());
      res.end(buf);
    } else {
      res.end();
    }
    return;
  }
  return yoga(req, res);
});

server.listen(env.apiPort, () => {
  console.log(`[api] GraphQL Yoga listening on http://localhost:${env.apiPort}/graphql`);
});

startExpirySweeper();
startRiderTrustJob();
