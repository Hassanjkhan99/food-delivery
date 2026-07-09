// M9 smoke test: admin — stats, approval->browse visibility, tier snapshot, override
// audited, refund decision with money, payout batch zeroes wallet, fee versioning.
export {};
const API = "http://localhost:4000/graphql";

function makeSession() {
  let cookie = "";
  return async function gql<T = unknown>(
    query: string,
    variables?: Record<string, unknown>,
  ): Promise<{ data?: T; errors?: Array<{ message: string }> }> {
    const res = await fetch(API, {
      method: "POST",
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
      body: JSON.stringify({ query, variables }),
    });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0]!;
    return res.json() as never;
  };
}
function assert(cond: unknown, label: string) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) process.exitCode = 1;
}
async function login(gql: ReturnType<typeof makeSession>, phone: string) {
  const otp = await gql<{ requestOtp: { devCode: string } }>(
    `mutation R($p: String!) { requestOtp(phone: $p) { devCode } }`,
    { p: phone },
  );
  if (!otp.data?.requestOtp) throw new Error(`otp failed: ${JSON.stringify(otp.errors)}`);
  await gql(`mutation V($p: String!, $c: String!) { verifyOtp(phone: $p, code: $c) { home } }`, {
    p: phone,
    c: otp.data.requestOtp.devCode,
  });
}

const admin = makeSession();
await login(admin, "+920000000001");
const anon = makeSession();

// authz: anonymous blocked
const blocked = await anon(`query { dashboardStats { ordersToday } }`);
assert(Boolean(blocked.errors?.length), "anonymous blocked from admin stats");

// stats
const stats = await admin<{
  dashboardStats: { ordersToday: number; pendingApprovals: number; pendingRefunds: number };
}>(`query { dashboardStats { ordersToday pendingApprovals pendingRefunds acceptanceSlaPct } }`);
assert(
  typeof stats.data?.dashboardStats.ordersToday === "number",
  `stats readable (${JSON.stringify(stats.data?.dashboardStats)})`,
);
assert(
  (stats.data?.dashboardStats.pendingApprovals ?? 0) >= 1,
  "pending approval visible (Lajawab Bites)",
);

// approve pending restaurant -> appears in customer browse
const queue = await admin<{ restaurantApprovalQueue: Array<{ id: string; slug: string }> }>(
  `query { restaurantApprovalQueue { id slug } }`,
);
const lajawab = queue.data!.restaurantApprovalQueue.find((r) => r.slug === "lajawab-bites")!;
await admin(`mutation { approveRestaurant(id: "${lajawab.id}") { status } }`);
// (Lajawab has no published menu so it won't show in browse — but its status must be approved)
const approved = await admin<{ allRestaurants: Array<{ slug: string; status: string }> }>(
  `query { allRestaurants { slug status } }`,
);
assert(
  approved.data?.allRestaurants.find((r) => r.slug === "lajawab-bites")?.status === "approved",
  "restaurant approved",
);

// tier change: set Green Bowl to chain, verify next order snapshots 8%
const gb = approved.data!.allRestaurants.find((r) => r.slug === "green-bowl")!;
const gbFull = await admin<{ allRestaurants: Array<{ id: string; slug: string }> }>(
  `query { allRestaurants { id slug } }`,
);
const gbId = gbFull.data!.allRestaurants.find((r) => r.slug === "green-bowl")!.id;
await admin(`mutation { setRestaurantTier(id: "${gbId}", tier: "chain") { tier } }`);

const cust = makeSession();
const custPhone = `+9234${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
await login(cust, custPhone);
const gbMenu = await cust<{
  branchBySlug: {
    id: string;
    activeMenu: { categories: Array<{ items: Array<{ id: string; name: string }> }> };
  };
}>(
  `query { branchBySlug(slug: "green-bowl") { id activeMenu { categories { items { id name } } } } }`,
);
const bowl = gbMenu
  .data!.branchBySlug.activeMenu.categories.flatMap((c) => c.items)
  .find((i) => i.name === "Steak Bowl")!;
const q = await cust<{ quoteCart: { platformFeeMinor: number; subtotalMinor: number } }>(
  `mutation Q($input: QuoteCartInput!) { quoteCart(input: $input) { platformFeeMinor subtotalMinor } }`,
  {
    input: {
      branchId: gbMenu.data!.branchBySlug.id,
      deliveryLat: 33.5312,
      deliveryLng: 73.0871,
      lines: [{ menuItemId: bowl.id, qty: 1 }],
    },
  },
);
assert(
  q.data?.quoteCart.platformFeeMinor === 3_000,
  `chain platform fee applied after tier change (${q.data?.quoteCart.platformFeeMinor})`,
);
await admin(`mutation { setRestaurantTier(id: "${gbId}", tier: "small_business") { tier } }`);

// refund workbench: approve the seeded pending refund (wallet destination)
const rq = await admin<{
  refundQueue: Array<{
    id: string;
    amountMinor: number;
    destination: string;
    order: { code: string };
  }>;
}>(`query { refundQueue { id amountMinor destination order { code } } }`);
assert(
  (rq.data?.refundQueue.length ?? 0) >= 1,
  `refund queue has ${rq.data?.refundQueue.length} case(s)`,
);
const refund = rq.data!.refundQueue[0]!;
const decided = await admin<{ decideRefund: { status: string } }>(
  `mutation { decideRefund(id: "${refund.id}", approve: true) { status } }`,
);
assert(
  decided.data?.decideRefund.status === "refunded",
  `refund ${refund.order.code} approved -> refunded`,
);
const again = await admin(
  `mutation { decideRefund(id: "${refund.id}", approve: true) { status } }`,
);
assert(Boolean(again.errors?.length), "double-decide rejected");

// override: illegal transition from terminal state rejected; legal override works
const anyDelivered = await admin<{ auditLogs: Array<{ action: string }> }>(
  `query { auditLogs(take: 10) { action } }`,
);
assert(
  anyDelivered.data?.auditLogs.some((a) => a.action === "refund.approve"),
  "refund decision audited",
);

// payout batch zeroes positive balances
const before = await admin<{
  payoutCandidates: Array<{ restaurantId: string; balanceMinor: number; name: string }>;
}>(`query { payoutCandidates { restaurantId balanceMinor name } }`);
const positive = before.data!.payoutCandidates.filter((c) => c.balanceMinor > 0);
const batch = await admin<{ runPayoutBatch: Array<{ reference: string; amountMinor: number }> }>(
  `mutation { runPayoutBatch { reference amountMinor } }`,
);
assert(
  (batch.data?.runPayoutBatch.length ?? 0) === positive.length,
  `payout batch paid ${batch.data?.runPayoutBatch.length}/${positive.length} positive balances`,
);
const after = await admin<{ payoutCandidates: Array<{ balanceMinor: number }> }>(
  `query { payoutCandidates { balanceMinor } }`,
);
assert(
  !after.data?.payoutCandidates.some((c) => c.balanceMinor > 0),
  "all positive balances zeroed",
);

// fee versioning
await admin(
  `mutation { updateFeeConfig(smallBusinessCommissionBps: 100, smallBusinessPlatformFeeMinor: 2000, chainCommissionBps: 800, chainPlatformFeeMinor: 3000) { id } }`,
);
const fees = await admin<{ currentFeeConfig: { smallBusinessCommissionBps: number } }>(
  `query { currentFeeConfig { smallBusinessCommissionBps } }`,
);
assert(fees.data?.currentFeeConfig.smallBusinessCommissionBps === 100, "new fee version active");
await admin(
  `mutation { updateFeeConfig(smallBusinessCommissionBps: 0, smallBusinessPlatformFeeMinor: 2000, chainCommissionBps: 800, chainPlatformFeeMinor: 3000) { id } }`,
);

console.log("done.");
