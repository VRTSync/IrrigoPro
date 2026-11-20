import { it, mock } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

// Storage initialization must not run in this in-memory HTTP suite.
mock.module("../storage", { namedExports: { storage: {} } });
const { registerInvoicePdfRoutes } = await import("./invoice-pdf-routes");
const { registerOutgoingEmailRoutes } = await import("./outgoing-email-routes");
const { createInvoiceEmailHandler } = await import("../outgoing-email/invoice-handler");
const { buildInvoiceEmailSubject, buildInvoicePdfFilename, InvoicePdfService, readInvoiceSentCopy } = await import("../invoice-pdf-service");
const { ObjectStorageService } = await import("../objectStorage");

const bytes = Buffer.from("%PDF-1.7\nexact generated invoice bytes");
const filename = "The Ranch - Irrigation Billing Detail - (10-1-26_10-31-26).pdf";
const sender = {
  from: { name: "High Plains Property Maintenance", email: "billing@example.invalid" },
  replyTo: "office@example.invalid",
  usingCompanyAddress: true,
};

function harness(opts: {
  companyId?: number | null; role?: string; email?: string | null; oldEmail?: string | null;
  mailFailure?: boolean; uploadFailure?: boolean; alreadySent?: boolean; customerCompany?: number;
  validationFailure?: boolean; unauthenticated?: boolean; mutateDuringRender?: boolean;
} = {}) {
  const events: string[] = [];
  const uploaded: { key: string; buf: Buffer; contentType: string; cacheControl?: string }[] = [];
  const deleted: string[] = [];
  const sent: any[][] = [];
  const copies: any[] = [];
  const stamps: any[] = [];
  let generated = 0;
  const invoice = {
    id: 1008, customerId: 42, companyId: 1, invoiceNumber: "IR-1008",
    customerName: "The Ranch", customerEmail: opts.oldEmail === undefined ? "old@example.invalid" : opts.oldEmail,
    periodStart: new Date(2026, 9, 1), periodEnd: new Date(2026, 9, 31),
    createdAt: new Date("2026-10-31"), updatedAt: new Date("2026-11-02"),
    dueDate: new Date("2026-11-30"), totalAmount: "1234.56", status: "generated",
    sentAt: opts.alreadySent ? new Date("2026-10-31") : null, items: [],
  };
  const company = {
    name: sender.from.name, email: sender.replyTo, phone: "970-555-0100",
    emailFromName: sender.from.name, emailFromAddress: sender.from.email,
    emailReplyTo: sender.replyTo, emailSendingDomain: "example.invalid", emailDomainVerifiedAt: new Date(),
  };
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
        email: opts.email === undefined ? " current@example.invalid " : opts.email };
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
    return opts.validationFailure
      ? { success: false, error: "totals drift", validationFailure: { validationFailed: true as const, rowErrors: [] }, documentVersion }
      : { success: true, pdfBuffer: bytes, documentVersion };
  };
  registerInvoicePdfRoutes(app, {
    requireAuthentication,
    requireInvoiceRead: (_req, _res, next) => next(),
    _storageApi: storage,
    _generatePdf: generate,
  });
  const handler = createInvoiceEmailHandler({
    storage,
    pdf: { getDocumentVersion: pdf.getDocumentVersion.bind(pdf), generatePdfBuffer: generate },
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
  registerOutgoingEmailRoutes(app, { requireAuthentication, handlers: [handler] });
  return { app, invoice, company, uploaded, deleted, sent, copies, stamps, events, generated: () => generated };
}

async function withServer(h: ReturnType<typeof harness>, run: (request: (path?: string, method?: string, fields?: Record<string, unknown>) => Promise<{ status: number; body: any }>) => Promise<void>) {
  const server = createServer(h.app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  try {
    await run(async (path = "/send", method = "POST", fields?: Record<string, unknown>) => {
      const url = `${base}${path.startsWith("/outgoing-email/") ? path : method === "GET" ? `/invoices/1008/pdf${path}` : `/outgoing-email/invoice/1008${path}`}`;
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
      return { status: res.status, body: await res.json().catch(() => null) };
    });
  } finally {
    await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  }
}

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
    assert.match(body.html, /\$1,234\.56/);
    assert.match(body.html, /Nov 30, 2026/);
    assert.doesNotMatch(body.html, /IrrigoPro/);
    assert.equal(h.generated(), 0);
    assert.deepEqual(h.events, []);
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

it("validates draft length and email fields, and only registers the invoice kind", async () => {
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

it("formats invoice subjects for same-month, cross-month and cross-year periods in UTC", () => {
  const customer = { name: "QB Ranch", irrigoName: "The Ranch" };
  const subject = (periodStart: string, periodEnd: string) =>
    buildInvoiceEmailSubject({ invoiceNumber: "IR-1008", periodStart, periodEnd }, customer);
  assert.equal(subject("2026-10-01", "2026-10-31"), "Irrigation Invoice IR-1008 – The Ranch – October 2026");
  assert.equal(subject("2026-09-30", "2026-10-31"), "Irrigation Invoice IR-1008 – The Ranch – September–October 2026");
  assert.equal(subject("2026-12-31", "2027-01-01"), "Irrigation Invoice IR-1008 – The Ranch – December 2026–January 2027");
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
