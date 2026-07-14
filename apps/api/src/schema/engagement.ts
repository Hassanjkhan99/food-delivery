// Engagement cards (UX-15 / #134): a single read-model that composes the customer's
// existing loyalty / voucher / order / referral / membership state into a small, ranked
// list of "flashcards" for the home rail. This is READ-ONLY — it never mutates points,
// vouchers, wallets or memberships; it only reads what already exists and frames it.
//
// Product guardrail (see #134): a card is allowed only when it helps the customer order
// faster, discover a real deal, reorder a good experience, or see a reward they've
// actually earned. No badges-without-value, no leaderboards, no popups. Every card must
// carry a real deep-link and (where relevant) a real Rupee number from the customer's own
// history — nothing invented.
import { prisma } from "@fd/db";
import { LOYALTY_REDEEM_STEP, formatRs, loyaltyPointsToDiscountMinor } from "@fd/shared";
import { hasActiveMembership } from "../services/membershipService.js";
import { builder } from "./builder.js";

// Orders that don't count as a genuine "prior order" for first-order-only vouchers —
// mirrors validateVoucher so the deal card never advertises a code the customer can't use.
const NON_QUALIFYING_ORDER_STATUSES = ["rejected", "auto_expired", "cancelled"] as const;

/** Format a percentage from basis points without rounding up (150 bps → "1.5%", 1000 → "10%"). */
function formatPercent(valueBps: number): string {
  return `${(valueBps / 100).toLocaleString("en-PK", { maximumFractionDigits: 2 })}%`;
}

// The wire shape. `kind`/`accent` are plain strings on the wire (the client maps them to
// icons/colours) — deliberately not enums, so adding a future card kind never breaks the
// SDL contract for older clients.
export type EngagementCardShape = {
  id: string;
  kind: "deal" | "reorder" | "reward" | "saved" | "referral" | "membership";
  title: string;
  body: string | null;
  accent: "red" | "yellow" | "neutral";
  ctaLabel: string;
  href: string;
  expiresAt: Date | null;
  priority: number;
};

const EngagementCard = builder.objectRef<EngagementCardShape>("EngagementCard");
EngagementCard.implement({
  description:
    "A single ranked home-rail flashcard composed from the customer's own loyalty / voucher / order / referral / membership state. Read model only — never mutates.",
  fields: (t) => ({
    // Stable within a response so the client can key/dismiss without a DB row.
    id: t.exposeID("id"),
    // deal | reorder | reward | saved | referral | membership.
    kind: t.exposeString("kind"),
    title: t.exposeString("title"),
    body: t.exposeString("body", { nullable: true }),
    // Offer treatment bucket (UX-13): red | yellow | neutral.
    accent: t.exposeString("accent"),
    ctaLabel: t.exposeString("ctaLabel"),
    // Deep-link the CTA navigates to. Always a real in-app route.
    href: t.exposeString("href"),
    // When the underlying offer stops being relevant (e.g. voucher endsAt); null = no expiry.
    expiresAt: t.field({ type: "DateTime", nullable: true, resolve: (c) => c.expiresAt }),
    // Lower = shown first. See the ranking rules in buildEngagementCards.
    priority: t.exposeInt("priority"),
  }),
});

// Ranking rules v1 (#134): active deal → reorder → savings recap → reward progress →
// referral → membership. `saved` sits above the reward prompt because a concrete "you've
// saved Rs X" recap is stronger social proof than a "keep earning" nudge.
const PRIORITY = {
  deal: 20,
  reorder: 30,
  saved: 40,
  reward: 50,
  referral: 60,
  membership: 70,
} as const;

/**
 * Compose the caller's engagement cards from live data. Deterministic and side-effect
 * free so it's trivially testable: same DB state + same clock → same cards. Returns at
 * most `limit` cards, already sorted by priority.
 */
export async function buildEngagementCards(
  userId: string,
  now: Date,
  limit: number,
): Promise<EngagementCardShape[]> {
  const cards: EngagementCardShape[] = [];

  // Pull the rows we need in parallel. Everything here is already exposed via existing
  // queries (availableVouchers / myOrders / loyaltyAccount / myReferral / myMembership) —
  // we're only re-reading it, not adding new access.
  const [
    voucherCandidates,
    lastDelivered,
    savedAgg,
    loyalty,
    memberIsActive,
    referralCode,
    priorOrderCount,
  ] = await Promise.all([
    // Active platform vouchers within their window, soonest-to-expire first — we pick the
    // first the customer can actually redeem (eligibility filtered below).
    prisma.voucher.findMany({
      where: {
        active: true,
        scope: "platform",
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
          { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
        ],
      },
      orderBy: [{ endsAt: "asc" }, { createdAt: "desc" }],
      take: 10,
    }),
    // Most recent delivered order → the reorder target.
    prisma.order.findFirst({
      where: { customerId: userId, status: "delivered" },
      orderBy: { deliveredAt: "desc" },
      include: { branch: { include: { restaurant: true } } },
    }),
    // Lifetime savings recap: sum across ALL delivered orders (not a truncated page).
    prisma.order.aggregate({
      where: { customerId: userId, status: "delivered" },
      _sum: { discountMinor: true, loyaltyDiscountMinor: true },
    }),
    prisma.loyaltyAccount.findUnique({ where: { userId } }),
    // Paid + unexpired only — mirrors membership benefit gating (no upsell to real members).
    hasActiveMembership(userId),
    prisma.referralCode.findUnique({ where: { userId } }),
    // "Genuine prior orders" for first-order-only voucher eligibility (matches validateVoucher).
    prisma.order.count({
      where: {
        customerId: userId,
        status: { notIn: [...NON_QUALIFYING_ORDER_STATUSES] },
      },
    }),
  ]);

  // 1) DEAL — the first active platform voucher the customer can actually redeem. We
  // filter out ones checkout would reject (budget-exhausted, first-order-only for a
  // returning customer, per-user limit reached) so the rail never advertises a dead code.
  const limitedIds = voucherCandidates.filter((v) => v.perUserLimit != null).map((v) => v.id);
  const perUserUsed = new Map<string, number>();
  if (limitedIds.length > 0) {
    const grouped = await prisma.voucherRedemption.groupBy({
      by: ["voucherId"],
      where: { userId, voucherId: { in: limitedIds }, reversedAt: null },
      _count: { _all: true },
    });
    for (const g of grouped) perUserUsed.set(g.voucherId, g._count._all);
  }
  const voucher = voucherCandidates.find((v) => {
    const budgetLeft = v.totalBudgetMinor == null || v.usedBudgetMinor < v.totalBudgetMinor;
    const firstOrderOk = !v.firstOrderOnly || priorOrderCount === 0;
    const perUserOk = v.perUserLimit == null || (perUserUsed.get(v.id) ?? 0) < v.perUserLimit;
    return budgetLeft && firstOrderOk && perUserOk;
  });
  if (voucher) {
    const value =
      voucher.type === "free_delivery"
        ? "Free delivery"
        : voucher.type === "percentage"
          ? `${formatPercent(voucher.valueBps)} off`
          : `${formatRs(voucher.valueMinor)} off`;
    const minOrder =
      voucher.minOrderMinor > 0 ? ` on orders over ${formatRs(voucher.minOrderMinor)}` : "";
    cards.push({
      id: `deal:${voucher.id}`,
      kind: "deal",
      title: `${value} with ${voucher.code}`,
      body: voucher.description ?? `Tap to browse and apply this offer at checkout${minOrder}.`,
      accent: "red",
      ctaLabel: "View deal",
      // Platform vouchers apply at checkout (which needs a cart), so there's no single
      // deep-link that pre-applies the code — send the customer to discovery; the code is
      // shown on the card. A dedicated offers surface / checkout prefill is a follow-up.
      href: "/search",
      expiresAt: voucher.endsAt,
      priority: PRIORITY.deal,
    });
  }

  // 2) REORDER — the most recent restaurant the customer had delivered. The home client
  // additionally drops this card if the restaurant doesn't deliver to the current area.
  if (lastDelivered?.branch?.restaurant) {
    const r = lastDelivered.branch.restaurant;
    cards.push({
      id: `reorder:${r.id}`,
      kind: "reorder",
      title: `Order again from ${r.name}`,
      body: "Loved it last time? Reorder your favourite in a couple of taps.",
      accent: "neutral",
      ctaLabel: "Reorder",
      href: `/r/${r.slug}`,
      expiresAt: null,
      priority: PRIORITY.reorder,
    });
  }

  // 3) SAVED — cumulative real savings (voucher + loyalty discounts) across ALL delivered
  // orders (DB aggregate, so it stays accurate past the query page). Shown once there's
  // something worth celebrating.
  const savedMinor = (savedAgg._sum.discountMinor ?? 0) + (savedAgg._sum.loyaltyDiscountMinor ?? 0);
  if (savedMinor > 0) {
    cards.push({
      id: "saved:lifetime",
      kind: "saved",
      title: `You've saved ${formatRs(savedMinor)} so far`,
      body: "Nice work. Keep an eye out for more offers near you.",
      accent: "yellow",
      ctaLabel: "Find more offers",
      href: "/search",
      expiresAt: null,
      priority: PRIORITY.saved,
    });
  }

  // 4) REWARD — loyalty points progress toward the next redeemable step. Uses the real
  // redemption math (LOYALTY_REDEEM_STEP points → a checkout discount). We only prompt
  // when the customer has points but not yet enough to redeem — a concrete, earned goal.
  const points = loyalty?.pointsBalance ?? 0;
  if (points > 0 && points < LOYALTY_REDEEM_STEP) {
    const toNext = LOYALTY_REDEEM_STEP - points;
    const stepValue = formatRs(loyaltyPointsToDiscountMinor(LOYALTY_REDEEM_STEP));
    cards.push({
      id: "reward:progress",
      kind: "reward",
      title: `${points} points — ${toNext} to your next reward`,
      body: `Earn ${toNext} more points to unlock ${stepValue} off. You earn 1 point per Rupee spent.`,
      accent: "yellow",
      ctaLabel: "How rewards work",
      href: "/account",
      expiresAt: null,
      priority: PRIORITY.reward,
    });
  } else if (points >= LOYALTY_REDEEM_STEP) {
    // Already redeemable — nudge them to use it at checkout. Value the STEP-ROUNDED points
    // (checkout only redeems whole LOYALTY_REDEEM_STEP multiples), so we never overstate
    // the discount (e.g. 150 pts → Rs 10 off, not Rs 15).
    const redeemablePoints = Math.floor(points / LOYALTY_REDEEM_STEP) * LOYALTY_REDEEM_STEP;
    const value = formatRs(loyaltyPointsToDiscountMinor(redeemablePoints));
    cards.push({
      id: "reward:redeemable",
      kind: "reward",
      title: `You have ${points} points to spend`,
      body: `That's up to ${value} off your next order at checkout.`,
      accent: "yellow",
      ctaLabel: "How rewards work",
      href: "/account",
      expiresAt: null,
      priority: PRIORITY.reward,
    });
  }

  // 5) REFERRAL — invite prompt. Only once the customer has a code (minted lazily on the
  // referrals page); we don't mint one here (read-only), we just surface it if it exists.
  if (referralCode) {
    cards.push({
      id: "referral:invite",
      kind: "referral",
      title: "Invite a friend, both get credit",
      body: "Share your code — you both earn wallet credit on their first order.",
      accent: "neutral",
      ctaLabel: "Invite friends",
      href: "/referrals",
      expiresAt: null,
      priority: PRIORITY.referral,
    });
  }

  // 6) MEMBERSHIP — upsell only for genuine non-members (hasActiveMembership requires a
  // paid, unexpired active row, so a lapsed / mid-charge slot still gets the prompt).
  // Deferred: quantifying "you'd have saved Rs X with Pro" (see follow-ups).
  if (!memberIsActive) {
    cards.push({
      id: "membership:upsell",
      kind: "membership",
      title: "Save on delivery with Pro",
      body: "Members get free or reduced delivery on eligible orders.",
      accent: "neutral",
      ctaLabel: "See Pro",
      href: "/membership",
      expiresAt: null,
      priority: PRIORITY.membership,
    });
  }

  cards.sort((a, b) => a.priority - b.priority);
  return cards.slice(0, Math.max(0, limit));
}

builder.queryFields((t) => ({
  engagementCards: t.field({
    type: [EngagementCard],
    // Signed-in only: every card is personal (their orders, points, referral). Anonymous
    // visitors just get an empty rail, which the client hides.
    authScopes: { loggedIn: true },
    args: {
      // Cap the rail; the UI shows 3–5 (#134). Defaults to 5, clamped 1..8.
      limit: t.arg.int({ required: false }),
    },
    resolve: (_root, args, ctx) => {
      const limit = Math.min(8, Math.max(1, args.limit ?? 5));
      return buildEngagementCards(ctx.userId!, new Date(), limit);
    },
  }),
}));
