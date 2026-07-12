// Owner lifecycle smoke test: a brand-new restaurant from zero.
//
// Walks the full restaurant-manager journey end to end:
//   sign up -> onboard blank restaurant -> admin approval -> build menu
//   (category, item, modifier group+option, combo) -> publish -> configure
//   branch (hours, accepting, busy mode) -> invite rider -> take a delivery
//   order (accept/prep/ETA/ready/assign) -> take a pickup order (through to
//   delivered) -> customer rates -> owner responds -> analytics/wallet ->
//   branding -> reject flow -> authz guard.
//
// Unlike smoke-m6 (which drives the seeded KBH restaurant), this one creates a
// fresh restaurant + owner + customer on every run, so it is self-contained and
// leaves the seed world untouched. Requires the API + DB running.
export {};
const API = process.env.SMOKE_API ?? "http://localhost:4000/graphql";

type GqlResult<T> = { data?: T; errors?: Array<{ message: string }> };

function makeSession() {
  let cookie = "";
  return async function gql<T = unknown>(
    query: string,
    variables?: Record<string, unknown>,
  ): Promise<GqlResult<T>> {
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

let failures = 0;
function assert(cond: unknown, label: string, res?: GqlResult<unknown>) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) {
    failures++;
    process.exitCode = 1;
    if (res?.errors) console.log(`        errors: ${JSON.stringify(res.errors)}`);
  }
}

async function login(gql: ReturnType<typeof makeSession>, phone: string) {
  const otp = await gql<{ requestOtp: { devCode: string } }>(
    `mutation R($p: String!) { requestOtp(phone: $p) { devCode } }`,
    { p: phone },
  );
  if (!otp.data?.requestOtp)
    throw new Error(`otp failed for ${phone}: ${JSON.stringify(otp.errors)}`);
  await gql(`mutation V($p: String!, $c: String!) { verifyOtp(phone: $p, code: $c) { home } }`, {
    p: phone,
    c: otp.data.requestOtp.devCode,
  });
}

const rnd = () => String(Math.floor(Math.random() * 1e8)).padStart(8, "0");
const LAT = 24.8607;
const LNG = 67.0011;

// ---------------------------------------------------------------------------
// 1. New owner signs up and onboards a blank restaurant (pending approval)
// ---------------------------------------------------------------------------
const owner = makeSession();
const ownerPhone = `+9230${rnd()}`;
await login(owner, ownerPhone);

const bizName = `Smoke Diner ${rnd()}`;
// Request scalars only: resolving the `branches` relation inline off the mutation
// return value trips Pothos' "Unable to find delegate for model Restaurant".
const onboard = await owner<{ submitOnboarding: { id: string; slug: string; status: string } }>(
  `mutation O($name: String!, $addr: String!, $lat: Float!, $lng: Float!, $min: Int!, $fee: Int!, $rad: Int!) {
     submitOnboarding(name: $name, addressText: $addr, lat: $lat, lng: $lng, minOrderMinor: $min, deliveryFeeMinor: $fee, deliveryRadiusM: $rad) {
       id slug status
     }
   }`,
  {
    name: bizName,
    addr: "Plot 1, Main Boulevard, Karachi",
    lat: LAT,
    lng: LNG,
    min: 0,
    fee: 12000,
    rad: 25000,
  },
);
const restaurantId = onboard.data?.submitOnboarding.id;
const slug = onboard.data?.submitOnboarding.slug;
assert(Boolean(restaurantId), `onboarded "${bizName}" (slug ${slug})`, onboard);
assert(
  onboard.data?.submitOnboarding.status === "pending_approval",
  "new restaurant is pending_approval",
  onboard,
);

// Branch id comes from myRestaurants, where the branches relation resolves cleanly.
const mine = await owner<{ myRestaurants: Array<{ id: string; branches: Array<{ id: string }> }> }>(
  `query { myRestaurants { id branches { id } } }`,
);
const branchId = mine.data?.myRestaurants.find((r) => r.id === restaurantId)?.branches[0]?.id;
assert(Boolean(branchId), "branch id resolved via myRestaurants", mine);

// ---------------------------------------------------------------------------
// 2. Admin approves the restaurant
// ---------------------------------------------------------------------------
const admin = makeSession();
await login(admin, "+920000000001");
const approved = await admin<{ approveRestaurant: { status: string } }>(
  `mutation A($id: String!) { approveRestaurant(id: $id) { status } }`,
  { id: restaurantId },
);
assert(
  approved.data?.approveRestaurant.status === "approved",
  "admin approved restaurant",
  approved,
);

// ---------------------------------------------------------------------------
// 3. Owner builds the draft menu: category, item, modifier group + option, combo
// ---------------------------------------------------------------------------
const draft = await owner<{ draftMenu: { id: string; version: number } }>(
  `query D($b: String!) { draftMenu(branchId: $b) { id version } }`,
  { b: branchId },
);
assert(
  Boolean(draft.data?.draftMenu),
  `draft menu v${draft.data?.draftMenu.version} auto-created`,
  draft,
);

const cat = await owner<{ upsertCategory: { id: string; name: string } }>(
  `mutation C($b: String!) { upsertCategory(branchId: $b, name: "Mains") { id name } }`,
  { b: branchId },
);
const categoryId = cat.data?.upsertCategory.id;
assert(Boolean(categoryId), "created category 'Mains'", cat);

const item = await owner<{ upsertMenuItem: { id: string; name: string } }>(
  `mutation I($b: String!, $c: String!) {
     upsertMenuItem(branchId: $b, categoryId: $c, name: "Signature Handi", description: "House special", priceMinor: 80000, compareAtPriceMinor: 95000, badges: ["chef-special"]) { id name }
   }`,
  { b: branchId, c: categoryId },
);
const itemId = item.data?.upsertMenuItem.id;
assert(Boolean(itemId), "created item 'Signature Handi' with offer price", item);

const group = await owner<{ upsertModifierGroup: { id: string } }>(
  `mutation G($b: String!, $i: String!) {
     upsertModifierGroup(branchId: $b, itemId: $i, name: "Spice Level", minSelect: 1, maxSelect: 1) { id }
   }`,
  { b: branchId, i: itemId },
);
const groupId = group.data?.upsertModifierGroup.id;
assert(Boolean(groupId), "created required modifier group 'Spice Level'", group);

const opt = await owner<{ upsertModifierOption: { id: string } }>(
  `mutation MO($g: String!) { upsertModifierOption(groupId: $g, name: "Medium", priceDeltaMinor: 5000, isAvailable: true) { id } }`,
  { g: groupId },
);
const optionId = opt.data?.upsertModifierOption.id;
assert(Boolean(optionId), "added modifier option 'Medium' (+Rs50)", opt);

const combo = await owner<{ upsertCombo: { id: string } }>(
  `mutation CB($b: String!) { upsertCombo(branchId: $b, name: "Family Deal", description: "Handi + drinks", priceMinor: 150000) { id } }`,
  { b: branchId },
);
const comboId = combo.data?.upsertCombo.id;
assert(Boolean(comboId), "created combo 'Family Deal'", combo);
const comboAdd = await owner(
  `mutation CA($c: String!, $i: String!) { addComboItem(comboId: $c, menuItemId: $i, qty: 2) { id } }`,
  { c: comboId, i: itemId },
);
assert(!comboAdd.errors, "added item to combo (qty 2)", comboAdd);

const avail = await owner<{ setItemAvailability: { isAvailable: boolean } }>(
  `mutation SA($i: String!) { setItemAvailability(itemId: $i, available: true) { isAvailable } }`,
  { i: itemId },
);
assert(avail.data?.setItemAvailability.isAvailable === true, "item marked available", avail);

// ---------------------------------------------------------------------------
// 4. Publish the menu
// ---------------------------------------------------------------------------
const pub = await owner<{ publishMenu: { version: number; status: string } }>(
  `mutation P($b: String!) { publishMenu(branchId: $b) { version status } }`,
  { b: branchId },
);
assert(
  pub.data?.publishMenu.status === "published",
  `published menu v${pub.data?.publishMenu.version}`,
  pub,
);

// ---------------------------------------------------------------------------
// 5. Configure the branch: all-day hours, accepting orders, busy mode
// ---------------------------------------------------------------------------
const hours = Array.from({ length: 7 }, (_, d) => ({
  dayOfWeek: d,
  openMinute: 0,
  closeMinute: 1439,
}));
// Select a scalar: resolving `hours` off the mutation return trips the same
// "Unable to find delegate for model Branch". We verify persistence separately below.
const setHours = await owner<{ setBranchHours: { id: string } }>(
  `mutation SH($b: String!, $h: [BranchHoursInput!]!) { setBranchHours(branchId: $b, hours: $h) { id } }`,
  { b: branchId, h: hours },
);
assert(!setHours.errors, "set 7-day opening hours", setHours);

const accepting = await owner<{ setAcceptingOrders: { isAcceptingOrders: boolean } }>(
  `mutation AC($b: String!) { setAcceptingOrders(branchId: $b, accepting: true) { isAcceptingOrders } }`,
  { b: branchId },
);
assert(
  accepting.data?.setAcceptingOrders.isAcceptingOrders === true,
  "branch accepting orders",
  accepting,
);

const busy = await owner<{ setBusyMode: { prepBufferMinutes: number } }>(
  `mutation BM($b: String!) { setBusyMode(branchId: $b, bufferMinutes: 10) { prepBufferMinutes } }`,
  { b: branchId },
);
assert(busy.data?.setBusyMode.prepBufferMinutes === 10, "busy-mode prep buffer set to 10m", busy);

// ---------------------------------------------------------------------------
// 6. Invite a restaurant rider
// ---------------------------------------------------------------------------
const invite = await owner<{ inviteRider: { id: string } }>(
  `mutation IR($b: String!, $p: String!) { inviteRider(branchId: $b, phone: $p, name: "Rider Ali") { id } }`,
  { b: branchId, p: `+9231${rnd()}` },
);
const riderId = invite.data?.inviteRider.id;
assert(Boolean(riderId), "invited restaurant rider 'Rider Ali'", invite);

// ---------------------------------------------------------------------------
// 7. Customer discovers the published menu and places a DELIVERY order
// ---------------------------------------------------------------------------
const customer = makeSession();
const custPhone = `+9232${rnd()}`;
await login(customer, custPhone);

// Verify the hours persisted (relation resolves cleanly on a query, unlike the mutation return).
const hrsCheck = await owner<{ branchBySlug: { hours: Array<{ dayOfWeek: number }> } | null }>(
  `query H($s: String!) { branchBySlug(slug: $s) { hours { dayOfWeek } } }`,
  { s: slug },
);
assert((hrsCheck.data?.branchBySlug?.hours.length ?? 0) === 7, "7-day hours persisted", hrsCheck);

type CustItem = {
  id: string;
  name: string;
  modifierGroups: Array<{ id: string; options: Array<{ id: string; name: string }> }>;
};
const disco = await customer<{
  branchBySlug: {
    id: string;
    activeMenu: { categories: Array<{ items: CustItem[] }> } | null;
  } | null;
}>(
  `query B($s: String!) { branchBySlug(slug: $s) { id activeMenu { categories { items { id name modifierGroups { id options { id name } } } } } } }`,
  { s: slug },
);
const custItem = disco.data?.branchBySlug?.activeMenu?.categories
  .flatMap((c) => c.items)
  .find((i) => i.name === "Signature Handi");
assert(Boolean(custItem), "customer sees published item on live menu", disco);
// Use the PUBLISHED option id (publishMenu re-ids everything; the draft optionId is stale).
const custOptionId = custItem?.modifierGroups[0]?.options[0]?.id;
assert(Boolean(custOptionId), "published item exposes its modifier option", disco);

const orderA = await customer<{ placeOrder: { id: string; code: string; status: string } }>(
  `mutation P($input: PlaceOrderInput!, $key: String!) { placeOrder(input: $input, idempotencyKey: $key) { id code status } }`,
  {
    key: crypto.randomUUID(),
    input: {
      branchId,
      deliveryLat: LAT,
      deliveryLng: LNG,
      addressText: "House 5, Block A, Karachi",
      contactPhone: custPhone,
      paymentMode: "cod",
      fulfillmentMode: "delivery",
      lines: [{ menuItemId: custItem!.id, qty: 1, modifierOptionIds: [custOptionId!] }],
    },
  },
);
const orderAId = orderA.data?.placeOrder.id;
assert(Boolean(orderAId), `customer placed DELIVERY order ${orderA.data?.placeOrder.code}`, orderA);

// ---------------------------------------------------------------------------
// 8. Owner drives the delivery order across the board
// ---------------------------------------------------------------------------
const board = await owner<{ boardOrders: Array<{ id: string; status: string }> }>(
  `query B($b: String!) { boardOrders(branchId: $b) { id status } }`,
  { b: branchId },
);
assert(
  board.data?.boardOrders.some((o) => o.id === orderAId && o.status === "pending_acceptance"),
  "delivery order visible on board as NEW",
  board,
);

const acc = await owner<{ acceptOrder: { status: string; prepEtaMinutes: number } }>(
  `mutation { acceptOrder(id: "${orderAId}", prepEtaMinutes: 25) { status prepEtaMinutes } }`,
);
assert(
  acc.data?.acceptOrder.prepEtaMinutes === 25,
  `accepted with 25m ETA (${acc.data?.acceptOrder.status})`,
  acc,
);
await owner(`mutation { startPreparing(id: "${orderAId}") { status } }`);
const eta = await owner<{ updatePrepEta: { prepEtaMinutes: number } }>(
  `mutation { updatePrepEta(id: "${orderAId}", prepEtaMinutes: 30) { prepEtaMinutes } }`,
);
assert(eta.data?.updatePrepEta.prepEtaMinutes === 30, "prep ETA updated to 30m", eta);
const rdy = await owner<{ markReady: { status: string } }>(
  `mutation { markReady(id: "${orderAId}") { status } }`,
);
assert(rdy.data?.markReady.status === "ready_for_pickup", "delivery order marked ready", rdy);
const assign = await owner<{ assignRider: { status: string } }>(
  `mutation { assignRider(orderId: "${orderAId}", riderId: "${riderId}") { status } }`,
);
assert(
  assign.data?.assignRider.status === "rider_assigned",
  "rider assigned to delivery order",
  assign,
);

// ---------------------------------------------------------------------------
// 9. Customer places a PICKUP order; owner takes it through to delivered
// ---------------------------------------------------------------------------
const orderB = await customer<{ placeOrder: { id: string; code: string } }>(
  `mutation P($input: PlaceOrderInput!, $key: String!) { placeOrder(input: $input, idempotencyKey: $key) { id code } }`,
  {
    key: crypto.randomUUID(),
    input: {
      branchId,
      deliveryLat: LAT,
      deliveryLng: LNG,
      addressText: "Pickup",
      contactPhone: custPhone,
      paymentMode: "cod",
      fulfillmentMode: "pickup",
      lines: [{ menuItemId: custItem!.id, qty: 2, modifierOptionIds: [custOptionId!] }],
    },
  },
);
const orderBId = orderB.data?.placeOrder.id;
assert(Boolean(orderBId), `customer placed PICKUP order ${orderB.data?.placeOrder.code}`, orderB);
await owner(`mutation { acceptOrder(id: "${orderBId}", prepEtaMinutes: 15) { status } }`);
await owner(`mutation { startPreparing(id: "${orderBId}") { status } }`);
await owner(`mutation { markReady(id: "${orderBId}") { status } }`);
const collected = await owner<{ markCollected: { status: string } }>(
  `mutation { markCollected(id: "${orderBId}") { status } }`,
);
assert(
  collected.data?.markCollected.status === "delivered",
  "pickup order collected -> delivered",
  collected,
);

// ---------------------------------------------------------------------------
// 10. Customer rates the delivered order; owner responds
// ---------------------------------------------------------------------------
const rated = await customer<{ rateOrder: { id: string; stars: number } }>(
  `mutation RT($o: String!) { rateOrder(orderId: $o, stars: 5, tags: ["tasty","fast"], comment: "Loved the handi!") { id stars } }`,
  { o: orderBId },
);
const ratingId = rated.data?.rateOrder.id;
assert(rated.data?.rateOrder.stars === 5, "customer left a 5-star review", rated);
const response = await owner<{ respondToRating: { body: string } }>(
  `mutation RR($r: String!) { respondToRating(ratingId: $r, body: "Thank you, see you again!") { body } }`,
  { r: ratingId },
);
assert(Boolean(response.data?.respondToRating.body), "owner responded to the review", response);

// ---------------------------------------------------------------------------
// 11. Owner reads today's summary, analytics, and wallet
// ---------------------------------------------------------------------------
const today = await owner<{ todaySummary: { orders: number; revenueMinor: number } }>(
  `query T($b: String!) { todaySummary(branchId: $b) { orders revenueMinor acceptanceSlaPct } }`,
  { b: branchId },
);
assert(
  (today.data?.todaySummary.orders ?? 0) >= 1,
  `today summary: ${today.data?.todaySummary.orders} orders`,
  today,
);
const analytics = await owner<{
  restaurantAnalytics: { totalOrders: number; topItems: Array<{ name: string }> };
}>(
  `query AN($b: String!) { restaurantAnalytics(branchId: $b, days: 30) { totalOrders totalRevenueMinor topItems { name } } }`,
  { b: branchId },
);
assert(
  (analytics.data?.restaurantAnalytics.totalOrders ?? 0) >= 1,
  `analytics: ${analytics.data?.restaurantAnalytics.totalOrders} total orders`,
  analytics,
);
const wallet = await owner<{ walletBalance: number; walletStatement: Array<{ memo: string }> }>(
  `query W($r: String!) { walletBalance(restaurantId: $r) walletStatement(restaurantId: $r) { memo } }`,
  { r: restaurantId },
);
assert(
  typeof wallet.data?.walletBalance === "number",
  `wallet balance readable (${wallet.data?.walletBalance})`,
  wallet,
);

// ---------------------------------------------------------------------------
// 12. Owner customizes branding
// ---------------------------------------------------------------------------
const theme = await owner<{ updateTheme: { primaryColor: string; cardStyle: string } }>(
  `mutation TH($r: String!) { updateTheme(restaurantId: $r, primaryColor: "#e11d48", accentColor: "#f59e0b", cardStyle: "glass", heroEffect: "parallax") { primaryColor cardStyle } }`,
  { r: restaurantId },
);
assert(theme.data?.updateTheme.primaryColor === "#e11d48", "branding theme updated", theme);

// ---------------------------------------------------------------------------
// 13. Reject flow: a new order is rejected with a reason
// ---------------------------------------------------------------------------
const orderC = await customer<{ placeOrder: { id: string } }>(
  `mutation P($input: PlaceOrderInput!, $key: String!) { placeOrder(input: $input, idempotencyKey: $key) { id } }`,
  {
    key: crypto.randomUUID(),
    input: {
      branchId,
      deliveryLat: LAT,
      deliveryLng: LNG,
      addressText: "House 9, Karachi",
      contactPhone: custPhone,
      paymentMode: "cod",
      fulfillmentMode: "delivery",
      lines: [{ menuItemId: custItem!.id, qty: 1, modifierOptionIds: [custOptionId!] }],
    },
  },
);
const orderCId = orderC.data?.placeOrder.id;
assert(Boolean(orderCId), "customer placed a third order (to be rejected)", orderC);
if (orderCId) {
  const rej = await owner<{ rejectOrder: { status: string } }>(
    `mutation { rejectOrder(id: "${orderCId}", reason: "out_of_stock") { status } }`,
  );
  assert(rej.data?.rejectOrder.status === "rejected", "owner rejected an order with a reason", rej);
}

// ---------------------------------------------------------------------------
// 14. Authz guard: the customer cannot read the owner board
// ---------------------------------------------------------------------------
const forbidden = await customer(`query B($b: String!) { boardOrders(branchId: $b) { id } }`, {
  b: branchId,
});
assert(Boolean(forbidden.errors?.length), "customer blocked from boardOrders", forbidden);

console.log(`\n${failures === 0 ? "ALL PASSED" : `${failures} FAILURE(S)`}`);
