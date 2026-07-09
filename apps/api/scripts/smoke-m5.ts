// M5 smoke test: saved cards -> card charge + ledger -> cancel auto-refund -> declined card.
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

const phone = `+9231${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
const otp = await gql<{ requestOtp: { devCode: string } }>(
  `mutation R($p: String!) { requestOtp(phone: $p) { devCode } }`,
  { p: phone },
);
await gql(`mutation V($p: String!, $c: String!) { verifyOtp(phone: $p, code: $c) { home } }`, {
  p: phone,
  c: otp.data!.requestOtp.devCode,
});

// add a good card and the decline test card
const ADD = `mutation A($card: CardInput!) { addPaymentMethod(card: $card) { id brand last4 isDefault } }`;
const good = await gql<{
  addPaymentMethod: { id: string; brand: string; last4: string; isDefault: boolean };
}>(ADD, {
  card: { number: "4242424242424242", expMonth: 12, expYear: 2030, cvc: "123" },
});
assert(
  good.data?.addPaymentMethod.brand === "visa" && good.data.addPaymentMethod.last4 === "4242",
  "card tokenized (visa •••• 4242)",
);
assert(good.data?.addPaymentMethod.isDefault === true, "first card is default");
const decline = await gql<{ addPaymentMethod: { id: string } }>(ADD, {
  card: { number: "4000000000000002", expMonth: 11, expYear: 2029, cvc: "999" },
});
const badExpiry = await gql(ADD, {
  card: { number: "4242424242424242", expMonth: 1, expYear: 2024, cvc: "123" },
});
assert(badExpiry.errors?.[0]?.message.includes("expired"), "expired card rejected");

// fetch a menu item
const menuQ = await gql<{
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
  `query { branchBySlug(slug: "burger-theory") { id activeMenu { categories { items { id name modifierGroups { name options { id } } } } } } }`,
);
const branchId = menuQ.data!.branchBySlug.id;
const items = menuQ.data!.branchBySlug.activeMenu.categories.flatMap((c) => c.items);
const burger = items.find((i) => i.name === "Classic Smash")!;

const PLACE = `mutation P($input: PlaceOrderInput!, $key: String!) { placeOrder(input: $input, idempotencyKey: $key) { id code status grandTotalMinor } }`;
const baseInput = {
  branchId,
  deliveryLat: 33.5104,
  deliveryLng: 73.1152,
  addressText: "Plaza 9, Business Bay, Phase 8",
  contactPhone: phone,
  lines: [{ menuItemId: burger.id, qty: 2 }],
};

// card order (chain restaurant: 8% commission + Rs30 platform fee)
const p1 = await gql<{
  placeOrder: { id: string; code: string; status: string; grandTotalMinor: number };
}>(PLACE, {
  input: { ...baseInput, paymentMode: "card", paymentMethodId: good.data!.addPaymentMethod.id },
  key: crypto.randomUUID(),
});
assert(
  p1.data?.placeOrder.status === "pending_acceptance",
  `card order placed ${p1.data?.placeOrder.code}`,
);
const orderId = p1.data!.placeOrder.id;
const grand = p1.data!.placeOrder.grandTotalMinor;
// subtotal 120000, tax 15600, delivery 8000, platform 3000 => 146600
assert(grand === 146_600, `chain money math (got ${grand})`);

// declined card
const p2 = await gql(PLACE, {
  input: { ...baseInput, paymentMode: "card", paymentMethodId: decline.data!.addPaymentMethod.id },
  key: crypto.randomUUID(),
});
assert(p2.errors?.[0]?.message.includes("declined"), "decline card rejected with issuer message");

// cancel the charged order -> automatic refund
const c = await gql<{ cancelOrder: { status: string } }>(
  `mutation { cancelOrder(id: "${orderId}", reason: "changed my mind") { status } }`,
);
assert(c.data?.cancelOrder.status === "cancelled", "charged order cancelled");

// DB-side verification via a raw check would need db access; assert via API shape instead:
const detail = await gql<{ order: { events: Array<{ toStatus: string }> } }>(
  `query { order(id: "${orderId}") { events { toStatus } } }`,
);
assert(
  detail.data?.order.events.some((e) => e.toStatus === "cancelled"),
  "cancel event recorded",
);

console.log("done. run check-ledger for balance verification.");
