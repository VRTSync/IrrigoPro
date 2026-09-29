import { test } from "node:test";
import assert from "node:assert/strict";
import { catalogLaborHours } from "./wet-check-labor.js";

test("catalog labor applies quantity with the existing fallback", () => {
  assert.equal(catalogLaborHours("0.25", 3), 0.75);
  assert.equal(catalogLaborHours("0.25", 0), 0.25);
  assert.equal(catalogLaborHours("0.25", null), 0.25);
  assert.equal(catalogLaborHours("0.25", "oops"), 0.25);
  assert.equal(catalogLaborHours(null, 2), 0);
  assert.equal(catalogLaborHours("abc", 2), 0);
});