import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { changedLockedFields, customerRecordsLabel, QB_OWNED_CUSTOMER_FIELDS } from "./customer-records.js";

describe("customer records shared contract", () => {
  it("normalizes null, undefined, empty and trimmed values", () => {
    assert.deepEqual(changedLockedFields({ name: "A", phone: null }, { name: "A", phone: "" }), []);
    assert.deepEqual(changedLockedFields({ name: "A" }, { name: " A " }), []);
    assert.deepEqual(changedLockedFields({}, { phone: undefined, city: null, zip: "" }), []);
  });
  it("ignores non-owned fields and omitted keys", () => {
    assert.deepEqual(changedLockedFields({ name: "A", email: "a@x" }, { name: "B", email: "a@x", laborRate: "50" }), ["name"]);
    assert.deepEqual(changedLockedFields({}, { laborRate: "50" }), []);
  });
  it("preserves constant order, not patch insertion order", () => {
    assert.deepEqual(changedLockedFields({}, { country: "US", phone: "123", name: "A" }), ["name", "phone", "country"]);
    assert.equal(QB_OWNED_CUSTOMER_FIELDS.length, 9);
    assert.equal(new Set(QB_OWNED_CUSTOMER_FIELDS).size, 9);
  });
  it("provides a trimmed label or the fallback", () => {
    for (const name of [null, undefined, "", "  "]) assert.equal(customerRecordsLabel(name), "your customer system");
    assert.equal(customerRecordsLabel(" High Plains CRM "), "High Plains CRM");
  });
});
