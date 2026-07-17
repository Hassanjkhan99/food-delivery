// Server-authoritative cart pricing. The client never sends prices — only item ids,
// modifier option ids, and quantities. Everything money is recomputed here.
import { prisma } from "@fd/db";
import {
  allocateLineTax,
  applyBps,
  haversineMeters,
  resolveLoyaltyRedemption,
  type QuoteInput,
  type UnavailabilityPreference,
} from "@fd/shared";
import { GraphQLError } from "graphql";
import { branchOpenNow } from "./branchHours.js";
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
  // Immutable per-line tax breakdown (#146). taxableMinor = pre-tax base; taxMinor =
  // allocated tax (Σ taxMinor across lines == taxTotalMinor exactly). lineTotalMinor stays
  // the charged total: == taxableMinor+taxMinor when inclusive, == taxableMinor when exclusive.
  taxableMinor: number;
  taxMinor: number;
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

// A single concrete, server-priced delivery choice the customer may pick at checkout
// (#98, epic #97). This is the API SHAPE the richer modes (#99–#106) slot into later.
// Every field is server-authoritative — the client never invents price or ETA.
export type DeliveryOption = {
  // Stable machine key: "standard" | "scheduled" (foundation set). More keys land with
  // the variant issues. Sent back as `deliveryOption` on quote/placeOrder to pick it.
  key: string;
  // Customer-facing label ("Standard delivery", "Schedule for later").
  label: string;
  // One-line trade-off/eligibility copy shown under the label.
  description: string;
  // Delivery fee for THIS option in minor units (membership-aware). Flows into the total
  // when selected. For the foundation set both options price identically to standard.
  priceMinor: number;
  // Coarse ETA in minutes, or null when it doesn't apply (e.g. a scheduled slot the
  // customer picks themselves). etaLabel is the human string the UI shows.
  etaMinutes: number | null;
  etaLabel: string;
  // Whether this option can currently be fulfilled/selected. Standard is available
  // whenever delivery is; unavailable options are shown disabled, never hidden silently.
  available: boolean;
  // True for the option chosen by default (standard).
  recommended: boolean;
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
  // Tax presentation contract (#146). The server is the source of truth; the client renders
  // the breakdown and toggles inclusive/exclusive DISPLAY only — never re-derives tax.
  // subtotalMinor is always the pre-tax taxable base; grandTotalMinor already accounts for
  // tax (added on top when exclusive, already contained in menu prices when inclusive), so a
  // client must never add taxTotalMinor to grandTotalMinor.
  taxRateBps: number;
  taxLabel: string;
  taxInclusive: boolean;
  taxResponsibility: string;
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
  // Concrete delivery choices for this cart/branch/address (#98). Empty for pickup (the
  // pickup toggle is a separate fulfillment control, unchanged). The first entry is the
  // default (standard). Server stays source of truth for every price + ETA here.
  deliveryOptions: DeliveryOption[];
  // The option key the caller requested (echoed, defaults to "standard"). The selected
  // option's fee is already reflected in deliveryFeeMinor/grandTotalMinor above.
  deliveryOption: string;
  lines: ResolvedLine[];
};

// Coarse delivery ETA in minutes: prep (default 20m + branch busy buffer) plus straight-
// line ride time at ~20 km/h (distanceM / 333). Mirrors the marketplace search band so
// the checkout ETA matches what the customer saw while browsing. (#98)
const DEFAULT_PREP_MINUTES = 20;
function estimateDeliveryEtaMinutes(distanceM: number, prepBufferMinutes: number): number {
  return DEFAULT_PREP_MINUTES + prepBufferMinutes + Math.round(distanceM / 333);
}

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
    // lastChargeRef (Codex P2): don't grant free/discounted delivery from a membership slot
    // that a concurrent subscribe claimed but hasn't paid for yet (active+future, no charge).
    where: {
      userId: customerId,
      status: "active",
      currentPeriodEnd: { gt: new Date() },
      lastChargeRef: { not: null },
    },
    include: { plan: true },
  });
  if (!sub) return { deliveryFeeMinor: baseDeliveryFeeMinor, applied: false };

  if (subtotalMinor >= sub.plan.freeDeliveryThresholdMinor) {
    return { deliveryFeeMinor: 0, applied: true };
  }
  if (sub.plan.deliveryDiscountBps > 0) {
    const discounted =
      baseDeliveryFeeMinor - applyBps(baseDeliveryFeeMinor, sub.plan.deliveryDiscountBps);
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
  if (!branch) {
    throw new GraphQLError("This restaurant could not be found.", {
      extensions: { code: "branch_not_found" },
    });
  }
  if (branch.restaurant.status !== "approved") {
    // Distinguish why, so the UI can say the right thing instead of a flat "not available".
    const status = branch.restaurant.status;
    const [message, code] =
      status === "pending_approval"
        ? ["This restaurant isn't open for orders yet.", "restaurant_pending"]
        : status === "suspended"
          ? ["This restaurant is temporarily unavailable.", "restaurant_suspended"]
          : ["This restaurant isn't available right now.", "restaurant_unavailable"];
    throw new GraphQLError(message, { extensions: { code } });
  }
  if (!branch.isAcceptingOrders) {
    throw new GraphQLError("This restaurant isn't accepting orders right now.", {
      extensions: { code: "not_accepting_orders" },
    });
  }
  // Opening-hours guard at quote time too (#19): an immediate order to a branch that's
  // closed by its published hours is rejected here, mirroring the placement guard — so a
  // 3 a.m. cart can't even price. A scheduled pre-order (#54) is exempt: it targets a
  // future slot, which placeOrder validates against hours at the requested time.
  if ((input.deliveryOption ?? "standard") !== "scheduled") {
    const open = await branchOpenNow(branch);
    if (!open.isOpen) {
      throw new GraphQLError(
        open.opensAtLabel
          ? `This restaurant is closed — opens ${open.opensAtLabel}.`
          : "This restaurant is currently closed.",
        { extensions: { code: "branch_closed" } },
      );
    }
  }
  if (!branch.activeMenuId) {
    throw new GraphQLError("This restaurant hasn't published a menu yet.", {
      extensions: { code: "no_published_menu" },
    });
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

  // Timed-86 re-arm (#110): an item 86'd with an elapsed `unavailableUntil` is effectively
  // available again. Mirror the marketplace read-time rule here so a customer who was shown a
  // re-armed item (menu/search/deep-link) isn't rejected at quote/checkout with item_unavailable
  // until someone manually toggles the flag. Applies to single items and combo components.
  const now = new Date();
  const menuItemAvailable = (i: { isAvailable: boolean; unavailableUntil: Date | null }): boolean =>
    i.isAvailable || (i.unavailableUntil != null && i.unavailableUntil <= now);

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
      if (!combo)
        throw new GraphQLError("This deal is no longer available.", {
          extensions: { code: "item_unavailable" },
        });
      if (!combo.isAvailable)
        throw new GraphQLError(`"${combo.name}" is currently unavailable.`, {
          extensions: { code: "item_unavailable" },
        });
      if (combo.items.length === 0)
        throw new GraphQLError(`"${combo.name}" is currently unavailable.`, {
          extensions: { code: "item_unavailable" },
        });
      const unavailable = combo.items.find((ci) => !menuItemAvailable(ci.menuItem));
      if (unavailable) {
        throw new GraphQLError(
          `"${combo.name}" includes "${unavailable.menuItem.name}", which is currently unavailable.`,
          { extensions: { code: "item_unavailable" } },
        );
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
        taxableMinor: 0, // filled by allocateLineTax after all lines are resolved
        taxMinor: 0,
        notes: line.notes,
        unavailabilityPreference: line.unavailabilityPreference,
        modifiers: [],
        comboComponents,
      };
    }

    const item = line.menuItemId ? byId.get(line.menuItemId) : undefined;
    if (!item)
      throw new GraphQLError("One of your items is no longer on the menu.", {
        extensions: { code: "item_unavailable" },
      });
    if (!menuItemAvailable(item))
      throw new GraphQLError(`"${item.name}" is currently unavailable.`, {
        extensions: { code: "item_unavailable" },
      });

    const selected = new Set(line.modifierOptionIds);
    const modifiers: ResolvedLine["modifiers"] = [];
    let delta = 0;

    for (const { group } of item.modGroups) {
      const chosen = group.options.filter((o) => selected.has(o.id));
      if (chosen.length < group.minSelect || chosen.length > group.maxSelect) {
        throw new GraphQLError(
          `For "${item.name}", please choose between ${group.minSelect} and ${group.maxSelect} option(s) for "${group.name}".`,
          { extensions: { code: "modifier_selection_invalid" } },
        );
      }
      for (const opt of chosen) {
        if (!opt.isAvailable)
          throw new GraphQLError(`The option "${opt.name}" is currently unavailable.`, {
            extensions: { code: "item_unavailable" },
          });
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
      throw new GraphQLError(`Please review your options for "${item.name}".`, {
        extensions: { code: "modifier_selection_invalid" },
      });
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
      taxableMinor: 0, // filled by allocateLineTax after all lines are resolved
      taxMinor: 0,
      notes: line.notes,
      unavailabilityPreference: line.unavailabilityPreference,
      modifiers,
      comboComponents: [],
    };
  });

  // Tax (#146). menu prices are entered/displayed inclusive or exclusive per the branch's
  // TaxProfile. We allocate tax across the charged line totals so per-line snapshots sum
  // EXACTLY to the order tax, then take the pre-tax base as the canonical `subtotal`. This
  // keeps exclusive behaviour identical to before (base == line totals, tax added on top)
  // while, for inclusive, backing the tax out of the menu price so it's never added twice.
  const { rateBps, inclusive } = branch.taxProfile;
  const lineTax = allocateLineTax(
    lines.map((l) => l.lineTotalMinor),
    rateBps,
    inclusive,
  );
  lines.forEach((l, i) => {
    const b = lineTax[i];
    l.taxableMinor = b?.baseMinor ?? l.lineTotalMinor;
    l.taxMinor = b?.taxMinor ?? 0;
  });
  const subtotal = lines.reduce((s, l) => s + l.taxableMinor, 0);
  const tax = lines.reduce((s, l) => s + l.taxMinor, 0);

  const fee = await prisma.feeConfig.findFirst({ orderBy: { createdAt: "desc" } });
  if (!fee)
    throw new GraphQLError("We couldn't price this order right now. Please try again shortly.", {
      extensions: { code: "pricing_unavailable" },
    });
  const isChain = branch.restaurant.tier === "chain";
  const commissionBps = isChain ? fee.chainCommissionBps : fee.smallBusinessCommissionBps;
  const platformFee = isChain ? fee.chainPlatformFeeMinor : fee.smallBusinessPlatformFeeMinor;
  const commission = applyBps(subtotal, commissionBps);
  // Rider tip is added on top of the bill; it isn't taxed or commissioned. Pickup has
  // no rider leg, so a rider tip can't be routed to anyone — force it to zero (#54) so
  // a tip chosen on the cart page before switching to Pickup is never charged.
  const tipAmount = isPickup ? 0 : (input.tipAmount ?? 0);
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
    subtotal +
      tax +
      deliveryFeeMinor +
      platformFee +
      tipAmount -
      discountMinor -
      loyaltyDiscountMinor,
  );

  // Delivery-option catalogue (#98). Foundation set only — `standard` (today's delivery)
  // and `scheduled` (reuses scheduledFor groundwork, same price). Priority/shared-route/
  // wait-and-save/freelance (#99–#106) slot in here once their pricing + product calls
  // land; deliberately NOT invented here. Empty for pickup (no rider leg to configure).
  // Both foundation options price at the membership-aware deliveryFeeMinor — the point of
  // this issue is the API shape + selector, so no new pricing is introduced.
  const requestedOption = input.deliveryOption ?? "standard";
  const etaMinutes = estimateDeliveryEtaMinutes(distanceM, branch.prepBufferMinutes);
  const deliveryOptions: DeliveryOption[] = isPickup
    ? []
    : [
        {
          key: "standard",
          label: "Standard delivery",
          description: "Our regular delivery — best price.",
          priceMinor: deliveryFeeMinor,
          etaMinutes,
          etaLabel: `${etaMinutes}–${etaMinutes + 10} min`,
          available: inRadius,
          recommended: true,
        },
        {
          key: "scheduled",
          label: "Schedule for later",
          description: "Pick a future time — delivered around your slot.",
          priceMinor: deliveryFeeMinor,
          etaMinutes: null,
          etaLabel: "You choose a time",
          available: inRadius,
          recommended: false,
        },
      ];
  // Clamp to a real, available option so the client can never force an unknown/unfulfillable
  // key. Falls back to standard (also the pickup case, where options is empty).
  const selectedOption =
    deliveryOptions.find((o) => o.key === requestedOption && o.available)?.key ?? "standard";

  return {
    branchId: branch.id,
    subtotalMinor: subtotal,
    deliveryFeeMinor,
    baseDeliveryFeeMinor,
    membershipDeliverySavingMinor: baseDeliveryFeeMinor - deliveryFeeMinor,
    membershipApplied: applied,
    taxTotalMinor: tax,
    taxRateBps: rateBps,
    taxLabel: branch.taxProfile.label,
    taxInclusive: inclusive,
    taxResponsibility: branch.taxProfile.responsibility,
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
    deliveryOptions,
    deliveryOption: selectedOption,
    lines,
  };
}
