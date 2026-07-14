// Run with: node --test --experimental-strip-types src/money.test.ts  (see package.json "test")
import assert from "node:assert/strict";
import { test } from "node:test";
import { allocateLineTax, displayPriceMinor, isAllowedTaxLabel, splitTax } from "./money.ts";

test("splitTax exclusive: tax added on top of a pre-tax base", () => {
  const b = splitTax(10_000, 1300, false); // Rs 100 + 13%
  assert.equal(b.baseMinor, 10_000);
  assert.equal(b.taxMinor, 1_300);
  assert.equal(b.finalMinor, 11_300);
});

test("splitTax inclusive: base backed out of a tax-inclusive price", () => {
  const b = splitTax(11_300, 1300, true); // Rs 113 incl 13%
  assert.equal(b.baseMinor, 10_000);
  assert.equal(b.taxMinor, 1_300);
  assert.equal(b.finalMinor, 11_300);
});

test("splitTax always reconciles: final === base + tax (rounding safe)", () => {
  for (const amount of [1, 7, 99, 100, 333, 12_345, 999_999]) {
    for (const rate of [0, 1, 500, 1300, 1700, 2500]) {
      for (const inclusive of [true, false]) {
        const b = splitTax(amount, rate, inclusive);
        assert.equal(b.baseMinor + b.taxMinor, b.finalMinor, `${amount}/${rate}/${inclusive}`);
        assert.ok(b.taxMinor >= 0 && b.baseMinor >= 0);
      }
    }
  }
});

test("splitTax: zero rate and zero/negative amount produce no tax", () => {
  assert.deepEqual(splitTax(10_000, 0, true), {
    baseMinor: 10_000,
    taxMinor: 0,
    finalMinor: 10_000,
  });
  assert.deepEqual(splitTax(0, 1300, true), { baseMinor: 0, taxMinor: 0, finalMinor: 0 });
  assert.deepEqual(splitTax(-5, 1300, false), { baseMinor: 0, taxMinor: 0, finalMinor: 0 });
});

test("splitTax inclusive/exclusive are inverse round-trips", () => {
  // Take an exclusive base, gross it up, then back it out inclusively → same base & tax.
  const rate = 1300;
  const excl = splitTax(10_000, rate, false);
  const incl = splitTax(excl.finalMinor, rate, true);
  assert.equal(incl.baseMinor, excl.baseMinor);
  assert.equal(incl.taxMinor, excl.taxMinor);
});

test("allocateLineTax: per-line tax sums EXACTLY to order tax (exclusive)", () => {
  const lines = [333, 333, 334]; // awkward split of 1000
  const rate = 1300;
  const alloc = allocateLineTax(lines, rate, false);
  const order = splitTax(1000, rate, false);
  assert.equal(
    alloc.reduce((s, l) => s + l.taxMinor, 0),
    order.taxMinor,
  );
  // Exclusive: each line base is unchanged.
  assert.deepEqual(
    alloc.map((l) => l.baseMinor),
    lines,
  );
});

test("allocateLineTax: per-line tax sums EXACTLY to order tax (inclusive)", () => {
  const lines = [3_767, 3_767, 3_766]; // tax-inclusive grosses
  const rate = 1700;
  const alloc = allocateLineTax(lines, rate, true);
  const order = splitTax(
    lines.reduce((s, l) => s + l, 0),
    rate,
    true,
  );
  assert.equal(
    alloc.reduce((s, l) => s + l.taxMinor, 0),
    order.taxMinor,
  );
  // Inclusive: each line gross (final) is unchanged.
  assert.deepEqual(
    alloc.map((l) => l.finalMinor),
    lines,
  );
  // And bases sum to the order base (no lost minor unit).
  assert.equal(
    alloc.reduce((s, l) => s + l.baseMinor, 0),
    order.baseMinor,
  );
});

test("allocateLineTax: deterministic allocation of the odd minor unit", () => {
  // Three equal lines whose ideal tax share is fractional; largest-remainder + line order
  // must place the extra unit deterministically on the earliest line.
  const alloc = allocateLineTax([1000, 1000, 1000], 1300, false);
  const taxes = alloc.map((l) => l.taxMinor);
  assert.equal(
    taxes.reduce((s, t) => s + t, 0),
    splitTax(3000, 1300, false).taxMinor,
  );
  // Same input → same output every run.
  const again = allocateLineTax([1000, 1000, 1000], 1300, false).map((l) => l.taxMinor);
  assert.deepEqual(taxes, again);
});

test("allocateLineTax: empty and zero-rate inputs are safe", () => {
  assert.deepEqual(allocateLineTax([], 1300, true), []);
  assert.deepEqual(allocateLineTax([500, 700], 0, false), [
    { baseMinor: 500, taxMinor: 0, finalMinor: 500 },
    { baseMinor: 700, taxMinor: 0, finalMinor: 700 },
  ]);
});

test("displayPriceMinor: switching mode never changes the underlying charge", () => {
  // Stored exclusive Rs 100 base, 13%: inclusive display = 113, exclusive display = 100.
  assert.equal(displayPriceMinor(10_000, 1300, false, "inclusive"), 11_300);
  assert.equal(displayPriceMinor(10_000, 1300, false, "exclusive"), 10_000);
  // Stored inclusive Rs 113 (incl 13%): inclusive display = 113, exclusive display = 100.
  assert.equal(displayPriceMinor(11_300, 1300, true, "inclusive"), 11_300);
  assert.equal(displayPriceMinor(11_300, 1300, true, "exclusive"), 10_000);
});

test("isAllowedTaxLabel guards against arbitrary labels", () => {
  assert.ok(isAllowedTaxLabel("Sales tax"));
  assert.ok(isAllowedTaxLabel("GST"));
  assert.ok(!isAllowedTaxLabel("Platform Tax"));
  assert.ok(!isAllowedTaxLabel("totally made up"));
});
