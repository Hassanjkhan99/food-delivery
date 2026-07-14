// M10 smoke test: SSE subscription receives a live event when an order is placed.
export {};
const API = "http://localhost:4000/graphql";

function makeSession() {
  let cookie = "";
  const gql = async function <T = unknown>(
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
  gql.getCookie = () => cookie;
  return gql;
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

const owner = makeSession();
await login(owner, "+923000000002");
const branchId = (
  await owner<{ branchBySlug: { id: string } }>(
    `query { branchBySlug(slug: "karachi-biryani-house") { id } }`,
  )
).data!.branchBySlug.id;

// open the SSE subscription (graphql-sse "distinct connections" mode: GET + Accept header)
const url = new URL(API);
url.searchParams.set(
  "query",
  `subscription { branchOrderFeed(branchId: "${branchId}") { orderId status } }`,
);
const events: string[] = [];
const controller = new AbortController();
const ssePromise = (async () => {
  const res = await fetch(url, {
    headers: { accept: "text/event-stream", cookie: owner.getCookie() },
    signal: controller.signal,
  });
  assert(
    res.ok && res.headers.get("content-type")?.includes("text/event-stream"),
    `SSE stream opened (${res.status})`,
  );
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    for (const line of buf.split("\n")) {
      if (line.startsWith("data:") && line.includes("branchOrderFeed")) events.push(line);
    }
    if (events.length > 0) break;
  }
})().catch((e) => {
  if ((e as Error).name !== "AbortError") throw e;
});

// give the stream a moment to establish, then place an order as a customer
await new Promise((r) => setTimeout(r, 1_000));

const cust = makeSession();
const custPhone = `+9235${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
await login(cust, custPhone);
const menuQ = await cust<{
  branchBySlug: {
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
  `query { branchBySlug(slug: "karachi-biryani-house") { activeMenu { categories { items { id name modifierGroups { name options { id } } } } } } }`,
);
const items = menuQ.data!.branchBySlug.activeMenu.categories.flatMap((c) => c.items);
const karahi = items.find((i) => i.name === "Chicken Karahi (Full)")!;
const spiceOpt = karahi.modifierGroups.find((g) => g.name === "Spice level")!.options[0]!.id;
const placed = await cust<{ placeOrder: { id: string } }>(
  `mutation P($input: PlaceOrderInput!, $key: String!) { placeOrder(input: $input, idempotencyKey: $key) { id } }`,
  {
    key: crypto.randomUUID(),
    input: {
      branchId,
      deliveryLat: 33.5251,
      deliveryLng: 73.0952,
      addressText: "House 12",
      contactPhone: custPhone,
      paymentMode: "cod",
      lines: [{ menuItemId: karahi.id, qty: 1, modifierOptionIds: [spiceOpt] }],
    },
  },
);
assert(Boolean(placed.data?.placeOrder.id), "order placed while stream open");

// wait up to 5s for the event
const deadline = Date.now() + 5_000;
while (events.length === 0 && Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 100));
}
controller.abort();
await ssePromise;
assert(events.length > 0, `SSE event received (<1s typical): ${events[0]?.slice(0, 120)}`);
assert(events[0]?.includes(placed.data!.placeOrder.id), "event carries the new order id");

// authz: a customer cannot subscribe to the branch feed
const res2 = await fetch(url, {
  headers: { accept: "text/event-stream", cookie: cust.getCookie() },
});
const text = await res2.text();
assert(
  text.includes("Not a member") || text.includes("error"),
  "customer blocked from branch feed subscription",
);

console.log("done.");
