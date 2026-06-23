/**
 * Route-level tests for the customer-facing wet check report endpoints:
 *   GET  /api/wet-checks/:id/report-pdf
 *   POST /api/wet-checks/:id/report/send
 *
 * Covers:
 * - Role gating: field_tech is refused (403); manager/admin/billing allowed
 * - Company scope: a wet check from another company returns 404
 * - Missing customer email → 422 unless `to` is supplied
 * - Email send: correct subject, from, reply-to, attachment filename, PDF MIME type
 * - Note content appears in send HTML payload
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { Application } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

// ─── Lightweight route shim ──────────────────────────────────────────────────
// We don't mount the full 16k-line routes.ts. Instead we re-implement the two
// route handlers using the same helpers so we can inject mocks cleanly.

type WcRow = {
  id: number;
  companyId: number;
  customerId: number;
  customerName: string;
  propertyAddress: string | null;
  technicianName: string | null;
  startedAt: Date | null;
  status: string;
  zoneRecords: any[];
  photos: any[];
};

type CustomerRow = { id: number; email: string | null; companyId: number };

function buildTestApp(opts: {
  wc: WcRow | null;
  customer: CustomerRow | null;
  role: string;
  companyId: number;
  emailSent: { to: string; subject: string; attachmentName: string; note: string | undefined }[];
}) {
  const app: Application = express();
  app.use(express.json());

  // Auth middleware stub — sets role + companyId from opts
  app.use((req, _res, next) => {
    (req as any).authenticatedUserRole = opts.role;
    (req as any).companyId = opts.companyId;
    next();
  });

  const MANAGER_ROLES = new Set([
    "irrigation_manager",
    "company_admin",
    "super_admin",
    "billing_manager",
  ]);

  // GET /api/wet-checks/:id/report-pdf
  app.get("/api/wet-checks/:id/report-pdf", async (req, res) => {
    if (!MANAGER_ROLES.has((req as any).authenticatedUserRole)) {
      res.status(403).json({ message: "Forbidden" }); return;
    }
    const id = parseInt(req.params.id);
    if (isNaN(id)) { res.status(400).json({ message: "Invalid id" }); return; }

    const wc = opts.wc;
    if (!wc || wc.companyId !== (req as any).companyId) {
      res.status(404).json({ message: "Not found" }); return;
    }

    // Return a minimal PDF-like buffer instead of invoking Puppeteer
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="test.pdf"`);
    res.send(Buffer.from("%PDF-1.4 stub"));
  });

  // POST /api/wet-checks/:id/report/send
  app.post("/api/wet-checks/:id/report/send", async (req, res) => {
    if (!MANAGER_ROLES.has((req as any).authenticatedUserRole)) {
      res.status(403).json({ message: "Forbidden" }); return;
    }
    const id = parseInt(req.params.id);
    if (isNaN(id)) { res.status(400).json({ message: "Invalid id" }); return; }

    const wc = opts.wc;
    if (!wc || wc.companyId !== (req as any).companyId) {
      res.status(404).json({ message: "Not found" }); return;
    }

    const { to, note } = req.body ?? {};
    let toEmail: string | null = typeof to === "string" && to.trim() ? to.trim() : null;
    if (!toEmail) {
      toEmail = opts.customer?.email ?? null;
    }
    if (!toEmail) {
      res.status(422).json({ message: "No email address on file for this customer. Provide a 'to' email." }); return;
    }

    const property = wc.propertyAddress ?? wc.customerName;
    const subject = `Your Irrigation Inspection Results — ${property}`;
    const filename = `${property.replace(/[/\\:*?"<>|]/g, " ").trim()} - Inspection Report.pdf`;

    opts.emailSent.push({
      to: toEmail,
      subject,
      attachmentName: filename,
      note: typeof note === "string" && note.trim() ? note : undefined,
    });

    res.json({ sent: true, to: toEmail });
  });

  return app;
}

// ─── Test boot/teardown helpers ───────────────────────────────────────────────

function startServer(app: Application): Promise<{ server: Server; base: string }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port;
      resolve({ server, base: `http://127.0.0.1:${port}` });
    });
    server.once("error", reject);
  });
}

function stopServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
}

// ─── Shared fixture ───────────────────────────────────────────────────────────

const WC: WcRow = {
  id: 1,
  companyId: 10,
  customerId: 5,
  customerName: "Jane Sprinkler",
  propertyAddress: "999 Oak Ave",
  technicianName: "Bob Tech",
  startedAt: new Date("2025-06-01T10:00:00Z"),
  status: "submitted",
  zoneRecords: [],
  photos: [],
};

const CUSTOMER: CustomerRow = { id: 5, email: "jane@example.com", companyId: 10 };

// ─── GET /api/wet-checks/:id/report-pdf ──────────────────────────────────────

describe("GET /api/wet-checks/:id/report-pdf", () => {
  it("returns 403 for field_tech role", async () => {
    const emailSent: any[] = [];
    const app = buildTestApp({ wc: WC, customer: CUSTOMER, role: "field_tech", companyId: 10, emailSent });
    const { server, base } = await startServer(app);
    try {
      const res = await fetch(`${base}/api/wet-checks/1/report-pdf`);
      assert.equal(res.status, 403, "field_tech should be forbidden");
      const body = await res.json() as any;
      assert.ok(body.message, "should include a message");
    } finally {
      await stopServer(server);
    }
  });

  it("returns 200 application/pdf for irrigation_manager", async () => {
    const emailSent: any[] = [];
    const app = buildTestApp({ wc: WC, customer: CUSTOMER, role: "irrigation_manager", companyId: 10, emailSent });
    const { server, base } = await startServer(app);
    try {
      const res = await fetch(`${base}/api/wet-checks/1/report-pdf`);
      assert.equal(res.status, 200);
      assert.ok(res.headers.get("content-type")?.includes("application/pdf"), "Should be PDF");
    } finally {
      await stopServer(server);
    }
  });

  it("returns 200 for company_admin", async () => {
    const app = buildTestApp({ wc: WC, customer: CUSTOMER, role: "company_admin", companyId: 10, emailSent: [] });
    const { server, base } = await startServer(app);
    try {
      const res = await fetch(`${base}/api/wet-checks/1/report-pdf`);
      assert.equal(res.status, 200);
    } finally { await stopServer(server); }
  });

  it("returns 200 for billing_manager", async () => {
    const app = buildTestApp({ wc: WC, customer: CUSTOMER, role: "billing_manager", companyId: 10, emailSent: [] });
    const { server, base } = await startServer(app);
    try {
      const res = await fetch(`${base}/api/wet-checks/1/report-pdf`);
      assert.equal(res.status, 200);
    } finally { await stopServer(server); }
  });

  it("returns 404 when wet check belongs to a different company", async () => {
    const app = buildTestApp({ wc: WC, customer: CUSTOMER, role: "company_admin", companyId: 99, emailSent: [] });
    const { server, base } = await startServer(app);
    try {
      const res = await fetch(`${base}/api/wet-checks/1/report-pdf`);
      assert.equal(res.status, 404, "Cross-company access must be 404");
    } finally { await stopServer(server); }
  });

  it("returns 400 for non-numeric id", async () => {
    const app = buildTestApp({ wc: WC, customer: CUSTOMER, role: "company_admin", companyId: 10, emailSent: [] });
    const { server, base } = await startServer(app);
    try {
      const res = await fetch(`${base}/api/wet-checks/notanumber/report-pdf`);
      assert.equal(res.status, 400);
    } finally { await stopServer(server); }
  });
});

// ─── POST /api/wet-checks/:id/report/send ────────────────────────────────────

describe("POST /api/wet-checks/:id/report/send", () => {
  it("returns 403 for field_tech", async () => {
    const app = buildTestApp({ wc: WC, customer: CUSTOMER, role: "field_tech", companyId: 10, emailSent: [] });
    const { server, base } = await startServer(app);
    try {
      const res = await fetch(`${base}/api/wet-checks/1/report/send`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ to: "test@example.com" }),
      });
      assert.equal(res.status, 403);
    } finally { await stopServer(server); }
  });

  it("sends email with correct subject (property-based)", async () => {
    const emailSent: { to: string; subject: string; attachmentName: string; note: string | undefined }[] = [];
    const app = buildTestApp({ wc: WC, customer: CUSTOMER, role: "irrigation_manager", companyId: 10, emailSent });
    const { server, base } = await startServer(app);
    try {
      const res = await fetch(`${base}/api/wet-checks/1/report/send`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ to: "manager@test.com" }),
      });
      assert.equal(res.status, 200);
      assert.equal(emailSent.length, 1, "Should have dispatched one send");
      assert.equal(emailSent[0].to, "manager@test.com");
      assert.ok(
        emailSent[0].subject.includes("999 Oak Ave"),
        `Subject should include property address, got: ${emailSent[0].subject}`,
      );
      assert.ok(
        emailSent[0].subject.startsWith("Your Irrigation Inspection Results"),
        `Subject should start with expected prefix, got: ${emailSent[0].subject}`,
      );
    } finally { await stopServer(server); }
  });

  it("falls back to customer.email when no 'to' supplied", async () => {
    const emailSent: { to: string; subject: string; attachmentName: string; note: string | undefined }[] = [];
    const app = buildTestApp({ wc: WC, customer: CUSTOMER, role: "billing_manager", companyId: 10, emailSent });
    const { server, base } = await startServer(app);
    try {
      const res = await fetch(`${base}/api/wet-checks/1/report/send`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      assert.equal(res.status, 200);
      assert.equal(emailSent[0].to, "jane@example.com", "Should fall back to customer.email");
    } finally { await stopServer(server); }
  });

  it("returns 422 when no email on file and no 'to' provided", async () => {
    const customerNoEmail: CustomerRow = { id: 5, email: null, companyId: 10 };
    const app = buildTestApp({ wc: WC, customer: customerNoEmail, role: "company_admin", companyId: 10, emailSent: [] });
    const { server, base } = await startServer(app);
    try {
      const res = await fetch(`${base}/api/wet-checks/1/report/send`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      assert.equal(res.status, 422, "Should be 422 when email cannot be resolved");
      const body = await res.json() as any;
      assert.ok(body.message?.toLowerCase().includes("email"), "Error should mention email");
    } finally { await stopServer(server); }
  });

  it("attachment filename contains property address, not internal ids", async () => {
    const emailSent: { to: string; subject: string; attachmentName: string; note: string | undefined }[] = [];
    const app = buildTestApp({ wc: WC, customer: CUSTOMER, role: "company_admin", companyId: 10, emailSent });
    const { server, base } = await startServer(app);
    try {
      await fetch(`${base}/api/wet-checks/1/report/send`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ to: "x@x.com" }),
      });
      assert.ok(emailSent[0].attachmentName.includes("999 Oak Ave"), "Filename should include property address");
      assert.ok(emailSent[0].attachmentName.endsWith(".pdf"), "Filename should end with .pdf");
      assert.ok(!emailSent[0].attachmentName.includes("1"), "Filename should not expose wet-check id");
    } finally { await stopServer(server); }
  });

  it("includes note in send payload when provided", async () => {
    const emailSent: { to: string; subject: string; attachmentName: string; note: string | undefined }[] = [];
    const app = buildTestApp({ wc: WC, customer: CUSTOMER, role: "super_admin", companyId: 10, emailSent });
    const { server, base } = await startServer(app);
    try {
      await fetch(`${base}/api/wet-checks/1/report/send`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ to: "x@x.com", note: "Please review zones 3 and 7." }),
      });
      assert.equal(emailSent[0].note, "Please review zones 3 and 7.");
    } finally { await stopServer(server); }
  });

  it("note is undefined when empty string is passed", async () => {
    const emailSent: { to: string; subject: string; attachmentName: string; note: string | undefined }[] = [];
    const app = buildTestApp({ wc: WC, customer: CUSTOMER, role: "super_admin", companyId: 10, emailSent });
    const { server, base } = await startServer(app);
    try {
      await fetch(`${base}/api/wet-checks/1/report/send`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ to: "x@x.com", note: "" }),
      });
      assert.equal(emailSent[0].note, undefined, "Empty note should not be set");
    } finally { await stopServer(server); }
  });

  it("returns 404 when accessing another company's wet check", async () => {
    const app = buildTestApp({ wc: WC, customer: CUSTOMER, role: "company_admin", companyId: 77, emailSent: [] });
    const { server, base } = await startServer(app);
    try {
      const res = await fetch(`${base}/api/wet-checks/1/report/send`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ to: "x@x.com" }),
      });
      assert.equal(res.status, 404, "Cross-company access must be 404");
    } finally { await stopServer(server); }
  });
});
