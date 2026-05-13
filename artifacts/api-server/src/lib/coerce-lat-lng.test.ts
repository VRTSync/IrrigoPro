// Task #596 regression — proves the work-order create/update endpoints
// will accept numeric workLocationLat/Lng (the shape the LocationPicker
// produces) and stringify them before drizzle-zod validation, instead
// of 400'ing with `expected string, received number`.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { insertWorkOrderSchema } from "@workspace/db";
import { coerceLatLngStrings } from "./coerce-lat-lng";

const baseBody = {
  customerId: 1,
  customerName: "Acme",
  customerEmail: "ops@acme.test",
  projectName: "Front lawn",
  description: "Repair zone 3 head",
  workType: "direct_billing",
  status: "pending",
};

describe("coerceLatLngStrings + insertWorkOrderSchema", () => {
  it("stringifies numeric workLocationLat/Lng so the schema accepts them", () => {
    const body: Record<string, unknown> = {
      ...baseBody,
      workLocationLat: 40.7128123,
      workLocationLng: -74.0060456,
    };
    coerceLatLngStrings(body);
    assert.equal(body.workLocationLat, "40.7128123");
    assert.equal(body.workLocationLng, "-74.0060456");
    const parsed = insertWorkOrderSchema.parse(body);
    assert.equal(parsed.workLocationLat, "40.7128123");
    assert.equal(parsed.workLocationLng, "-74.0060456");
  });

  it("passes string coordinates through untouched", () => {
    const body: Record<string, unknown> = {
      ...baseBody,
      workLocationLat: "40.7128",
      workLocationLng: "-74.0060",
    };
    coerceLatLngStrings(body);
    assert.equal(body.workLocationLat, "40.7128");
    assert.equal(body.workLocationLng, "-74.0060");
    const parsed = insertWorkOrderSchema.parse(body);
    assert.equal(parsed.workLocationLat, "40.7128");
  });

  it("leaves null coordinates alone (no pin captured)", () => {
    const body: Record<string, unknown> = {
      ...baseBody,
      workLocationLat: null,
      workLocationLng: null,
    };
    coerceLatLngStrings(body);
    assert.equal(body.workLocationLat, null);
    assert.equal(body.workLocationLng, null);
    const parsed = insertWorkOrderSchema.parse(body);
    assert.equal(parsed.workLocationLat, null);
    assert.equal(parsed.workLocationLng, null);
  });

  it("leaves non-finite numbers in place so the schema rejects them with 400", () => {
    const body: Record<string, unknown> = {
      ...baseBody,
      workLocationLat: Number.NaN,
      workLocationLng: Number.POSITIVE_INFINITY,
    };
    coerceLatLngStrings(body);
    assert.equal(body.workLocationLat, Number.NaN);
    assert.equal(body.workLocationLng, Number.POSITIVE_INFINITY);
    assert.throws(() => insertWorkOrderSchema.parse(body));
  });

  it("works on a partial PATCH body that only carries coordinates", () => {
    const body: Record<string, unknown> = {
      workLocationLat: 41.5,
      workLocationLng: -75.25,
    };
    coerceLatLngStrings(body);
    const parsed = insertWorkOrderSchema.partial().parse(body);
    assert.equal(parsed.workLocationLat, "41.5");
    assert.equal(parsed.workLocationLng, "-75.25");
  });

  it("does not crash on an empty body", () => {
    const body: Record<string, unknown> = {};
    coerceLatLngStrings(body);
    assert.deepEqual(body, {});
  });
});
