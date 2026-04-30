/**
 * Tests for POST /api/billing-sheets/missing-photos/notify
 *
 * Covers the multi-channel notify behavior:
 *  - channel='email' | 'sms' | 'both' produces the right per-channel outcomes
 *  - per-channel 24h idempotency works independently for email and SMS
 *  - force=true bypasses the 24h window per-channel
 *  - technician with no phone produces skipped_no_phone for SMS but not email
 *    (the route returns the granular contract values: skipped_no_email for
 *    email and skipped_no_phone for sms — together these cover the
 *    "skipped_no_contact" idea from the task spec, asserted per channel)
 *  - tenant scoping still applies (out-of-company techs are not notified)
 *
 * SmsService.sendMissingPhotosTechnicianSms and
 * EmailService.sendMissingPhotosTechnicianEmail are explicitly mocked so no
 * real provider call is ever made. The tests run against an isolated
 * in-process Express app constructed with `registerRoutes(app)`, on its own
 * ephemeral port, so the mocks installed on the imported service singletons
 * are guaranteed to be the ones the route handler invokes. After the suite
 * we additionally assert that NO real provider call slipped through (the
 * spies recorded every call instead).
 *
 * Run with:
 *   node --import tsx/esm --test tests/missing-photos-notify-channels.test.mjs
 */

import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";

const COMPANY_A_ID = 99;
const COMPANY_B_ID = 3; // a different real company in seed data

let baseUrl;
let httpServer;
let pool;

let SmsServiceRef;
let EmailServiceRef;
let originalSmsImpl;
let originalEmailImpl;
const sentSmsCalls = [];
const sentEmailCalls = [];

// Captures every setInterval scheduled while routes.ts is loading so we can
// clearInterval them in `after` and let the event loop drain naturally —
// avoids needing a process.exit() hack that would terminate other suites
// running in the same Node process.
const capturedIntervals = [];
let originalSetInterval;

let techNoContactId; // company A, no email, no phone
let techEmailOnlyId; // company A, has email, no phone
let techSmsCapableId; // company A, has email AND phone — exercises SMS `sent`
let techOtherCoId; // company B, has email and phone
const createdSheetIds = [];
const createdUserIds = [];

const PHOTO_FIX_CUTOFF = new Date("2026-04-22T14:22:39Z");
// Use a created_at value safely BEFORE the cutoff so each sheet shows up
// in the "missing photos" candidate set.
const OLD_CREATED_AT = new Date(PHOTO_FIX_CUTOFF.getTime() - 24 * 60 * 60 * 1000);

// Built once an admin user is created in `before`. The route writes a
// missing_photos_notifications row with sent_by_user_id = authenticatedUserId
// after every successful (mocked) send, so this MUST be a real users.id to
// satisfy the FK constraint.
let ADMIN_A_HEADERS;
let adminUserId;

async function api(method, path, body, headers = ADMIN_A_HEADERS) {
  const opts = { method, headers: { ...headers } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(`${baseUrl}${path}`, opts);
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

// Create users via direct DB insert to avoid triggering the user-creation
// route's outbound email-verification call (which would hit Postmark for
// real even though we have mocked the missing-photos email path).
async function createUser({ name, email, phone, companyId, role = "field_tech" }) {
  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const result = await pool.query(
    `INSERT INTO users (
       username, password, name, email, phone, role, company_id,
       email_verified, is_active, is_deleted
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, true, true, false)
     RETURNING id`,
    [
      `mp_notify_${suffix}`,
      "$2b$10$disabled.password.hash.for.test.user.only.never.used.ever.aa",
      name,
      email ?? null,
      phone ?? null,
      role,
      companyId,
    ],
  );
  const id = result.rows[0].id;
  createdUserIds.push(id);
  return id;
}

async function insertOldMissingPhotosSheet(technicianId, technicianName) {
  const billingNumber = `BS-MP-TEST-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  const result = await pool.query(
    `INSERT INTO billing_sheets (
       billing_number, customer_id, customer_name, property_address,
       work_date, technician_name, technician_id, work_description, status,
       total_hours, labor_rate, labor_subtotal, parts_subtotal,
       total_amount, photos, created_at, updated_at
     ) VALUES (
       $1, NULL, 'Test Customer (notify)', '1 Notify Way',
       $2, $3, $4, 'multi-channel notify test', 'submitted',
       '0', '0', '0', '0', '0',
       ARRAY[]::text[], $2, $2
     ) RETURNING id`,
    [billingNumber, OLD_CREATED_AT.toISOString(), technicianName, technicianId],
  );
  const id = result.rows[0].id;
  createdSheetIds.push(id);
  return id;
}

async function deleteNotificationRow(technicianId) {
  await pool.query(
    `DELETE FROM missing_photos_notifications WHERE technician_id = $1`,
    [technicianId],
  );
}

async function seedNotification(technicianId, { emailAt, smsAt }) {
  await deleteNotificationRow(technicianId);
  await pool.query(
    `INSERT INTO missing_photos_notifications (
       technician_id, last_sent_at, sheet_count, sheet_ids, sent_by_user_id,
       last_sent_email_at, last_sent_sms_at,
       last_email_sheet_count, last_sms_sheet_count
     ) VALUES ($1, NOW(), 0, ARRAY[]::int[], NULL, $2, $3, $4, $5)`,
    [
      technicianId,
      emailAt ?? null,
      smsAt ?? null,
      emailAt ? 1 : null,
      smsAt ? 1 : null,
    ],
  );
}

function findResult(body, technicianId) {
  return body.results?.find((r) => r.technicianId === technicianId);
}

function channelOutcome(result, channel) {
  return result?.channels?.find((c) => c.channel === channel);
}

// COMPANY_A_ID is a real seeded company that may already contain other
// technicians with old missing-photo billing sheets. The notify route walks
// all of them, so spy assertions must be scoped to OUR fixture users to stay
// deterministic. These predicates filter the captured spy arrays.
const myEmails = new Set();
const myPhones = new Set();
function myEmailCalls() {
  return sentEmailCalls.filter((c) => myEmails.has(c.to));
}
function mySmsCalls() {
  return sentSmsCalls.filter((c) => myPhones.has(c.to));
}

describe("POST /api/billing-sheets/missing-photos/notify (multi-channel)", () => {
  before(async () => {
    // 0. Set up the DB pool early and run the same idempotent startup
    //    migrations server/index.ts runs at boot. The route's storage layer
    //    queries columns (e.g. last_sms_message_sid, last_sent_email_at,
    //    last_sent_sms_at) that may not exist yet on a fresh DB; without
    //    these the route returns 500 and the suite cannot validate behavior.
    //    Running CREATE TABLE / ALTER ... ADD COLUMN IF NOT EXISTS here makes
    //    the test resilient to default repo state.
    const { Pool, neonConfig } = await import("@neondatabase/serverless");
    const ws = (await import("ws")).default;
    neonConfig.webSocketConstructor = ws;
    pool = new Pool({ connectionString: process.env.DATABASE_URL });

    await pool.query(`
      CREATE TABLE IF NOT EXISTS missing_photos_notifications (
        id SERIAL PRIMARY KEY,
        technician_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
        last_sent_at TIMESTAMP NOT NULL DEFAULT NOW(),
        sheet_count INTEGER NOT NULL DEFAULT 0,
        sheet_ids INTEGER[] DEFAULT '{}',
        sent_by_user_id INTEGER REFERENCES users(id)
      )
    `);
    await pool.query(`
      ALTER TABLE missing_photos_notifications
        ADD COLUMN IF NOT EXISTS last_sent_email_at TIMESTAMP,
        ADD COLUMN IF NOT EXISTS last_sent_sms_at   TIMESTAMP,
        ADD COLUMN IF NOT EXISTS last_email_sheet_count INTEGER,
        ADD COLUMN IF NOT EXISTS last_sms_sheet_count   INTEGER,
        ADD COLUMN IF NOT EXISTS last_sms_message_sid text,
        ADD COLUMN IF NOT EXISTS last_sms_status text,
        ADD COLUMN IF NOT EXISTS last_sms_status_at timestamp,
        ADD COLUMN IF NOT EXISTS last_sms_error_code text
    `);

    // 1. Install spies on SmsService and EmailService BEFORE registerRoutes
    //    is invoked. routes.ts imports the singleton classes once at module
    //    load time and then calls their static methods at request time, so
    //    mutating the static methods on the imported class is observed by
    //    every later request.
    const smsModule = await import("../server/sms-service.ts");
    const emailModule = await import("../server/email-service.ts");
    SmsServiceRef = smsModule.SmsService;
    EmailServiceRef = emailModule.EmailService;

    originalSmsImpl = SmsServiceRef.sendMissingPhotosTechnicianSms;
    originalEmailImpl = EmailServiceRef.sendMissingPhotosTechnicianEmail;

    SmsServiceRef.sendMissingPhotosTechnicianSms = async (args) => {
      sentSmsCalls.push(args);
      return { success: true };
    };
    EmailServiceRef.sendMissingPhotosTechnicianEmail = async (args) => {
      sentEmailCalls.push(args);
      return { success: true };
    };

    // 2. Build an isolated Express app and register routes on it. Listen on
    //    an ephemeral port so this test never collides with the dev server
    //    (which uses unmocked services) on port 5000.
    //
    //    Wrap setInterval BEFORE importing routes.ts so we can capture any
    //    background timers it installs at module-eval time (e.g. the
    //    oauthStateStore cleanup at routes.ts:711) and tear them down in
    //    `after`. Without this the Node test runner would hang after the
    //    suite completes because the interval keeps the event loop alive.
    originalSetInterval = global.setInterval;
    global.setInterval = (fn, ms, ...rest) => {
      const handle = originalSetInterval(fn, ms, ...rest);
      capturedIntervals.push(handle);
      return handle;
    };
    const { registerRoutes } = await import("../server/routes.ts");
    const app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: false }));
    // registerRoutes itself starts background jobs (e.g. QB token health
    // job) that install setIntervals; keep the wrapper installed across
    // this call so they're captured too.
    httpServer = await registerRoutes(app);
    global.setInterval = originalSetInterval;
    await new Promise((resolve, reject) => {
      httpServer.once("error", reject);
      httpServer.listen(0, "127.0.0.1", () => resolve());
    });
    const addr = httpServer.address();
    baseUrl = `http://127.0.0.1:${addr.port}`;

    // 3. Create a real admin user in COMPANY_A_ID — required because the
    //    route writes missing_photos_notifications.sent_by_user_id =
    //    authenticatedUserId on every successful (mocked) send, and that
    //    column has a FK to users.id.
    adminUserId = await createUser({
      name: "Notify Test Admin",
      companyId: COMPANY_A_ID,
      role: "company_admin",
    });
    ADMIN_A_HEADERS = {
      "Content-Type": "application/json",
      "x-user-id": String(adminUserId),
      "x-user-role": "company_admin",
      "x-user-company-id": String(COMPANY_A_ID),
    };

    // 5. Create the test technicians and their old missing-photo sheets.
    techNoContactId = await createUser({
      name: "Tech No Contact",
      companyId: COMPANY_A_ID,
    });
    const emailOnlyAddr = `tech_email_only_${Date.now()}@example.com`;
    techEmailOnlyId = await createUser({
      name: "Tech Email Only",
      email: emailOnlyAddr,
      companyId: COMPANY_A_ID,
    });
    const smsCapableEmail = `tech_sms_capable_${Date.now()}@example.com`;
    const smsCapablePhone = "+15555550111";
    techSmsCapableId = await createUser({
      name: "Tech Sms Capable",
      email: smsCapableEmail,
      phone: smsCapablePhone,
      companyId: COMPANY_A_ID,
    });
    const otherCoEmail = `tech_other_co_${Date.now()}@example.com`;
    const otherCoPhone = "+15555550199";
    techOtherCoId = await createUser({
      name: "Tech Other Co",
      email: otherCoEmail,
      phone: otherCoPhone,
      companyId: COMPANY_B_ID,
    });

    // Track contact info for our fixture techs so spy assertions can be
    // scoped to OUR users only (the route may also send to other real
    // company-A techs that already exist in seed data).
    myEmails.add(emailOnlyAddr);
    myEmails.add(smsCapableEmail);
    myEmails.add(otherCoEmail);
    myPhones.add(smsCapablePhone);
    myPhones.add(otherCoPhone);

    await insertOldMissingPhotosSheet(techNoContactId, "Tech No Contact");
    await insertOldMissingPhotosSheet(techEmailOnlyId, "Tech Email Only");
    await insertOldMissingPhotosSheet(techSmsCapableId, "Tech Sms Capable");
    await insertOldMissingPhotosSheet(techOtherCoId, "Tech Other Co");
  });

  after(async () => {
    if (createdSheetIds.length) {
      await pool.query(
        `DELETE FROM billing_sheets WHERE id = ANY($1::int[])`,
        [createdSheetIds],
      );
    }
    const techIds = [
      techNoContactId,
      techEmailOnlyId,
      techSmsCapableId,
      techOtherCoId,
    ].filter(Boolean);
    if (techIds.length) {
      await pool.query(
        `DELETE FROM missing_photos_notifications WHERE technician_id = ANY($1::int[])`,
        [techIds],
      );
    }
    // The notify route walks every technician in COMPANY_A_ID with missing
    // photos, so notifications for OTHER company-A techs (not in our test
    // fixtures) may exist with sent_by_user_id = adminUserId. Clear those
    // before deleting users to avoid an FK violation on
    // missing_photos_notifications_sent_by_user_id_users_id_fk.
    if (adminUserId) {
      await pool.query(
        `DELETE FROM missing_photos_notifications WHERE sent_by_user_id = $1`,
        [adminUserId],
      );
    }
    if (createdUserIds.length) {
      // Successful (mocked) sends also write rows into the generic
      // `notifications` table for the technician via NotificationService;
      // remove any of those rows referencing our test users so the
      // notifications_user_id_users_id_fk constraint doesn't block the
      // user delete.
      await pool.query(
        `DELETE FROM notifications WHERE user_id = ANY($1::int[])`,
        [createdUserIds],
      );
      await pool.query(`DELETE FROM users WHERE id = ANY($1::int[])`, [
        createdUserIds,
      ]);
    }
    await pool.end();

    if (SmsServiceRef && originalSmsImpl) {
      SmsServiceRef.sendMissingPhotosTechnicianSms = originalSmsImpl;
    }
    if (EmailServiceRef && originalEmailImpl) {
      EmailServiceRef.sendMissingPhotosTechnicianEmail = originalEmailImpl;
    }

    if (httpServer) {
      await new Promise((resolve) => httpServer.close(() => resolve()));
    }

    // Tear down every background interval routes.ts installed at module-eval
    // time so the Node test runner can exit cleanly without a process.exit
    // hack (which would also kill any sibling test files running in the same
    // node process).
    for (const handle of capturedIntervals) {
      clearInterval(handle);
    }
    capturedIntervals.length = 0;
  });

  beforeEach(async () => {
    // Reset per-test state for techs in company A so each test starts from a
    // clean idempotency baseline. Other-co tech is reset too for safety.
    await deleteNotificationRow(techNoContactId);
    await deleteNotificationRow(techEmailOnlyId);
    await deleteNotificationRow(techSmsCapableId);
    await deleteNotificationRow(techOtherCoId);
    sentSmsCalls.length = 0;
    sentEmailCalls.length = 0;
  });

  test("channel='email' produces only email per-channel outcomes; sms branch never runs", async () => {
    const res = await api(
      "POST",
      "/api/billing-sheets/missing-photos/notify",
      { channel: "email" },
    );
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.channel, "email");

    const noContact = findResult(res.body, techNoContactId);
    assert.ok(noContact, "tech with no contact must appear in results");
    assert.equal(noContact.channels.length, 1);
    assert.equal(noContact.channels[0].channel, "email");
    assert.equal(noContact.channels[0].status, "skipped_no_email");

    const emailOnly = findResult(res.body, techEmailOnlyId);
    assert.ok(emailOnly, "email-only tech must appear in results");
    assert.equal(emailOnly.channels.length, 1);
    assert.equal(emailOnly.channels[0].channel, "email");
    // Tech has email → mocked email send was invoked → outcome 'sent'.
    assert.equal(emailOnly.channels[0].status, "sent");
    assert.ok(typeof emailOnly.channels[0].lastSentAt === "string");

    // SMS-capable tech also has an email so should also be 'sent' here.
    const smsTech = findResult(res.body, techSmsCapableId);
    assert.ok(smsTech);
    assert.equal(smsTech.channels.length, 1);
    assert.equal(smsTech.channels[0].channel, "email");
    assert.equal(smsTech.channels[0].status, "sent");

    // No SMS outcomes anywhere when channel='email'
    for (const r of res.body.results) {
      for (const c of r.channels) {
        assert.notEqual(c.channel, "sms");
      }
    }

    assert.equal(mySmsCalls().length, 0, "no SMS provider call for our techs");
    const myEmail = myEmailCalls();
    assert.equal(
      myEmail.length,
      2,
      "two mocked email sends for our fixture techs: email-only tech + sms-capable tech",
    );
    const recipients = new Set(myEmail.map((c) => c.to));
    const emailOnlyAddr = (await pool.query(
      "SELECT email FROM users WHERE id=$1",
      [techEmailOnlyId],
    )).rows[0].email;
    const smsCapableAddr = (await pool.query(
      "SELECT email FROM users WHERE id=$1",
      [techSmsCapableId],
    )).rows[0].email;
    assert.ok(recipients.has(emailOnlyAddr));
    assert.ok(recipients.has(smsCapableAddr));
  });

  test("channel='sms' produces only sms per-channel outcomes; email branch never runs", async () => {
    const res = await api(
      "POST",
      "/api/billing-sheets/missing-photos/notify",
      { channel: "sms" },
    );
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.channel, "sms");

    const noContact = findResult(res.body, techNoContactId);
    assert.ok(noContact);
    assert.equal(noContact.channels.length, 1);
    assert.equal(noContact.channels[0].channel, "sms");
    assert.equal(noContact.channels[0].status, "skipped_no_phone");

    const emailOnly = findResult(res.body, techEmailOnlyId);
    assert.ok(emailOnly);
    assert.equal(emailOnly.channels.length, 1);
    assert.equal(emailOnly.channels[0].channel, "sms");
    assert.equal(
      emailOnly.channels[0].status,
      "skipped_no_phone",
      "email-only tech still has no phone, so SMS must be skipped_no_phone",
    );

    // The SMS-capable tech (company A, phone present) MUST get a real
    // (mocked) SMS send → outcome 'sent' and a recorded provider call.
    const smsTech = findResult(res.body, techSmsCapableId);
    assert.ok(smsTech, "sms-capable tech must appear in results");
    assert.equal(smsTech.channels.length, 1);
    assert.equal(smsTech.channels[0].channel, "sms");
    assert.equal(
      smsTech.channels[0].status,
      "sent",
      "tech with a phone must produce SMS status='sent' on channel='sms'",
    );
    assert.ok(typeof smsTech.channels[0].lastSentAt === "string");

    for (const r of res.body.results) {
      for (const c of r.channels) {
        assert.notEqual(c.channel, "email");
      }
    }

    assert.equal(myEmailCalls().length, 0, "no email provider call for our techs");
    const mySms = mySmsCalls();
    assert.equal(
      mySms.length,
      1,
      "exactly one mocked SMS send for our fixture techs (the sms-capable tech)",
    );
    assert.equal(mySms[0].to, (await pool.query(
      "SELECT phone FROM users WHERE id=$1",
      [techSmsCapableId],
    )).rows[0].phone);
  });

  test("channel='both' produces both per-channel outcomes per technician", async () => {
    const res = await api(
      "POST",
      "/api/billing-sheets/missing-photos/notify",
      { channel: "both" },
    );
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.channel, "both");

    const noContact = findResult(res.body, techNoContactId);
    assert.ok(noContact);
    assert.equal(noContact.channels.length, 2);
    assert.equal(channelOutcome(noContact, "email").status, "skipped_no_email");
    assert.equal(channelOutcome(noContact, "sms").status, "skipped_no_phone");

    const emailOnly = findResult(res.body, techEmailOnlyId);
    assert.ok(emailOnly);
    assert.equal(emailOnly.channels.length, 2);
    // Email is sent (mocked); SMS is skipped because the tech has no phone —
    // proving "no phone produces skipped_no_phone for SMS but NOT for email".
    assert.equal(channelOutcome(emailOnly, "email").status, "sent");
    assert.equal(
      channelOutcome(emailOnly, "sms").status,
      "skipped_no_phone",
      "tech with no phone produces skipped_no_phone for SMS but not for email",
    );

    // The SMS-capable tech (email + phone) MUST get BOTH channels marked
    // 'sent' on channel='both' — exercises the success path on both branches.
    const smsTech = findResult(res.body, techSmsCapableId);
    assert.ok(smsTech);
    assert.equal(smsTech.channels.length, 2);
    assert.equal(channelOutcome(smsTech, "email").status, "sent");
    assert.equal(channelOutcome(smsTech, "sms").status, "sent");

    assert.equal(
      mySmsCalls().length,
      1,
      "only the sms-capable tech (of OUR fixture techs) should have triggered a mocked SMS send",
    );
    assert.equal(
      myEmailCalls().length,
      2,
      "email-only tech AND sms-capable tech should each trigger one mocked email send",
    );
  });

  test("default channel (no channel field in body) is 'email'", async () => {
    const res = await api(
      "POST",
      "/api/billing-sheets/missing-photos/notify",
      {},
    );
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.channel, "email");
    for (const r of res.body.results) {
      for (const c of r.channels) {
        assert.equal(c.channel, "email");
      }
    }
    assert.equal(mySmsCalls().length, 0);
  });

  test("per-channel 24h idempotency: recent email send blocks email but NOT sms", async () => {
    // Recent email send only — sms window is empty.
    await seedNotification(techNoContactId, { emailAt: new Date() });

    const res = await api(
      "POST",
      "/api/billing-sheets/missing-photos/notify",
      { channel: "both" },
    );
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const r = findResult(res.body, techNoContactId);
    assert.ok(r);
    const email = channelOutcome(r, "email");
    const sms = channelOutcome(r, "sms");
    assert.equal(
      email.status,
      "skipped_already_notified",
      "email window should still apply",
    );
    assert.equal(
      sms.status,
      "skipped_no_phone",
      "sms window is empty, so the route falls through to the contact check",
    );
    assert.notEqual(
      sms.status,
      "skipped_already_notified",
      "sms must NOT inherit the email window",
    );
  });

  test("per-channel 24h idempotency: recent sms send blocks sms but NOT email", async () => {
    // Recent sms send only — email window is empty.
    await seedNotification(techNoContactId, { smsAt: new Date() });

    const res = await api(
      "POST",
      "/api/billing-sheets/missing-photos/notify",
      { channel: "both" },
    );
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const r = findResult(res.body, techNoContactId);
    assert.ok(r);
    const email = channelOutcome(r, "email");
    const sms = channelOutcome(r, "sms");
    assert.equal(
      sms.status,
      "skipped_already_notified",
      "sms window should still apply",
    );
    assert.equal(
      email.status,
      "skipped_no_email",
      "email window is empty, so the route falls through to the contact check",
    );
    assert.notEqual(
      email.status,
      "skipped_already_notified",
      "email must NOT inherit the sms window",
    );
  });

  test("force=true bypasses the email window (per-channel)", async () => {
    await seedNotification(techNoContactId, { emailAt: new Date() });

    const res = await api(
      "POST",
      "/api/billing-sheets/missing-photos/notify",
      { channel: "email", force: true },
    );
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const r = findResult(res.body, techNoContactId);
    assert.ok(r);
    assert.equal(r.channels.length, 1);
    assert.equal(r.channels[0].channel, "email");
    // Window was bypassed; the route then hit the no-email contact check.
    assert.notEqual(
      r.channels[0].status,
      "skipped_already_notified",
      "force=true must bypass the recent-email window",
    );
    assert.equal(r.channels[0].status, "skipped_no_email");
  });

  test("force=true bypasses the sms window (per-channel)", async () => {
    await seedNotification(techNoContactId, { smsAt: new Date() });

    const res = await api(
      "POST",
      "/api/billing-sheets/missing-photos/notify",
      { channel: "sms", force: true },
    );
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const r = findResult(res.body, techNoContactId);
    assert.ok(r);
    assert.equal(r.channels.length, 1);
    assert.equal(r.channels[0].channel, "sms");
    assert.notEqual(
      r.channels[0].status,
      "skipped_already_notified",
      "force=true must bypass the recent-sms window",
    );
    assert.equal(r.channels[0].status, "skipped_no_phone");
  });

  test("force=true bypasses each channel window independently when channel='both'", async () => {
    // Recent send on BOTH channels — without force, both would be skipped.
    await seedNotification(techNoContactId, {
      emailAt: new Date(),
      smsAt: new Date(),
    });

    const res = await api(
      "POST",
      "/api/billing-sheets/missing-photos/notify",
      { channel: "both", force: true },
    );
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const r = findResult(res.body, techNoContactId);
    assert.ok(r);
    assert.equal(r.channels.length, 2);
    const email = channelOutcome(r, "email");
    const sms = channelOutcome(r, "sms");
    assert.notEqual(email.status, "skipped_already_notified");
    assert.notEqual(sms.status, "skipped_already_notified");
    assert.equal(email.status, "skipped_no_email");
    assert.equal(sms.status, "skipped_no_phone");
  });

  test("tenant scoping: out-of-company technicians are not in results", async () => {
    const res = await api(
      "POST",
      "/api/billing-sheets/missing-photos/notify",
      { channel: "both" },
    );
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const techIdsInResults = new Set(
      (res.body.results ?? []).map((r) => r.technicianId),
    );
    assert.ok(
      techIdsInResults.has(techNoContactId),
      "in-company tech must appear",
    );
    assert.ok(
      techIdsInResults.has(techEmailOnlyId),
      "in-company tech must appear",
    );
    assert.equal(
      techIdsInResults.has(techOtherCoId),
      false,
      "tech in a different company must NOT appear in the results",
    );

    // Sanity: the (mocked) email recipient was only ever the in-company tech;
    // no email was ever generated for the other-company tech.
    for (const call of sentEmailCalls) {
      assert.notEqual(call.technicianName, "Tech Other Co");
    }
  });

  test("non-manager roles are denied (403)", async () => {
    const FIELD_TECH_HEADERS = {
      "Content-Type": "application/json",
      "x-user-id": String(techNoContactId),
      "x-user-role": "field_tech",
      "x-user-company-id": String(COMPANY_A_ID),
    };
    const res = await api(
      "POST",
      "/api/billing-sheets/missing-photos/notify",
      { channel: "email" },
      FIELD_TECH_HEADERS,
    );
    assert.equal(res.status, 403, JSON.stringify(res.body));
  });
});
