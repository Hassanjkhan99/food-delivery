// Pothos schema builder: Prisma-backed types + role scopes.
// ScopeAuth must be the FIRST plugin so unauthorized resolvers never execute.
import SchemaBuilder from "@pothos/core";
import PrismaPlugin from "@pothos/plugin-prisma";
import ScopeAuthPlugin from "@pothos/plugin-scope-auth";
import { getDatamodel, prisma, type PrismaTypes } from "@fd/db";
import type { AppContext } from "../context.js";

export const builder = new SchemaBuilder<{
  PrismaTypes: PrismaTypes;
  Context: AppContext;
  AuthScopes: {
    loggedIn: boolean;
    customer: boolean;
    restaurantMember: boolean;
    rider: boolean;
    admin: boolean;
  };
  Scalars: {
    DateTime: { Input: Date; Output: Date };
    JSON: { Input: unknown; Output: unknown };
  };
  DefaultFieldNullability: false;
}>({
  plugins: [ScopeAuthPlugin, PrismaPlugin],
  defaultFieldNullability: false,
  scopeAuth: {
    authScopes: (ctx) => ({
      loggedIn: ctx.userId !== null,
      customer: ctx.hasRole("customer"),
      restaurantMember: ctx.hasRole("restaurant_owner") || ctx.hasRole("restaurant_staff"),
      rider: ctx.hasRole("rider"),
      admin: ctx.hasRole("admin"),
    }),
  },
  prisma: {
    client: prisma,
    dmmf: getDatamodel(),
    exposeDescriptions: false,
    filterConnectionTotalCount: true,
  },
});

builder.scalarType("DateTime", {
  serialize: (d) => d.toISOString(),
  parseValue: (v) => {
    const d = new Date(String(v));
    if (Number.isNaN(d.getTime())) throw new TypeError("Invalid DateTime");
    return d;
  },
});

builder.scalarType("JSON", {
  serialize: (v) => v,
  parseValue: (v) => v,
});

builder.queryType({});
builder.mutationType({});
