"use client";

import { Client, Provider, cacheExchange, fetchExchange, subscriptionExchange } from "urql";
import { createClient as createSSEClient } from "graphql-sse";
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

// Same-origin by default now that the GraphQL server is mounted inside this app at
// /api/graphql. A relative URL keeps the session cookie first-party in every environment
// (local, preview, prod) with no CORS. Override with NEXT_PUBLIC_API_URL only to point at a
// standalone API (e.g. http://localhost:4000/graphql).
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "/api/graphql";

export function makeClient() {
  // Subscriptions ride the graphql-sse protocol on the SAME endpoint; the session cookie
  // flows because it's first-party same-origin.
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
              unsubscribe: sse.subscribe({ ...operation, query: operation.query ?? "" }, sink),
            }),
          };
        },
      }),
    ],
    fetchOptions: { credentials: "include" },
  });
}

/**
 * Lets any client component drop the urql cache — the document cache has no public
 * `reset()`, so we swap in a fresh Client (new empty cache) instead. Call this on
 * logout so a cached `myOrders`/`viewer` can't render the previous customer's data on
 * a shared browser. — #36 review.
 */
const ResetClientContext = createContext<() => void>(() => {});

export function useResetGraphQLClient() {
  return useContext(ResetClientContext);
}

export function GraphQLProvider({ children }: { children: ReactNode }) {
  // Hold the Client in state; resetting swaps in a fresh one (new empty cache) which
  // remounts subscribers so auth-derived queries re-run against the clean cache.
  const [client, setClient] = useState(makeClient);
  const reset = useCallback(() => setClient(makeClient()), []);
  return (
    <ResetClientContext.Provider value={reset}>
      <Provider value={client}>{children}</Provider>
    </ResetClientContext.Provider>
  );
}
