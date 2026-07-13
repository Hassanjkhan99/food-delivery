"use client";

// Console context: the operator's restaurant + the currently-selected branch. Multi-branch
// (#155): the query runs once in a provider at the console shell and all pages read the
// same selected branch, so a branch switcher in the sidebar re-scopes the whole console.
import { createContext, useContext, useState, type ReactNode } from "react";
import { useQuery } from "urql";
import { graphql } from "@/graphql/generated";

const MyRestaurantsQuery = graphql(`
  query MyRestaurants {
    myRestaurants {
      id
      name
      slug
      status
      tier
      cuisineTags
      branches {
        id
        name
        isAcceptingOrders
        prepBufferMinutes
        minOrderMinor
        deliveryFeeMinor
        deliveryRadiusM
      }
    }
  }
`);

function useConsoleValue() {
  const [{ data, fetching }, refetch] = useQuery({
    query: MyRestaurantsQuery,
    requestPolicy: "cache-and-network",
  });
  // Selected branch id; null until the user picks one, in which case we derive the first
  // branch as the default (no setState-in-effect — the selection is pure derivation).
  const [branchId, setBranchId] = useState<string | null>(null);
  const restaurant = data?.myRestaurants?.[0] ?? null;
  const branches = restaurant?.branches ?? [];
  const branch = branches.find((b) => b.id === branchId) ?? branches[0] ?? null;
  return {
    restaurant,
    branches,
    branch,
    branchId: branch?.id ?? null,
    setBranchId,
    fetching,
    refetch,
  };
}

type ConsoleValue = ReturnType<typeof useConsoleValue>;

const ConsoleContext = createContext<ConsoleValue | null>(null);

export function ConsoleProvider({ children }: { children: ReactNode }) {
  const value = useConsoleValue();
  return <ConsoleContext.Provider value={value}>{children}</ConsoleContext.Provider>;
}

export function useConsole(): ConsoleValue {
  const ctx = useContext(ConsoleContext);
  if (!ctx) throw new Error("useConsole must be used within ConsoleProvider");
  return ctx;
}
