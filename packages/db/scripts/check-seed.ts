// Quick data sanity check used by milestone verification.
import { prisma, disconnect } from "../src/index.js";

const statuses = await prisma.order.groupBy({ by: ["status"], _count: true });
console.log("orders by status:", Object.fromEntries(statuses.map((s) => [s.status, s._count])));

const unbalanced = await prisma.$queryRaw<Array<{ txId: string }>>`
  SELECT "txId" FROM ledger_entries
  GROUP BY "txId"
  HAVING SUM("debitMinor") <> SUM("creditMinor")`;
console.log("unbalanced ledger txs:", unbalanced.length);

const counts = {
  users: await prisma.user.count(),
  restaurants: await prisma.restaurant.count(),
  menuItems: await prisma.menuItem.count(),
  orderEvents: await prisma.orderEvent.count(),
  ledgerEntries: await prisma.ledgerEntry.count(),
  payouts: await prisma.payout.count(),
  ratings: await prisma.rating.count(),
  themes: await prisma.restaurantTheme.count(),
};
console.log("counts:", counts);

await disconnect();
