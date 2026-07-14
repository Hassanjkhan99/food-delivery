// Unit tests for the scheduled-order promotion timing math (#199). Pure functions, no DB /
// clock, so they run under Node's built-in test runner with zero extra deps:
//   node --test --experimental-strip-types packages/shared/src/constants.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  computeScheduledPromoteAt,
  SCHEDULED_PROMOTE_BASE_LEAD_MINUTES,
  scheduledPromoteLeadMinutes,
} from "./constants.ts";

test("scheduledPromoteLeadMinutes: base lead when the branch is not busy", () => {
  assert.equal(scheduledPromoteLeadMinutes(0), SCHEDULED_PROMOTE_BASE_LEAD_MINUTES);
  assert.equal(scheduledPromoteLeadMinutes(), SCHEDULED_PROMOTE_BASE_LEAD_MINUTES);
});

test("scheduledPromoteLeadMinutes: adds the branch busy buffer", () => {
  assert.equal(scheduledPromoteLeadMinutes(15), SCHEDULED_PROMOTE_BASE_LEAD_MINUTES + 15);
});

test("scheduledPromoteLeadMinutes: negative buffer is floored at 0", () => {
  assert.equal(scheduledPromoteLeadMinutes(-99), SCHEDULED_PROMOTE_BASE_LEAD_MINUTES);
});

test("computeScheduledPromoteAt: subtracts the lead time from scheduledFor", () => {
  const scheduledFor = new Date("2026-07-14T19:00:00.000Z");
  const promoteAt = computeScheduledPromoteAt(scheduledFor, 30);
  assert.equal(promoteAt.toISOString(), "2026-07-14T18:30:00.000Z");
});

test("computeScheduledPromoteAt: lead of 0 promotes exactly at scheduledFor", () => {
  const scheduledFor = new Date("2026-07-14T19:00:00.000Z");
  assert.equal(computeScheduledPromoteAt(scheduledFor, 0).getTime(), scheduledFor.getTime());
});

test("computeScheduledPromoteAt: composes with the busy-buffer lead", () => {
  const scheduledFor = new Date("2026-07-14T19:00:00.000Z");
  const lead = scheduledPromoteLeadMinutes(10); // base + 10
  const promoteAt = computeScheduledPromoteAt(scheduledFor, lead);
  assert.equal(
    promoteAt.getTime(),
    scheduledFor.getTime() - (SCHEDULED_PROMOTE_BASE_LEAD_MINUTES + 10) * 60_000,
  );
});

test("computeScheduledPromoteAt: does not mutate the input date", () => {
  const scheduledFor = new Date("2026-07-14T19:00:00.000Z");
  const before = scheduledFor.getTime();
  computeScheduledPromoteAt(scheduledFor, 45);
  assert.equal(scheduledFor.getTime(), before);
});
