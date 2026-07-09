// M3/M4 smoke test: browse -> quote validations -> idempotent placeOrder -> auto-expire.
export {};
const API = "http://localhost:4000/graphql";
let cookie = "";

async function gql<T = unknown>(
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
}

function assert(cond: unknown, label: string) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) process.exitCode = 1;
}

// login as a fresh customer (random number avoids the 5/hr OTP rate limit across runs)
const phone = `+9230${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
const otp = await gql<{ requestOtp: { devCode: string } }>(
  `mutation R($p: String!) { requestOtp(phone: $p) { devCode } }`,
  { p: phone },
);
if (!otp.data?.requestOtp) throw new Error(`requestOtp failed: ${JSON.stringify(otp.errors)}`);
await gql(`mutation Verify($p: String!, $c: String!) { verifyOtp(phone: $p, code: $c) { home } }`, {
  p: phone,
  c: otp.data.requestOtp.devCode,
});

// browse
const browse = await gql<{
  browseBranches: Array<{
    distanceM: number;
    branch: { id: string; restaurant: { slug: string } };
  }>;
}>(
  `query { browseBranches(lat: 33.5251, lng: 73.0952) { distanceM branch { id restaurant { slug } } } }`,
);
const hits = browse.data!.browseBranches;
assert(hits.length === 3, `browse returns 3 approved branches (got ${hits.length})`);
assert(
  !hits.some((h) => h.branch.restaurant.slug === "lajawab-bites"),
  "pending restaurant excluded",
);

// menu detail
const menuQ = await gql<{
  branchBySlug: {
    id: string;
    activeMenu: {
      categories: Array<{
        items: Array<{
          id: string;
          name: string;
          modifierGroups: Array<{
            name: string;
            minSelect: number;
            options: Array<{ id: string; name: string }>;
          }>;
        }>;
      }>;
    };
  };
}>(
  `query { branchBySlug(slug: "karachi-biryani-house") { id activeMenu { categories { items { id name modifierGroups { name minSelect options { id name } } } } } } }`,
);
const branchId = menuQ.data!.branchBySlug.id;
const items = menuQ.data!.branchBySlug.activeMenu.categories.flatMap((c) => c.items);
const biryani = items.find((i) => i.name === "Chicken Biryani")!;
const spice = biryani.modifierGroups.find((g) => g.name === "Spice level");
assert(Boolean(spice && spice.options.length === 3), `spice group present with 3 options`);
const spiceOptId = spice!.options[0]!.id;
const naan = items.find((i) => i.name === "Naan")!;

const QUOTE = `mutation Q($input: QuoteCartInput!) { quoteCart(input: $input) { subtotalMinor taxTotalMinor deliveryFeeMinor platformFeeMinor grandTotalMinor meetsMinimum inRadius distanceM } }`;

// below minimum
const q1 = await gql<{ quoteCart: { meetsMinimum: boolean } }>(QUOTE, {
  input: {
    branchId,
    deliveryLat: 33.5251,
    deliveryLng: 73.0952,
    lines: [{ menuItemId: naan.id, qty: 1 }],
  },
});
assert(q1.data!.quoteCart.meetsMinimum === false, "below-minimum flagged");

// missing required modifier
const q2 = await gql(QUOTE, {
  input: {
    branchId,
    deliveryLat: 33.5251,
    deliveryLng: 73.0952,
    lines: [{ menuItemId: biryani.id, qty: 2 }],
  },
});
assert(q2.errors?.[0]?.message.includes("Spice level"), "required modifier enforced");

// out of radius
const q3 = await gql<{ quoteCart: { inRadius: boolean; distanceM: number } }>(QUOTE, {
  input: {
    branchId,
    deliveryLat: 33.9,
    deliveryLng: 73.5,
    lines: [{ menuItemId: biryani.id, qty: 2, modifierOptionIds: [spiceOptId] }],
  },
});
assert(
  q3.data!.quoteCart.inRadius === false,
  `out-of-radius flagged (${q3.data!.quoteCart.distanceM}m)`,
);

// valid quote: 2x biryani (45000) = 90000, tax 13% = 11700, delivery 8000, platform 2000 -> 111700
const q4 = await gql<{
  quoteCart: {
    subtotalMinor: number;
    taxTotalMinor: number;
    grandTotalMinor: number;
    meetsMinimum: boolean;
    inRadius: boolean;
  };
}>(QUOTE, {
  input: {
    branchId,
    deliveryLat: 33.5251,
    deliveryLng: 73.0952,
    lines: [{ menuItemId: biryani.id, qty: 2, modifierOptionIds: [spiceOptId] }],
  },
});
const q = q4.data!.quoteCart;
assert(
  q.subtotalMinor === 90_000 && q.taxTotalMinor === 11_700 && q.grandTotalMinor === 111_700,
  `money math (got ${q.subtotalMinor}/${q.taxTotalMinor}/${q.grandTotalMinor})`,
);
assert(q.meetsMinimum && q.inRadius, "valid quote passes gates");

// placeOrder idempotency
const PLACE = `mutation P($input: PlaceOrderInput!, $key: String!) { placeOrder(input: $input, idempotencyKey: $key) { id code status } }`;
const input = {
  branchId,
  deliveryLat: 33.5251,
  deliveryLng: 73.0952,
  addressText: "House 12, Street 4, Phase 8",
  contactPhone: phone,
  paymentMode: "cod",
  lines: [{ menuItemId: biryani.id, qty: 2, modifierOptionIds: [spiceOptId] }],
};
const key = crypto.randomUUID();
const p1 = await gql<{ placeOrder: { id: string; status: string } }>(PLACE, { input, key });
const p2 = await gql<{ placeOrder: { id: string } }>(PLACE, { input, key });
assert(
  p1.data?.placeOrder.status === "pending_acceptance",
  `order placed (${p1.data?.placeOrder.id})`,
);
assert(p1.data?.placeOrder.id === p2.data?.placeOrder.id, "double-submit returns same order id");

// out-of-radius placement rejected
const p3 = await gql(PLACE, {
  input: { ...input, deliveryLat: 33.9, deliveryLng: 73.5 },
  key: crypto.randomUUID(),
});
assert(p3.errors?.[0]?.message.includes("radius"), "out-of-radius placement rejected");

// card not yet enabled
const p4 = await gql(PLACE, { input: { ...input, paymentMode: "card" }, key: crypto.randomUUID() });
assert(p4.errors?.[0]?.message.includes("Card payment"), "card blocked until M5");

// illegal transition via cancelOrder on someone else's terminal order? — use cancel on delivered order
const my = await gql<{ myOrders: Array<{ id: string; status: string }> }>(
  `query { myOrders { id status } }`,
);
const delivered = my.data!.myOrders.find((o) => o.status === "delivered");
if (delivered) {
  const c = await gql(`mutation { cancelOrder(id: "${delivered.id}") { id } }`);
  assert(c.errors?.[0]?.message.includes("Cannot transition"), "illegal transition rejected");
}

// auto-expire: wait out the 120s SLA on the just-placed order
console.log("waiting 130s for the acceptance SLA to lapse...");
await new Promise((r) => setTimeout(r, 130_000));
const after = await gql<{
  order: { status: string; events: Array<{ toStatus: string; actorRole: string | null }> };
}>(`query { order(id: "${p1.data!.placeOrder.id}") { status events { toStatus actorRole } } }`);
assert(
  after.data?.order.status === "auto_expired",
  `order auto-expired (got ${after.data?.order.status})`,
);
assert(
  after.data?.order.events.some((e) => e.toStatus === "auto_expired" && e.actorRole === "system"),
  "system event row written",
);

console.log("done.");
