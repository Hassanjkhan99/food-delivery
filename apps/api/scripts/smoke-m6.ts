// M6 smoke test: restaurant console — board lifecycle, menu draft/publish, wallet.
export {};
const API = "http://localhost:4000/graphql";

type GqlResult<T> = { data?: T; errors?: Array<{ message: string }> };

function makeSession() {
  let cookie = "";
  return async function gql<T = unknown>(query: string, variables?: Record<string, unknown>): Promise<GqlResult<T>> {
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
  const otp = await gql<{ requestOtp: { devCode: string } }>(`mutation R($p: String!) { requestOtp(phone: $p) { devCode } }`, { p: phone });
  if (!otp.data?.requestOtp) throw new Error(`otp failed for ${phone}: ${JSON.stringify(otp.errors)}`);
  await gql(`mutation V($p: String!, $c: String!) { verifyOtp(phone: $p, code: $c) { home } }`, { p: phone, c: otp.data.requestOtp.devCode });
}

// customer places a COD order at KBH
const customer = makeSession();
const custPhone = `+9232${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
await login(customer, custPhone);

const menuQ = await customer<{ branchBySlug: { id: string; activeMenu: { version: number; categories: Array<{ items: Array<{ id: string; name: string; modifierGroups: Array<{ name: string; options: Array<{ id: string }> }> }> }> } } }>(
  `query { branchBySlug(slug: "karachi-biryani-house") { id activeMenu { version categories { items { id name modifierGroups { name options { id } } } } } } }`,
);
const branchId = menuQ.data!.branchBySlug.id;
const liveVersion = menuQ.data!.branchBySlug.activeMenu.version;
const items = menuQ.data!.branchBySlug.activeMenu.categories.flatMap((c) => c.items);
const karahi = items.find((i) => i.name === "Chicken Karahi (Full)")!;
const spiceOpt = karahi.modifierGroups.find((g) => g.name === "Spice level")!.options[0]!.id;

const placed = await customer<{ placeOrder: { id: string; code: string } }>(
  `mutation P($input: PlaceOrderInput!, $key: String!) { placeOrder(input: $input, idempotencyKey: $key) { id code } }`,
  {
    key: crypto.randomUUID(),
    input: {
      branchId, deliveryLat: 33.5251, deliveryLng: 73.0952,
      addressText: "House 12, Street 4, Phase 8", contactPhone: custPhone, paymentMode: "cod",
      lines: [{ menuItemId: karahi.id, qty: 1, modifierOptionIds: [spiceOpt] }],
    },
  },
);
const orderId = placed.data!.placeOrder.id;
assert(Boolean(orderId), `customer placed ${placed.data?.placeOrder.code}`);

// owner drives the board
const owner = makeSession();
await login(owner, "+920000000002");

const board = await owner<{ boardOrders: Array<{ id: string; status: string }> }>(
  `query B($b: String!) { boardOrders(branchId: $b) { id status } }`, { b: branchId },
);
assert(board.data?.boardOrders.some((o) => o.id === orderId && o.status === "pending_acceptance"), "order visible on board as NEW");

const accepted = await owner<{ acceptOrder: { status: string; prepEtaMinutes: number } }>(
  `mutation { acceptOrder(id: "${orderId}", prepEtaMinutes: 20) { status prepEtaMinutes } }`,
);
assert(accepted.data?.acceptOrder.prepEtaMinutes === 20, `accepted with ETA (status ${accepted.data?.acceptOrder.status})`);

const reaccept = await owner(`mutation { acceptOrder(id: "${orderId}", prepEtaMinutes: 10) { status } }`);
assert(Boolean(reaccept.errors?.length), "double-accept rejected");

await owner(`mutation { startPreparing(id: "${orderId}") { status } }`);
const ready = await owner<{ markReady: { status: string } }>(`mutation { markReady(id: "${orderId}") { status } }`);
assert(ready.data?.markReady.status === "ready_for_pickup", "marked ready");

const riders = await owner<{ branchRiders: Array<{ id: string; user: { name: string } }> }>(
  `query R($b: String!) { branchRiders(branchId: $b) { id user { name } } }`, { b: branchId },
);
const rider = riders.data!.branchRiders[0]!;
const assigned = await owner<{ assignRider: { status: string } }>(
  `mutation { assignRider(orderId: "${orderId}", riderId: "${rider.id}") { status } }`,
);
assert(assigned.data?.assignRider.status === "rider_assigned", `rider assigned (${rider.user.name})`);

// customer sees the progress
const track = await customer<{ order: { status: string; events: Array<{ toStatus: string }> } }>(
  `query { order(id: "${orderId}") { status events { toStatus } } }`,
);
assert(track.data?.order.status === "rider_assigned", "customer timeline reflects rider_assigned");
assert((track.data?.order.events.length ?? 0) >= 5, `full event chain (${track.data?.order.events.length} events)`);

// menu draft -> publish
const draft = await owner<{ draftMenu: { id: string; version: number; categories: Array<{ id: string; name: string }> } }>(
  `query D($b: String!) { draftMenu(branchId: $b) { id version categories { id name } } }`, { b: branchId },
);
assert(Boolean(draft.data?.draftMenu), `draft menu v${draft.data?.draftMenu.version} exists`);
const catId = draft.data!.draftMenu.categories[0]!.id;
const newItem = await owner<{ upsertMenuItem: { id: string; name: string } }>(
  `mutation { upsertMenuItem(branchId: "${branchId}", categoryId: "${catId}", name: "Smoke Test Special", priceMinor: 99900) { id name } }`,
);
assert(newItem.data?.upsertMenuItem.name === "Smoke Test Special", "item added to draft");

// draft item must NOT be visible to customers yet
const before = await customer<{ branchBySlug: { activeMenu: { version: number; categories: Array<{ items: Array<{ name: string }> }> } } }>(
  `query { branchBySlug(slug: "karachi-biryani-house") { activeMenu { version categories { items { name } } } } }`,
);
assert(!before.data!.branchBySlug.activeMenu.categories.flatMap((c) => c.items).some((i) => i.name === "Smoke Test Special"), "draft item hidden pre-publish");

const pub = await owner<{ publishMenu: { version: number } }>(`mutation { publishMenu(branchId: "${branchId}") { version } }`);
assert((pub.data?.publishMenu.version ?? 0) > liveVersion, `published v${pub.data?.publishMenu.version}`);

const after = await customer<{ branchBySlug: { activeMenu: { version: number; categories: Array<{ items: Array<{ name: string }> }> } } }>(
  `query { branchBySlug(slug: "karachi-biryani-house") { activeMenu { version categories { items { name } } } } }`,
);
assert(after.data!.branchBySlug.activeMenu.categories.flatMap((c) => c.items).some((i) => i.name === "Smoke Test Special"), "published item visible to customers");

// wallet
const kbhId = (await owner<{ myRestaurants: Array<{ id: string; slug: string }> }>(`query { myRestaurants { id slug } }`)).data!.myRestaurants.find((r) => r.slug === "karachi-biryani-house")!.id;
const wallet = await owner<{ walletBalance: number; walletStatement: Array<{ memo: string }>; payoutHistory: Array<{ status: string }> }>(
  `query W($r: String!) { walletBalance(restaurantId: $r) walletStatement(restaurantId: $r) { memo } payoutHistory(restaurantId: $r) { status } }`, { r: kbhId },
);
assert(typeof wallet.data?.walletBalance === "number", `wallet balance readable (${wallet.data?.walletBalance})`);
assert((wallet.data?.payoutHistory.length ?? 0) >= 1, "payout history visible");

// authz: customer cannot use the board
const forbidden = await customer(`query B($b: String!) { boardOrders(branchId: $b) { id } }`, { b: branchId });
assert(Boolean(forbidden.errors?.length), "customer blocked from boardOrders");

console.log("done.");
