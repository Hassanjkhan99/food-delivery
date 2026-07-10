// Gift cards (FP-10). Purchase charges a saved card via the mock provider and mints
// a shareable code; redemption credits the full remaining balance into the redeemer's
// wallet (WalletTransaction). Wallet balance = SUM(walletTransaction.amountMinor).
//
// v1 founder-style calls (see PR body):
//   - Redemption is all-or-nothing: the whole remaining balance moves to the wallet.
//   - Fixed denominations enforced server-side; purchase paid by a saved card only.
//   - Codes are human-shareable (XXXX-XXXX-XXXX). "Send to recipient" captures an
//     email + message but nothing is actually emailed in the mock.
import { randomBytes } from "node:crypto";
import { prisma } from "@fd/db";
import { GraphQLError } from "graphql";
import { z } from "zod";
import { mockProvider } from "../services/payments/mockProvider.js";
import { builder } from "./builder.js";

// Allowed face values in minor units (Rs 500 / 1000 / 2000 / 5000).
const ALLOWED_AMOUNTS_MINOR = [50_000, 100_000, 200_000, 500_000];

const purchaseSchema = z.object({
  amountMinor: z.number().int().refine((v) => ALLOWED_AMOUNTS_MINOR.includes(v), {
    message: "Unsupported gift card amount",
  }),
  paymentMethodId: z.string().min(1),
  recipientEmail: z.string().email().max(200).optional(),
  message: z.string().max(280).optional(),
  idempotencyKey: z.string().min(1).max(200),
});

// Human-friendly code: 12 base32-ish chars grouped as XXXX-XXXX-XXXX.
function generateCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous 0/O/1/I
  const bytes = randomBytes(12);
  let raw = "";
  for (let i = 0; i < 12; i++) raw += alphabet[bytes[i]! % alphabet.length];
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}

builder.prismaObject("GiftCard", {
  fields: (t) => ({
    id: t.exposeID("id"),
    code: t.exposeString("code"),
    amountMinor: t.exposeInt("amountMinor"),
    balanceMinor: t.exposeInt("balanceMinor"),
    status: t.exposeString("status"),
    recipientEmail: t.exposeString("recipientEmail", { nullable: true }),
    message: t.exposeString("message", { nullable: true }),
    redeemedAt: t.expose("redeemedAt", { type: "DateTime", nullable: true }),
    createdAt: t.expose("createdAt", { type: "DateTime" }),
  }),
});

builder.prismaObject("WalletTransaction", {
  fields: (t) => ({
    id: t.exposeID("id"),
    amountMinor: t.exposeInt("amountMinor"),
    kind: t.exposeString("kind"),
    memo: t.exposeString("memo", { nullable: true }),
    createdAt: t.expose("createdAt", { type: "DateTime" }),
  }),
});

// Wallet balance summary returned by the gift-card redeem flow. Distinct typename from
// the canonical `Wallet` (wallet.ts, #55) to avoid a duplicate-typename clash — the
// redeem mutation just needs to echo the resulting balance.
type WalletSummary = { balanceMinor: number };
const WalletBalanceType = builder.objectRef<WalletSummary>("GiftCardWalletBalance");
WalletBalanceType.implement({
  fields: (t) => ({
    balanceMinor: t.exposeInt("balanceMinor"),
  }),
});

async function walletBalanceMinor(userId: string): Promise<number> {
  const agg = await prisma.walletTransaction.aggregate({
    where: { userId },
    _sum: { amountMinor: true },
  });
  return agg._sum.amountMinor ?? 0;
}

builder.queryFields((t) => ({
  // Note: the canonical `myWallet` query lives in wallet.ts (#55, ledger-backed). This
  // module only adds the WalletTransaction history + the gift-card flows below.
  myWalletTransactions: t.prismaField({
    type: ["WalletTransaction"],
    authScopes: { loggedIn: true },
    resolve: (query, _root, _args, ctx) =>
      prisma.walletTransaction.findMany({
        ...query,
        where: { userId: ctx.userId! },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
  }),

  myGiftCards: t.prismaField({
    type: ["GiftCard"],
    authScopes: { loggedIn: true },
    // Hide pending rows (charge not yet confirmed) and voided/abandoned attempts.
    resolve: (query, _root, _args, ctx) =>
      prisma.giftCard.findMany({
        ...query,
        where: { purchaserId: ctx.userId!, status: { in: ["active", "redeemed"] } },
        orderBy: { createdAt: "desc" },
      }),
  }),

  // Preview a code before redeeming (does not mutate). Returns null if unusable.
  giftCardByCode: t.prismaField({
    type: "GiftCard",
    nullable: true,
    authScopes: { loggedIn: true },
    args: { code: t.arg.string({ required: true }) },
    resolve: (query, _root, args) =>
      prisma.giftCard.findFirst({
        ...query,
        where: { code: normalizeCode(args.code), status: "active" },
      }),
  }),
}));

function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

const PurchaseInput = builder.inputType("GiftCardPurchaseInput", {
  fields: (t) => ({
    amountMinor: t.int({ required: true }),
    paymentMethodId: t.string({ required: true }),
    recipientEmail: t.string({ required: false }),
    message: t.string({ required: false }),
    // Stable client key so a timed-out retry returns the first card instead of
    // minting/charging a second one (mirrors placeOrder).
    idempotencyKey: t.string({ required: true }),
  }),
});

builder.mutationFields((t) => ({
  purchaseGiftCard: t.prismaField({
    type: "GiftCard",
    authScopes: { loggedIn: true },
    args: { input: t.arg({ type: PurchaseInput, required: true }) },
    resolve: async (query, _root, args, ctx) => {
      const input = purchaseSchema.parse({
        amountMinor: args.input.amountMinor,
        paymentMethodId: args.input.paymentMethodId,
        recipientEmail: args.input.recipientEmail ?? undefined,
        message: args.input.message ?? undefined,
        idempotencyKey: args.input.idempotencyKey,
      });
      const userId = ctx.userId!;

      // Idempotent replay: a completed purchase for this key returns its card.
      // A row still `pending` (a charge that never confirmed) is treated as
      // unresolved rather than double-charged.
      const existing = await prisma.giftCard.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
      });
      if (existing) {
        if (existing.purchaserId !== userId) {
          throw new GraphQLError("Idempotency key conflict");
        }
        if (existing.status === "pending") {
          throw new GraphQLError("A previous purchase is still being processed");
        }
        if (existing.status === "void") {
          throw new GraphQLError("The previous purchase failed; use a new request");
        }
        return prisma.giftCard.findUniqueOrThrow({ ...query, where: { id: existing.id } });
      }

      const method = await prisma.paymentMethod.findUnique({
        where: { id: input.paymentMethodId },
      });
      if (!method || method.userId !== userId) {
        throw new GraphQLError("Payment method not found");
      }

      // Persist a durable pending row FIRST. Its unique idempotencyKey is the race
      // arbiter (like placeOrder): a duplicate submit can never double-charge, and
      // a card is always recoverable from the charge reference.
      const code = generateCode();
      let card;
      try {
        card = await prisma.giftCard.create({
          data: {
            code,
            amountMinor: input.amountMinor,
            balanceMinor: input.amountMinor,
            status: "pending",
            purchaserId: userId,
            recipientEmail: input.recipientEmail ?? null,
            message: input.message ?? null,
            idempotencyKey: input.idempotencyKey,
          },
        });
      } catch (e) {
        // Concurrent duplicate won the unique(idempotencyKey) race.
        if ((e as { code?: string }).code === "P2002") {
          throw new GraphQLError("A previous purchase is still being processed");
        }
        throw e;
      }

      const charge = await mockProvider.charge({
        token: method.providerToken,
        amountMinor: input.amountMinor,
        reference: `gift_${code}`,
      });
      if (!charge.ok) {
        // Void the pending row so the balance is never redeemable; the unique key
        // stays claimed so a blind retry surfaces the failure rather than recharging.
        await prisma.giftCard.update({
          where: { id: card.id },
          data: { status: "void", balanceMinor: 0 },
        });
        throw new GraphQLError(charge.declineReason);
      }

      return prisma.giftCard.update({
        ...query,
        where: { id: card.id },
        data: { status: "active", providerRef: charge.providerRef },
      });
    },
  }),

  // Redeem a code: move the whole remaining balance into the caller's wallet.
  // A conditional updateMany on status guards against double-redeem races.
  redeemGiftCard: t.field({
    type: WalletBalanceType,
    authScopes: { loggedIn: true },
    args: { code: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      const userId = ctx.userId!;
      const code = normalizeCode(args.code);

      await prisma.$transaction(async (tx) => {
        const card = await tx.giftCard.findUnique({ where: { code } });
        if (!card) throw new GraphQLError("Gift card not found");
        if (card.status !== "active" || card.balanceMinor <= 0) {
          throw new GraphQLError("Gift card already redeemed or inactive");
        }

        // Atomic claim: only the row still `active` transitions to redeemed.
        const claimed = await tx.giftCard.updateMany({
          where: { code, status: "active" },
          data: {
            status: "redeemed",
            balanceMinor: 0,
            redeemedById: userId,
            redeemedAt: new Date(),
          },
        });
        if (claimed.count !== 1) {
          throw new GraphQLError("Gift card already redeemed or inactive");
        }

        await tx.walletTransaction.create({
          data: {
            userId,
            amountMinor: card.balanceMinor,
            kind: "gift_card_redeem",
            giftCardId: card.id,
            memo: `Gift card ${card.code}`,
          },
        });
      });

      return { balanceMinor: await walletBalanceMinor(userId) };
    },
  }),
}));
