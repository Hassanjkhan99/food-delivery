// Customer wallet: balance + transaction history derived from the prepaid ledger
// account (the single source of truth — no separate balance column), plus top-up via
// the existing mock payment provider. Pay-from-wallet lives in orderService/placeOrder;
// refunds-to-wallet and admin goodwill credit live in the ledger/admin domains.
import { prisma } from "@fd/db";
import { GraphQLError } from "graphql";
import { z } from "zod";
import { accountBalance, onWalletToppedUp } from "../services/ledgerService.js";
import { mockProvider } from "../services/payments/mockProvider.js";
import { builder } from "./builder.js";

// Top-up bounds (minor units): Rs 100 – Rs 100,000. Keeps a fat-fingered client from
// booking an absurd charge; the real ceiling is a business/risk decision.
const MIN_TOPUP_MINOR = 10_000;
const MAX_TOPUP_MINOR = 10_000_000;

const topUpSchema = z.object({
  amountMinor: z
    .number()
    .int()
    .min(MIN_TOPUP_MINOR, `Enter at least Rs ${MIN_TOPUP_MINOR / 100}.`)
    .max(MAX_TOPUP_MINOR, `You can top up at most Rs ${(MAX_TOPUP_MINOR / 100).toLocaleString()}.`),
  paymentMethodId: z.string().min(1, "Choose a payment method."),
  idempotencyKey: z.string().min(8, "Missing idempotency key.").max(200),
});

// One ledger movement on the prepaid account, presented as a signed wallet entry.
type WalletTxn = {
  id: string;
  amountMinor: number; // +credit (money in) / -debit (money out)
  memo: string;
  createdAt: Date;
};

const WalletTxnType = builder.objectRef<WalletTxn>("WalletTxn");
WalletTxnType.implement({
  fields: (t) => ({
    id: t.exposeID("id"),
    amountMinor: t.exposeInt("amountMinor"),
    memo: t.exposeString("memo"),
    createdAt: t.field({ type: "DateTime", resolve: (e) => e.createdAt }),
  }),
});

type Wallet = { balanceMinor: number; transactions: WalletTxn[] };

const WalletType = builder.objectRef<Wallet>("Wallet");
WalletType.implement({
  fields: (t) => ({
    balanceMinor: t.exposeInt("balanceMinor"),
    transactions: t.field({ type: [WalletTxnType], resolve: (w) => w.transactions }),
  }),
});

async function loadWallet(customerId: string): Promise<Wallet> {
  const code = `customer:${customerId}:prepaid`;
  const account = await prisma.ledgerAccount.findUnique({ where: { code } });
  if (!account) return { balanceMinor: 0, transactions: [] };
  const entries = await prisma.ledgerEntry.findMany({
    where: { accountId: account.id },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  const balanceMinor = await accountBalance(prisma, code);
  const transactions = entries.map((e) => ({
    id: e.id,
    amountMinor: e.creditMinor - e.debitMinor,
    memo: e.memo,
    createdAt: e.createdAt,
  }));
  return { balanceMinor, transactions };
}

builder.queryFields((t) => ({
  myWallet: t.field({
    type: WalletType,
    authScopes: { loggedIn: true },
    resolve: (_root, _args, ctx) => loadWallet(ctx.userId!),
  }),
}));

builder.mutationFields((t) => ({
  // Charge a saved card via the provider and credit the wallet. On decline the balance
  // is untouched. Mirrors an order charge: real cash in, prepaid balance up.
  topUpWallet: t.field({
    type: WalletType,
    authScopes: { loggedIn: true },
    args: {
      amountMinor: t.arg.int({ required: true }),
      paymentMethodId: t.arg.string({ required: true }),
      // Stable per-attempt key so a retry / double-submit is idempotent (Codex #116).
      idempotencyKey: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      const customerId = ctx.userId!;
      const { amountMinor, paymentMethodId, idempotencyKey } = topUpSchema.parse(args);

      // Claim the idempotency key FIRST — before the card lookup and the charge (#116/#208).
      // The UNIQUE constraint is the race arbiter: a retry / double-submit loses here and
      // returns the wallet unchanged instead of charging + crediting a second time. Doing
      // this before the card lookup means a genuine replay still succeeds even if the saved
      // card was since removed (the replay must not fail on card lookup).
      try {
        await prisma.walletTopUp.create({
          data: { idempotencyKey, userId: customerId, amountMinor, status: "pending" },
        });
      } catch (e) {
        if ((e as { code?: string }).code === "P2002") {
          // Same key already claimed — replay the ORIGINAL attempt's outcome (#208):
          const prior = await prisma.walletTopUp.findUnique({ where: { idempotencyKey } });
          // Confirm it's THIS user's attempt (the key is client-supplied) — a cross-user
          // collision must not be treated as this user's top-up.
          if (prior && prior.userId !== customerId)
            throw new GraphQLError("This looks like a duplicate request — please try again.", {
              extensions: { code: "idempotency_key_conflict" },
            });
          // A prior FAILED attempt must not report success on retry — the card was never
          // charged and nothing was credited. Surface the failure so the client retries
          // (with a fresh key), mirroring the original attempt's error.
          if (prior?.status === "failed")
            throw new GraphQLError("That top-up didn't go through — please try again.", {
              extensions: { code: "topup_failed" },
            });
          // pending (in-flight) or completed → the current wallet reflects the outcome.
          return loadWallet(customerId);
        }
        throw e;
      }

      const method = await prisma.paymentMethod.findUnique({ where: { id: paymentMethodId } });
      if (!method || method.userId !== customerId) {
        // Mark the claim failed (don't DELETE it): deleting would let a concurrent duplicate
        // that already lost the P2002 race find no row and wrongly report a completed replay.
        // A terminal `failed` row keeps the key resolved — the customer retries with a new key,
        // exactly like a declined charge below. (Codex #208)
        await prisma.walletTopUp.update({
          where: { idempotencyKey },
          data: { status: "failed" },
        });
        throw new GraphQLError("We couldn't find that card.", {
          extensions: { code: "payment_method_not_found" },
        });
      }

      const result = await mockProvider.charge({
        token: method.providerToken,
        // Reference is derived from the idempotency key so the provider side is
        // deterministic across retries too.
        reference: `topup_${idempotencyKey}`,
        amountMinor,
      });
      if (!result.ok) {
        await prisma.walletTopUp.update({
          where: { idempotencyKey },
          data: { status: "failed" },
        });
        throw new GraphQLError(result.declineReason, {
          extensions: { code: "payment_declined" },
        });
      }

      await prisma.$transaction(async (tx) => {
        await onWalletToppedUp(tx, customerId, amountMinor);
        await tx.walletTopUp.update({
          where: { idempotencyKey },
          data: { status: "completed", providerRef: result.providerRef },
        });
      });
      return loadWallet(customerId);
    },
  }),
}));
