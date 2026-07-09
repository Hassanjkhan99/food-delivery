// Server-authoritative cart pricing. The client never sends prices — only item ids,
// modifier option ids, and quantities. Everything money is recomputed here.
import { prisma } from "@fd/db";
import {
  applyBps,
  haversineMeters,
  resolveLoyaltyRedemption,
  type QuoteInput,
} from "@fd/shared";
import { GraphQLError } from "graphql";

export type ResolvedLine = {
  menuItemId: string;
  name: string;
  qty: number;
  unitPriceMinor: number; // base + selected modifier deltas
  lineTotalMinor: number;
  notes?: string;
  modifiers: Array<{
    groupName: string;
    optionId: string;
    optionName: string;
    priceDeltaMinor: number;
  }>;
};

export type QuoteResult = {
  branchId: string;
  subtotalMinor: number;
  deliveryFeeMinor: number;
  taxTotalMinor: number;
  platformFeeMinor: number;
  commissionMinor: number;
  commissionBps: number;
  tipAmount: number;
  // Loyalty redemption resolved server-side (FP-07). loyaltyDiscountMinor is subtracted
  // from grandTotalMinor; loyaltyPointsRedeemed is what will actually be spent. Both 0
  // when nothing is redeemed. pointsBalance is the caller's current balance (for UI).
  loyaltyPointsRedeemed: number;
  loyaltyDiscountMinor: number;
  loyaltyPointsBalance: number;
  grandTotalMinor: number;
  minOrderMinor: number;
  meetsMinimum: boolean;
  inRadius: boolean;
  distanceM: number;
  lines: ResolvedLine[];
};

// customerId is optional: anonymous quote requests (pre-login) still price the cart but
// can't redeem points. When present we look up the loyalty balance and clamp redemption.
export async function quoteCart(input: QuoteInput, customerId?: string | null): Promise<QuoteResult> {
  const branch = await prisma.branch.findUnique({
    where: { id: input.branchId },
    include: { restaurant: true, taxProfile: true },
  });
  if (!branch || branch.restaurant.status !== "approved") {
    throw new GraphQLError("Restaurant not available");
  }
  if (!branch.isAcceptingOrders) {
    throw new GraphQLError("Restaurant is not accepting orders right now");
  }
  if (!branch.activeMenuId) {
    throw new GraphQLError("Restaurant has no published menu");
  }

  const distanceM = haversineMeters(
    Number(branch.lat),
    Number(branch.lng),
    input.deliveryLat,
    input.deliveryLng,
  );
  const inRadius = distanceM <= branch.deliveryRadiusM;

  // Resolve items against the ACTIVE menu only (stale carts re-priced or rejected).
  const items = await prisma.menuItem.findMany({
    where: {
      id: { in: input.lines.map((l) => l.menuItemId) },
      category: { menuId: branch.activeMenuId },
    },
    include: {
      modGroups: { include: { group: { include: { options: true } } } },
    },
  });
  const byId = new Map(items.map((i) => [i.id, i]));

  const lines: ResolvedLine[] = input.lines.map((line) => {
    const item = byId.get(line.menuItemId);
    if (!item) throw new GraphQLError(`Item no longer on the menu`);
    if (!item.isAvailable) throw new GraphQLError(`'${item.name}' is currently unavailable`);

    const selected = new Set(line.modifierOptionIds);
    const modifiers: ResolvedLine["modifiers"] = [];
    let delta = 0;

    for (const { group } of item.modGroups) {
      const chosen = group.options.filter((o) => selected.has(o.id));
      if (chosen.length < group.minSelect || chosen.length > group.maxSelect) {
        throw new GraphQLError(
          `'${item.name}': choose between ${group.minSelect} and ${group.maxSelect} of '${group.name}'`,
        );
      }
      for (const opt of chosen) {
        if (!opt.isAvailable) throw new GraphQLError(`Option '${opt.name}' is unavailable`);
        delta += opt.priceDeltaMinor;
        modifiers.push({
          groupName: group.name,
          optionId: opt.id,
          optionName: opt.name,
          priceDeltaMinor: opt.priceDeltaMinor,
        });
      }
      // Drop consumed options so leftovers below are truly unknown.
      chosen.forEach((o) => selected.delete(o.id));
    }
    if (selected.size > 0) {
      throw new GraphQLError(`'${item.name}': unknown modifier option selected`);
    }

    const unit = item.priceMinor + delta;
    return {
      menuItemId: item.id,
      name: item.name,
      qty: line.qty,
      unitPriceMinor: unit,
      lineTotalMinor: unit * line.qty,
      notes: line.notes,
      modifiers,
    };
  });

  const subtotal = lines.reduce((s, l) => s + l.lineTotalMinor, 0);
  const tax = applyBps(subtotal, branch.taxProfile.rateBps);

  const fee = await prisma.feeConfig.findFirst({ orderBy: { createdAt: "desc" } });
  if (!fee) throw new GraphQLError("Platform fees are not configured");
  const isChain = branch.restaurant.tier === "chain";
  const commissionBps = isChain ? fee.chainCommissionBps : fee.smallBusinessCommissionBps;
  const platformFee = isChain ? fee.chainPlatformFeeMinor : fee.smallBusinessPlatformFeeMinor;
  const commission = applyBps(subtotal, commissionBps);
  // Rider tip is added on top of the bill; it isn't taxed or commissioned.
  const tipAmount = input.tipAmount ?? 0;

  // Loyalty redemption (FP-07). Points can only offset the subtotal — fees, tax, and
  // tip stay fully owed — so the restaurant/rider are never shortchanged by a discount.
  let loyaltyPointsBalance = 0;
  let loyaltyPointsRedeemed = 0;
  let loyaltyDiscountMinor = 0;
  const requestedRedeem = input.redeemPoints ?? 0;
  if (customerId) {
    const acct = await prisma.loyaltyAccount.findUnique({ where: { userId: customerId } });
    loyaltyPointsBalance = acct?.pointsBalance ?? 0;
    if (requestedRedeem > 0) {
      const r = resolveLoyaltyRedemption(requestedRedeem, loyaltyPointsBalance, subtotal);
      loyaltyPointsRedeemed = r.points;
      loyaltyDiscountMinor = r.discountMinor;
    }
  }

  const grandTotalMinor =
    subtotal + tax + branch.deliveryFeeMinor + platformFee + tipAmount - loyaltyDiscountMinor;

  return {
    branchId: branch.id,
    subtotalMinor: subtotal,
    deliveryFeeMinor: branch.deliveryFeeMinor,
    taxTotalMinor: tax,
    platformFeeMinor: platformFee,
    commissionMinor: commission,
    commissionBps,
    tipAmount,
    loyaltyPointsRedeemed,
    loyaltyDiscountMinor,
    loyaltyPointsBalance,
    grandTotalMinor,
    minOrderMinor: branch.minOrderMinor,
    meetsMinimum: subtotal >= branch.minOrderMinor,
    inRadius,
    distanceM,
    lines,
  };
}
