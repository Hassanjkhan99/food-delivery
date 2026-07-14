// Run with: node --test --experimental-strip-types src/roles.test.ts  (see package.json "test")
import assert from "node:assert/strict";
import { test } from "node:test";
import { homeForRoles, isRestaurantOwner } from "./roles.ts";

test("isRestaurantOwner: owner of the given restaurant", () => {
  const roles = [{ role: "restaurant_owner", restaurantId: "r1" }];
  assert.equal(isRestaurantOwner(roles, "r1"), true);
});

test("isRestaurantOwner: staff membership is NOT ownership (#204)", () => {
  const roles = [{ role: "restaurant_staff", restaurantId: "r1" }];
  assert.equal(isRestaurantOwner(roles, "r1"), false);
});

test("isRestaurantOwner: owner of a DIFFERENT restaurant does not grant access", () => {
  const roles = [{ role: "restaurant_owner", restaurantId: "r2" }];
  assert.equal(isRestaurantOwner(roles, "r1"), false);
});

test("isRestaurantOwner: hybrid owner+staff still counts as owner where owned", () => {
  const roles = [
    { role: "restaurant_staff", restaurantId: "r1" },
    { role: "restaurant_owner", restaurantId: "r1" },
  ];
  assert.equal(isRestaurantOwner(roles, "r1"), true);
});

test("isRestaurantOwner: empty roles → false", () => {
  assert.equal(isRestaurantOwner([], "r1"), false);
});

test("homeForRoles routes by precedence", () => {
  assert.equal(homeForRoles(["admin"]), "/admin");
  assert.equal(homeForRoles(["restaurant_staff"]), "/restaurant/orders");
  assert.equal(homeForRoles(["rider"]), "/rider");
  assert.equal(homeForRoles(["customer"]), "/");
});
