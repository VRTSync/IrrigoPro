import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { computeLifecycleStatus, ESTIMATE_EXPIRATION_DAYS } from "../shared/lifecycle.ts";

const NOW = new Date("2026-05-06T12:00:00.000Z");

function daysAgo(n) {
  return new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);
}

describe("Slice 10a — computeLifecycleStatus mapping", () => {
  test("status=approved → approved (regardless of internalStatus)", () => {
    assert.equal(
      computeLifecycleStatus({ status: "approved", internalStatus: "sent_to_customer", estimateDate: daysAgo(5) }, NOW),
      "approved",
    );
    assert.equal(
      computeLifecycleStatus({ status: "approved", internalStatus: "draft", estimateDate: daysAgo(0) }, NOW),
      "approved",
    );
  });

  test("status=rejected → rejected", () => {
    assert.equal(
      computeLifecycleStatus({ status: "rejected", internalStatus: "sent_to_customer", estimateDate: daysAgo(5) }, NOW),
      "rejected",
    );
  });

  test("internalStatus=draft (with status=pending) → draft", () => {
    assert.equal(
      computeLifecycleStatus({ status: "pending", internalStatus: "draft", estimateDate: NOW }, NOW),
      "draft",
    );
  });

  test("pending + sent_to_customer + 5d old → sent", () => {
    assert.equal(
      computeLifecycleStatus({ status: "pending", internalStatus: "sent_to_customer", estimateDate: daysAgo(5) }, NOW),
      "sent",
    );
  });

  test("pending + pending_approval → pending_review", () => {
    assert.equal(
      computeLifecycleStatus({ status: "pending", internalStatus: "pending_approval", estimateDate: NOW }, NOW),
      "pending_review",
    );
  });

  test("pending + approved_internal → pending_review (not yet sent)", () => {
    assert.equal(
      computeLifecycleStatus({ status: "pending", internalStatus: "approved_internal", estimateDate: NOW }, NOW),
      "pending_review",
    );
  });

  test("Unknown internal state falls through to pending_review", () => {
    assert.equal(
      computeLifecycleStatus({ status: "pending", internalStatus: "wat_is_this", estimateDate: NOW }, NOW),
      "pending_review",
    );
  });

  test("30-day expiration boundary (sanity): exact constant", () => {
    assert.equal(ESTIMATE_EXPIRATION_DAYS, 30);
  });

  test("29 days old → sent", () => {
    assert.equal(
      computeLifecycleStatus({ status: "pending", internalStatus: "sent_to_customer", estimateDate: daysAgo(29) }, NOW),
      "sent",
    );
  });

  test("exactly 30 days old → sent (boundary inclusive)", () => {
    assert.equal(
      computeLifecycleStatus({ status: "pending", internalStatus: "sent_to_customer", estimateDate: daysAgo(30) }, NOW),
      "sent",
    );
  });

  test("31 days old → expired", () => {
    assert.equal(
      computeLifecycleStatus({ status: "pending", internalStatus: "sent_to_customer", estimateDate: daysAgo(31) }, NOW),
      "expired",
    );
  });

  test("expired only applies to pending + sent_to_customer (approved old estimate stays approved)", () => {
    assert.equal(
      computeLifecycleStatus({ status: "approved", internalStatus: "sent_to_customer", estimateDate: daysAgo(365) }, NOW),
      "approved",
    );
  });

  test("Accepts ISO-string estimateDate", () => {
    assert.equal(
      computeLifecycleStatus({ status: "pending", internalStatus: "sent_to_customer", estimateDate: daysAgo(45).toISOString() }, NOW),
      "expired",
    );
  });
});
