// Idempotent dev seed: wipes all data and rebuilds a deterministic demo world.
// Prints a login cheat-sheet at the end. Money is integer minor units (paisa).
import { prisma } from "../src/index.js";
import { Prisma } from "../src/generated/prisma/client.js";
import type { OrderStatus, PaymentMode, RestaurantTier } from "../src/generated/prisma/client.js";

const now = new Date();
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);
const daysAgo = (d: number) => new Date(now.getTime() - d * 24 * 60 * 60_000);

const TAX_BPS = 1300;
const FEES = {
  small_business: { commissionBps: 0, platformFeeMinor: 2_000 },
  chain: { commissionBps: 800, platformFeeMinor: 3_000 },
} as const;

const bps = (amount: number, b: number) => Math.round((amount * b) / 10_000);

async function wipe() {
  // Dependency order matters; everything goes.
  const tables = [
    "ratings",
    "support_tickets",
    "home_banners",
    "refunds",
    "cancellations",
    "payments",
    "delivery_events",
    "delivery_tasks",
    "order_events",
    "order_items",
    "orders",
    "ledger_entries",
    "ledger_accounts",
    "payouts",
    "campaigns",
    "menu_source_docs",
    "menu_item_modifier_groups",
    "modifier_options",
    "modifier_groups",
    "menu_items",
    "menu_categories",
    "menus",
    "restaurant_themes",
    "media_assets",
    "rider_availability",
    "riders",
    "payment_methods",
    "push_subscriptions",
    "addresses",
    "sessions",
    "otp_codes",
    "audit_logs",
    "fee_configs",
    // #30: RESTRICT FK to branches — must be wiped before branches or re-seed fails.
    "branch_cancellation_stats",
    "branches",
    "user_roles",
    "restaurants",
    "tax_profiles",
    "users",
  ];
  for (const t of tables) {
    await prisma.$executeRawUnsafe(`DELETE FROM "${t}"`);
  }
}

// ── ledger helpers ──────────────────────────────────────────────────────────

const accountIds = new Map<string, string>();
async function account(
  ownerType: "platform" | "restaurant" | "customer",
  code: string,
  ownerId?: string,
) {
  if (accountIds.has(code)) return accountIds.get(code)!;
  const a = await prisma.ledgerAccount.create({ data: { ownerType, ownerId, code } });
  accountIds.set(code, a.id);
  return a.id;
}

let txCounter = 0;
async function postTx(
  memo: string,
  legs: Array<{ account: string; debit?: number; credit?: number }>,
  refs: { orderId?: string; payoutId?: string; refundId?: string } = {},
  createdAt?: Date,
) {
  const txId = `seedtx_${++txCounter}`;
  const totalDebit = legs.reduce((s, l) => s + (l.debit ?? 0), 0);
  const totalCredit = legs.reduce((s, l) => s + (l.credit ?? 0), 0);
  if (totalDebit !== totalCredit) {
    throw new Error(`Unbalanced ledger tx "${memo}": debit ${totalDebit} != credit ${totalCredit}`);
  }
  for (const leg of legs) {
    await prisma.ledgerEntry.create({
      data: {
        txId,
        accountId: accountIds.get(leg.account)!,
        debitMinor: leg.debit ?? 0,
        creditMinor: leg.credit ?? 0,
        memo,
        createdAt: createdAt ?? now,
        ...refs,
      },
    });
  }
  return txId;
}

// ── main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("Seeding: wiping existing data...");
  await wipe();

  // Users
  const mkUser = (phone: string, name: string) => prisma.user.create({ data: { phone, name } });
  const admin = await mkUser("+920000000001", "Demo Admin");
  const owner1 = await mkUser("+920000000002", "Owner Karachi Biryani");
  const owner2 = await mkUser("+920000000003", "Owner Burger Theory");
  const staff1 = await mkUser("+920000000004", "Counter Staff KBH");
  const riderR = await mkUser("+920000000005", "Hamza (Restaurant Rider)");
  const riderI = await mkUser("+920000000006", "Bilal (Independent Rider)");
  const cust1 = await mkUser("+920000000007", "Ayesha Customer");
  const cust2 = await mkUser("+920000000008", "Danish Customer");
  const cust3 = await mkUser("+920000000009", "Fatima Customer");

  const tax = await prisma.taxProfile.create({
    data: { name: "Punjab restaurant services 13%", rateBps: TAX_BPS, inclusive: false },
  });

  await prisma.feeConfig.create({
    data: {
      smallBusinessCommissionBps: FEES.small_business.commissionBps,
      smallBusinessPlatformFeeMinor: FEES.small_business.platformFeeMinor,
      chainCommissionBps: FEES.chain.commissionBps,
      chainPlatformFeeMinor: FEES.chain.platformFeeMinor,
      featuredSlotDailyRateSmallMinor: 0,
      featuredSlotDailyRateChainMinor: 50_000,
      createdByUserId: admin.id,
    },
  });

  // Restaurants + branches (Bahria Phase 8, Rawalpindi cluster — a few km apart)
  async function mkRestaurant(opts: {
    name: string;
    slug: string;
    tier: RestaurantTier;
    ownerId: string;
    status?: "approved" | "pending_approval";
    lat: number;
    lng: number;
    cuisineTags?: string[];
    deliveryFeeMinor?: number;
    hoursJson?: Prisma.InputJsonValue;
  }) {
    const r = await prisma.restaurant.create({
      data: {
        name: opts.name,
        slug: opts.slug,
        tier: opts.tier,
        ownerId: opts.ownerId,
        status: opts.status ?? "approved",
        cuisineTags: opts.cuisineTags ?? [],
      },
    });
    const b = await prisma.branch.create({
      data: {
        restaurantId: r.id,
        name: "Main Branch",
        addressText: `${opts.name}, Phase 8, Bahria Town, Rawalpindi`,
        lat: new Prisma.Decimal(opts.lat),
        lng: new Prisma.Decimal(opts.lng),
        deliveryRadiusM: 5_000,
        minOrderMinor: 50_000,
        deliveryFeeMinor: opts.deliveryFeeMinor ?? 8_000,
        taxProfileId: tax.id,
        hoursJson: opts.hoursJson ?? { open: "11:00", close: "23:30", days: [0, 1, 2, 3, 4, 5, 6] },
      },
    });
    return { r, b };
  }

  const kbh = await mkRestaurant({
    name: "Karachi Biryani House",
    slug: "karachi-biryani-house",
    tier: "small_business",
    ownerId: owner1.id,
    lat: 33.5205,
    lng: 73.1005,
    cuisineTags: ["Biryani", "Desi", "BBQ/Karahi"],
  });
  const gb = await mkRestaurant({
    name: "Green Bowl",
    slug: "green-bowl",
    tier: "small_business",
    ownerId: owner1.id,
    lat: 33.5312,
    lng: 73.0871,
    cuisineTags: ["Healthy", "Drinks"],
    deliveryFeeMinor: 0, // free delivery — exercises the free-delivery emphasis + swimlane
  });
  const bt = await mkRestaurant({
    name: "Burger Theory",
    slug: "burger-theory",
    tier: "chain",
    ownerId: owner2.id,
    lat: 33.5104,
    lng: 73.1152,
    cuisineTags: ["Burgers", "Pizza", "Desserts"],
    // Late-night-only hours → closed during daytime, exercises the "Closed — opens" overlay.
    hoursJson: { open: "02:00", close: "05:00", days: [0, 1, 2, 3, 4, 5, 6] },
  });
  const pending = await mkRestaurant({
    name: "Lajawab Bites",
    slug: "lajawab-bites",
    tier: "small_business",
    ownerId: owner2.id,
    status: "pending_approval",
    lat: 33.5411,
    lng: 73.0968,
    cuisineTags: ["Desi", "BBQ/Karahi"],
  });

  // Structured opening hours (#19) for one branch, exercising the BranchHours model
  // path (the rest keep the legacy hoursJson fallback). These mirror KBH's hoursJson
  // window (11:00–23:30 daily = minutes 660–1410) so open/closed results are identical.
  await prisma.branchHours.createMany({
    data: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
      branchId: kbh.b.id,
      dayOfWeek,
      openMinute: 11 * 60,
      closeMinute: 23 * 60 + 30,
    })),
  });

  // Home promo banners (ux-parity #36) — lightweight demo set. Images are static
  // SVGs in apps/web/public/banners (no external/Google imagery). Real campaigns
  // land with #22.
  //
  // NOTE: the "WELCOME50" code banner is intentionally omitted here — this branch has
  // no promo-code input and quoteCart/placeOrder apply no discount, so advertising a
  // code would charge customers full price. The voucher engine lands separately
  // (PR #70); the discount-code banner can be re-seeded once that plumbing is on this feed.
  await prisma.homeBanner.createMany({
    data: [
      {
        // Scoped to Green Bowl, the one seeded branch with deliveryFeeMinor: 0 — the banner
        // must not promise free delivery platform-wide when other branches charge a fee
        // (#36 review round 2). Keep this in sync with Green Bowl's deliveryFeeMinor above.
        title: "Free delivery at Green Bowl",
        imageUrl: "/banners/free-delivery.svg",
        linkHref: "/r/green-bowl",
        sortOrder: 0,
      },
      {
        title: "Biryani cravings sorted",
        imageUrl: "/banners/biryani.svg",
        linkHref: "/r/karachi-biryani-house",
        sortOrder: 1,
      },
    ],
  });

  // Roles
  const roleRows: Prisma.UserRoleCreateManyInput[] = [
    { userId: admin.id, role: "admin" },
    { userId: owner1.id, role: "restaurant_owner", restaurantId: kbh.r.id },
    { userId: owner1.id, role: "restaurant_owner", restaurantId: gb.r.id },
    { userId: owner2.id, role: "restaurant_owner", restaurantId: bt.r.id },
    { userId: owner2.id, role: "restaurant_owner", restaurantId: pending.r.id },
    { userId: staff1.id, role: "restaurant_staff", restaurantId: kbh.r.id },
    { userId: riderR.id, role: "rider" },
    { userId: riderI.id, role: "rider" },
    { userId: cust1.id, role: "customer" },
    { userId: cust2.id, role: "customer" },
    { userId: cust3.id, role: "customer" },
  ];
  await prisma.userRole.createMany({ data: roleRows });

  // Riders
  const riderRestaurant = await prisma.rider.create({
    data: {
      userId: riderR.id,
      riderType: "restaurant",
      restaurantId: kbh.r.id,
      vehicleType: "motorbike",
      verificationStatus: "verified",
    },
  });
  await prisma.rider.create({
    data: {
      userId: riderI.id,
      riderType: "independent",
      vehicleType: "motorbike",
      verificationStatus: "verified",
    },
  });
  await prisma.riderAvailability.create({
    data: {
      riderId: riderRestaurant.id,
      isOnline: true,
      lat: new Prisma.Decimal(33.5207),
      lng: new Prisma.Decimal(73.1009),
    },
  });

  // Customer addresses + one saved mock card
  const addr1 = await prisma.address.create({
    data: {
      userId: cust1.id,
      label: "Home",
      text: "House 12, Street 4, Phase 8, Bahria Town",
      lat: new Prisma.Decimal(33.5251),
      lng: new Prisma.Decimal(73.0952),
      phone: cust1.phone,
    },
  });
  await prisma.address.create({
    data: {
      userId: cust2.id,
      label: "Office",
      text: "Plaza 9, Business Bay, Phase 8",
      lat: new Prisma.Decimal(33.5152),
      lng: new Prisma.Decimal(73.1101),
      phone: cust2.phone,
    },
  });
  const card1 = await prisma.paymentMethod.create({
    data: {
      userId: cust1.id,
      providerToken: "mocktok_seed_visa_4242",
      brand: "visa",
      last4: "4242",
      expMonth: 12,
      expYear: 2030,
      isDefault: true,
    },
  });

  // Themes (distinct look & feel per restaurant, demoable from first boot)
  await prisma.restaurantTheme.create({
    data: {
      restaurantId: kbh.r.id,
      primaryColor: "#b45309",
      accentColor: "#f59e0b",
      backgroundColor: "#fffbeb",
      textColor: "#451a03",
      fontKey: "serif",
      cardStyle: "tilt3d",
      heroEffect: "parallax",
    },
  });
  await prisma.restaurantTheme.create({
    data: {
      restaurantId: gb.r.id,
      primaryColor: "#15803d",
      accentColor: "#84cc16",
      backgroundColor: "#f0fdf4",
      textColor: "#14532d",
      fontKey: "sans",
      cardStyle: "glass",
      heroEffect: "depth",
    },
  });
  await prisma.restaurantTheme.create({
    data: {
      restaurantId: bt.r.id,
      primaryColor: "#dc2626",
      accentColor: "#fbbf24",
      backgroundColor: "#171717",
      textColor: "#fafafa",
      fontKey: "display",
      cardStyle: "flat",
      heroEffect: "none",
    },
  });

  // ── Menus ──────────────────────────────────────────────────────────────
  type ItemDef = { name: string; desc?: string; price: number; badges?: string[] };
  type CatDef = { name: string; desc?: string; mode?: string; items: ItemDef[] };

  async function mkMenu(
    branchId: string,
    cats: CatDef[],
    opts?: { spiceOn?: string[]; addonsOn?: string[] },
  ) {
    const menu = await prisma.menu.create({
      data: {
        branchId,
        version: 1,
        status: "published",
        publishedAt: daysAgo(7),
        layoutJson: {
          categoryOrder: cats.map((c) => c.name),
          displayModes: Object.fromEntries(cats.map((c) => [c.name, c.mode ?? "list"])),
        },
      },
    });
    const spice = await prisma.modifierGroup.create({
      data: {
        menuId: menu.id,
        name: "Spice level",
        minSelect: 1,
        maxSelect: 1,
        options: {
          create: [
            { name: "Mild", priceDeltaMinor: 0, sortOrder: 0 },
            { name: "Medium", priceDeltaMinor: 0, sortOrder: 1 },
            { name: "Extra Hot", priceDeltaMinor: 0, sortOrder: 2 },
          ],
        },
      },
    });
    const addons = await prisma.modifierGroup.create({
      data: {
        menuId: menu.id,
        name: "Add-ons",
        minSelect: 0,
        maxSelect: 3,
        options: {
          create: [
            { name: "Raita", priceDeltaMinor: 5_000, sortOrder: 0 },
            { name: "Salad", priceDeltaMinor: 7_000, sortOrder: 1 },
            { name: "Extra Sauce", priceDeltaMinor: 4_000, sortOrder: 2 },
          ],
        },
      },
    });
    const itemIds = new Map<string, string>();
    for (const [ci, cat] of cats.entries()) {
      const category = await prisma.menuCategory.create({
        data: { menuId: menu.id, name: cat.name, description: cat.desc, sortOrder: ci },
      });
      for (const [ii, item] of cat.items.entries()) {
        const created = await prisma.menuItem.create({
          data: {
            categoryId: category.id,
            name: item.name,
            description: item.desc,
            priceMinor: item.price,
            badges: item.badges ?? [],
            sortOrder: ii,
          },
        });
        itemIds.set(item.name, created.id);
        if (opts?.spiceOn?.includes(item.name)) {
          await prisma.menuItemModifierGroup.create({
            data: { itemId: created.id, groupId: spice.id, sortOrder: 0 },
          });
        }
        if (opts?.addonsOn?.includes(item.name)) {
          await prisma.menuItemModifierGroup.create({
            data: { itemId: created.id, groupId: addons.id, sortOrder: 1 },
          });
        }
      }
    }
    await prisma.branch.update({ where: { id: branchId }, data: { activeMenuId: menu.id } });
    return { menu, itemIds };
  }

  const kbhMenu = await mkMenu(
    kbh.b.id,
    [
      {
        name: "Biryani",
        desc: "Slow-cooked, dum style",
        mode: "grid",
        items: [
          {
            name: "Chicken Biryani",
            desc: "Signature dum biryani",
            price: 45_000,
            badges: ["Bestseller"],
          },
          { name: "Beef Biryani", price: 55_000 },
          {
            name: "Sindhi Biryani",
            desc: "Extra spicy, aloo included",
            price: 50_000,
            badges: ["Spicy"],
          },
        ],
      },
      {
        name: "Karahi",
        mode: "list",
        items: [
          { name: "Chicken Karahi (Half)", price: 90_000 },
          { name: "Chicken Karahi (Full)", price: 170_000 },
          { name: "Mutton Karahi (Half)", price: 140_000 },
        ],
      },
      {
        name: "Sides & Drinks",
        mode: "compact",
        items: [
          { name: "Naan", price: 3_000 },
          { name: "Zeera Raita", price: 5_000 },
          { name: "Soft Drink 500ml", price: 12_000 },
        ],
      },
    ],
    {
      spiceOn: [
        "Chicken Biryani",
        "Beef Biryani",
        "Sindhi Biryani",
        "Chicken Karahi (Half)",
        "Chicken Karahi (Full)",
        "Mutton Karahi (Half)",
      ],
      addonsOn: ["Chicken Biryani", "Beef Biryani", "Chicken Karahi (Full)"],
    },
  );

  const gbMenu = await mkMenu(
    gb.b.id,
    [
      {
        name: "Signature Bowls",
        mode: "grid",
        items: [
          {
            name: "Grilled Chicken Bowl",
            desc: "Brown rice, greens, house dressing",
            price: 65_000,
            badges: ["Healthy"],
          },
          { name: "Falafel Bowl", price: 55_000, badges: ["Veg"] },
          { name: "Steak Bowl", price: 85_000 },
        ],
      },
      {
        name: "Wraps",
        mode: "list",
        items: [
          { name: "Chicken Caesar Wrap", price: 48_000 },
          { name: "Halloumi Wrap", price: 52_000, badges: ["Veg"] },
        ],
      },
      {
        name: "Juices",
        mode: "compact",
        items: [
          { name: "Fresh Orange", price: 25_000 },
          { name: "Green Detox", price: 28_000 },
        ],
      },
    ],
    { addonsOn: ["Grilled Chicken Bowl", "Steak Bowl"] },
  );

  const btMenu = await mkMenu(
    bt.b.id,
    [
      {
        name: "Smash Burgers",
        mode: "grid",
        items: [
          {
            name: "Classic Smash",
            desc: "Double patty, house sauce",
            price: 60_000,
            badges: ["Bestseller"],
          },
          { name: "Cheese Overload", price: 72_000 },
          { name: "Jalapeño Heat", price: 68_000, badges: ["Spicy"] },
          { name: "Crispy Chicken Burger", price: 58_000 },
        ],
      },
      {
        name: "Sides",
        mode: "compact",
        items: [
          { name: "Fries", price: 20_000 },
          { name: "Loaded Fries", price: 35_000 },
          { name: "Nuggets (6pc)", price: 30_000 },
        ],
      },
      {
        name: "Shakes",
        mode: "list",
        items: [
          { name: "Chocolate Shake", price: 32_000 },
          { name: "Oreo Shake", price: 35_000 },
        ],
      },
    ],
    { spiceOn: ["Jalapeño Heat"], addonsOn: ["Classic Smash", "Cheese Overload"] },
  );

  // Draft menu with pending edits on KBH (exercises draft/publish).
  // IMPORTANT: drafts must be FULL clones of the live menu — publishing replaces the
  // active menu wholesale, so a sparse draft would wipe the live catalog.
  {
    const source = await prisma.menu.findUniqueOrThrow({
      where: { id: kbhMenu.menu.id },
      include: {
        categories: { include: { items: { include: { modGroups: true } } } },
        modGroups: { include: { options: true } },
      },
    });
    const draft = await prisma.menu.create({
      data: {
        branchId: kbh.b.id,
        version: 2,
        status: "draft",
        layoutJson: { categoryOrder: ["Biryani", "Karahi", "Sides & Drinks", "Desserts"] },
      },
    });
    const groupMap = new Map<string, string>();
    for (const g of source.modGroups) {
      const ng = await prisma.modifierGroup.create({
        data: {
          menuId: draft.id,
          name: g.name,
          minSelect: g.minSelect,
          maxSelect: g.maxSelect,
          options: {
            create: g.options.map((o) => ({
              name: o.name,
              priceDeltaMinor: o.priceDeltaMinor,
              isAvailable: o.isAvailable,
              sortOrder: o.sortOrder,
            })),
          },
        },
      });
      groupMap.set(g.id, ng.id);
    }
    for (const cat of source.categories) {
      const nc = await prisma.menuCategory.create({
        data: {
          menuId: draft.id,
          name: cat.name,
          description: cat.description,
          sortOrder: cat.sortOrder,
        },
      });
      for (const item of cat.items) {
        const ni = await prisma.menuItem.create({
          data: {
            categoryId: nc.id,
            name: item.name,
            description: item.description,
            priceMinor: item.priceMinor,
            isAvailable: item.isAvailable,
            badges: item.badges,
            sortOrder: item.sortOrder,
          },
        });
        for (const join of item.modGroups) {
          const mapped = groupMap.get(join.groupId);
          if (mapped) {
            await prisma.menuItemModifierGroup.create({
              data: { itemId: ni.id, groupId: mapped, sortOrder: join.sortOrder },
            });
          }
        }
      }
    }
    // ...and the pending edit: a new Desserts category only in the draft.
    await prisma.menuCategory.create({
      data: {
        menuId: draft.id,
        name: "Desserts",
        sortOrder: 3,
        items: { create: [{ name: "Gulab Jamun (2pc)", priceMinor: 15_000, sortOrder: 0 }] },
      },
    });
  }

  // ── Ledger accounts ────────────────────────────────────────────────────
  await account("platform", "platform:cash");
  await account("platform", "platform:revenue");
  for (const { r } of [kbh, gb, bt]) {
    await account("restaurant", `restaurant:${r.id}:payable`, r.id);
  }
  for (const c of [cust1, cust2, cust3]) {
    await account("customer", `customer:${c.id}:prepaid`, c.id);
  }

  // ── Orders ─────────────────────────────────────────────────────────────
  let orderNo = 1000;

  type OrderSpec = {
    rest: { r: { id: string; tier: RestaurantTier }; b: { id: string } };
    customer: { id: string; phone: string };
    mode: PaymentMode;
    items: Array<{ menuItemId: string; name: string; price: number; qty: number }>;
    status: OrderStatus;
    placedMinutesAgo: number;
    rider?: string; // rider id for tasks in/after rider_assigned
    rejectReason?: string;
  };

  const PATHS: Record<string, OrderStatus[]> = {
    delivered: [
      "pending_acceptance",
      "accepted",
      "preparing",
      "ready_for_pickup",
      "rider_assigned",
      "picked_up",
      "out_for_delivery",
      "delivered",
    ],
    out_for_delivery: [
      "pending_acceptance",
      "accepted",
      "preparing",
      "ready_for_pickup",
      "rider_assigned",
      "picked_up",
      "out_for_delivery",
    ],
    ready_for_pickup: ["pending_acceptance", "accepted", "preparing", "ready_for_pickup"],
    preparing: ["pending_acceptance", "accepted", "preparing"],
    rejected: ["pending_acceptance", "rejected"],
    auto_expired: ["pending_acceptance", "auto_expired"],
    cancelled: ["pending_acceptance", "accepted", "cancelled"],
    pending_acceptance: ["pending_acceptance"],
  };

  async function mkOrder(spec: OrderSpec) {
    const fees = FEES[spec.rest.r.tier];
    const subtotal = spec.items.reduce((s, i) => s + i.price * i.qty, 0);
    const taxTotal = bps(subtotal, TAX_BPS);
    const deliveryFee = 8_000;
    const commission = bps(subtotal, fees.commissionBps);
    const grand = subtotal + taxTotal + deliveryFee + fees.platformFeeMinor;
    const placedAt = minutesAgo(spec.placedMinutesAgo);
    const path = PATHS[spec.status]!;
    const code = `FD-${++orderNo}`;

    const order = await prisma.order.create({
      data: {
        code,
        customerId: spec.customer.id,
        branchId: spec.rest.b.id,
        status: spec.status,
        idempotencyKey: `seed-${code}`,
        addressSnapshotJson: {
          label: "Home",
          text: "House 12, Street 4, Phase 8",
          lat: 33.5251,
          lng: 73.0952,
        },
        contactPhone: spec.customer.phone,
        subtotalMinor: subtotal,
        deliveryFeeMinor: deliveryFee,
        taxTotalMinor: taxTotal,
        platformFeeMinor: fees.platformFeeMinor,
        commissionMinor: commission,
        grandTotalMinor: grand,
        commissionBpsSnapshot: fees.commissionBps,
        paymentMode: spec.mode,
        acceptDeadlineAt:
          spec.status === "pending_acceptance"
            ? new Date(now.getTime() + 120_000)
            : new Date(placedAt.getTime() + 120_000),
        placedAt,
        prepEtaMinutes: path.includes("accepted") ? 25 : null,
        acceptedAt: path.includes("accepted") ? new Date(placedAt.getTime() + 60_000) : null,
        readyAt: path.includes("ready_for_pickup")
          ? new Date(placedAt.getTime() + 20 * 60_000)
          : null,
        pickedUpAt: path.includes("picked_up") ? new Date(placedAt.getTime() + 25 * 60_000) : null,
        deliveredAt: path.includes("delivered") ? new Date(placedAt.getTime() + 40 * 60_000) : null,
        cancelledAt: spec.status === "cancelled" ? new Date(placedAt.getTime() + 5 * 60_000) : null,
        items: {
          create: spec.items.map((i) => ({
            menuSnapshotJson: {
              menuItemId: i.menuItemId,
              name: i.name,
              priceMinor: i.price,
              modifiers: [],
            },
            qty: i.qty,
            unitPriceMinor: i.price,
            lineTotalMinor: i.price * i.qty,
          })),
        },
      },
    });

    // Event chain along the path
    for (let i = 0; i < path.length; i++) {
      await prisma.orderEvent.create({
        data: {
          orderId: order.id,
          fromStatus: i === 0 ? null : path[i - 1],
          toStatus: path[i]!,
          actorRole:
            i === 0 ? "customer" : path[i] === "auto_expired" ? "system" : "restaurant_staff",
          reason: path[i] === "rejected" ? (spec.rejectReason ?? "Out of stock") : null,
          createdAt: new Date(placedAt.getTime() + i * 4 * 60_000),
        },
      });
    }

    // Delivery task for rider-involved states
    if (
      spec.rider &&
      ["rider_assigned", "picked_up", "out_for_delivery", "delivered"].some((s) =>
        path.includes(s as OrderStatus),
      )
    ) {
      const delivered = path.includes("delivered");
      const task = await prisma.deliveryTask.create({
        data: {
          orderId: order.id,
          riderId: spec.rider,
          status: delivered ? "delivered" : "picked_up",
          codAmountMinor: spec.mode === "cod" ? grand : 0,
          assignedAt: new Date(placedAt.getTime() + 18 * 60_000),
        },
      });
      const evts: Array<{
        type: "assigned" | "arrived_pickup" | "picked_up" | "delivered";
        at: number;
      }> = [
        { type: "assigned", at: 18 },
        { type: "arrived_pickup", at: 22 },
        { type: "picked_up", at: 25 },
      ];
      if (delivered) evts.push({ type: "delivered", at: 40 });
      for (const e of evts) {
        await prisma.deliveryEvent.create({
          data: {
            taskId: task.id,
            type: e.type,
            createdAt: new Date(placedAt.getTime() + e.at * 60_000),
          },
        });
      }
    }

    // Payment row
    const captured =
      spec.mode === "card"
        ? !["auto_expired", "pending_acceptance"].includes(spec.status)
        : spec.status === "delivered";
    await prisma.payment.create({
      data: {
        orderId: order.id,
        mode: spec.mode,
        status:
          spec.status === "rejected" && spec.mode === "card"
            ? "refunded"
            : captured
              ? "captured"
              : "pending",
        providerRef: spec.mode === "card" ? `mockch_${code}` : null,
        paymentMethodId: spec.mode === "card" && spec.customer.id === cust1.id ? card1.id : null,
        amountMinor: grand,
        refundedMinor: spec.status === "rejected" && spec.mode === "card" ? grand : 0,
        capturedAt:
          spec.mode === "card"
            ? placedAt
            : path.includes("delivered")
              ? new Date(placedAt.getTime() + 40 * 60_000)
              : null,
      },
    });

    // Ledger
    const restPayable = `restaurant:${spec.rest.r.id}:payable`;
    const custPrepaid = `customer:${spec.customer.id}:prepaid`;
    if (spec.mode === "card" && captured) {
      await postTx(
        `Card charge ${code}`,
        [
          { account: "platform:cash", debit: grand },
          { account: custPrepaid, credit: grand },
        ],
        { orderId: order.id },
        placedAt,
      );
    }
    if (spec.status === "delivered") {
      const restaurantShare = subtotal + taxTotal + deliveryFee - commission;
      if (spec.mode === "card") {
        await postTx(
          `Settlement ${code} (card)`,
          [
            { account: custPrepaid, debit: grand },
            { account: restPayable, credit: restaurantShare },
            { account: "platform:revenue", credit: commission + fees.platformFeeMinor },
          ],
          { orderId: order.id },
          new Date(placedAt.getTime() + 40 * 60_000),
        );
      } else {
        // COD: restaurant holds the cash; platform books its cut as receivable.
        await postTx(
          `Settlement ${code} (COD receivable)`,
          [
            { account: restPayable, debit: commission + fees.platformFeeMinor },
            { account: "platform:revenue", credit: commission + fees.platformFeeMinor },
          ],
          { orderId: order.id },
          new Date(placedAt.getTime() + 40 * 60_000),
        );
      }
    }
    if (spec.status === "rejected" && spec.mode === "card") {
      const refund = await prisma.refund.create({
        data: {
          orderId: order.id,
          status: "refunded",
          amountMinor: grand,
          destination: "card",
          reason: "Automatic refund — order rejected",
          decidedAt: new Date(placedAt.getTime() + 10 * 60_000),
        },
      });
      await postTx(
        `Refund ${code} (rejected)`,
        [
          { account: custPrepaid, debit: grand },
          { account: "platform:cash", credit: grand },
        ],
        { orderId: order.id, refundId: refund.id },
        new Date(placedAt.getTime() + 10 * 60_000),
      );
    }
    return order;
  }

  const item = (ids: Map<string, string>, name: string, price: number, qty = 1) => ({
    menuItemId: ids.get(name)!,
    name,
    price,
    qty,
  });

  // 12 orders across all states, mixed COD/card
  const o1 = await mkOrder({
    rest: kbh,
    customer: cust1,
    mode: "card",
    status: "delivered",
    placedMinutesAgo: 60 * 26,
    rider: riderRestaurant.id,
    items: [
      item(kbhMenu.itemIds, "Chicken Biryani", 45_000, 2),
      item(kbhMenu.itemIds, "Naan", 3_000, 4),
    ],
  });
  const o2 = await mkOrder({
    rest: kbh,
    customer: cust2,
    mode: "cod",
    status: "delivered",
    placedMinutesAgo: 60 * 20,
    rider: riderRestaurant.id,
    items: [item(kbhMenu.itemIds, "Chicken Karahi (Full)", 170_000)],
  });
  const o3 = await mkOrder({
    rest: bt,
    customer: cust1,
    mode: "card",
    status: "delivered",
    placedMinutesAgo: 60 * 44,
    rider: riderRestaurant.id,
    items: [
      item(btMenu.itemIds, "Classic Smash", 60_000, 2),
      item(btMenu.itemIds, "Fries", 20_000, 2),
    ],
  });
  await mkOrder({
    rest: gb,
    customer: cust3,
    mode: "cod",
    status: "delivered",
    placedMinutesAgo: 60 * 30,
    rider: riderRestaurant.id,
    items: [
      item(gbMenu.itemIds, "Grilled Chicken Bowl", 65_000),
      item(gbMenu.itemIds, "Fresh Orange", 25_000),
    ],
  });
  await mkOrder({
    rest: kbh,
    customer: cust2,
    mode: "card",
    status: "rejected",
    placedMinutesAgo: 60 * 50,
    items: [item(kbhMenu.itemIds, "Mutton Karahi (Half)", 140_000)],
    rejectReason: "Mutton finished for the day",
  });
  await mkOrder({
    rest: bt,
    customer: cust3,
    mode: "cod",
    status: "auto_expired",
    placedMinutesAgo: 60 * 48,
    items: [item(btMenu.itemIds, "Oreo Shake", 35_000, 2)],
  });
  await mkOrder({
    rest: gb,
    customer: cust1,
    mode: "cod",
    status: "cancelled",
    placedMinutesAgo: 60 * 28,
    items: [item(gbMenu.itemIds, "Falafel Bowl", 55_000)],
  });
  const o8 = await mkOrder({
    rest: bt,
    customer: cust2,
    mode: "card",
    status: "delivered",
    placedMinutesAgo: 60 * 8,
    rider: riderRestaurant.id,
    items: [
      item(btMenu.itemIds, "Cheese Overload", 72_000),
      item(btMenu.itemIds, "Loaded Fries", 35_000),
    ],
  });
  const o9 = await mkOrder({
    rest: kbh,
    customer: cust1,
    mode: "card",
    status: "out_for_delivery",
    placedMinutesAgo: 35,
    rider: riderRestaurant.id,
    items: [
      item(kbhMenu.itemIds, "Sindhi Biryani", 50_000),
      item(kbhMenu.itemIds, "Soft Drink 500ml", 12_000, 2),
    ],
  });
  await mkOrder({
    rest: gb,
    customer: cust2,
    mode: "cod",
    status: "preparing",
    placedMinutesAgo: 15,
    items: [item(gbMenu.itemIds, "Steak Bowl", 85_000)],
  });
  await mkOrder({
    rest: kbh,
    customer: cust3,
    mode: "cod",
    status: "ready_for_pickup",
    placedMinutesAgo: 25,
    items: [item(kbhMenu.itemIds, "Beef Biryani", 55_000, 2)],
  });
  await mkOrder({
    rest: bt,
    customer: cust1,
    mode: "cod",
    status: "pending_acceptance",
    placedMinutesAgo: 0,
    items: [
      item(btMenu.itemIds, "Jalapeño Heat", 68_000),
      item(btMenu.itemIds, "Chocolate Shake", 32_000),
    ],
  });

  // Cancellation row for the cancelled order
  const cancelledOrder = await prisma.order.findFirst({ where: { status: "cancelled" } });
  await prisma.cancellation.create({
    data: {
      orderId: cancelledOrder!.id,
      cancelledBy: "customer",
      reasonCode: "customer_changed_mind",
      feeAssessedMinor: 0,
    },
  });

  // Refund pending on o8 (wrong item complaint) + support ticket
  const refund = await prisma.refund.create({
    data: {
      orderId: o8.id,
      status: "refund_pending",
      amountMinor: 35_000,
      destination: "wallet",
      reason: "Loaded Fries missing from bag",
    },
  });
  await prisma.supportTicket.create({
    data: {
      customerId: cust2.id,
      orderId: o8.id,
      category: "missing_item",
      subject: "Missing Loaded Fries",
      body: "Order arrived without the Loaded Fries. Requesting refund.",
      status: "open",
    },
  });

  // Ratings on delivered orders
  await prisma.rating.create({
    data: {
      orderId: o1.id,
      customerId: cust1.id,
      restaurantId: kbh.r.id,
      stars: 5,
      tags: ["tasty", "on-time"],
      comment: "Best biryani in Phase 8!",
    },
  });
  await prisma.rating.create({
    data: {
      orderId: o2.id,
      customerId: cust2.id,
      restaurantId: kbh.r.id,
      stars: 4,
      tags: ["tasty"],
    },
  });
  await prisma.rating.create({
    data: {
      orderId: o3.id,
      customerId: cust1.id,
      restaurantId: bt.r.id,
      stars: 4,
      tags: ["hot", "on-time"],
    },
  });

  // One completed payout for KBH (books against payable)
  const kbhPayable = accountIds.get(`restaurant:${kbh.r.id}:payable`)!;
  const payableRows = await prisma.ledgerEntry.findMany({ where: { accountId: kbhPayable } });
  const kbhBalance = payableRows.reduce((s, e) => s + e.creditMinor - e.debitMinor, 0);
  const payoutAmount = Math.max(0, Math.min(kbhBalance, 150_000));
  if (payoutAmount > 0) {
    const payout = await prisma.payout.create({
      data: {
        restaurantId: kbh.r.id,
        periodStart: daysAgo(7),
        periodEnd: daysAgo(1),
        amountMinor: payoutAmount,
        status: "paid",
        reference: "SEED-PAYOUT-001",
        paidAt: daysAgo(1),
      },
    });
    const txId = await postTx(
      `Payout ${payout.reference} to Karachi Biryani House`,
      [
        { account: `restaurant:${kbh.r.id}:payable`, debit: payoutAmount },
        { account: "platform:cash", credit: payoutAmount },
      ],
      { payoutId: payout.id },
      daysAgo(1),
    );
    await prisma.payout.update({ where: { id: payout.id }, data: { ledgerTxId: txId } });
  }

  // Audit rows for admin actions
  for (const { r } of [kbh, gb, bt]) {
    await prisma.auditLog.create({
      data: {
        actorUserId: admin.id,
        actorRole: "admin",
        action: "restaurant.approve",
        subjectType: "Restaurant",
        subjectId: r.id,
        beforeJson: { status: "pending_approval" },
        afterJson: { status: "approved" },
      },
    });
  }

  // Verify ledger balance per txId
  const entries = await prisma.ledgerEntry.groupBy({
    by: ["txId"],
    _sum: { debitMinor: true, creditMinor: true },
  });
  for (const e of entries) {
    if (e._sum.debitMinor !== e._sum.creditMinor) {
      throw new Error(`Ledger tx ${e.txId} unbalanced!`);
    }
  }

  // Cheat-sheet
  console.log(`
  ── Seed complete ─────────────────────────────────────────────
  Login (dev OTP is printed by the API console on request):

    Admin              +920000000001
    Owner (KBH, GB)    +920000000002
    Owner (BT, LB)     +920000000003
    Staff (KBH)        +920000000004
    Rider (restaurant) +920000000005
    Rider (independent)+920000000006
    Customer (card)    +920000000007
    Customer           +920000000008
    Customer           +920000000009

  Restaurants:
    karachi-biryani-house  small_business  tilt3d + parallax  (draft menu v2 pending)
    green-bowl             small_business  glass + depth
    burger-theory          chain (8% commission)  flat
    lajawab-bites          PENDING APPROVAL

  Orders: 12 seeded across all states (one live pending_acceptance,
  one out_for_delivery, one refund_pending with open ticket).
  Ledger: all ${entries.length} transactions balanced. Payout SEED-PAYOUT-001 paid.
  ──────────────────────────────────────────────────────────────`);
}

main()
  .then(async () => {
    const { disconnect } = await import("../src/index.js");
    await disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    const { disconnect } = await import("../src/index.js");
    await disconnect();
    process.exit(1);
  });
