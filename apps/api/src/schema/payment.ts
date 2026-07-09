// Saved cards (tokenized via the payment provider — the DB never sees a PAN).
import { prisma } from "@fd/db";
import { GraphQLError } from "graphql";
import { z } from "zod";
import { mockProvider } from "../services/payments/mockProvider.js";
import { builder } from "./builder.js";

const cardInputSchema = z.object({
  number: z.string().min(13).max(23),
  expMonth: z.number().int().min(1).max(12),
  expYear: z.number().int().min(2024).max(2050),
  cvc: z.string().min(3).max(4),
  holderName: z.string().max(100).optional(),
});

builder.prismaObject("PaymentMethod", {
  fields: (t) => ({
    id: t.exposeID("id"),
    brand: t.exposeString("brand"),
    last4: t.exposeString("last4"),
    expMonth: t.exposeInt("expMonth"),
    expYear: t.exposeInt("expYear"),
    isDefault: t.exposeBoolean("isDefault"),
  }),
});

const CardInputType = builder.inputType("CardInput", {
  fields: (t) => ({
    number: t.string({ required: true }),
    expMonth: t.int({ required: true }),
    expYear: t.int({ required: true }),
    cvc: t.string({ required: true }),
    holderName: t.string({ required: false }),
  }),
});

builder.queryFields((t) => ({
  myPaymentMethods: t.prismaField({
    type: ["PaymentMethod"],
    authScopes: { loggedIn: true },
    resolve: (query, _root, _args, ctx) =>
      prisma.paymentMethod.findMany({
        ...query,
        where: { userId: ctx.userId! },
        orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
      }),
  }),
}));

builder.mutationFields((t) => ({
  addPaymentMethod: t.prismaField({
    type: "PaymentMethod",
    authScopes: { loggedIn: true },
    args: { card: t.arg({ type: CardInputType, required: true }) },
    resolve: async (_query, _root, args, ctx) => {
      const card = cardInputSchema.parse({
        ...args.card,
        holderName: args.card.holderName ?? undefined,
      });
      const tokenized = await mockProvider.tokenize(card);
      const count = await prisma.paymentMethod.count({ where: { userId: ctx.userId! } });
      return prisma.paymentMethod.create({
        data: {
          userId: ctx.userId!,
          providerToken: tokenized.token,
          brand: tokenized.brand,
          last4: tokenized.last4,
          expMonth: tokenized.expMonth,
          expYear: tokenized.expYear,
          isDefault: count === 0,
        },
      });
    },
  }),

  removePaymentMethod: t.field({
    type: "Boolean",
    authScopes: { loggedIn: true },
    args: { id: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      const method = await prisma.paymentMethod.findUnique({ where: { id: args.id } });
      if (!method || method.userId !== ctx.userId) throw new GraphQLError("Card not found");
      // Keep the row referenced by past payments intact? Payments keep methodId FK —
      // deleting would violate it, so detach then delete.
      await prisma.payment.updateMany({
        where: { paymentMethodId: args.id },
        data: { paymentMethodId: null },
      });
      await prisma.paymentMethod.delete({ where: { id: args.id } });
      return true;
    },
  }),
}));
