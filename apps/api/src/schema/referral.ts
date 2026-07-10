// Referrals (#58): the caller's share code + invite stats, and the apply mutation.
import { prisma } from "@fd/db";
import { z } from "zod";
import { accountBalance } from "../services/ledgerService.js";
import { applyReferralCode, getOrCreateReferralCode } from "../services/referralService.js";
import { builder } from "./builder.js";

const codeInputSchema = z.object({ code: z.string().min(4).max(16) });

type ReferralSummaryShape = {
  code: string;
  invited: number;
  qualified: number;
  earnedMinor: number;
  walletBalanceMinor: number;
};

/** Compute the caller's live referral summary (shared by the query + mutation). */
async function getReferralSummary(userId: string): Promise<ReferralSummaryShape> {
  const code = await getOrCreateReferralCode(userId);
  const made = await prisma.referral.findMany({ where: { referrerId: userId } });
  const qualified = made.filter((r) => r.status === "qualified");
  const earnedMinor = qualified.reduce((s, r) => s + r.referrerRewardMinor, 0);
  const walletBalanceMinor = await accountBalance(prisma, `customer:${userId}:prepaid`);
  return {
    code,
    invited: made.length,
    qualified: qualified.length,
    earnedMinor,
    walletBalanceMinor,
  };
}

const ReferralSummaryType = builder.objectRef<ReferralSummaryShape>("ReferralSummary");
ReferralSummaryType.implement({
  fields: (t) => ({
    // The caller's personal share code (minted on first read).
    code: t.exposeString("code"),
    // Friends who applied this code.
    invited: t.exposeInt("invited"),
    // Friends whose first order qualified (both sides paid).
    qualified: t.exposeInt("qualified"),
    // Total the caller has earned from referrals, in minor units.
    earnedMinor: t.exposeInt("earnedMinor"),
    // Current customer-wallet balance in minor units (credit from referrals lands here).
    walletBalanceMinor: t.exposeInt("walletBalanceMinor"),
  }),
});

builder.queryFields((t) => ({
  myReferral: t.field({
    type: ReferralSummaryType,
    authScopes: { loggedIn: true },
    resolve: async (_root, _args, ctx) => getReferralSummary(ctx.userId!),
  }),
}));

builder.mutationFields((t) => ({
  applyReferralCode: t.field({
    type: ReferralSummaryType,
    authScopes: { loggedIn: true },
    args: { code: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      const userId = ctx.userId!;
      const { code } = codeInputSchema.parse({ code: args.code });
      await applyReferralCode(userId, code);
      // Return the caller's own live summary so the UI refreshes in one round-trip
      // (a user may already have made invites of their own before applying a code).
      return getReferralSummary(userId);
    },
  }),
}));
