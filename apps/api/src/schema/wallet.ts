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
  amountMinor: z.number().int().min(MIN_TOPUP_MINOR).max(MAX_TOPUP_MINOR),
  paymentMethodId: z.string().min(1),
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
    },
    resolve: async (_root, args, ctx) => {
      const customerId = ctx.userId!;
      const { amountMinor, paymentMethodId } = topUpSchema.parse(args);

      const method = await prisma.paymentMethod.findUnique({ where: { id: paymentMethodId } });
      if (!method || method.userId !== customerId) throw new GraphQLError("Card not found");

      const result = await mockProvider.charge({
        token: method.providerToken,
        amountMinor,
        reference: `topup_${customerId}_${Date.now().toString(36)}`,
      });
      if (!result.ok) throw new GraphQLError(result.declineReason);

      await prisma.$transaction((tx) => onWalletToppedUp(tx, customerId, amountMinor));
      return loadWallet(customerId);
    },
  }),
}));
