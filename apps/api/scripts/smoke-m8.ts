// M8 smoke test: three-actor lifecycle — customer places, restaurant preps+assigns,
// rider picks up and delivers with COD capture; ledger settles; mismatch opens ticket.
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
  if (!otp.data?.requestOtp)
    throw new Error(`otp failed for ${phone}: ${JSON.stringify(otp.errors)}`);
  await gql(`mutation V($p: String!, $c: String!) { verifyOtp(phone: $p, code: $c) { home } }`, {
    p: phone,
    c: otp.data.requestOtp.devCode,
  });
}

const customer = makeSession();
const owner = makeSession();
const rider = makeSession();
const custPhone = `+9233${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
await login(customer, custPhone);
await login(owner, "+923000000002");
await login(rider, "+923000000005");

// customer orders COD from KBH
const menuQ = await customer<{
  branchBySlug: {
    id: string;
    activeMenu: {
      categories: Array<{
        items: Array<{
          id: string;
          name: string;
          modifierGroups: Array<{ name: string; options: Array<{ id: string }> }>;
        }>;
      }>;
    };
  };
}>(
  `query { branchBySlug(slug: "karachi-biryani-house") { id activeMenu { categories { items { id name modifierGroups { name options { id } } } } } } }`,
);
const branchId = menuQ.data!.branchBySlug.id;
const items = menuQ.data!.branchBySlug.activeMenu.categories.flatMap((c) => c.items);
const karahi = items.find((i) => i.name === "Chicken Karahi (Full)")!;
const spiceOpt = karahi.modifierGroups.find((g) => g.name === "Spice level")!.options[0]!.id;
const placed = await customer<{
  placeOrder: { id: string; code: string; grandTotalMinor: number };
}>(
  `mutation P($input: PlaceOrderInput!, $key: String!) { placeOrder(input: $input, idempotencyKey: $key) { id code grandTotalMinor } }`,
  {
    key: crypto.randomUUID(),
    input: {
      branchId,
      deliveryLat: 33.5251,
      deliveryLng: 73.0952,
      addressText: "House 12, Street 4, Phase 8",
      contactPhone: custPhone,
      paymentMode: "cod",
      lines: [{ menuItemId: karahi.id, qty: 1, modifierOptionIds: [spiceOpt] }],
    },
  },
);
const orderId = placed.data!.placeOrder.id;
const grand = placed.data!.placeOrder.grandTotalMinor;

// restaurant preps + assigns Hamza
await owner(`mutation { acceptOrder(id: "${orderId}", prepEtaMinutes: 15) { status } }`);
await owner(`mutation { startPreparing(id: "${orderId}") { status } }`);
await owner(`mutation { markReady(id: "${orderId}") { status } }`);
const riders = await owner<{ branchRiders: Array<{ id: string; user: { phone: string } }> }>(
  `query R($b: String!) { branchRiders(branchId: $b) { id user { phone } } }`,
  { b: branchId },
);
const hamza = riders.data!.branchRiders.find((r) => r.user.phone === "+923000000005")!;
await owner(`mutation { assignRider(orderId: "${orderId}", riderId: "${hamza.id}") { status } }`);

// rider goes online, sees the job
await rider(`mutation { setAvailability(online: true) }`);
const profile = await rider<{ myRiderProfile: { isOnline: boolean } }>(
  `query { myRiderProfile { isOnline } }`,
);
assert(profile.data?.myRiderProfile.isOnline === true, "rider online");

const jobs = await rider<{
  myJobs: Array<{ id: string; status: string; codAmountMinor: number; order: { id: string } }>;
}>(`query { myJobs { id status codAmountMinor order { id } } }`);
const job = jobs.data!.myJobs.find((j) => j.order.id === orderId);
assert(job?.status === "assigned", "job visible as assigned");
assert(job?.codAmountMinor === grand, `COD amount on task = grand total (${job?.codAmountMinor})`);

// deliver-before-pickup blocked
const early = await rider(
  `mutation { riderDelivered(taskId: "${job!.id}", codCollectedMinor: ${grand}) { status } }`,
);
assert(Boolean(early.errors?.length), "deliver before pickup blocked");

await rider(`mutation { riderArrivedAtPickup(taskId: "${job!.id}") { status } }`);

// Pickup PIN handoff (#25): the restaurant shows the order-scoped PIN; the rider must
// enter it (verifyPickupPin) before collecting — the wrong-rider guard. Read the PIN as
// the owner (riders can never READ it), verify as the rider, then collect.
const pinQ = await owner<{ order: { pickupPin: string | null } }>(
  `query { order(id: "${orderId}") { pickupPin } }`,
);
const pin = pinQ.data!.order.pickupPin!;
const verified = await rider<{ verifyPickupPin: boolean }>(
  `mutation { verifyPickupPin(taskId: "${job!.id}", pin: "${pin}") }`,
);
assert(verified.data?.verifyPickupPin === true, "pickup PIN verified");

const picked = await rider<{ riderPickedUp: { status: string } }>(
  `mutation { riderPickedUp(taskId: "${job!.id}") { status } }`,
);
assert(picked.data?.riderPickedUp.status === "picked_up", "picked up");

const midway = await customer<{ order: { status: string } }>(
  `query { order(id: "${orderId}") { status } }`,
);
assert(midway.data?.order.status === "out_for_delivery", "customer sees out_for_delivery");

// deliver with a COD mismatch (declared 100 short) -> ticket opens, delivery completes
const short = grand - 10_000;
const del = await rider<{ riderDelivered: { status: string } }>(
  `mutation { riderDelivered(taskId: "${job!.id}", codCollectedMinor: ${short}) { status } }`,
);
assert(del.data?.riderDelivered.status === "delivered", "delivered");

const final = await customer<{ order: { status: string } }>(
  `query { order(id: "${orderId}") { status } }`,
);
assert(final.data?.order.status === "delivered", "order delivered end-to-end across 3 actors");

const earnings = await rider<{ myEarnings: { deliveredCount: number; codCollectedMinor: number } }>(
  `query { myEarnings { deliveredCount codCollectedMinor } }`,
);
assert(
  (earnings.data?.myEarnings.deliveredCount ?? 0) >= 1,
  `earnings visible (${earnings.data?.myEarnings.deliveredCount} delivered)`,
);

console.log("done. (COD mismatch ticket + ledger settlement verified via check-ledger)");
