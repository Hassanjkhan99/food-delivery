/**
 * Mirror of the deterministic demo world produced by `pnpm db:seed`
 * (packages/db/prisma/seed.ts). Kept as plain constants so specs read cleanly
 * and so a seed drift shows up as a single-file diff here.
 *
 * NOTE: phones/slugs must track the seed. If the seed changes, update this file.
 */
export const SEED_USERS = {
  admin: { phone: "+920000000001", name: "Demo Admin" },
  ownerKarachiBiryani: { phone: "+920000000002", name: "Owner Karachi Biryani" },
  ownerBurgerTheory: { phone: "+920000000003", name: "Owner Burger Theory" },
  staffKbh: { phone: "+920000000004", name: "Counter Staff KBH" },
  riderRestaurant: { phone: "+920000000005", name: "Hamza (Restaurant Rider)" },
  riderIndependent: { phone: "+920000000006", name: "Bilal (Independent Rider)" },
  customerCard: { phone: "+920000000007", name: "Ayesha Customer" },
  customer2: { phone: "+920000000008", name: "Danish Customer" },
  customer3: { phone: "+920000000009", name: "Fatima Customer" },
} as const;

export type SeedUserKey = keyof typeof SEED_USERS;

/**
 * Mock payment cards recognised by the platform-controlled (mocked) gateway.
 * The decline card lets us assert the failed-charge path without a real PSP.
 * If the mock gateway uses different numbers, update here + the card spec.
 */
export const MOCK_CARDS = {
  approve: "4242424242424242",
  decline: "4000000000000002",
} as const;
