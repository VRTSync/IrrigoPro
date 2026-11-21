import assert from "node:assert/strict";
import { it } from "node:test";
import {
  defaultEmailWording, EMAIL_LABELS, isEmailKey, validateWording, WORDING_FIELDS, WORDING_LIMITS,
} from "./wording";

const base = defaultEmailWording("invoice");

it("accepts the catalog and validates all five fields after trim", () => {
  for (const key of Object.keys(EMAIL_LABELS).filter(isEmailKey)) {
    assert.equal(Object.values(validateWording(key, defaultEmailWording(key))).some(Boolean), false, key);
  }
  for (const key of ["constructor", "__proto__", "toString", null, "Invoice"]) assert.equal(isEmailKey(key), false);
  for (const name of WORDING_FIELDS) {
    const limit = WORDING_LIMITS[name];
    assert.equal(validateWording("invoice", { ...base, [name]: ` ${"x".repeat(limit)} ` })[name], null);
    assert.equal(validateWording("invoice", { ...base, [name]: "x".repeat(limit + 1) })[name], `Use ${limit} characters or fewer.`);
    assert.equal(validateWording("invoice", { ...base, [name]: " " })[name], "This field is required.");
    assert.equal(validateWording("invoice", { ...base, [name]: "One line\r\nTwo lines" })[name], "Keep this to one paragraph.");
  }
});

it("reports unbalanced braces separately and lists only allowed case-sensitive placeholders", () => {
  for (const value of ["Call {companyPhone", "Call companyPhone}", "{{companyPhone}}", "{companyPhone}}"]) {
    assert.equal(validateWording("invoice", { ...base, intro: value }).intro, "Placeholders need both braces, like {invoiceNumber}.");
  }
  const allowed = "{customerName}, {companyName}, {companyPhone}, {companyEmail}, {invoiceNumber}, {billingMonth}, {balanceDue}, {dueDate}.";
  for (const token of ["{invoiceNumbr}", "{InvoiceNumber}", "{estimateNumber}", "{invoice1}", "{}"]) {
    assert.equal(validateWording("invoice", { ...base, intro: `See ${token}.` }).intro, `Unknown placeholder ${token}. Use one of: ${allowed}`);
  }
  assert.equal(validateWording("invoice", { ...base, intro: "Hello {customerName}. Call {companyPhone} about {invoiceNumber}." }).intro, null);
});
