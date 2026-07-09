import "./env.js";
import { createServer } from "node:http";
import { createYoga, createSchema } from "graphql-yoga";
import { env } from "./env.js";

// M0 bootstrap schema — replaced by the Pothos schema in M2.
const schema = createSchema({
  typeDefs: /* GraphQL */ `
    type Query {
      hello: String!
    }
  `,
  resolvers: {
    Query: {
      hello: () => "Food Delivery API is up",
    },
  },
});

const yoga = createYoga({
  schema,
  graphqlEndpoint: "/graphql",
  cors: {
    origin: [env.webOrigin],
    credentials: true,
  },
});

const server = createServer(yoga);

server.listen(env.apiPort, () => {
  console.log(`[api] GraphQL Yoga listening on http://localhost:${env.apiPort}/graphql`);
});
