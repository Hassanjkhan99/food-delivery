"use client";

import { Client, Provider, cacheExchange, fetchExchange } from "urql";
import { useMemo, type ReactNode } from "react";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/graphql";

export function makeClient() {
  return new Client({
    url: API_URL,
    exchanges: [cacheExchange, fetchExchange],
    // Session cookie flows on every request (same-site localhost:3000 -> :4000).
    fetchOptions: { credentials: "include" },
  });
}

export function GraphQLProvider({ children }: { children: ReactNode }) {
  const client = useMemo(makeClient, []);
  return <Provider value={client}>{children}</Provider>;
}
