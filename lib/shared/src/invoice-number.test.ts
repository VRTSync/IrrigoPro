import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatIrrigoInvoiceNumber, isIrrigoInvoiceNumber } from "./invoice-number.js";

describe("IR invoice numbers", () => {
  it("formats without padding across digit boundaries", () => {
    assert.equal(formatIrrigoInvoiceNumber(1001), "IR-1001");
    assert.equal(formatIrrigoInvoiceNumber(10000), "IR-10000");
    assert.equal(formatIrrigoInvoiceNumber(1), "IR-1");
  });
  it("rejects invalid counters", () => {
    for (const n of [0, -1, 1.5, NaN, Infinity]) assert.throws(() => formatIrrigoInvoiceNumber(n), RangeError);
  });
  it("detects only strict IR numbers", () => {
    assert.equal(isIrrigoInvoiceNumber("IR-1001"), true);
    for (const value of ["60897", "IR-", "ir-1001", "IR-0", "IR-01001", "IP-" + "10001", "IR-1001-R1", " IR-1001"]) {
      assert.equal(isIrrigoInvoiceNumber(value), false, value);
    }
  });
});
