"use client";

import { Client, Provider, cacheExchange, fetchExchange, subscriptionExchange } from "urql";
import { createClient as createSSEClient } from "graphql-sse";
import { useMemo, type ReactNode } from "react";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/graphql";

export function makeClient() {
  // Subscriptions ride the graphql-sse protocol on the SAME endpoint; the session
  // cookie flows because localhost:3000 -> :4000 is same-site.
  const sse = createSSEClient({
    url: API_URL,
    credentials: "include",
  });

  return new Client({
    url: API_URL,
    exchanges: [
      cacheExchange,
      fetchExchange,
      subscriptionExchange({
        forwardSubscription(operation) {
          return {
            subscribe: (sink) => ({
              unsubscribe: sse.subscribe(
                { ...operation, query: operation.query ?? "" },
                sink,
              ),
            }),
          };
        },
      }),
    ],
    fetchOptions: { credentials: "include" },
  });
}

export function GraphQLProvider({ children }: { children: ReactNode }) {
  const client = useMemo(makeClient, []);
  return <Provider value={client}>{children}</Provider>;
}
