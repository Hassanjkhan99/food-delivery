// Server-authoritative cart pricing. The client never sends prices — only item ids,
// modifier option ids, and quantities. Everything money is recomputed here.
import { prisma } from "@fd/db";
import {
  applyBps,
  haversineMeters,
  resolveLoyaltyRedemption,
  type QuoteInput,
  type UnavailabilityPreference,
} from "@fd/shared";
import { GraphQLError } from "graphql";
import { validateVoucher, VoucherError, type AppliedVoucher } from "./voucherService.js";

export type ResolvedLine = {
  // Present for a normal menu-item line; null for a combo line (#53).
  menuItemId: string | null;
  // Present for a combo line; null for a menu-item line.
  comboId: string | null;
  name: string;
  qty: number;
  unitPriceMinor: number; // base + selected modifier deltas, or the combo bundle price
  lineTotalMinor: number;
  notes?: string;
  // Customer's "if unavailable" preference (#39), snapshotted onto the order item.
  unavailabilityPreference: UnavailabilityPreference;
  modifiers: Array<{
    groupName: string;
    optionId: string;
    optionName: string;
    priceDeltaMinor: number;
  }>;
  // Frozen component list for a combo line (empty for menu-item lines). Mirrors the
  // menuSnapshotJson pattern so the order never depends on the live combo.
  comboComponents: Array<{
    menuItemId: string;
    name: string;
    qty: number;
    unitPriceMinor: number;
  }>;
};

export type QuoteResult = {
  branchId: string;
  subtotalMinor: number;
  deliveryFeeMinor: number;
  // Full delivery fee before any membership benefit is applied. Equals deliveryFeeMinor
  // when the customer is not a member (or the benefit didn't apply).
  baseDeliveryFeeMinor: number;
  // How much the delivery fee was reduced by an active membership (>= 0).
  membershipDeliverySavingMinor: number;
  // Whether an active membership benefit (free/discounted delivery) was applied.
  membershipApplied: boolean;
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

// Compute the delivery fee after any active membership benefit. Free above the plan's
// threshold; otherwise reduced by the plan's discount bps. customerId is optional — a
// guest/unauthenticated quote simply pays the full fee. (#59)
async function applyMembershipBenefit(
  customerId: string | undefined | null,
  subtotalMinor: number,
  baseDeliveryFeeMinor: number,
): Promise<{ deliveryFeeMinor: number; applied: boolean }> {
  if (!customerId || baseDeliveryFeeMinor <= 0) {
    return { deliveryFeeMinor: baseDeliveryFeeMinor, applied: false };
  }
  const sub = await prisma.subscription.findFirst({
    where: { userId: customerId, status: "active", currentPeriodEnd: { gt: new Date() } },
    include: { plan: true },
  });
  if (!sub) return { deliveryFeeMinor: baseDeliveryFeeMinor, applied: false };

  if (subtotalMinor >= sub.plan.freeDeliveryThresholdMinor) {
    return { deliveryFeeMinor: 0, applied: true };
  }
  if (sub.plan.deliveryDiscountBps > 0) {
    const discounted = baseDeliveryFeeMinor - applyBps(baseDeliveryFeeMinor, sub.plan.deliveryDiscountBps);
    return { deliveryFeeMinor: Math.max(0, discounted), applied: true };
  }
  return { deliveryFeeMinor: baseDeliveryFeeMinor, applied: false };
}

/**
 * Server-authoritative quote. When `userId` is provided and the input carries a
 * voucherCode, the voucher is validated + priced against this cart (an invalid code is
 * reported via voucherError in the preview path rather than thrown; placeOrder re-validates
 * and DOES throw). `userId` is also used to look up the loyalty balance and clamp point
 * redemption (FP-07) and to apply any active membership delivery benefit (#59). Anonymous
 * quotes (no userId) still price the cart but can't redeem or get membership benefits.
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
  // Pickup (#54): the customer collects at the branch, so the delivery radius never
  // applies (any distance is fine — they travel to the branch, not the reverse).
  const isPickup = input.fulfillmentMode === "pickup";
  const inRadius = isPickup || distanceM <= branch.deliveryRadiusM;

  // Resolve items against the ACTIVE menu only (stale carts re-priced or rejected).
  const itemIds = input.lines.map((l) => l.menuItemId).filter((id): id is string => Boolean(id));
  const items = await prisma.menuItem.findMany({
    where: {
      id: { in: itemIds },
      category: { menuId: branch.activeMenuId },
    },
    include: {
      modGroups: { include: { group: { include: { options: true } } } },
    },
  });
  const byId = new Map(items.map((i) => [i.id, i]));

  // Combos referenced in the cart (#53), resolved against the active menu with their
  // component items so availability can be validated at quote time.
  const comboIds = input.lines.map((l) => l.comboId).filter((id): id is string => Boolean(id));
  const combos = comboIds.length
    ? await prisma.combo.findMany({
        where: { id: { in: comboIds }, menuId: branch.activeMenuId },
        include: { items: { include: { menuItem: true }, orderBy: { sortOrder: "asc" } } },
      })
    : [];
  const comboById = new Map(combos.map((c) => [c.id, c]));

  const lines: ResolvedLine[] = input.lines.map((line) => {
    // ── combo line (#53): one bundled, server-priced line with a frozen component list ──
    if (line.comboId) {
      const combo = comboById.get(line.comboId);
      if (!combo) throw new GraphQLError(`Deal no longer available`);
      if (!combo.isAvailable) throw new GraphQLError(`'${combo.name}' is currently unavailable`);
      if (combo.items.length === 0) throw new GraphQLError(`'${combo.name}' has no items`);
      const unavailable = combo.items.find((ci) => !ci.menuItem.isAvailable);
      if (unavailable) {
        throw new GraphQLError(`'${combo.name}' includes '${unavailable.menuItem.name}', which is unavailable`);
      }
      const comboComponents = combo.items.map((ci) => ({
        menuItemId: ci.menuItemId,
        name: ci.menuItem.name,
        qty: ci.qty,
        unitPriceMinor: ci.menuItem.priceMinor,
      }));
      return {
        menuItemId: null,
        comboId: combo.id,
        name: combo.name,
        qty: line.qty,
        unitPriceMinor: combo.priceMinor,
        lineTotalMinor: combo.priceMinor * line.qty,
        notes: line.notes,
        unavailabilityPreference: line.unavailabilityPreference,
        modifiers: [],
        comboComponents,
      };
    }

    const item = line.menuItemId ? byId.get(line.menuItemId) : undefined;
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

    // priceMinor is always the charged price; compareAtPriceMinor (#53) is display-only.
    const unit = item.priceMinor + delta;
    return {
      menuItemId: item.id,
      comboId: null,
      name: item.name,
      qty: line.qty,
      unitPriceMinor: unit,
      lineTotalMinor: unit * line.qty,
      notes: line.notes,
      unavailabilityPreference: line.unavailabilityPreference,
      modifiers,
      comboComponents: [],
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
  // Rider tip is added on top of the bill; it isn't taxed or commissioned. Pickup has
  // no rider leg, so a rider tip can't be routed to anyone — force it to zero (#54) so
  // a tip chosen on the cart page before switching to Pickup is never charged.
  const tipAmount = isPickup ? 0 : input.tipAmount ?? 0;
  // Pickup has no rider leg, so there's no delivery fee to charge (#54). Founder call:
  // no separate pickup discount in v1 — the waived delivery fee is the customer win.
  const baseDeliveryFeeMinor = isPickup ? 0 : branch.deliveryFeeMinor;
  // Membership benefit (#59): an active plan waives/reduces the base delivery fee. Applied
  // for the signed-in customer only; guests pay the full base fee.
  const { deliveryFeeMinor, applied } = await applyMembershipBenefit(
    userId,
    subtotal,
    baseDeliveryFeeMinor,
  );

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

  // Loyalty redemption (FP-07). Points can only offset the subtotal — fees, tax, and
  // tip stay fully owed — so the restaurant/rider are never shortchanged by a discount.
  let loyaltyPointsBalance = 0;
  let loyaltyPointsRedeemed = 0;
  let loyaltyDiscountMinor = 0;
  const requestedRedeem = input.redeemPoints ?? 0;
  if (userId) {
    const acct = await prisma.loyaltyAccount.findUnique({ where: { userId } });
    loyaltyPointsBalance = acct?.pointsBalance ?? 0;
    if (requestedRedeem > 0) {
      const r = resolveLoyaltyRedemption(requestedRedeem, loyaltyPointsBalance, subtotal);
      loyaltyPointsRedeemed = r.points;
      loyaltyDiscountMinor = r.discountMinor;
    }
  }

  // Pickup + membership-aware deliveryFeeMinor, minus BOTH the voucher discount (#52)
  // and the loyalty discount (#57). Clamp to 0 so stacked discounts can't go negative.
  const grandTotalMinor = Math.max(
    0,
    subtotal + tax + deliveryFeeMinor + platformFee + tipAmount - discountMinor - loyaltyDiscountMinor,
  );

  return {
    branchId: branch.id,
    subtotalMinor: subtotal,
    deliveryFeeMinor,
    baseDeliveryFeeMinor,
    membershipDeliverySavingMinor: baseDeliveryFeeMinor - deliveryFeeMinor,
    membershipApplied: applied,
    taxTotalMinor: tax,
    platformFeeMinor: platformFee,
    commissionMinor: commission,
    commissionBps,
    tipAmount,
    discountMinor,
    voucherCode: appliedVoucher ? appliedVoucher.voucher.code : null,
    voucherError,
    appliedVoucher,
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
