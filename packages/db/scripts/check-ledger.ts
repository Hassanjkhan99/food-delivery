// Ledger invariants: every txId balances; per-account balances; refund reversals net to zero.
import { prisma, disconnect } from "../src/index.js";

const unbalanced = await prisma.$queryRaw<Array<{ txId: string }>>`
  SELECT "txId" FROM ledger_entries
  GROUP BY "txId"
  HAVING SUM("debitMinor") <> SUM("creditMinor")`;
console.log(
  `${unbalanced.length === 0 ? "PASS" : "FAIL"}  all ledger txs balanced (${unbalanced.length} unbalanced)`,
);

// A charged-then-refunded order's customer prepaid legs must net to zero.
const refunded = await prisma.payment.findFirst({
  where: { mode: "card", status: "refunded" },
  include: { order: true },
  orderBy: { createdAt: "desc" },
});
if (refunded) {
  const legs = await prisma.ledgerEntry.findMany({ where: { orderId: refunded.orderId } });
  const prepaidAccounts = await prisma.ledgerAccount.findMany({
    where: { code: { startsWith: `customer:${refunded.order.customerId}:` } },
  });
  const ids = new Set(prepaidAccounts.map((a) => a.id));
  const net = legs
    .filter((l) => ids.has(l.accountId))
    .reduce((s, l) => s + l.creditMinor - l.debitMinor, 0);
  console.log(
    `${net === 0 ? "PASS" : "FAIL"}  refunded order ${refunded.order.code}: customer prepaid nets to ${net}`,
  );
  const refundRow = await prisma.refund.findFirst({ where: { orderId: refunded.orderId } });
  console.log(
    `${refundRow?.status === "refunded" ? "PASS" : "FAIL"}  Refund row auto-created (${refundRow?.status})`,
  );
} else {
  console.log("SKIP  no refunded card payment found");
}

const balances = await prisma.$queryRaw<Array<{ code: string; balance: number }>>`
  SELECT a.code, (SUM(e."creditMinor") - SUM(e."debitMinor"))::int AS balance
  FROM ledger_entries e JOIN ledger_accounts a ON a.id = e."accountId"
  GROUP BY a.code ORDER BY a.code`;
console.log("account balances (credit - debit):");
for (const b of balances) console.log(`  ${b.code}: ${b.balance}`);

await disconnect();
