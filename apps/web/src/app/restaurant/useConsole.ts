"use client";

// Console context: the operator's first restaurant + branch (single-branch MVP).
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
      branches {
        id
        name
        isAcceptingOrders
        minOrderMinor
        deliveryFeeMinor
        deliveryRadiusM
      }
    }
  }
`);

export function useConsole() {
  const [{ data, fetching }, refetch] = useQuery({
    query: MyRestaurantsQuery,
    requestPolicy: "cache-and-network",
  });
  const restaurant = data?.myRestaurants?.[0] ?? null;
  const branch = restaurant?.branches?.[0] ?? null;
  return { restaurant, branch, fetching, refetch };
}
