// Run with: node --test --experimental-strip-types src/phone.test.ts  (see package.json "test")
import assert from "node:assert/strict";
import { test } from "node:test";
import { PK_PHONE_MESSAGE, normalizePkPhone, pkPhoneSchema } from "./phone.ts";

const CANONICAL = "+923102658153";

test("normalizePkPhone accepts and normalizes common PK forms", () => {
  // 11-digit local, leading 0
  assert.equal(normalizePkPhone("03102658153"), CANONICAL);
  // 10-digit, no leading 0
  assert.equal(normalizePkPhone("3102658153"), CANONICAL);
  // spaces (local)
  assert.equal(normalizePkPhone("0310 265 8153"), CANONICAL);
  // spaces, already +92
  assert.equal(normalizePkPhone("+92 310 2658153"), CANONICAL);
  // dashes
  assert.equal(normalizePkPhone("0310-265-8153"), CANONICAL);
  // already canonical passes through
  assert.equal(normalizePkPhone("+923102658153"), CANONICAL);
  // 00 international access prefix
  assert.equal(normalizePkPhone("00923102658153"), CANONICAL);
  // bare country code without +
  assert.equal(normalizePkPhone("923102658153"), CANONICAL);
  // surrounding whitespace
  assert.equal(normalizePkPhone("  03102658153  "), CANONICAL);
  // trunk 0 left after +92 (keeping the field's prefilled +92 and typing the local form)
  assert.equal(normalizePkPhone("+92 0310 2658153"), CANONICAL);
  assert.equal(normalizePkPhone("+9203102658153"), CANONICAL);
});

test("normalizePkPhone rejects invalid inputs", () => {
  assert.equal(normalizePkPhone(""), null);
  assert.equal(normalizePkPhone("+92"), null);
  assert.equal(normalizePkPhone("0310265815"), null); // one digit short
  assert.equal(normalizePkPhone("031026581530"), null); // one digit long
  assert.equal(normalizePkPhone("abc"), null);
  assert.equal(normalizePkPhone("+1 555 123 4567"), null); // wrong country
  // non-mobile PK number: 10 significant digits but not starting with 3
  assert.equal(normalizePkPhone("01234567890"), null);
  assert.equal(normalizePkPhone("+921234567890"), null);
});

test("pkPhoneSchema normalizes on parse and errors with friendly copy", () => {
  assert.equal(pkPhoneSchema.parse("03102658153"), CANONICAL);
  assert.equal(pkPhoneSchema.parse("+92 310 2658153"), CANONICAL);

  const result = pkPhoneSchema.safeParse("+92");
  assert.equal(result.success, false);
  assert.equal(result.error?.issues[0]?.message, PK_PHONE_MESSAGE);
});

test("friendly message never leaks the raw pattern", () => {
  assert.equal(PK_PHONE_MESSAGE.includes("+92XXXXXXXXXX"), false);
});
