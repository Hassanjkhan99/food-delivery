// Server-authoritative cart pricing. The client never sends prices — only item ids,
// modifier option ids, and quantities. Everything money is recomputed here.
import { prisma } from "@fd/db";
import { applyBps, haversineMeters, type QuoteInput } from "@fd/shared";
import { GraphQLError } from "graphql";
import { validateVoucher, VoucherError, type AppliedVoucher } from "./voucherService.js";

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
  // Voucher discount (#52). discountMinor is subtracted from the grand total; the
  // remaining fields describe the applied voucher (or an error) for the UI. When a code
  // is supplied but invalid, voucherError carries a stable code and discountMinor is 0.
  discountMinor: number;
  voucherCode: string | null;
  voucherError: string | null;
  appliedVoucher: AppliedVoucher | null;
  grandTotalMinor: number;
  minOrderMinor: number;
  meetsMinimum: boolean;
  inRadius: boolean;
  distanceM: number;
  lines: ResolvedLine[];
};

/**
 * Server-authoritative quote. When `userId` is provided and the input carries a
 * voucherCode, the voucher is validated + priced against this cart. In the quote
 * (preview) path an invalid code is reported via voucherError rather than thrown, so a
 * bad code doesn't blow up the whole price preview; placeOrder re-validates and DOES
 * throw so an order can never be placed with a silently-dropped discount.
 */
export async function quoteCart(input: QuoteInput, userId?: string | null): Promise<QuoteResult> {
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

  // Voucher (#52): validate + price the code when one is supplied and we know the user.
  // In the preview path an invalid code surfaces as voucherError; the discount is 0.
  let discountMinor = 0;
  let voucherError: string | null = null;
  let appliedVoucher: AppliedVoucher | null = null;
  if (input.voucherCode && userId) {
    try {
      appliedVoucher = await validateVoucher(input.voucherCode, {
        userId,
        restaurantId: branch.restaurantId,
        subtotalMinor: subtotal,
        deliveryFeeMinor: branch.deliveryFeeMinor,
      });
      discountMinor = appliedVoucher.discountMinor;
    } catch (e) {
      if (e instanceof VoucherError) {
        voucherError = e.code;
      } else {
        throw e;
      }
    }
  }

  const grandTotalMinor = Math.max(
    0,
    subtotal + tax + branch.deliveryFeeMinor + platformFee + tipAmount - discountMinor,
  );

  return {
    branchId: branch.id,
    subtotalMinor: subtotal,
    deliveryFeeMinor: branch.deliveryFeeMinor,
    taxTotalMinor: tax,
    platformFeeMinor: platformFee,
    commissionMinor: commission,
    commissionBps,
    tipAmount,
    discountMinor,
    voucherCode: appliedVoucher ? appliedVoucher.voucher.code : null,
    voucherError,
    appliedVoucher,
    grandTotalMinor,
    minOrderMinor: branch.minOrderMinor,
    meetsMinimum: subtotal >= branch.minOrderMinor,
    inRadius,
    distanceM,
    lines,
  };
}
