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
 * rejecting competing sends before they can reach the mail provider.
 */

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express, { type RequestHandler } from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { companies, db, estimateEmailSendClaims, estimates } from "@workspace/db";
import type { EstimateWithItems } from "@workspace/db";
import { eq } from "drizzle-orm";
import { computeLifecycleStatus, ESTIMATE_EXPIRATION_DAYS } from "@workspace/shared";

import { storage } from "./storage";
import { EmailService, EstimateEmailNotSubmittedError, type EstimateEmailData } from "./email-service";
import { createEstimateEmailHandler } from "./outgoing-email/estimate-handlers";
import { registerOutgoingEmailRoutes } from "./routes/outgoing-email-routes";
import {
  registerEstimateRoutes,
  type EstimateRoutesStorage,
} from "./routes/estimate-routes";

const SEED_PROJECT_NAME = "TASK-1955-RESEND-CAS-TEST";

const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

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
  mode?: "first" | "redelivery" | "resend";
} = {}) {
  const first = overrides.mode === "first";
  const live = overrides.mode === "redelivery";
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
      internalStatus: first ? "approved_internal" : "sent_to_customer",
      lifecycle: first ? "pending_review" : "sent",
      estimateDate: daysAgo(60),
      approvalSentAt: first ? null : daysAgo(live ? 10 : ESTIMATE_EXPIRATION_DAYS + 10),
      approvalToken:
        first ? null : overrides.approvalToken === undefined
          ? `old-token-${stamp}`
          : overrides.approvalToken,
      tokenExpiresAt: first ? null : daysAgo(live ? -20 : 10),
    })
    .returning();
  return row;
}

// A minimal mount of the real estimate routes so the customer-facing
// token endpoint and reviewed resend can be exercised over HTTP.
const noAuth: RequestHandler = (req: any, _res, next) => {
  req.authenticatedUserRole = "super_admin";
  req.authenticatedUserId = Number(req.get("x-test-user-id") ?? 1);
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
const post = (
  id: number, action: "preview" | "send", confirmationToken?: string,
  kind: "estimate" | "estimate_resend" = "estimate_resend", userId = 1,
) =>
  fetch(`${publicBaseUrl}/api/outgoing-email/${kind}/${id}/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-test-user-id": String(userId) },
    body: JSON.stringify({ ...resendFields, confirmationToken }),
  });

async function previewResend(id: number, kind: "estimate" | "estimate_resend" = "estimate_resend", userId = 1): Promise<string> {
  const res = await post(id, "preview", undefined, kind, userId);
  assert.equal(res.status, 200);
  return (await res.json() as { confirmationToken: string }).confirmationToken;
}

describe("estimate email delivery claims and resend state", () => {
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
      claimEstimateEmailSend: storage.claimEstimateEmailSend,
      releaseEstimateEmailSend: storage.releaseEstimateEmailSend,
      markEstimateSentToCustomer: (...args: Parameters<typeof storage.markEstimateSentToCustomer>) =>
        storage.markEstimateSentToCustomer(...args),
    };
    registerOutgoingEmailRoutes(app, {
      requireAuthentication: noAuth,
      handlers: (["estimate", "estimate_resend"] as const).map(kind =>
        createEstimateEmailHandler(kind, { storage: storageForTest, recordAuditEvent: async () => {} })),
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

  for (const mode of ["first", "redelivery", "resend"] as const) {
    it(`allows only one provider delivery for concurrent ${mode} requests`, { timeout: 15_000 }, async (t) => {
      const seeded = await seedLapsedSentEstimate({ mode });
      const kind = mode === "first" ? "estimate" : "estimate_resend";
      const entered = deferred();
      const release = deferred();
      let mailCalls = 0;
      const mail = t.mock.method(EmailService, "sendEstimateApprovalEmail", async (_data: EstimateEmailData) => {
        if (++mailCalls === 1) {
          entered.resolve();
          await release.promise;
        }
      });
      const reviews = await Promise.all([1, 2, 3].map(user => previewResend(seeded.id, kind, user)));
      const firstSend = post(seeded.id, "send", reviews[0], kind, 1);
      try {
        // Keep the first request inside the mailer so the competing
        // reviewer necessarily sees the same pre-send database state.
        await Promise.race([entered.promise, firstSend.then(res => assert.fail(`First send stopped at ${res.status}`))]);
        const competing = await post(seeded.id, "send", reviews[1], kind, 2);
        assert.equal(competing.status, 409);
        assert.match((await competing.json() as { message: string }).message, /already being sent/);
        assert.equal(mail.mock.callCount(), 1);
      } finally {
        release.resolve();
        assert.equal((await firstSend).status, 200);
      }

      // A slow request with the old review must not deliver after release.
      const stale = await post(seeded.id, "send", reviews[2], kind, 3);
      assert.equal(stale.status, mode === "first" ? 404 : 409);
      assert.equal(mail.mock.callCount(), 1);
      assert.equal(await storage.claimEstimateEmailSend(seeded, randomUUID(), mode), "changed",
        "a request that already loaded the old row must not claim after the winner releases");
      const [row] = await db.select().from(estimates).where(eq(estimates.id, seeded.id));
      assert.equal(row.approvalToken, mail.mock.calls[0].arguments[0].approvalToken);
      assert.equal(row.approvalToken === seeded.approvalToken, mode === "redelivery");
      assert.equal(row.estimateDate.getTime() === seeded.estimateDate.getTime(), mode !== "resend");
      assert.ok(row.approvalSentAt && row.tokenExpiresAt);
      const expectedExpiry = new Date(row.approvalSentAt);
      expectedExpiry.setDate(expectedExpiry.getDate() + ESTIMATE_EXPIRATION_DAYS);
      assert.deepEqual(row.tokenExpiresAt, expectedExpiry);
      assert.equal((await db.select().from(estimateEmailSendClaims).where(eq(estimateEmailSendClaims.estimateId, seeded.id))).length, 0);
      if (mode === "redelivery") {
        const fresh = await post(seeded.id, "send", await previewResend(seeded.id, kind, 2), kind, 2);
        assert.equal(fresh.status, 200, "a deliberate new review can re-deliver");
        assert.equal(mail.mock.callCount(), 2);
      }
    });
  }

  it("retains the tenant claim and blocks a fresh review after a provider timeout", async (t) => {
    const seeded = await seedLapsedSentEstimate({ mode: "first" });
    assert.equal(await storage.claimEstimateEmailSend({ ...seeded, companyId: 0 }, randomUUID(), "first"), "changed");
    const mail = t.mock.method(EmailService, "sendEstimateApprovalEmail", async (_data: EstimateEmailData) => {
      throw new Error("connection closed before receiving a response");
    });
    const kind = "estimate";
    const sent = await post(seeded.id, "send", await previewResend(seeded.id, kind), kind);
    assert.equal(sent.status, 502);
    assert.match((await sent.json() as { message: string }).message, /may have accepted/);
    const [claim] = await db.select().from(estimateEmailSendClaims).where(eq(estimateEmailSendClaims.estimateId, seeded.id));
    assert.equal(claim.companyId, seeded.companyId);
    assert.equal(claim.attemptId, mail.mock.calls[0].arguments[0].deliveryAttemptId);
    await storage.releaseEstimateEmailSend(seeded.id, 0, claim.attemptId);
    const retried = await post(seeded.id, "send", await previewResend(seeded.id, kind, 2), kind, 2);
    assert.equal(retried.status, 409);
    assert.match((await retried.json() as { message: string }).message, /Verify delivery/);
    assert.equal(mail.mock.callCount(), 1);
    const [row] = await db.select().from(estimates).where(eq(estimates.id, seeded.id));
    assert.equal(row.approvalSentAt, null);
    assert.equal(row.approvalToken, null);
    assert.equal(await storage.markEstimateSentToCustomer(seeded.id, {
      companyId: seeded.companyId, approvalToken: "manual-token", tokenExpiresAt: daysAgo(-30),
      approvalSentAt: new Date(), newEstimateDate: null, isResend: false,
    }), undefined, "manual mark-sent must not invalidate an unconfirmed email link");
  });

  it("releases the claim after a definite rejection so a fresh review can retry", async (t) => {
    const seeded = await seedLapsedSentEstimate();
    let attempts = 0;
    const mail = t.mock.method(EmailService, "sendEstimateApprovalEmail", async (_data: EstimateEmailData) => {
      if (++attempts === 1) throw new EstimateEmailNotSubmittedError("SendGrid rejected the estimate email");
    });
    const failed = await post(seeded.id, "send", await previewResend(seeded.id));
    assert.equal(failed.status, 500);
    assert.equal(mail.mock.callCount(), 1);
    const retried = await post(seeded.id, "send", await previewResend(seeded.id));
    assert.equal(retried.status, 200);
    assert.equal(mail.mock.callCount(), 2);
  });

  it("does not send again when acceptance succeeds but stamping the estimate fails", async (t) => {
    const seeded = await seedLapsedSentEstimate();
    const mail = t.mock.method(EmailService, "sendEstimateApprovalEmail", async (_data: EstimateEmailData) => {});
    const stamp = t.mock.method(storage, "markEstimateSentToCustomer", async () => {
      throw new Error("database write failed");
    });
    const sent = await post(seeded.id, "send", await previewResend(seeded.id));
    assert.equal(sent.status, 500);
    assert.match((await sent.json() as { message: string }).message, /provider accepted/);
    stamp.mock.restore();
    const retried = await post(seeded.id, "send", await previewResend(seeded.id, "estimate_resend", 2), "estimate_resend", 2);
    assert.equal(retried.status, 409);
    assert.equal(mail.mock.callCount(), 1);
  });
});
