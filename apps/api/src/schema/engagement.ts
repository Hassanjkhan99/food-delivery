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
import {
  LOYALTY_POINT_VALUE_MINOR,
  LOYALTY_REDEEM_STEP,
  formatRs,
  loyaltyPointsToDiscountMinor,
} from "@fd/shared";
import { builder } from "./builder.js";

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

  // Pull the handful of rows we need in parallel. Everything here is already exposed via
  // existing queries (availableVouchers / myOrders / loyaltyAccount / myReferral /
  // myMembership) — we're only re-reading it, not adding new access.
  const [voucher, deliveredOrders, loyalty, membership, referralCode] = await Promise.all([
    // The soonest-to-expire active platform voucher the customer can still discover.
    prisma.voucher.findFirst({
      where: {
        active: true,
        scope: "platform",
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
          { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
        ],
      },
      // Expiring vouchers first (nulls last), then newest — mirrors the urgency the card conveys.
      orderBy: [{ endsAt: "asc" }, { createdAt: "desc" }],
    }),
    // Delivered orders: newest first, enough to derive both the reorder target and the
    // cumulative-savings recap.
    prisma.order.findMany({
      where: { customerId: userId, status: "delivered" },
      orderBy: { deliveredAt: "desc" },
      take: 50,
      include: { branch: { include: { restaurant: true } } },
    }),
    prisma.loyaltyAccount.findUnique({ where: { userId } }),
    prisma.subscription.findFirst({ where: { userId, status: "active" } }),
    prisma.referralCode.findUnique({ where: { userId } }),
  ]);

  // 1) DEAL — an active, discoverable platform voucher, framed with its real value.
  if (voucher) {
    const value =
      voucher.type === "free_delivery"
        ? "Free delivery"
        : voucher.type === "percentage"
          ? `${Math.round(voucher.valueBps / 100)}% off`
          : `${formatRs(voucher.valueMinor)} off`;
    const minOrder =
      voucher.minOrderMinor > 0 ? ` on orders over ${formatRs(voucher.minOrderMinor)}` : "";
    cards.push({
      id: `deal:${voucher.id}`,
      kind: "deal",
      title: `${value} with ${voucher.code}`,
      body: voucher.description ?? `Tap to see today's offer${minOrder}.`,
      accent: "red",
      ctaLabel: "View deal",
      // Deep-link to the offers surface; the code is applied at checkout.
      href: "/search",
      expiresAt: voucher.endsAt,
      priority: PRIORITY.deal,
    });
  }

  // 2) REORDER — the most recent restaurant the customer had delivered.
  const lastDelivered = deliveredOrders[0];
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

  // 3) SAVED — cumulative real savings (voucher + loyalty discounts) across delivered
  // orders. Only shown once there's something worth celebrating.
  const savedMinor = deliveredOrders.reduce(
    (sum, o) => sum + o.discountMinor + o.loyaltyDiscountMinor,
    0,
  );
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
    // Already redeemable — nudge them to actually use it at checkout.
    const value = formatRs(points * LOYALTY_POINT_VALUE_MINOR);
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

  // 6) MEMBERSHIP — upsell only for non-members. Deferred: quantifying "you'd have saved
  // Rs X with Pro" (see follow-ups).
  if (!membership) {
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
