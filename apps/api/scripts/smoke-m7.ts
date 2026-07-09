// M7 smoke test: presigned uploads, source docs, CSV import, theming, layout, ratings.
export {};
const API = "http://localhost:4000/graphql";

function makeSession() {
  let cookie = "";
  return async function gql<T = unknown>(query: string, variables?: Record<string, unknown>): Promise<{ data?: T; errors?: Array<{ message: string }> }> {
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
  if (!otp.data?.requestOtp) throw new Error(`otp failed: ${JSON.stringify(otp.errors)}`);
  await gql(`mutation V($p: String!, $c: String!) { verifyOtp(phone: $p, code: $c) { home } }`, { p: phone, c: otp.data.requestOtp.devCode });
}

const owner = makeSession();
await login(owner, "+920000000002");

const branchId = (await owner<{ branchBySlug: { id: string } }>(`query { branchBySlug(slug: "karachi-biryani-house") { id } }`)).data!.branchBySlug.id;
const kbhId = (await owner<{ myRestaurants: Array<{ id: string; slug: string }> }>(`query { myRestaurants { id slug } }`)).data!.myRestaurants.find((r) => r.slug === "karachi-biryani-house")!.id;

// 1) upload an "image" (fake png bytes) via presign -> PUT -> finalize
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const pre = await owner<{ presignUpload: { assetId: string; uploadUrl: string } }>(
  `mutation { presignUpload(contentType: "image/png", byteSize: ${png.byteLength}, kind: "image") { assetId uploadUrl } }`,
);
assert(Boolean(pre.data?.presignUpload.uploadUrl), "presign issued");
const put = await fetch(pre.data!.presignUpload.uploadUrl, { method: "PUT", body: png });
assert(put.ok, `direct PUT accepted (${put.status})`);
const fin = await owner<{ finalizeUpload: { status: string; url: string } }>(
  `mutation { finalizeUpload(assetId: "${pre.data!.presignUpload.assetId}") { status url } }`,
);
assert(fin.data?.finalizeUpload.status === "finalized", "finalize hashed + confirmed");
const got = await fetch(fin.data!.finalizeUpload.url);
assert(got.ok && (await got.arrayBuffer()).byteLength === png.byteLength, "public GET serves the bytes");

// size cap
const tooBig = await owner(`mutation { presignUpload(contentType: "image/png", byteSize: ${11 * 1024 * 1024}, kind: "image") { assetId } }`);
assert(Boolean(tooBig.errors?.length), "10MB image cap enforced");

// 2) register as menu source doc
const doc = await owner<{ registerMenuSourceDoc: { id: string } }>(
  `mutation { registerMenuSourceDoc(branchId: "${branchId}", assetId: "${pre.data!.presignUpload.assetId}", kind: "photo") { id } }`,
);
assert(Boolean(doc.data?.registerMenuSourceDoc.id), "menu source doc registered");

// 3) CSV upload -> preview -> import
const csv = `category,name,description,price\nDesserts,Kheer,"Creamy, chilled",250\nDesserts,Jalebi,,180\nBad Row,,missing name,100\n`;
const csvBytes = new TextEncoder().encode(csv);
const preCsv = await owner<{ presignUpload: { assetId: string; uploadUrl: string } }>(
  `mutation { presignUpload(contentType: "text/csv", byteSize: ${csvBytes.byteLength}, kind: "csv") { assetId uploadUrl } }`,
);
await fetch(preCsv.data!.presignUpload.uploadUrl, { method: "PUT", body: csvBytes });
await owner(`mutation { finalizeUpload(assetId: "${preCsv.data!.presignUpload.assetId}") { status } }`);
const preview = await owner<{ previewMenuCsv: Array<{ name: string; priceMinor: number; error: string | null }> }>(
  `mutation { previewMenuCsv(assetId: "${preCsv.data!.presignUpload.assetId}") { name priceMinor error } }`,
);
assert(preview.data?.previewMenuCsv.length === 3, "CSV preview parses 3 rows");
assert(preview.data?.previewMenuCsv.filter((r) => r.error).length === 1, "invalid row flagged");
assert(preview.data?.previewMenuCsv[0]?.priceMinor === 25_000, "quoted field + Rs price parsed");
const imp = await owner<{ importMenuCsvToDraft: { created: number; updated: number } }>(
  `mutation { importMenuCsvToDraft(branchId: "${branchId}", assetId: "${preCsv.data!.presignUpload.assetId}") { created updated } }`,
);
assert(imp.data?.importMenuCsvToDraft.created === 2, `2 items imported into draft (${JSON.stringify(imp.data?.importMenuCsvToDraft)})`);

// 4) theme update visible on the public branch query
const th = await owner(`mutation { updateTheme(restaurantId: "${kbhId}", primaryColor: "#0e7490", cardStyle: "glass", heroEffect: "depth") { id } }`);
assert(!th.errors, "theme updated");
const pub = await owner<{ branchBySlug: { restaurant: { theme: { primaryColor: string; cardStyle: string } } } }>(
  `query { branchBySlug(slug: "karachi-biryani-house") { restaurant { theme { primaryColor cardStyle } } } }`,
);
assert(pub.data?.branchBySlug.restaurant.theme.primaryColor === "#0e7490" && pub.data.branchBySlug.restaurant.theme.cardStyle === "glass", "public theme reflects change");
const badColor = await owner(`mutation { updateTheme(restaurantId: "${kbhId}", primaryColor: "teal") { id } }`);
assert(Boolean(badColor.errors?.length), "non-hex color rejected");

// restore the seed theme
await owner(`mutation { updateTheme(restaurantId: "${kbhId}", primaryColor: "#b45309", cardStyle: "tilt3d", heroEffect: "parallax") { id } }`);

// 5) layout update
const lay = await owner(`mutation { updateMenuLayout(branchId: "${branchId}", layoutJson: { displayModes: { Desserts: "grid" } }) { id } }`);
assert(!lay.errors, "layoutJson updated on draft");

// 6) rating: customer 0008 rates their delivered (unrated) order
const cust = makeSession();
await login(cust, "+920000000008");
const orders = await cust<{ myOrders: Array<{ id: string; status: string }> }>(`query { myOrders { id status } }`);
const delivered = orders.data!.myOrders.filter((o) => o.status === "delivered");
let ratedOk = false;
for (const o of delivered) {
  const r = await cust<{ rateOrder: { stars: number } }>(`mutation { rateOrder(orderId: "${o.id}", stars: 5, comment: "great") { stars } }`);
  if (r.data?.rateOrder.stars === 5) {
    ratedOk = true;
    const again = await cust(`mutation { rateOrder(orderId: "${o.id}", stars: 1) { stars } }`);
    assert(Boolean(again.errors?.length), "double-rating rejected");
    break;
  }
}
assert(ratedOk, "delivered order rated once");

// non-delivered rating rejected
const notDelivered = orders.data!.myOrders.find((o) => o.status !== "delivered");
if (notDelivered) {
  const r = await cust(`mutation { rateOrder(orderId: "${notDelivered.id}", stars: 4) { stars } }`);
  assert(Boolean(r.errors?.length), "rating non-delivered order rejected");
}

console.log("done.");
