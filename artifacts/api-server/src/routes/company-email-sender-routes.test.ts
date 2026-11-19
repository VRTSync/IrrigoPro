import { beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import express, { type RequestHandler } from "express";
import request from "supertest";
import type { Company } from "@workspace/db";
import { insertCompanySchema } from "@workspace/db/schema";

const rows = new Map<number, Company>();
const writes: Array<{ id: number; patch: Partial<Company> }> = [];
const audits: unknown[] = [];
const checks: number[] = [];
const storage = {
  async getCompanyProfile(id: number) { return rows.get(id); },
  async updateCompany(id: number, patch: Partial<Company>) {
    if (patch.emailSendingDomain && [...rows.values()].some((c) => c.id !== id && c.emailSendingDomain === patch.emailSendingDomain)) {
      throw Object.assign(new Error("duplicate"), { code: "23505" });
    }
    writes.push({ id, patch });
    const row = rows.get(id);
    if (!row) return undefined;
    Object.assign(row, patch);
    return row;
  },
};
mock.module("../storage", { namedExports: { storage } });
mock.module("../db", { namedExports: { db: {} } });
mock.module("./audit-log", { namedExports: { recordAuditEvent: async () => {} } });
const { registerCompanyEmailSenderRoutes, updateCompanyHandler } = await import("./company-email-sender-routes");

function app(role = "company_admin", companyId: number | null = 1) {
  const app = express();
  app.use(express.json());
  const auth: RequestHandler = (req, _res, next) => {
    req.authenticatedUserRole = role; req.authenticatedUserCompanyId = companyId; req.authenticatedUserId = 10;
    req.log = { error() {} } as any;
    next();
  };
  registerCompanyEmailSenderRoutes(app, { requireAuthentication: auth,
    recheck: async (id) => { checks.push(id); },
    audit: async (_req, entry) => { audits.push(entry); },
  });
  app.put("/api/companies/:id", auth, updateCompanyHandler);
  return app;
}
beforeEach(() => {
  rows.clear(); writes.length = 0; checks.length = 0; audits.length = 0;
  for (const id of [1, 2]) rows.set(id, {
    id, name: `Company ${id}`, email: `office@company${id}.test`,
    emailSendingDomain: id === 1 ? "company1.test" : null,
    emailFromName: null, emailFromAddress: null, emailReplyTo: null,
    emailDomainVerifiedAt: null, emailDomainCheckedAt: null, emailDomainCheckError: null,
  } as Company);
});

describe("outgoing email tenant and role boundaries", () => {
  it("does not permit company A to change or check B", async () => {
    await request(app()).put("/api/company/2/email-sender").send({}).expect(403);
    await request(app()).post("/api/company/2/email-sender/check").expect(403);
    assert.equal(writes.length, 0); assert.equal(checks.length, 0);
  });
  it("lets super admins check and assign domains, but reserves sender edits for own company admins", async () => {
    const admin = app("super_admin", null);
    await request(admin).post("/api/company/2/email-sender/check").expect(200);
    await request(admin).put("/api/admin/companies/2/email-sending-domain").send({ domain: " EXAMPLE.COM " }).expect(200);
    assert.equal(rows.get(2)?.emailSendingDomain, "example.com");
    assert.deepEqual(checks, [2, 2]);
    assert.equal(audits.length, 2);
    await request(admin).put("/api/company/2/email-sender").send({}).expect(403);
  });
  it("denies domain assignment by a company admin", async () => {
    await request(app()).put("/api/admin/companies/1/email-sending-domain").send({ domain: "other.test" }).expect(403);
    assert.equal(writes.length, 0);
  });
  it("returns 409 for a domain already assigned to another company", async () => {
    const res = await request(app("super_admin", null)).put("/api/admin/companies/2/email-sending-domain").send({ domain: "COMPANY1.TEST" }).expect(409);
    assert.equal(res.body.message, "That domain is already assigned to another company.");
    assert.equal(rows.get(2)?.emailSendingDomain, null);
  });
  it("normalizes the sender, checks on save, and audits the write", async () => {
    const res = await request(app()).put("/api/company/1/email-sender").send({
      fromName: " Office ", fromLocalPart: "Billing", replyTo: "reply@example.com",
    }).expect(200);
    assert.equal(res.body.fromAddress, "billing@company1.test");
    assert.equal(res.body.fromName, "Office");
    assert.equal(res.body.effective.from.name, "Office");
    assert.equal(res.body.effective.replyTo, "reply@example.com");
    assert.deepEqual(checks, [1]); assert.equal(audits.length, 1);
  });
  it("rejects a local part without a domain, but allows blank settings", async () => {
    const own = app("company_admin", 2);
    const res = await request(own).put("/api/company/2/email-sender").send({ fromName: "", fromLocalPart: "billing", replyTo: "" }).expect(409);
    assert.equal(res.body.message, "No sending domain is assigned to this company yet.");
    await request(own).put("/api/company/2/email-sender").send({ fromName: " ", fromLocalPart: "", replyTo: "" }).expect(200);
    assert.equal(rows.get(2)?.emailFromName, null);
  });
  it("clears a mismatched address and stale verification when assigning or removing a domain", async () => {
    Object.assign(rows.get(1)!, { emailFromAddress: "billing@company1.test", emailDomainVerifiedAt: new Date() });
    const admin = app("super_admin", null);
    await request(admin).put("/api/admin/companies/1/email-sending-domain").send({ domain: "new.test" }).expect(200);
    assert.equal(rows.get(1)?.emailFromAddress, null);
    assert.equal(rows.get(1)?.emailDomainVerifiedAt, null);
    await request(admin).put("/api/admin/companies/1/email-sending-domain").send({ domain: null }).expect(200);
    assert.equal(rows.get(1)?.emailSendingDomain, null);
  });
  it("scopes reads to the authenticated company, ignoring a tenant's query override", async () => {
    const res = await request(app()).get("/api/company/email-sender?companyId=2").expect(200);
    assert.equal(res.body.sendingDomain, "company1.test");
    const admin = await request(app("super_admin", null)).get("/api/company/email-sender?companyId=2").expect(200);
    assert.equal(admin.body.sendingDomain, null);
    await request(app("super_admin", null)).get("/api/company/email-sender?companyId=999").expect(404);
  });
  it("validates input and denies other company roles", async () => {
    for (const data of [
      { fromName: "", fromLocalPart: "a@b", replyTo: "" },
      { fromName: "", fromLocalPart: "", replyTo: "invalid" },
      { fromName: "x".repeat(101), fromLocalPart: "", replyTo: "" },
      { fromName: "", fromLocalPart: "", replyTo: "", emailSendingDomain: "evil.test" },
    ]) await request(app()).put("/api/company/1/email-sender").send(data).expect(400);
    await request(app("technician")).put("/api/company/1/email-sender").send({}).expect(403);
    await request(app("technician")).post("/api/company/1/email-sender/check").expect(403);
    await request(app("super_admin", null)).put("/api/admin/companies/1/email-sending-domain").send({ domain: "https://bad.test" }).expect(400);
  });
  it("closes the legacy company update hole and strips every protected field", async () => {
    await request(app()).put("/api/companies/2").send({ name: "hacked" }).expect(404);
    const protectedValues = {
      id: 5, createdAt: "yesterday", updatedAt: "today",
      customerRecordsLocked: true, customerRecordsSystemName: "evil",
      emailSendingDomain: "evil.test", emailDomainVerifiedAt: "today", emailDomainCheckedAt: "today",
      emailDomainCheckError: "", emailFromName: "evil", emailFromAddress: "evil@evil.test", emailReplyTo: "evil@evil.test",
    };
    await request(app()).put("/api/companies/1").send({ name: "Renamed", ...protectedValues }).expect(200);
    assert.deepEqual(writes, [{ id: 1, patch: { name: "Renamed" } }]);
    assert.equal(rows.get(1)?.emailSendingDomain, "company1.test");
    assert.deepEqual(insertCompanySchema.partial().parse({ name: "Profile", ...protectedValues }), { name: "Profile" });
  });
  it("preserves the super admin starting estimate number update", async () => {
    await request(app("super_admin", null)).put("/api/companies/1").send({ startingEstimateNumber: 60000 }).expect(200);
    assert.deepEqual(writes[0].patch, { startingEstimateNumber: 60000 });
  });
});
