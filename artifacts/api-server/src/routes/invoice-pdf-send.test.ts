import { it, mock } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

// Storage initialization must not run in this in-memory HTTP suite.
mock.module("../storage", { namedExports: { storage: {} } });
const { registerInvoicePdfRoutes } = await import("./invoice-pdf-routes");
const { buildInvoicePdfFilename, readInvoiceSentCopy } = await import("../invoice-pdf-service");
const { ObjectStorageService } = await import("../objectStorage");

const bytes = Buffer.from("%PDF-1.7\nexact generated invoice bytes");
const filename = "The Ranch - Irrigation Billing Detail - (10-1-26_10-31-26).pdf";

function harness(opts: {
  companyId?: number | null; role?: string; email?: string | null; oldEmail?: string | null;
  mailFailure?: boolean; uploadFailure?: boolean; alreadySent?: boolean; customerCompany?: number;
  validationFailure?: boolean;
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
    sentAt: opts.alreadySent ? new Date("2026-10-31") : null,
  };
  const app = express();
  registerInvoicePdfRoutes(app, {
    requireAuthentication: (req: any, _res, next) => {
      req.authenticatedUserCompanyId = opts.companyId === undefined ? 1 : opts.companyId;
      req.authenticatedUserRole = opts.role ?? "billing_manager";
      req.authenticatedUserId = 7;
      next();
    },
    requireInvoiceRead: (_req, _res, next) => next(),
    requireInvoiceSend: (_req, _res, next) => next(),
    _storageApi: {
      async getInvoiceById(id: number, companyId: number | null) {
        return id === invoice.id && (companyId === null || companyId === invoice.companyId) ? invoice : undefined;
      },
      async getCustomerById() {
        return { id: 42, companyId: opts.customerCompany ?? 1, name: "QB customer", irrigoName: "The Ranch",
          email: opts.email === undefined ? " current@example.invalid " : opts.email };
      },
      async getCompanyProfile() { return { email: "office@example.invalid" }; },
      async createInvoicePdf(row: any) { events.push("insert"); copies.push(row); return row; },
      async updateInvoice(id: number, data: any) { stamps.push({ id, ...data }); },
      async getLatestInvoiceSentCopy() { return copies.at(-1); },
    } as any,
    _generatePdf: async () => {
      generated++;
      return opts.validationFailure
        ? { success: false, error: "totals drift", validationFailure: {} as any }
        : { success: true, pdfBuffer: bytes };
    },
    _objectStorage: {
      async writeBufferToFirstSearchPath(key, buf, contentType, cacheControl) {
        if (opts.uploadFailure) throw new Error("upload failed");
        events.push("upload"); uploaded.push({ key, buf, contentType, cacheControl });
      },
      async deleteFromFirstSearchPath(key) { deleted.push(key); },
    },
    _mailer: async (...args) => {
      events.push("send"); sent.push(args);
      return opts.mailFailure ? { success: false, error: "mailer rejected" } : { success: true };
    },
  });
  return { app, uploaded, deleted, sent, copies, stamps, events, generated: () => generated };
}

async function withServer(h: ReturnType<typeof harness>, run: (request: (path?: string, method?: string) => Promise<{ status: number; body: any }>) => Promise<void>) {
  const server = createServer(h.app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/invoices/1008/pdf`;
  try {
    await run(async (path = "/send", method = "POST") => {
      const res = await fetch(`${base}${path}`, { method });
      return { status: res.status, body: await res.json() };
    });
  } finally {
    await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  }
}

it("uploads and emails identical nonempty bytes, then records the current recipient and delivery metadata", async () => {
  const h = harness();
  await withServer(h, async request => {
    assert.deepEqual(await request(), { status: 200, body: { message: "PDF sent successfully to customer", email: "current@example.invalid" } });
    assert.deepEqual(h.events, ["upload", "send", "insert"]);
    assert.match(h.uploaded[0].key, /^invoice-sent-copies\/1\/1008\/.+\.pdf$/);
    assert.ok(bytes.length > 0);
    assert.deepEqual(h.sent[0][3], bytes);
    assert.deepEqual(h.uploaded[0].buf, h.sent[0][3]);
    assert.equal(h.uploaded[0].cacheControl, "private, no-store");
    assert.equal(h.uploaded[0].contentType, "application/pdf");
    assert.deepEqual(h.sent[0][4], { replyTo: "office@example.invalid", filename });
    assert.equal(h.copies.length, 1);
    const row = h.copies[0];
    assert.equal(row.pdfUrl, h.uploaded[0].key);
    assert.equal(row.status, "sent");
    assert.equal(row.sentToEmail, "current@example.invalid");
    assert.equal(row.subject, "Invoice Detail Report - IR-1008");
    assert.equal(row.sentByUserId, 7);
    assert.equal(row.byteSize, bytes.length);
    assert.equal(row.companyId, 1);
    assert.equal(row.filename, filename);
    assert.deepEqual(row.ccEmails, []);
    assert.deepEqual(row.bccEmails, []);
    assert.equal(h.stamps[0].sentAt, row.sentAt);
    const ready = await request("", "GET");
    assert.deepEqual(ready.body, { filename, sentAt: row.sentAt.toISOString(), sentToEmail: "current@example.invalid" });
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
    assert.equal(res.body.message, "This customer has no billing email. Add one in QuickBooks, resync customers, then send.");
    assert.deepEqual(h.events, []);
  });
});

it("uses the invoice email only when the current customer email is blank", async () => {
  const h = harness({ email: " " });
  await withServer(h, async request => {
    assert.equal((await request()).body.email, "old@example.invalid");
  });
});

it("refuses company B on send, metadata and download before generating; super admin can send", async () => {
  const h = harness({ companyId: 2 });
  await withServer(h, async request => {
    assert.equal((await request()).status, 404);
    assert.equal((await request("", "GET")).status, 404);
    assert.equal((await request("/download", "GET")).status, 404);
    assert.equal(h.generated(), 0);
    assert.deepEqual(h.events, []);
  });
  const admin = harness({ role: "super_admin", companyId: null });
  await withServer(admin, async request => assert.equal((await request()).status, 200));
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
    assert.equal((await request()).status, 200);
    assert.equal(h.copies.length, 2);
    assert.equal(h.stamps.length, 0);
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
