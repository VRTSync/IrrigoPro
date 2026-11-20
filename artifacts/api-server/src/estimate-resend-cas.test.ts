/**
 * estimate-resend-cas.test.ts
 *
 * Task #1955 — expiry is a read-time view, so an expired estimate is
 * *persisted* as an ordinary sent row (internalStatus='sent_to_customer',
 * lifecycle='sent', status='pending') whose 30-day window has simply
 * lapsed. `status` only becomes 'expired' in the database if a customer
 * happens to click the dead approval link first.
 *
 * The resend path's conditional UPDATE therefore cannot gate on
 * status='expired': in the normal case it would match zero rows *after*
 * the email had already gone out, leaving the customer holding a token
 * that was never persisted and the manager looking at a 409.
 *
 * These tests hit the real database (like the other estimate storage
 * integration tests) and assert that a resend of a derived-expired row
 * persists the new token and send time — restarting the window — while
 * still rejecting a concurrent second writer.
 */

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import express, { type RequestHandler } from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { companies, db, estimates } from "@workspace/db";
import type { EstimateWithItems } from "@workspace/db";
import { eq } from "drizzle-orm";
import { computeLifecycleStatus, ESTIMATE_EXPIRATION_DAYS } from "@workspace/shared";

import { storage } from "./storage";
import { EmailService, type EstimateEmailData } from "./email-service";
import { createEstimateEmailHandler } from "./outgoing-email/estimate-handlers";
import { registerOutgoingEmailRoutes } from "./routes/outgoing-email-routes";
import {
  registerEstimateRoutes,
  type EstimateRoutesStorage,
} from "./routes/estimate-routes";

const SEED_PROJECT_NAME = "TASK-1955-RESEND-CAS-TEST";

const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

async function cleanupSeed(): Promise<void> {
  await db.delete(estimates).where(eq(estimates.projectName, SEED_PROJECT_NAME));
}

// `estimates.company_id` is a FK, so borrow whatever company the
// environment happens to have rather than assuming an id.
let seedCompanyId: number | null = null;
async function resolveCompanyId(): Promise<number> {
  if (seedCompanyId !== null) return seedCompanyId;
  const [row] = await db.select({ id: companies.id }).from(companies).limit(1);
  if (!row) throw new Error("no company row available to attach the fixture to");
  seedCompanyId = row.id;
  return seedCompanyId;
}

/**
 * Seed a row exactly the way a sent-then-lapsed estimate looks on disk:
 * sent to the customer, lifecycle='sent', status untouched at 'pending',
 * and a send timestamp older than the expiry window.
 */
async function seedLapsedSentEstimate(overrides: {
  status?: string;
  approvalToken?: string | null;
} = {}) {
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  const [row] = await db
    .insert(estimates)
    .values({
      estimateNumber: `EST-TEST-1955-${stamp}`,
      companyId: await resolveCompanyId(),
      customerName: "Test Customer 1955",
      customerEmail: "test1955@example.com",
      projectName: SEED_PROJECT_NAME,
      laborRate: "75.00",
      laborMode: "flat",
      totalLaborHours: "0.00",
      partsSubtotal: "0.00",
      laborSubtotal: "0.00",
      totalAmount: "0.00",
      status: overrides.status ?? "pending",
      internalStatus: "sent_to_customer",
      lifecycle: "sent",
      estimateDate: daysAgo(60),
      approvalSentAt: daysAgo(ESTIMATE_EXPIRATION_DAYS + 10),
      approvalToken:
        overrides.approvalToken === undefined
          ? `old-token-${stamp}`
          : overrides.approvalToken,
      tokenExpiresAt: daysAgo(10),
    })
    .returning();
  return row;
}

// A minimal mount of the real estimate routes so the customer-facing
// token endpoint and reviewed resend can be exercised over HTTP.
const noAuth: RequestHandler = (req: any, _res, next) => {
  req.authenticatedUserRole = "super_admin";
  req.authenticatedUserId = 1;
  req.authenticatedUserCompanyId = null;
  next();
};

function makeReadOnlyStorage(): EstimateRoutesStorage {
  return {
    async getCustomer() {
      return undefined;
    },
    async getEstimate(id: number) {
      const [row] = await db
        .select()
        .from(estimates)
        .where(eq(estimates.id, id))
        .limit(1);
      return row && { ...row, items: [], lifecycleStatus: computeLifecycleStatus(row) };
    },
    async getEstimates() {
      return (await db.select().from(estimates)) as unknown as EstimateWithItems[];
    },
    async createEstimateFromPayload() {
      throw new Error("not used in this test");
    },
    async updateEstimateWithItems() {
      throw new Error("not used in this test");
    },
  } as unknown as EstimateRoutesStorage;
}

let publicServer: Server;
let publicBaseUrl: string;

const resendFields = { to: "override@example.invalid", options: { attachPdf: false } };
const post = (id: number, action: "preview" | "send", confirmationToken?: string) =>
  fetch(`${publicBaseUrl}/api/outgoing-email/estimate_resend/${id}/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...resendFields, confirmationToken }),
  });

async function previewResend(id: number): Promise<string> {
  const res = await post(id, "preview");
  assert.equal(res.status, 200);
  return (await res.json() as { confirmationToken: string }).confirmationToken;
}

describe("resend of a derived-expired estimate (Task #1955)", () => {
  before(async () => {
    await cleanupSeed();
    const app = express();
    app.use(express.json());
    const reads = makeReadOnlyStorage();
    registerEstimateRoutes(app, reads, noAuth);
    const storageForTest = {
      getEstimate: reads.getEstimate,
      getCustomer: reads.getCustomer,
      getCompany: async () => undefined,
      getCompanyProfile: async () => undefined,
      markEstimateSentToCustomer: storage.markEstimateSentToCustomer.bind(storage),
    };
    registerOutgoingEmailRoutes(app, {
      requireAuthentication: noAuth,
      handlers: [createEstimateEmailHandler("estimate_resend", { storage: storageForTest, recordAuditEvent: async () => {} })],
    });
    publicServer = createServer(app);
    await new Promise<void>((resolve) => publicServer.listen(0, resolve));
    publicBaseUrl = `http://127.0.0.1:${(publicServer.address() as AddressInfo).port}`;
  });

  after(async () => {
    await new Promise<void>((resolve, reject) =>
      publicServer.close((err) => (err ? reject(err) : resolve())),
    );
    await cleanupSeed();
  });

  it("reads as expired while the persisted status stays 'pending'", async () => {
    const seeded = await seedLapsedSentEstimate();
    assert.equal(seeded.status, "pending");
    assert.equal(computeLifecycleStatus(seeded), "expired");
  });

  it("persists the new token and send time, restarting the window", async (t) => {
    const seeded = await seedLapsedSentEstimate();
    const mail = t.mock.method(EmailService, "sendEstimateApprovalEmail", async (_data: EstimateEmailData) => {});
    const sentAt = new Date();
    const sent = await post(seeded.id, "send", await previewResend(seeded.id));
    assert.equal(sent.status, 200, "resend must persist even though status is still pending");
    assert.equal(mail.mock.callCount(), 1);
    const outgoing = mail.mock.calls[0].arguments[0];

    const [row] = await db
      .select()
      .from(estimates)
      .where(eq(estimates.id, seeded.id));
    assert.equal(row.approvalToken, outgoing.approvalToken);
    assert.notEqual(row.approvalToken, seeded.approvalToken);
    assert.equal(row.sentToEmail, resendFields.to);
    assert.equal(row.approvalSentAt?.toISOString(), (await sent.json() as { sentAt: string }).sentAt);
    assert.ok(
      row.approvalSentAt && row.approvalSentAt.getTime() >= sentAt.getTime() - 1000,
      "send time must be re-stamped",
    );
    assert.equal(row.internalStatus, "sent_to_customer");
    assert.equal(row.lifecycle, "sent");
    // The customer's link and the estimate now agree on a live window.
    assert.equal(computeLifecycleStatus(row), "sent");
    assert.ok(
      row.tokenExpiresAt && row.tokenExpiresAt.getTime() > Date.now(),
      "the approval link must be usable",
    );
  });

  it("gives the customer a usable link again after they hit the dead one", async (t) => {
    // Customer clicked the expired link, persisting legacy status='expired'.
    const seeded = await seedLapsedSentEstimate({ status: "expired" });
    const mail = t.mock.method(EmailService, "sendEstimateApprovalEmail", async (_data: EstimateEmailData) => {});
    const sent = await post(seeded.id, "send", await previewResend(seeded.id));
    assert.equal(sent.status, 200, "the legacy status='expired' shape must keep working");
    const newToken = mail.mock.calls[0].arguments[0].approvalToken;

    const [row] = await db
      .select()
      .from(estimates)
      .where(eq(estimates.id, seeded.id));
    assert.equal(row.approvalToken, newToken);
    assert.equal(computeLifecycleStatus(row), "sent");
    assert.equal(
      row.status,
      "pending",
      "customer-facing status must be renewed, or the new token is refused",
    );

    // Prove it end-to-end through the public token endpoint the emailed
    // link lands on.
    const res = await fetch(
      `${publicBaseUrl}/api/estimates/view-by-token/${newToken}`,
    );
    assert.equal(res.status, 200, `view-by-token returned ${res.status}`);
    const body = (await res.json()) as { alreadyResponded: boolean; status: string };
    assert.equal(
      body.alreadyResponded,
      false,
      "the resent link must open the approval page, not 'already responded'",
    );
    assert.equal(body.status, "pending");
  });

  it("rejects a second concurrent resend instead of stamping twice", { timeout: 15_000 }, async (t) => {
    const seeded = await seedLapsedSentEstimate();
    let release!: () => void;
    const ready = new Promise<void>(resolve => { release = resolve; });
    const tokens: string[] = [];
    t.mock.method(EmailService, "sendEstimateApprovalEmail", async (data: EstimateEmailData) => {
      tokens.push(data.approvalToken);
      if (tokens.length === 2) release();
      // Both deliveries must reach the mailer before either can attempt
      // the real DB CAS, or the second request just sees the new lifecycle.
      await ready;
    });
    const reviews = await Promise.all([previewResend(seeded.id), previewResend(seeded.id)]);
    const safety = setTimeout(release, 6000);
    const results = await Promise.all(reviews.map(token => post(seeded.id, "send", token))).finally(() => clearTimeout(safety));
    assert.deepEqual(results.map(res => res.status).sort(), [200, 409]);
    const conflict = await results.find(res => res.status === 409)!.json() as { message: string };
    assert.equal(conflict.message, "Estimate is no longer in an expired state and cannot be resent");

    const [row] = await db.select().from(estimates).where(eq(estimates.id, seeded.id));
    assert.ok(tokens.includes(row.approvalToken!));
    assert.notEqual(tokens[0], tokens[1]);
  });
});
