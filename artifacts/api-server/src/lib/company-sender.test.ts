import { describe, it, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import type { Company } from "@workspace/db";

const companies = new Map<number, Company>();
const verificationWrites: Array<Record<string, unknown>> = [];
mock.module("../db", { namedExports: { db: {
  update() { return { set(values: Record<string, unknown>) {
    return { async where() { verificationWrites.push(values); } };
  } }; },
} } });
mock.module("../storage", { namedExports: { storage: {
  getCompanyProfile: async (id: number) => companies.get(id),
} } });
const { senderFromCompany, resolveCompanySender, checkSendingDomain, recheckCompanyDomain, DEFAULT_FROM_EMAIL, SENDGRID_FROM_NAME } = await import("./company-sender");

const company = (patch: Partial<Company> = {}) => ({
  name: "High Plains", email: "office@highplainsprop.com",
  emailFromName: "High Plains Property Maintenance", emailFromAddress: "billing@highplainsprop.com",
  emailSendingDomain: "highplainsprop.com", emailDomainVerifiedAt: new Date(),
  emailReplyTo: "replies@highplainsprop.com", ...patch,
}) as Company;

describe("company sender", () => {
  it("uses the company address only with a verified matching domain", () => {
    assert.deepEqual(senderFromCompany(company()), {
      from: { email: "billing@highplainsprop.com", name: "High Plains Property Maintenance" },
      replyTo: "replies@highplainsprop.com", usingCompanyAddress: true,
    });
    for (const patch of [
      { emailDomainVerifiedAt: null }, { emailSendingDomain: null },
      { emailFromAddress: "billing@other.test" }, { emailFromAddress: null },
    ]) {
      const sender = senderFromCompany(company(patch));
      assert.equal(sender.from.email, DEFAULT_FROM_EMAIL);
      assert.equal(sender.from.name, "High Plains Property Maintenance");
      assert.equal(sender.usingCompanyAddress, false);
    }
  });
  it("compares the address domain case-insensitively and trims name/reply fields", () => {
    const sender = senderFromCompany(company({ emailFromAddress: "Billing@HIGHPLAINSPROP.COM", emailFromName: " Custom ", emailReplyTo: " reply@example.com " }));
    assert.equal(sender.usingCompanyAddress, true);
    assert.equal(sender.from.name, "Custom");
    assert.equal(sender.replyTo, "reply@example.com");
  });
  it("uses the complete reply-to and name fallback order", () => {
    assert.equal(senderFromCompany(company({ emailReplyTo: " " })).replyTo, "billing@highplainsprop.com");
    const fallback = senderFromCompany(company({ emailReplyTo: null, emailDomainVerifiedAt: null, emailFromName: " " }));
    assert.equal(fallback.replyTo, "office@highplainsprop.com");
    assert.equal(fallback.from.name, "High Plains");
    const blank = senderFromCompany(company({ emailReplyTo: "", emailFromAddress: "", email: " ", name: " ", emailFromName: " " }));
    assert.deepEqual(blank, { from: { email: DEFAULT_FROM_EMAIL, name: SENDGRID_FROM_NAME }, replyTo: undefined, usingCompanyAddress: false });
    assert.deepEqual(senderFromCompany(undefined), blank);
  });
  it("resolves only the requested company and unknown companies use platform defaults", async () => {
    companies.set(1, company());
    companies.set(2, company({ emailFromAddress: "billing@second.test", emailSendingDomain: "second.test" }));
    assert.equal((await resolveCompanySender(1)).from.email, "billing@highplainsprop.com");
    assert.equal((await resolveCompanySender(2)).from.email, "billing@second.test");
    assert.deepEqual(await resolveCompanySender(99), senderFromCompany(undefined));
  });
});

// Only a test-local dummy value is installed; no real secret is inspected.
describe("SendGrid domain checks", () => {
  afterEach(() => mock.restoreAll());
  function key(value = "test-only-key") { mock.property(process, "env", { SENDGRID_API_KEY: value }); }
  function response(status: number, body: unknown) {
    mock.method(globalThis, "fetch", async (url: string | URL | Request, options?: RequestInit) => {
      assert.equal(String(url), "https://api.sendgrid.com/v3/whitelabel/domains?domain=highplainsprop.com&limit=50");
      assert.equal((options?.headers as Record<string, string>).Authorization, "Bearer test-only-key");
      return new Response(JSON.stringify(body), { status });
    });
  }
  it("accepts any valid exact-domain match, not a subdomain", async () => {
    key(); response(200, [{ domain: "sub.highplainsprop.com", valid: true }, { domain: "HIGHPLAINSPROP.COM", valid: true }]);
    assert.deepEqual(await checkSendingDomain("highplainsprop.com"), { verified: true, error: null });
  });
  it("reports unvalidated DNS", async () => {
    key(); response(200, [{ domain: "highplainsprop.com", valid: false }]);
    assert.deepEqual(await checkSendingDomain("highplainsprop.com"), { verified: false, error: "highplainsprop.com is in SendGrid but its DNS records are not validated yet." });
  });
  it("reports no matching entry", async () => {
    key(); response(200, [{ domain: "other.test", valid: true }]);
    assert.deepEqual(await checkSendingDomain("highplainsprop.com"), { verified: false, error: "highplainsprop.com is not an authenticated domain in SendGrid." });
  });
  for (const status of [401, 403]) it(`explains ${status} permissions`, async () => {
    key(); response(status, {});
    assert.deepEqual(await checkSendingDomain("highplainsprop.com"), { verified: false, error: "The SendGrid API key cannot read Sender Authentication. Give the key read access to Sender Authentication in SendGrid." });
  });
  it("reports network failure", async () => {
    key(); mock.method(globalThis, "fetch", async () => { throw new Error("network down"); });
    assert.deepEqual(await checkSendingDomain("highplainsprop.com"), { verified: false, error: "Could not reach SendGrid (network down)." });
  });
  it("reports unexpected HTTP status", async () => {
    key(); response(503, {});
    assert.deepEqual(await checkSendingDomain("highplainsprop.com"), { verified: false, error: "Could not reach SendGrid (503)." });
  });
  it("reports missing configuration without a request", async () => {
    key(""); const spy = mock.method(globalThis, "fetch", async () => { throw new Error("must not call"); });
    assert.deepEqual(await checkSendingDomain("highplainsprop.com"), { verified: false, error: "Email is not configured (SENDGRID_API_KEY missing)." });
    assert.equal(spy.mock.callCount(), 0);
  });
  it("persists a successful authentication check and a failed recheck clears verification", async () => {
    key(); companies.set(1, company());
    response(200, [{ domain: "highplainsprop.com", valid: true }]);
    await recheckCompanyDomain(1);
    const successful = verificationWrites.at(-1)!;
    assert.ok(successful.emailDomainVerifiedAt instanceof Date);
    assert.ok(successful.emailDomainCheckedAt instanceof Date);
    assert.equal(successful.emailDomainCheckError, null);
    mock.restoreAll(); key(); response(403, {});
    await recheckCompanyDomain(1);
    const failed = verificationWrites.at(-1)!;
    assert.equal(failed.emailDomainVerifiedAt, null);
    assert.ok(failed.emailDomainCheckedAt instanceof Date);
    assert.match(String(failed.emailDomainCheckError), /cannot read Sender Authentication/);
  });
  it("clears all verification fields with no domain and makes no SendGrid call", async () => {
    key(); companies.set(1, company({ emailSendingDomain: null }));
    const spy = mock.method(globalThis, "fetch", async () => { throw new Error("must not call"); });
    await recheckCompanyDomain(1);
    assert.deepEqual(verificationWrites.at(-1), {
      emailDomainVerifiedAt: null, emailDomainCheckedAt: null, emailDomainCheckError: null,
    });
    assert.equal(spy.mock.callCount(), 0);
  });
});
