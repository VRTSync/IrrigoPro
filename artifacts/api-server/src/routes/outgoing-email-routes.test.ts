import { it, mock } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { Company, Customer, EstimateWithItems, PlatformDocument } from "@workspace/db";
import { buildEstimateHtml, fmtDate } from "../estimate-pdf-html";
import { requireInvoiceRead } from "./role-guards";

// Storage initialization must not run in this in-memory HTTP suite.
mock.module("../storage", { namedExports: { storage: {} } });
mock.module("../outgoing-email/wording-store", { namedExports: { findEmailWordingOverride: async () => undefined } });
const estimateMessages: Array<{ html: string; text: string; to: string; subject: string; attachments?: Array<{ filename: string; content: string }> }> = [];
const estimateRenders: Array<{ estimate: EstimateWithItems; sentAt: Date; html: string }> = [];
let failEstimatePdf = false;
let estimateProviderError: unknown;
mock.module("@sendgrid/mail", { defaultExport: {
  setApiKey() {},
  async send(message: (typeof estimateMessages)[number]) {
    estimateMessages.push(message);
    if (estimateProviderError) throw estimateProviderError;
    return [{ statusCode: 202 }];
  },
} });
mock.module("../estimate-pdf", { namedExports: {
  async renderEstimatePdf(estimate: EstimateWithItems, opts: { sentAt: Date; company?: Company }) {
    estimateRenders.push({ estimate, sentAt: opts.sentAt, html: buildEstimateHtml(estimate, opts) });
    if (failEstimatePdf) throw new Error("test PDF unavailable");
    return Buffer.from("%PDF estimate test");
  },
} });
await import("../db");
const emailEnv = mock.property(process, "env", { SENDGRID_API_KEY: "test-only-key", APP_BASE_URL: "https://estimates.example.invalid" });
await import("../email-service");
emailEnv.mock.restore();
const { registerInvoicePdfRoutes } = await import("./invoice-pdf-routes");
const { registerOutgoingEmailRoutes } = await import("./outgoing-email-routes");
const { createInvoiceEmailHandler } = await import("../outgoing-email/invoice-handler");
const { createEstimateEmailHandler } = await import("../outgoing-email/estimate-handlers");
const { createReportEmailHandlers } = await import("../outgoing-email/report-handlers");
const { buildInvoicePdfFilename, InvoicePdfService, readInvoiceSentCopy } = await import("../invoice-pdf-service");
const { ObjectStorageService } = await import("../objectStorage");

const bytes = Buffer.from("%PDF-1.7\nexact generated invoice bytes");
const filename = "The Ranch - Irrigation Billing Detail - (10-1-26_10-31-26).pdf";
const guideBytes = Buffer.from("%PDF-1.7\ninvoice guide fixture");
const guide: PlatformDocument = {
  id: 21, isCurrent: true, kind: "invoice_guide", storageKey: "guide-fixture", sha256: "unused",
  filename: "Understanding Your Invoice.pdf", pageCount: 5, byteSize: guideBytes.length,
  uploadedAt: new Date(), uploadedByUserId: 7,
};
const sender = {
  from: { name: "High Plains Property Maintenance", email: "billing@example.invalid" },
  replyTo: "office@example.invalid",
  usingCompanyAddress: true,
};

function estimateHarness(opts: { companyId?: number | null; role?: string; missingBranch?: boolean; now?: () => Date } = {}) {
  const app = express();
  app.use(express.json());
  const company = {
    id: 1, name: "High Plains", email: "office@example.invalid",
    emailFromName: sender.from.name, emailFromAddress: sender.from.email, emailReplyTo: sender.replyTo,
    emailSendingDomain: "example.invalid", emailDomainVerifiedAt: new Date(), attachInvoiceGuide: true,
  } as Company;
  const customer = {
    id: 42, companyId: 1, irrigoName: "The Ranch", name: "QuickBooks Ranch",
    email: "current@example.invalid", branches: opts.missingBranch ? ["East", "West"] : null,
  } as Customer;
  const baseEstimate = {
    id: 50123, estimateNumber: "EST-50123", companyId: 1, customerId: 42,
    customerName: "Ranch snapshot", customerEmail: "snapshot@example.invalid", projectName: "Sprinkler repairs",
    totalAmount: "150.00", partsSubtotal: "150.00", laborSubtotal: "0.00", totalLaborHours: "0.00", laborRate: "75.00",
    updatedAt: new Date(), estimateDate: new Date("2026-10-01T12:00:00Z"),
    createdBy: "Office", approvalSentAt: null, status: "pending",
    internalStatus: "approved_internal", lifecycleStatus: "pending_review", items: [],
  } as unknown as EstimateWithItems;
  const rows = new Map<number, EstimateWithItems>([
    [50123, baseEstimate],
    [50124, { ...baseEstimate, id: 50124, lifecycleStatus: "sent", internalStatus: "sent_to_customer", approvalToken: "existing-secret-token" }],
    [50125, { ...baseEstimate, id: 50125, lifecycleStatus: "draft", internalStatus: "draft" }],
    [50126, { ...baseEstimate, id: 50126, lifecycleStatus: "expired", internalStatus: "sent_to_customer", approvalToken: "expired-secret-token" }],
  ]);
  const claims = new Map<number, string>();
  const audit: string[] = [];
  const store: NonNullable<Parameters<typeof createEstimateEmailHandler>[1]>["storage"] = {
    async getEstimate(id) { return rows.get(id); },
    async getCustomer() { return customer; },
    async getCompany() { return company; },
    async getCompanyProfile() { return company; },
    async claimEstimateEmailSend(row, attemptId) {
      if (claims.has(row.id)) return "blocked";
      claims.set(row.id, attemptId);
      return "claimed";
    },
    async releaseEstimateEmailSend(id, _companyId, attemptId) {
      if (claims.get(id) === attemptId) claims.delete(id);
    },
    async markEstimateSentToCustomer(id, stamps) {
      assert.equal(claims.get(id), stamps.deliveryAttemptId);
      claims.delete(id);
      const row = rows.get(id)!;
      const saved = {
        ...row, internalStatus: "sent_to_customer", status: "pending", lifecycle: "sent", lifecycleStatus: "sent" as const,
        estimateDate: stamps.newEstimateDate ?? row.estimateDate,
        approvalToken: stamps.approvalToken, tokenExpiresAt: stamps.tokenExpiresAt,
        approvalSentAt: stamps.approvalSentAt, sentToEmail: stamps.sentToEmail ?? row.sentToEmail,
      };
      rows.set(id, saved);
      return saved;
    },
  };
  registerOutgoingEmailRoutes(app, {
    requireAuthentication(req, _res, next) {
      req.authenticatedUserId = 10;
      req.authenticatedUserCompanyId = opts.companyId === undefined ? 1 : opts.companyId;
      req.authenticatedUserRole = opts.role ?? "company_admin";
      next();
    },
    handlers: (["estimate", "estimate_resend"] as const).map(kind => createEstimateEmailHandler(kind, {
      storage: store,
      now: opts.now,
      recordAuditEvent: async (_req, event) => { audit.push(event.action); },
      recordLifecycleAudit: async (_req, event) => { audit.push(event.action); },
    })),
  });
  return { app, rows, customer, company, audit };
}

function harness(opts: {
  companyId?: number | null; role?: string; email?: string | null; oldEmail?: string | null;
  mailFailure?: boolean; uploadFailure?: boolean; alreadySent?: boolean; customerCompany?: number;
  validationFailure?: boolean; unauthenticated?: boolean; mutateDuringRender?: boolean;
  attachInvoiceGuide?: boolean; currentGuide?: PlatformDocument; replaceGuideDuringRender?: boolean; guideReadFailure?: boolean;
} = {}) {
  const events: string[] = [];
  const uploaded: { key: string; buf: Buffer; contentType: string; cacheControl?: string }[] = [];
  const deleted: string[] = [];
  const sent: any[][] = [];
  const copies: any[] = [];
  const stamps: any[] = [];
  const reportSends: { kind: string; args: any }[] = [];
  const reportRenders: string[] = [];
  const savedReads: string[] = [];
  let generated = 0;
  const guides = { current: opts.currentGuide };
  const invoice = {
    id: 1008, customerId: 42, companyId: 1, invoiceNumber: "IR-1008",
    customerName: "The Ranch", customerEmail: opts.oldEmail === undefined ? "old@example.invalid" : opts.oldEmail,
    periodStart: new Date(2026, 9, 1), periodEnd: new Date(2026, 9, 31),
    createdAt: new Date("2026-10-31"), updatedAt: new Date("2026-11-02"),
    dueDate: new Date("2026-11-30"), totalAmount: "1234.56", status: "generated",
    sentAt: opts.alreadySent ? new Date("2026-10-31") : null, items: [],
  };
  const company = {
    id: 1, name: sender.from.name, email: sender.replyTo, phone: "970-555-0100",
    logo: "company-logos/high-plains-test-logo", address: "100 Main St", website: "https://www.highplainsprop.com/",
    emailFromName: sender.from.name, emailFromAddress: sender.from.email,
    emailReplyTo: sender.replyTo, emailSendingDomain: "example.invalid", emailDomainVerifiedAt: new Date(),
    attachInvoiceGuide: opts.attachInvoiceGuide ?? false,
  };
  const wc = {
    id: 66, companyId: 1, customerId: 42, customerName: "The Ranch",
    propertyAddress: "100 Main St", technicianName: "A Technician",
    startedAt: new Date("2026-10-13T02:00:00Z") as Date | null, updatedAt: new Date("2026-10-13T12:00:00Z"),
    zoneRecords: [], photos: [],
  };
  const controller = { id: 8, updatedAt: new Date("2026-10-18T12:00:00Z") };
  const app = express();
  app.use(express.json());
  const requireAuthentication: express.RequestHandler = (req, res, next) => {
    if (opts.unauthenticated) { res.sendStatus(401); return; }
    req.authenticatedUserCompanyId = opts.companyId === undefined ? 1 : opts.companyId;
    req.authenticatedUserRole = opts.role ?? "billing_manager";
    req.authenticatedUserId = 7;
    next();
  };
  const storage = {
    async getInvoiceById(id: number, companyId: number | null) {
      return id === invoice.id && (companyId === null || companyId === invoice.companyId) ? invoice : undefined;
    },
    async getCustomerById() {
      return { id: 42, companyId: opts.customerCompany ?? 1, name: "QB customer", irrigoName: "The Ranch",
        address: "100 Main St", email: opts.email === undefined ? " current@example.invalid " : opts.email };
    },
    async getCustomer(id: number) { return id === 42 ? this.getCustomerById() : undefined; },
    async getWetCheck(id: number, scope: number | null) {
      return id === wc.id && (scope === null || scope === wc.companyId) ? wc : undefined;
    },
    async listIrrigationControllers(companyId: number, id: number) {
      assert.equal(companyId, 1);
      assert.equal(id, 42);
      return [controller];
    },
    async getIrrigationController(companyId: number, id: number) {
      assert.equal(companyId, 1);
      assert.equal(id, controller.id);
      return controller;
    },
    async getCompanyProfile(companyId: number) { assert.equal(companyId, invoice.companyId); return company; },
    async getCompany(companyId: number) { assert.equal(companyId, invoice.companyId); return company; },
    async createInvoicePdf(row: any) { events.push("insert"); copies.push(row); return row; },
    async stampInvoiceSent(id: number, companyId: number, sentAt: Date) {
      assert.equal(companyId, invoice.companyId);
      stamps.push({ id, sentAt });
      invoice.sentAt = sentAt;
    },
    async getLatestInvoiceSentCopy(_id: number, companyId: number) {
      assert.equal(companyId, invoice.companyId);
      return copies.at(-1);
    },
  } as any;
  const pdf = new InvoicePdfService(storage);
  const generate = async () => {
    generated++;
    const documentVersion = await pdf.getDocumentVersion(invoice.id, invoice.companyId);
    if (opts.mutateDuringRender) invoice.updatedAt = new Date("2026-11-19");
    if (opts.replaceGuideDuringRender) guides.current = { ...guide, id: guide.id + 1 };
    return opts.validationFailure
      ? { success: false, error: "totals drift", validationFailure: { validationFailed: true as const, rowErrors: [] }, documentVersion }
      : { success: true, pdfBuffer: bytes, documentVersion };
  };
  registerInvoicePdfRoutes(app, {
    requireAuthentication,
    requireInvoiceRead,
    _storageApi: storage,
    _generatePdf: generate,
    _readSentCopy: async key => {
      savedReads.push(key);
      return uploaded.find(file => file.key === key)?.buf ?? null;
    },
  });
  const handler = createInvoiceEmailHandler({
    storage,
    pdf: { getDocumentVersion: pdf.getDocumentVersion.bind(pdf), generatePdfBuffer: generate },
    guides: {
      async getCurrentInvoiceGuide() { return guides.current; },
      async getInvoiceGuide(id) { return guides.current?.id === id ? guides.current : { ...guide, id, isCurrent: false }; },
      async readPlatformDocument() {
        if (opts.guideReadFailure) throw new Error("fixture guide missing");
        return guideBytes;
      },
    },
    objects: {
      async writeBufferToFirstSearchPath(key, buf, contentType, cacheControl) {
        if (opts.uploadFailure) throw new Error("upload failed");
        events.push("upload"); uploaded.push({ key, buf, contentType, cacheControl });
      },
      async deleteFromFirstSearchPath(key) { deleted.push(key); },
    },
    mailer: async (...args) => {
      events.push("send"); sent.push(args);
      return opts.mailFailure ? { success: false, error: "mailer rejected" } : { success: true };
    },
  });
  const reportHandlers = createReportEmailHandlers({
    storage,
    async renderWetCheck(source) {
      assert.equal(source.id, wc.id);
      reportRenders.push("wet_check_report");
      return bytes;
    },
    async renderProfile(name, controllers) {
      assert.equal(name, "QB customer");
      assert.deepEqual(controllers.map(c => c.id), [controller.id]);
      reportRenders.push("irrigation_profile_report");
      return bytes;
    },
    async sendWetCheck(args) { reportSends.push({ kind: "wet_check_report", args }); },
    async sendProfile(args) { reportSends.push({ kind: "irrigation_profile_report", args }); },
  });
  registerOutgoingEmailRoutes(app, { requireAuthentication, handlers: [handler, ...reportHandlers] });
  return { app, invoice, company, wc, controller, reportRenders, reportSends, uploaded, deleted, sent, copies, stamps, events, savedReads, guides, generated: () => generated };
}

async function withServer(h: Pick<ReturnType<typeof harness>, "app">, run: (request: (path?: string, method?: string, fields?: Record<string, unknown>) => Promise<{ status: number; body: any; headers?: Headers }>) => Promise<void>) {
  const server = createServer(h.app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  try {
    await run(async (path = "/send", method = "POST", fields?: Record<string, unknown>) => {
      const url = `${base}${path.startsWith("/outgoing-email/") || path.startsWith("/invoices/") ? path : method === "GET" ? `/invoices/1008/pdf${path}` : `/outgoing-email/invoice/1008${path}`}`;
      const post = (target: string, data: unknown) => fetch(target, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data),
      });
      if (path === "/send" && fields === undefined) {
        const preview = await post(`${base}/outgoing-email/invoice/1008/preview`, {});
        if (!preview.ok) return { status: preview.status, body: await preview.json() };
        const draft = await preview.json() as { confirmationToken: string };
        fields = { confirmationToken: draft.confirmationToken };
      }
      const res = method === "POST" ? await post(url, fields ?? {}) : await fetch(url, { method });
      const isPdf = path.endsWith("/sent-copy") && res.headers.get("content-type") === "application/pdf";
      if (isPdf) return { status: res.status, body: Buffer.from(await res.arrayBuffer()), headers: res.headers };
      return { status: res.status, body: res.headers.get("content-type")?.includes("application/pdf")
        ? await res.text()
        : await res.json().catch(() => null) };
    });
  } finally {
    await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  }
}

it("reviews current customer email and placeholder links, then sends the real first-send token and reviewed PDF", async () => {
  const h = estimateHarness();
  await withServer(h, async request => {
    const path = "/outgoing-email/estimate/50123";
    const priorRenderCount = estimateRenders.length;
    const priorMessageCount = estimateMessages.length;
    const missing = await request(`${path}/send`);
    assert.equal(missing.status, 400);
    const defaultDraft = await request(`${path}/preview`);
    assert.equal(defaultDraft.status, 200);
    assert.equal(defaultDraft.body.to, "current@example.invalid");
    assert.equal(defaultDraft.body.subject, "Irrigation Estimate #50123 – The Ranch");
    assert.deepEqual(defaultDraft.body.from, sender.from);
    assert.equal(defaultDraft.body.replyTo, sender.replyTo);
    assert.deepEqual(defaultDraft.body.attachments, [{ filename: "Estimate-EST-50123.pdf", viewUrl: `/api${path}/attachment` }]);
    assert.match(defaultDraft.body.html, /Estimate-EST-50123\.pdf/);
    assert.deepEqual(defaultDraft.body.optionDefs, [{ key: "attachPdf", label: "Attach the estimate as a PDF", default: true }]);

    const fields = { to: "reviewed@example.invalid", subject: "Reviewed estimate", note: "Check <yard>" };
    const preview = await request(`${path}/preview`, "POST", fields);
    assert.equal(preview.status, 200);
    assert.match(preview.body.html, /about:blank#link-created-when-sent/);
    assert.match(preview.body.html, /\(links are created when sent\)/);
    assert.match(preview.body.html, /Approve estimate/);
    assert.match(preview.body.html, />Decline</);
    assert.match(preview.body.html, /<title>Reviewed estimate<\/title>/);
    assert.doesNotMatch(preview.body.html, /\/estimate-approval\//);
    assert.match(preview.body.html, /Check &lt;yard&gt;/);
    assert.equal(estimateMessages.length, priorMessageCount);
    assert.equal(estimateRenders.length, priorRenderCount);
    const sent = await request(`${path}/send`, "POST", { ...fields, confirmationToken: preview.body.confirmationToken });
    assert.equal(sent.status, 200);
    const row = h.rows.get(50123)!;
    assert.equal(row.lifecycleStatus, "sent");
    assert.equal(row.sentToEmail, fields.to);
    assert.equal(row.approvalSentAt?.toISOString(), sent.body.sentAt);
    assert.match(row.approvalToken!, /^[a-f0-9]{64}$/);
    assert.ok(!preview.body.html.includes(row.approvalToken!));
    const message = estimateMessages.at(-1)!;
    assert.match(message.html, new RegExp(`/estimate-approval/${row.approvalToken}\\?intent=reject`));
    assert.match(message.text, new RegExp(`/estimate-approval/${row.approvalToken}`));
    assert.doesNotMatch(message.html, /link-created-when-sent|\(links are created when sent\)/);
    assert.match(message.html, /Estimate-EST-50123\.pdf/);
    assert.equal(message.subject, fields.subject);
    assert.equal(message.to, fields.to);
    assert.equal(message.attachments?.[0]?.filename, preview.body.attachments[0].filename);
    assert.equal(Buffer.from(message.attachments![0].content, "base64").toString(), "%PDF estimate test");
    assert.equal(estimateRenders.at(-1)?.sentAt.toISOString(), sent.body.sentAt);
    assert.deepEqual(h.audit, ["estimate.email.sent"]);
  });
});

it("requires a new review when the PDF checkbox changes, and sends no PDF when unticked", async () => {
  const h = estimateHarness();
  await withServer(h, async request => {
    const path = "/outgoing-email/estimate/50123";
    const priorRenderCount = estimateRenders.length;
    const { body: checked } = await request(`${path}/preview`);
    const fields = { options: { attachPdf: false } };
    const mismatched = await request(`${path}/send`, "POST", { ...fields, confirmationToken: checked.confirmationToken });
    assert.equal(mismatched.status, 409);
    const { body: unchecked } = await request(`${path}/preview`, "POST", fields);
    assert.deepEqual(unchecked.attachments, []);
    assert.doesNotMatch(unchecked.html, /Estimate-EST-50123\.pdf/);
    assert.equal((await request(`${path}/attachment`, "POST", { confirmationToken: unchecked.confirmationToken })).status, 409);
    assert.notEqual(checked.confirmationToken.split(".")[1], unchecked.confirmationToken.split(".")[1]);
    assert.equal((await request(`${path}/send`, "POST", { ...fields, confirmationToken: unchecked.confirmationToken })).status, 200);
    assert.equal(estimateRenders.length, priorRenderCount);
    assert.equal(estimateMessages.at(-1)?.attachments, undefined);
    assert.doesNotMatch(estimateMessages.at(-1)!.html, /Estimate-EST-50123\.pdf/);
  });
});

it("requires re-review for PDF-only estimate edits and company footer edits without an updatedAt change", async () => {
  const h = estimateHarness();
  await withServer(h, async request => {
    const path = "/outgoing-email/estimate/50123";
    const count = estimateMessages.length;
    const changes = [
      { change: () => { h.rows.get(50123)!.accessInstructions = "Use the rear gate."; }, bodyChanges: false },
      { change: () => { h.rows.get(50123)!.photos = ["/objects/new-test-photo"]; }, bodyChanges: false },
      { change: () => { h.company.address = "New office address"; }, bodyChanges: true },
    ];
    for (const { change, bodyChanges } of changes) {
      const { body: review } = await request(`${path}/preview`);
      change();
      const { body: fresh } = await request(`${path}/preview`);
      if (bodyChanges) {
        assert.doesNotMatch(review.html, /New office address/);
        assert.match(fresh.html, /New office address/);
      } else {
        assert.equal(fresh.html, review.html);
      }
      const payload = { confirmationToken: review.confirmationToken };
      assert.equal((await request(`${path}/attachment`, "POST", payload)).status, 409);
      assert.equal((await request(`${path}/send`, "POST", payload)).status, 409);
      assert.equal(estimateMessages.length, count);
    }
  });
});

it("views and attaches the same printed dates in all three modes without freezing the recorded send time", async () => {
  let now = new Date(2026, 10, 20, 11);
  const h = estimateHarness({ now: () => now });
  await withServer(h, async request => {
    for (const [kind, id, expired] of [
      ["estimate", 50123, false], ["estimate_resend", 50124, false], ["estimate_resend", 50126, true],
    ] as const) {
      now = new Date(2026, 10, 20, 11);
      const estimateDate = expired ? now : h.rows.get(id)!.estimateDate;
      const path = `/outgoing-email/${kind}/${id}`;
      const fields = { subject: "Test custom subject" };
      const { body: review } = await request(`${path}/preview`, "POST", fields);
      assert.equal((await request(`${path}/attachment`)).status, 400);
      const viewed = await request(`${path}/attachment`, "POST", { confirmationToken: review.confirmationToken });
      assert.equal(viewed.status, 200);
      assert.equal(viewed.body, "%PDF estimate test");
      const html = estimateRenders.at(-1)!.html;
      assert.ok(html.includes(`<div class="k">Estimate Date</div><div class="v">${fmtDate(estimateDate)}`));
      assert.ok(html.includes(`<div class="k">Valid Until</div><div class="v">${fmtDate(new Date(2026, 11, 20))}`));

      now = new Date(2026, 10, 20, 11, 5);
      const sent = await request(`${path}/send`, "POST", { ...fields, confirmationToken: review.confirmationToken });
      assert.equal(sent.status, 200);
      assert.equal(sent.body.sentAt, now.toISOString());
      assert.equal(estimateRenders.at(-1)!.html, html);
    }
  });
});

it("requires a fresh estimate PDF review when the printed validity date changes overnight", async () => {
  let now = new Date(2026, 10, 20, 23, 58);
  await withServer(estimateHarness({ now: () => now }), async request => {
    const path = "/outgoing-email/estimate/50123";
    const { body: review } = await request(`${path}/preview`);
    now = new Date(2026, 10, 21, 0, 1);
    const payload = { confirmationToken: review.confirmationToken };
    assert.equal((await request(`${path}/attachment`, "POST", payload)).status, 409);
    assert.equal((await request(`${path}/send`, "POST", payload)).status, 409);
  });
});

it("does not deliver an estimate email if its reviewed attachment cannot be rendered", async () => {
  const h = estimateHarness();
  await withServer(h, async request => {
    const path = "/outgoing-email/estimate/50123";
    const { body: preview } = await request(`${path}/preview`);
    const priorMessageCount = estimateMessages.length;
    failEstimatePdf = true;
    try {
      const sent = await request(`${path}/send`, "POST", { confirmationToken: preview.confirmationToken });
      assert.equal(sent.status, 500);
      assert.match(sent.body.message, /Nothing was sent/);
      assert.equal(estimateMessages.length, priorMessageCount);
      assert.equal(h.rows.get(50123)?.lifecycleStatus, "pending_review");
    } finally {
      failEstimatePdf = false;
    }
  });
});

it("only clears the estimate send claim for a definite SendGrid rejection", async () => {
  const fields = { options: { attachPdf: false } };
  for (const [code, expectedStatus, retryStatus] of [[403, 500, 200], [408, 502, 409], [503, 502, 409]]) {
    await withServer(estimateHarness(), async request => {
      const path = "/outgoing-email/estimate/50123";
      const before = estimateMessages.length;
      const { body: review } = await request(`${path}/preview`, "POST", fields);
      estimateProviderError = Object.assign(new Error("SendGrid error"), {
        code, response: { body: { errors: [{ message: "Sender is not verified" }] } },
      });
      try {
        const failed = await request(`${path}/send`, "POST", { ...fields, confirmationToken: review.confirmationToken });
        assert.equal(failed.status, expectedStatus);
        assert.match(failed.body.message, code === 403 ? /Sender is not verified/ : /may have accepted/);
      } finally {
        estimateProviderError = undefined;
      }
      const { body: fresh } = await request(`${path}/preview`, "POST", fields);
      const retry = await request(`${path}/send`, "POST", { ...fields, confirmationToken: fresh.confirmationToken });
      assert.equal(retry.status, retryStatus);
      assert.equal(estimateMessages.length - before, retryStatus === 200 ? 2 : 1);
    });
  }
});

it("allows only the correct estimate lifecycle per kind and keeps the sent link and date on re-delivery", async () => {
  const h = estimateHarness();
  await withServer(h, async request => {
    for (const action of ["preview", "send"]) {
      assert.equal((await request(`/outgoing-email/estimate_resend/50125/${action}`)).status, 404);
      assert.equal((await request(`/outgoing-email/estimate/50124/${action}`)).status, 404);
    }
    for (const [id, expired] of [[50124, false], [50126, true]] as const) {
      const path = `/outgoing-email/estimate_resend/${id}`;
      const original = h.rows.get(id)!;
      const fields = { options: { attachPdf: true } };
      const { status, body } = await request(`${path}/preview`, "POST", fields);
      assert.equal(status, 200);
      assert.doesNotMatch(body.html, /existing-secret-token|expired-secret-token/);
      assert.match(body.html, /\(links are created when sent\)/);
      assert.deepEqual(body.warnings, [expired
        ? "The estimate date will be reset and the 30-day window restarted from today's send."
        : "The estimate date and approval link remain unchanged, and the 30-day window restarts from today's send."]);
      const sent = await request(`${path}/send`, "POST", { ...fields, confirmationToken: body.confirmationToken });
      assert.equal(sent.status, 200);
      const saved = h.rows.get(id)!;
      assert.equal(saved.lifecycleStatus, "sent");
      assert.equal(saved.approvalSentAt?.toISOString(), sent.body.sentAt);
      assert.equal(saved.estimateDate.toISOString(), expired ? sent.body.sentAt : original.estimateDate.toISOString());
      assert.equal(estimateRenders.at(-1)?.estimate.estimateDate.toISOString(), saved.estimateDate.toISOString());
      assert.equal(saved.approvalToken === original.approvalToken, !expired);
      assert.match(estimateMessages.at(-1)!.html, new RegExp(`/estimate-approval/${saved.approvalToken}`));
      assert.match(estimateMessages.at(-1)!.html, /Approval needed/);
      const message = estimateMessages.at(-1)!;
      assert.equal(message.attachments?.[0]?.filename, body.attachments[0].filename);
      assert.ok(message.html.includes(body.attachments[0].filename));
    }
    assert.deepEqual(h.audit, ["estimate.email.sent", "estimate.resent", "estimate.email.sent", "estimate.resent"]);
  });
});

it("keeps both estimate kinds tenant-scoped on preview and send, with super-admin access", async () => {
  for (const opts of [{ companyId: 2, missingBranch: true }, { companyId: null, missingBranch: true }]) {
    await withServer(estimateHarness(opts), async request => {
      for (const path of ["/outgoing-email/estimate/50123", "/outgoing-email/estimate_resend/50124"]) {
        assert.equal((await request(`${path}/preview`)).status, 404);
        assert.equal((await request(`${path}/send`, "POST", { confirmationToken: "foreign-review" })).status, 404);
        assert.equal((await request(`${path}/attachment`, "POST", { confirmationToken: "foreign-review" })).status, 404);
      }
    });
  }
  await withServer(estimateHarness({ companyId: null, role: "super_admin" }), async request => {
    for (const path of ["/outgoing-email/estimate/50123", "/outgoing-email/estimate_resend/50124"]) {
      const fields = { options: { attachPdf: false } };
      const { status, body } = await request(`${path}/preview`, "POST", fields);
      assert.equal(status, 200);
      assert.equal((await request(`${path}/send`, "POST", { ...fields, confirmationToken: body.confirmationToken })).status, 200);
    }
  });
});

const reportCases = [
  { kind: "wet_check_report", id: 66, subject: "Irrigation Inspection Results – 100 Main St",
    filename: "100 Main St - Inspection Report.pdf", viewUrl: "/api/wet-checks/66/report-pdf", denied: "Access restricted to manager/admin/billing roles" },
  { kind: "irrigation_profile_report", id: 42, subject: "Irrigation System Profile – 100 Main St",
    filename: "100 Main St - Irrigation Profile.pdf", viewUrl: "/api/customers/42/irrigation-profile/report-pdf", denied: "Forbidden" },
];

for (const report of reportCases) {
  const route = `/outgoing-email/${report.kind}/${report.id}`;
  it(`${report.kind} previews current recipient and sends the reviewed fields and report bytes`, async () => {
    const h = harness();
    await withServer(h, async request => {
      const defaults = await request(`${route}/preview`);
      assert.equal(defaults.status, 200);
      assert.equal(defaults.body.to, "current@example.invalid");
      assert.equal(defaults.body.subject, report.subject);
      assert.match(defaults.body.html, /<tr bgcolor="#82bf40"><td height="5"/);
      assert.match(defaults.body.text, /Hello The Ranch,\s+[\s\S]*Property: 100 Main St/);
      assert.doesNotMatch(defaults.body.html, /gradient|<svg|\p{Extended_Pictographic}/u);
      assert.deepEqual(defaults.body.from, sender.from);
      assert.equal(defaults.body.replyTo, sender.replyTo);
      assert.deepEqual(defaults.body.attachments, [{ filename: report.filename, viewUrl: report.viewUrl }]);
      assert.deepEqual(defaults.body.variantDefs, []);
      assert.equal((await request(`${route}/send`, "POST", {})).status, 400);
      assert.equal(h.reportRenders.length, 0);
      const fields = { to: "reviewed@example.invalid", cc: ["cc@example.invalid"], bcc: ["bcc@example.invalid"], subject: "Reviewed report", note: "Check <this>." };
      const review = await request(`${route}/preview`, "POST", fields);
      assert.equal(review.status, 200);
      assert.match(review.body.html, /Check &lt;this&gt;\./);
      assert.match(review.body.text, /Check <this>\./);
      const confirmationToken = review.body.confirmationToken;
      assert.equal((await request(`${route}/send`, "POST", { ...fields, cc: [], confirmationToken })).status, 409);
      const result = await request(`${route}/send`, "POST", { ...fields, confirmationToken });
      assert.equal(result.status, 200);
      assert.equal(result.body.sentTo, fields.to);
      assert.deepEqual(h.reportRenders, [report.kind]);
      const [{ args }] = h.reportSends;
      assert.equal(args.to, fields.to);
      assert.deepEqual(args.cc, fields.cc);
      assert.deepEqual(args.bcc, fields.bcc);
      assert.deepEqual(args.sender, sender);
      assert.deepEqual(args.pdfBuffer, bytes);
      assert.deepEqual(args.reviewed, { subject: fields.subject, html: review.body.html, text: review.body.text, filename: report.filename });
    });
  });

  it(`${report.kind} lets the reviewer fill in a missing customer email`, async () => {
    const h = harness({ email: null });
    await withServer(h, async request => {
      const initial = await request(`${route}/preview`);
      assert.equal(initial.status, 200);
      assert.equal(initial.body.to, "");
      assert.match(initial.body.warnings.join(" "), /No email address/);
      assert.equal((await request(`${route}/send`, "POST", { confirmationToken: initial.body.confirmationToken })).status, 422);
      const fields = { to: "entered@example.invalid" };
      const preview = await request(`${route}/preview`, "POST", fields);
      assert.equal((await request(`${route}/send`, "POST", { ...fields, confirmationToken: preview.body.confirmationToken })).status, 200);
    });
  });

  it(`${report.kind} enforces the same role and tenant gates for preview and send`, async () => {
    for (const [opts, status, message] of [
      [{ companyId: 2 }, 404, "Document not found."],
      [{ role: "field_tech" }, 403, report.denied],
      [{ role: "super_admin", companyId: null }, 200, undefined],
    ] as const) {
      const h = harness(opts);
      await withServer(h, async request => {
        const reviewed = await request(`${route}/preview`);
        assert.equal(reviewed.status, status);
        const sent = await request(`${route}/send`, "POST", { confirmationToken: reviewed.body.confirmationToken });
        assert.equal(sent.status, status);
        if (message) {
          assert.equal(reviewed.body.message, message);
          assert.equal(sent.body.message, message);
        }
        assert.equal(h.reportSends.length, status === 200 ? 1 : 0);
      });
    }
  });

  it(`${report.kind} refuses a stale report review`, async () => {
    const h = harness();
    await withServer(h, async request => {
      const review = await request(`${route}/preview`);
      if (report.kind === "wet_check_report") h.wc.updatedAt = new Date("2026-10-20");
      else h.controller.updatedAt = new Date("2026-10-20");
      assert.equal((await request(`${route}/send`, "POST", { confirmationToken: review.body.confirmationToken })).status, 409);
      assert.equal(h.reportSends.length, 0);
    });
  });
}

it("previews the Denver inspection date but never the technician, even when recorded", async () => {
  const h = harness();
  await withServer(h, async request => {
    const route = "/outgoing-email/wet_check_report/66/preview";
    const { status, body } = await request(route);
    assert.equal(status, 200);
    assert.match(body.text, /Inspection date: Oct 12, 2026/);
    assert.match(body.html, />Inspection<\/div>\s*<div[^>]*>Oct 12, 2026<\/div>/);
    assert.ok(!`${body.html}\n${body.text}`.includes(h.wc.technicianName));
    assert.doesNotMatch(`${body.html}\n${body.text}`, /Technician:/);
    h.wc.startedAt = null;
    const undated = await request(route);
    assert.equal(undated.status, 200);
    assert.doesNotMatch(`${undated.body.html}\n${undated.body.text}`, /Inspection date|Oct 12, 2026/);
  });
});

it("previews the number of controllers without rendering the profile PDF", async () => {
  const h = harness();
  await withServer(h, async request => {
    const { status, body } = await request("/outgoing-email/irrigation_profile_report/42/preview");
    assert.equal(status, 200);
    assert.match(body.html, />Controllers<\/th>\s*<td[^>]*>1<\/td>/);
    assert.match(body.text, /^Controllers: 1$/m);
    assert.deepEqual(h.reportRenders, []);
  });
});

it("serves the exact saved invoice bytes inline only to readers in scope, including super admin", async () => {
  for (const [opts, status] of [
    [{}, 200], [{ role: "super_admin", companyId: null }, 200], [{ companyId: 2 }, 404], [{ role: "field_tech" }, 403],
  ] as const) {
    const h = harness(opts);
    h.copies.push({ filename, pdfUrl: "saved", companyId: 1 });
    h.uploaded.push({ key: "saved", buf: bytes, contentType: "application/pdf" });
    await withServer(h, async request => {
      const result = await request("/invoices/1008/sent-copy", "GET");
      assert.equal(result.status, status);
      assert.equal(h.generated(), 0);
      assert.deepEqual(h.savedReads, status === 200 ? ["saved"] : []);
      if (status === 200) {
        assert.deepEqual(result.body, bytes);
        assert.equal(result.headers?.get("content-type"), "application/pdf");
        assert.match(result.headers?.get("content-disposition") ?? "", /^inline; filename="The Ranch/);
      }
    });
  }
  await withServer(harness(), async request => assert.equal((await request("/invoices/1008/sent-copy", "GET")).status, 404));
});

it("previews current email, company sender, period, amount, due date and filename without rendering the PDF", async () => {
  const h = harness();
  await withServer(h, async request => {
    const { status, body } = await request("/preview");
    assert.equal(status, 200);
    assert.equal(body.to, "current@example.invalid");
    assert.equal(body.subject, "Irrigation Invoice IR-1008 – The Ranch – October 2026");
    assert.deepEqual(body.from, sender.from);
    assert.equal(body.replyTo, sender.replyTo);
    assert.deepEqual(body.attachments, [{ filename, viewUrl: "/api/invoices/1008/pdf/download" }]);
    assert.ok(body.confirmationToken);
    assert.match(body.html, /High Plains Property Maintenance/);
    assert.match(body.html, /\/api\/company-logo\/high-plains-test-logo/);
    assert.match(body.html, /October 2026 · Irrigation/);
    assert.match(body.html, /Your October 2026 invoice is ready/);
    assert.match(body.html, /Oct 1 – Oct 31, 2026/);
    assert.match(body.html, /bgcolor="#1e5c99">\s*<th[^>]+>Amount due<\/th>\s*<td[^>]+>\$1,234\.56/);
    assert.match(body.html, /Nov 30, 2026/);
    assert.match(body.html, /Billing detail report/);
    assert.match(body.html, /100 Main St · \(970\) 555-0100/);
    assert.match(body.html, /Sent with[\s\S]*\/email\/irrigopro-wordmark\.png/);
    assert.match(body.text, /Attached: The Ranch - Irrigation Billing Detail/);
    assert.doesNotMatch(body.html, /A note from|Pay now|Understanding Your Invoice/);
    assert.equal(h.generated(), 0);
    assert.deepEqual(h.events, []);
  });
});

it("previews and sends the guide after the invoice PDF and records the exact version", async () => {
  const h = harness({ attachInvoiceGuide: true, currentGuide: guide });
  await withServer(h, async request => {
    const { status, body } = await request("/preview");
    assert.equal(status, 200);
    assert.deepEqual(body.attachments, [
      { filename, viewUrl: "/api/invoices/1008/pdf/download" },
      { title: "Guide: how to read your invoice", filename: guide.filename, viewUrl: `/api/platform-documents/${guide.id}/file` },
    ]);
    assert.match(body.html, /Billing detail report[\s\S]*Guide: how to read your invoice[\s\S]*Understanding Your Invoice\.pdf/);
    assert.match(body.text, /Attached:[\s\S]*Understanding Your Invoice\.pdf/);
    const sent = await request("/send", "POST", { confirmationToken: body.confirmationToken });
    assert.equal(sent.status, 200, JSON.stringify(sent.body));
    assert.equal(h.sent[0][4].filename, filename);
    assert.deepEqual(h.sent[0][4].extraAttachments, [{ filename: guide.filename, content: guideBytes }]);
    assert.equal(h.copies[0].guideDocumentId, guide.id);
  });
});

it("sends without a guide when disabled, and warns only when enabled with no current guide", async () => {
  for (const attachInvoiceGuide of [false, true]) {
    const h = harness({ attachInvoiceGuide, currentGuide: attachInvoiceGuide ? undefined : guide });
    await withServer(h, async request => {
      const { status, body } = await request("/preview");
      assert.equal(status, 200);
      assert.equal(body.attachments.length, 1);
      assert.deepEqual(body.warnings, attachInvoiceGuide ? ["No invoice guide is uploaded yet, so this email goes without it."] : []);
      assert.equal((await request("/send", "POST", { confirmationToken: body.confirmationToken })).status, 200);
      assert.equal(h.copies[0].guideDocumentId, null);
      assert.equal(h.sent[0][4].extraAttachments, undefined);
    });
  }
});

for (const replaceGuideDuringRender of [false, true]) {
  it(`blocks a same-filename guide replacement ${replaceGuideDuringRender ? "during PDF rendering" : "after preview"}`, async () => {
    const h = harness({ attachInvoiceGuide: true, currentGuide: guide, replaceGuideDuringRender });
    await withServer(h, async request => {
      const { body } = await request("/preview");
      if (!replaceGuideDuringRender) h.guides.current = { ...guide, id: guide.id + 1 };
      const refused = await request("/send", "POST", { confirmationToken: body.confirmationToken });
      assert.equal(refused.status, 409);
      assert.equal(refused.body.message, "The invoice guide was replaced after you reviewed this email. Review it again before sending.");
      assert.deepEqual(h.events, []);
      assert.equal(h.generated(), replaceGuideDuringRender ? 1 : 0);
    });
  });
}

it("does not send or save an invoice copy if the reviewed guide cannot be loaded", async () => {
  const h = harness({ attachInvoiceGuide: true, currentGuide: guide, guideReadFailure: true });
  await withServer(h, async request => {
    const response = await request("/send");
    assert.equal(response.status, 500);
    assert.equal(response.body.message, "Could not load the invoice guide. Nothing was sent.");
    assert.deepEqual(h.events, []);
  });
});

it("never shows the guide on estimate or report reviews", async () => {
  await withServer(estimateHarness(), async request => {
    for (const path of ["estimate/50123", "estimate_resend/50124"]) {
      const result = await request(`/outgoing-email/${path}/preview`);
      assert.equal(result.status, 200);
      assert.doesNotMatch(JSON.stringify(result.body.attachments), /platform-documents|Understanding Your Invoice/);
    }
  });
  await withServer(harness({ attachInvoiceGuide: true, currentGuide: guide, role: "company_admin" }), async request => {
    for (const path of ["wet_check_report/66", "irrigation_profile_report/42"]) {
      const result = await request(`/outgoing-email/${path}/preview`);
      assert.equal(result.status, 200);
      assert.doesNotMatch(JSON.stringify(result.body.attachments), /platform-documents|Understanding Your Invoice/);
    }
  });
});

it("does not expose internal A/R notes in the preview or the email sent to the customer", async () => {
  const h = harness();
  Object.assign(h.invoice, {
    arNotes: [{ note: "Private note: customer disputed the second ticket." }],
    arNoteCount: 1,
    arNotePreview: "Private note: talked to collections.",
    lastArNotePreview: "Private note: hold for review.",
  });
  await withServer(h, async request => {
    const fields = { note: "Customer-facing note" };
    const preview = await request("/preview", "POST", fields);
    assert.equal(preview.status, 200);
    assert.equal((await request("/send", "POST", { ...fields, confirmationToken: preview.body.confirmationToken })).status, 200);
    const message = h.sent[0][4];
    for (const { html, text } of [preview.body, message]) {
      for (const part of [html, text]) {
        assert.match(part, /Customer-facing note/);
        assert.doesNotMatch(part, /Private note|arNotePreview|lastArNotePreview/);
      }
    }
  });
});

it("sends and saves the reviewed contents and identical PDF bytes, using the token only once", async () => {
  const h = harness();
  await withServer(h, async request => {
    const fields = { to: "test@example.com", subject: "Reviewed billing", cc: ["cc@example.com"], bcc: ["bcc@example.com"], note: "Thanks <team> & office." };
    const { body: draft } = await request("/preview", "POST", fields);
    const payload = { ...fields, confirmationToken: draft.confirmationToken };
    const { status, body } = await request("/send", "POST", payload);
    assert.equal(status, 200);
    assert.equal(body.sentTo, fields.to);
    assert.ok(body.sentAt);
    assert.deepEqual(h.events, ["upload", "send", "insert"]);
    assert.match(h.uploaded[0].key, /^invoice-sent-copies\/1\/1008\/.+\.pdf$/);
    assert.ok(bytes.length > 0);
    assert.deepEqual(h.sent[0][3], bytes);
    assert.deepEqual(h.uploaded[0].buf, h.sent[0][3]);
    assert.equal(h.uploaded[0].cacheControl, "private, no-store");
    assert.equal(h.uploaded[0].contentType, "application/pdf");
    assert.equal(h.sent[0][0], fields.to);
    assert.deepEqual(h.sent[0][4], {
      sender, filename, cc: fields.cc, bcc: fields.bcc, subject: fields.subject, html: draft.html, text: draft.text,
    });
    assert.match(draft.html, /Thanks &lt;team&gt; &amp; office\./);
    assert.match(draft.text, /Thanks <team> & office\./);
    assert.equal(h.copies.length, 1);
    const row = h.copies[0];
    assert.equal(row.pdfUrl, h.uploaded[0].key);
    assert.equal(row.status, "sent");
    assert.equal(row.sentToEmail, fields.to);
    assert.equal(row.subject, fields.subject);
    assert.equal(row.sentByUserId, 7);
    assert.equal(row.byteSize, bytes.length);
    assert.equal(row.companyId, 1);
    assert.equal(row.filename, filename);
    assert.deepEqual(row.ccEmails, fields.cc);
    assert.deepEqual(row.bccEmails, fields.bcc);
    assert.equal(h.stamps[0].sentAt, row.sentAt);
    const replay = await request("/send", "POST", payload);
    assert.equal(replay.status, 409);
    assert.equal(replay.body.reason, "confirmation_used");
    const ready = await request("", "GET");
    assert.deepEqual(ready.body, { filename, sentAt: row.sentAt.toISOString(), sentToEmail: fields.to });
    assert.equal(h.copies.length, 1, "opening metadata must not write");
  });
});

it("deletes the uploaded object and writes no sent row when the mailer rejects", async () => {
  const h = harness({ mailFailure: true });
  await withServer(h, async request => {
    assert.equal((await request()).status, 500);
    assert.deepEqual(h.deleted, [h.uploaded[0].key]);
    assert.equal(h.copies.length, 0);
    assert.equal(h.stamps.length, 0);
  });
});

it("refuses a customer and invoice with no email before upload or send", async () => {
  const h = harness({ email: "  ", oldEmail: null });
  await withServer(h, async request => {
    const res = await request();
    assert.equal(res.status, 422);
    assert.equal(res.body.message, "This customer has no billing email. Enter one, or add it in QuickBooks and resync.");
    assert.deepEqual(h.events, []);
  });
});

it("uses the invoice email only when the current customer email is blank", async () => {
  const h = harness({ email: " " });
  await withServer(h, async request => {
    assert.equal((await request()).body.sentTo, "old@example.invalid");
  });
});

it("refuses company B on send, metadata and download before generating; super admin can send", async () => {
  const h = harness({ companyId: 2 });
  await withServer(h, async request => {
    assert.equal((await request("/preview")).status, 404);
    assert.equal((await request("/send", "POST", { confirmationToken: "not-for-this-company" })).status, 404);
    assert.equal((await request("", "GET")).status, 404);
    assert.equal((await request("/download", "GET")).status, 404);
    assert.equal(h.generated(), 0);
    assert.deepEqual(h.events, []);
  });
  const admin = harness({ role: "super_admin", companyId: null });
  await withServer(admin, async request => {
    assert.equal((await request("/preview")).status, 200);
    assert.equal((await request()).status, 200);
  });
});

it("rejects a customer belonging to another company", async () => {
  const h = harness({ customerCompany: 2 });
  await withServer(h, async request => {
    assert.equal((await request()).status, 404);
    assert.deepEqual(h.events, []);
  });
});

it("a non-admin without a company cannot use the unscoped lookup", async () => {
  const h = harness({ companyId: null });
  await withServer(h, async request => {
    assert.equal((await request()).status, 404);
    assert.deepEqual(h.events, []);
  });
});

it("GET metadata validates the PDF but never creates a row", async () => {
  const h = harness();
  await withServer(h, async request => {
    assert.deepEqual(await request("", "GET"), { status: 200, body: { filename, sentAt: null, sentToEmail: null } });
    assert.equal(h.generated(), 1);
    assert.deepEqual(h.events, []);
  });
});

it("upload failure sends nothing and reports the save error", async () => {
  const h = harness({ uploadFailure: true });
  await withServer(h, async request => {
    assert.deepEqual(await request(), { status: 500, body: { message: "Could not save the invoice PDF. Nothing was sent." } });
    assert.equal(h.sent.length, 0);
    assert.equal(h.copies.length, 0);
  });
});

it("returns 422 for totals drift on both GET and send", async () => {
  const h = harness({ validationFailure: true });
  await withServer(h, async request => {
    assert.equal((await request()).status, 422);
    assert.equal((await request("", "GET")).status, 422);
    assert.deepEqual(h.events, []);
  });
});

it("resends append copies without overwriting the invoice's original sent timestamp", async () => {
  const h = harness({ alreadySent: true });
  await withServer(h, async request => {
    assert.equal((await request()).status, 200);
    const { body } = await request("/preview");
    assert.match(body.warnings[0], /^Already sent on .+ to current@example\.invalid\. Sending again sends a new copy\./);
    assert.equal((await request()).status, 200);
    assert.equal(h.copies.length, 2);
    assert.equal(h.stamps.length, 0);
  });
});

it("rejects a missing review, changed subject or changed sender without delivery", async () => {
  const h = harness();
  await withServer(h, async request => {
    const missing = await request("/send", "POST", {});
    assert.equal(missing.status, 400);
    assert.equal(missing.body.reason, "confirmation_required");
    const { body: { confirmationToken } } = await request("/preview");
    const subject = await request("/send", "POST", { confirmationToken, subject: "Unreviewed subject" });
    assert.equal(subject.status, 409);
    assert.equal(subject.body.reason, "confirmation_mismatch");
    const address = h.company.address;
    h.company.address = "New footer address";
    assert.equal((await request("/send", "POST", { confirmationToken })).status, 409);
    h.company.address = address;
    h.company.emailReplyTo = "new@example.com";
    assert.equal((await request("/send", "POST", { confirmationToken })).status, 409);
    assert.deepEqual(h.events, []);
    assert.equal(h.generated(), 0);
  });
});

it("rejects an edit both after preview and during PDF rendering with the invoice-specific message", async () => {
  for (const mutateDuringRender of [false, true]) {
    const h = harness({ mutateDuringRender });
    await withServer(h, async request => {
      const { body: { confirmationToken } } = await request("/preview");
      if (!mutateDuringRender) h.invoice.updatedAt = new Date("2026-11-19");
      const response = await request("/send", "POST", { confirmationToken });
      assert.equal(response.status, 409);
      assert.equal(response.body.message, "This invoice changed after you reviewed it. Review it again before sending.");
      assert.deepEqual(h.events, []);
    });
  }
});

it("validates draft length and email fields, and refuses unregistered kinds", async () => {
  const h = harness();
  await withServer(h, async request => {
    const cc = Array.from({ length: 6 }, (_, i) => `cc${i}@example.com`);
    assert.equal((await request("/preview", "POST", { cc })).status, 400);
    assert.equal((await request("/send", "POST", { cc })).status, 400);
    assert.equal((await request("/preview", "POST", { to: "not-an-email" })).status, 400);
    assert.equal((await request("/preview", "POST", { subject: "x".repeat(201) })).status, 400);
    assert.equal((await request("/preview", "POST", { note: "x".repeat(1001) })).status, 400);
    assert.equal((await request("/outgoing-email/estimates/1008/preview")).status, 404);
    assert.deepEqual(h.events, []);
  });
});

it("keeps authentication and invoice send capability in front of both operations", async () => {
  for (const [options, status] of [[{ unauthenticated: true }, 401], [{ role: "irrigation_manager" }, 403]] as const) {
    await withServer(harness(options), async request => {
      assert.equal((await request("/preview")).status, status);
      assert.equal((await request("/send", "POST", {})).status, status);
    });
  }
});

it("refuses cancelled, superseded and merged invoices", async () => {
  const h = harness();
  await withServer(h, async request => {
    for (const status of ["cancelled", "superseded", "merged"]) {
      h.invoice.status = status;
      assert.equal((await request("/preview")).status, 404);
      assert.equal((await request("/send", "POST", {})).status, 404);
    }
    assert.deepEqual(h.events, []);
  });
});

it("formats invoice subjects and billing date ranges for same-month, cross-month and cross-year periods in UTC", async () => {
  const h = harness();
  await withServer(h, async request => {
    for (const [start, end, month, range] of [
      ["2026-10-01", "2026-10-31", "October 2026", "Oct 1 – Oct 31, 2026"],
      ["2026-09-30", "2026-10-31", "September–October 2026", "Sep 30 – Oct 31, 2026"],
      ["2026-12-31", "2027-01-01", "December 2026–January 2027", "Dec 31, 2026 – Jan 1, 2027"],
    ]) {
      h.invoice.periodStart = new Date(start);
      h.invoice.periodEnd = new Date(end);
      const { status, body } = await request("/preview");
      assert.equal(status, 200);
      assert.equal(body.subject, `Irrigation Invoice IR-1008 – The Ranch – ${month}`);
      assert.ok(body.text.includes(`Billing period: ${range}`));
    }
  });
});

it("uses a single filename builder including the documented fallback", () => {
  assert.equal(buildInvoicePdfFilename({ periodStart: new Date(2026, 9, 1), periodEnd: new Date(2026, 9, 31) }, { irrigoName: "The Ranch", name: "Other" }, 1008), filename);
  assert.equal(buildInvoicePdfFilename(null, null, 1008), "Irrigation Billing Detail - 1008.pdf");
});

it("reads saved object bytes and returns null for a missing saved copy", async () => {
  const { Readable } = await import("node:stream");
  const search = mock.method(ObjectStorageService.prototype, "searchPublicObject", async (key: string) =>
    key === "missing" ? null : { createReadStream: () => Readable.from([bytes.subarray(0, 8), bytes.subarray(8)]) } as any);
  try {
    assert.deepEqual(await readInvoiceSentCopy("saved"), bytes);
    assert.equal(await readInvoiceSentCopy("missing"), null);
  } finally { search.mock.restore(); }
});
