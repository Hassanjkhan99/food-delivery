import "./env.js";
import { createServer } from "node:http";
import { createYoga } from "graphql-yoga";
import { useCookies } from "@whatwg-node/server-plugin-cookies";
import { env } from "./env.js";
import { buildContext } from "./context.js";
import { schema } from "./schema/index.js";

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

const server = createServer(yoga);

server.listen(env.apiPort, () => {
  console.log(`[api] GraphQL Yoga listening on http://localhost:${env.apiPort}/graphql`);
});
