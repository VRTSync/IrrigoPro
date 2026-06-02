// Regression test for the assertCanViewPhoto SQL cast bug.
//
// Root cause: `= ANY(${candidates})` inside assertCanViewPhoto passed a
// JS string[] directly to Drizzle's sql template, which expands it as
// multiple positional params `($2, $3, ...)`. Without an explicit type
// cast Postgres throws "could not determine data type of parameter $N".
// Even with `::text[]`, Postgres cannot cast a row expression
// `($2,$3)::text[]` to text[]. The correct fix is `sql.param(candidates)`
// which makes the pg driver pass the array as a SINGLE Postgres array
// parameter `{val1,val2,...}` that `::text[]` can then cast safely.
//
// The same class of bug existed in the overlaps() helper used for the
// work_orders / billing_sheets / estimates branches — fixed in lockstep.
//
// Two layers of coverage:
//
// 1. Static-source assertion — verifies sql.param() with ::text[] is
//    textually present in routes.ts so any edit that removes it fails.
//
// 2. Behavioral integration test — seeds real wet_check_photos / wet_checks
//    rows, spins up a minimal Express app with a route that runs the exact
//    fixed SQL expression (sql.param + ::text[]), makes a GET, and asserts
//    status < 500. The test locks out the SQL error; 200 / 302 / 404 are
//    all acceptable outcomes.

import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import express, { type Express, type RequestHandler } from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { db } from "@workspace/db";
import {
  companies,
  users,
  customers,
  wetChecks,
  wetCheckPhotos,
} from "@workspace/db/schema";
import { eq, and, sql } from "drizzle-orm";

// ── Static-source assertion ──────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const routesSrc = readFileSync(join(__dirname, "routes.ts"), "utf8");

describe("assertCanViewPhoto — SQL cast regression", () => {
  it("wet_check_photos ANY() uses sql.param + ::text[] so Postgres receives a single array parameter", () => {
    // The pattern must be: sql.param(candidates) so Drizzle passes the
    // whole JS array as one pg parameter (pg serialises as {val1,val2,...})
    // which ::text[] can then cast. The bare ${candidates}::text[] expansion
    // produces ($2,$3)::text[] (row cast) which Postgres rejects.
    assert.ok(
      routesSrc.includes("= ANY(${sql.param(candidates)}::text[])"),
      'Expected `= ANY(${sql.param(candidates)}::text[])` in routes.ts ' +
      "— sql.param() is required so the pg driver binds the array as a " +
      "single Postgres array parameter rather than expanding it into ($2,$3,...).",
    );
  });

  it("overlaps() helper also uses sql.param + ::text[] so work_orders / billing_sheets / estimates branches do not fail", () => {
    assert.ok(
      routesSrc.includes("&& ${sql.param(candidates)}::text[]"),
      'Expected `&& ${sql.param(candidates)}::text[]` in routes.ts — ' +
      "the overlaps() helper for array columns has the same binding requirement.",
    );
  });

  it("assertCanViewPhoto function body contains both sql.param cast sites", () => {
    const fnStart = routesSrc.indexOf("async function assertCanViewPhoto(");
    assert.ok(fnStart >= 0, "Could not locate assertCanViewPhoto in routes.ts");

    // ~3000 chars covers the full function body (definition is ~60 lines
    // before the last SQL branch, at ~60 chars/line ≈ 3 600 chars max).
    const fnSlice = routesSrc.slice(fnStart, fnStart + 3600);

    assert.ok(
      fnSlice.includes("= ANY(${sql.param(candidates)}::text[])"),
      "wet_check_photos branch is missing sql.param ::text[] cast",
    );
    assert.ok(
      fnSlice.includes("&& ${sql.param(candidates)}::text[]"),
      "overlaps() helper is missing sql.param ::text[] cast",
    );
  });
});

// ── Behavioral integration test ──────────────────────────────────────────────
//
// Seeds: company → user → customer → wet_check → wet_check_photos
// Route: minimal Express app replicating the exact fixed SQL from
//        assertCanViewPhoto (sql.param + ::text[])
// Assert: GET /api/photos/<url>?variant=thumb returns status < 500
//         and specifically 200 when the seeded photo matches.

const SEED_MARKER = "PHOTO-SERVE-TEST-1084";
const TEST_PHOTO_URL = "photos/test-photo-serve-1084-regression";

async function seedRows(): Promise<{
  companyId: number;
  userId: number;
  customerId: number;
  wetCheckId: number;
  photoId: number;
}> {
  const [company] = await db
    .insert(companies)
    .values({ name: SEED_MARKER })
    .returning();

  const [user] = await db
    .insert(users)
    .values({
      username: `${SEED_MARKER}-user`,
      password: "x",
      name: "Test Tech",
      role: "field_tech",
      companyId: company.id,
    })
    .returning();

  const [customer] = await db
    .insert(customers)
    .values({
      companyId: company.id,
      name: "Test Customer",
      email: `${SEED_MARKER}@test.local`,
    })
    .returning();

  const [wc] = await db
    .insert(wetChecks)
    .values({
      companyId: company.id,
      customerId: customer.id,
      technicianId: user.id,
      technicianName: "Test Tech",
      customerName: "Test Customer",
      numControllers: 1,
      status: "in_progress",
      laborMode: "flat",
      totalLaborHours: "0.00",
    })
    .returning();

  const [photo] = await db
    .insert(wetCheckPhotos)
    .values({
      wetCheckId: wc.id,
      url: TEST_PHOTO_URL,
      takenBy: user.id,
    })
    .returning();

  return {
    companyId: company.id,
    userId: user.id,
    customerId: customer.id,
    wetCheckId: wc.id,
    photoId: photo.id,
  };
}

async function cleanupRows(): Promise<void> {
  // Find seed wet_checks via the company name marker.
  const seedWetChecks = await db
    .select({ id: wetChecks.id })
    .from(wetChecks)
    .innerJoin(companies, eq(companies.id, wetChecks.companyId))
    .where(eq(companies.name, SEED_MARKER));
  for (const wc of seedWetChecks) {
    await db.delete(wetCheckPhotos).where(eq(wetCheckPhotos.wetCheckId, wc.id));
    await db.delete(wetChecks).where(eq(wetChecks.id, wc.id));
  }
  const seedCompanies = await db
    .select({ id: companies.id })
    .from(companies)
    .where(eq(companies.name, SEED_MARKER));
  for (const co of seedCompanies) {
    await db.delete(customers).where(eq(customers.companyId, co.id));
    await db.delete(users).where(eq(users.companyId, co.id));
    await db.delete(companies).where(eq(companies.id, co.id));
  }
}

describe("assertCanViewPhoto — behavioral SQL integration", () => {
  let server: Server;
  let baseUrl: string;
  let seeded: Awaited<ReturnType<typeof seedRows>>;

  beforeEach(async () => {
    await cleanupRows();
    seeded = await seedRows();

    // Minimal Express app replicating the wet_check_photos branch of
    // assertCanViewPhoto with the sql.param + ::text[] fix applied.
    // A non-500 response proves the fix resolves the Postgres type-
    // inference error.
    const app: Express = express();

    const authMiddleware: RequestHandler = (req: any, _res, next) => {
      req.user = { id: seeded.userId, companyId: seeded.companyId, role: "field_tech" };
      next();
    };

    app.get("/api/photos/{*photoId}", authMiddleware, async (req: any, res) => {
      try {
        const photoId = Array.isArray(req.params.photoId)
          ? req.params.photoId.join("/")
          : (req.params.photoId ?? "");
        const stripped = photoId.startsWith("/") ? photoId.slice(1) : photoId;
        const deDoubled = stripped.replace(/^photos\/photos\//, "photos/");
        const candidates = Array.from(new Set([photoId, stripped, deDoubled]));

        // Exact fixed SQL from assertCanViewPhoto: sql.param() passes the
        // JS array as a single Postgres array parameter so ::text[] can cast it.
        const wcRows = await db
          .select({ id: wetCheckPhotos.id })
          .from(wetCheckPhotos)
          .innerJoin(wetChecks, eq(wetChecks.id, wetCheckPhotos.wetCheckId))
          .where(and(
            eq(wetChecks.companyId, req.user.companyId),
            sql`${wetCheckPhotos.url} = ANY(${sql.param(candidates)}::text[])`,
          ))
          .limit(1);

        if (wcRows.length > 0) {
          res.status(200).json({ authorized: true });
          return;
        }
        res.status(404).json({ error: "Not found or not authorized" });
      } catch (err: any) {
        res.status(500).json({ error: String(err?.message ?? err) });
      }
    });

    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
    await cleanupRows();
  });

  it("GET /api/photos/<url>?variant=thumb does not return 5xx when wet_check_photos row exists", async () => {
    const encoded = encodeURIComponent(TEST_PHOTO_URL);
    const res = await fetch(`${baseUrl}/api/photos/${encoded}?variant=thumb`);
    assert.ok(
      res.status < 500,
      `Expected status < 500 (200/404 both OK), got ${res.status} — ` +
      "a 500 here means the sql.param ::text[] cast is broken and Postgres threw " +
      '"could not determine data type of parameter $N" or a row-cast error.',
    );
  });

  it("GET /api/photos/<url>?variant=thumb returns 200 when the seeded photo URL matches", async () => {
    const encoded = encodeURIComponent(TEST_PHOTO_URL);
    const res = await fetch(`${baseUrl}/api/photos/${encoded}?variant=thumb`);
    assert.equal(
      res.status,
      200,
      `Expected 200 (photo found and authorized), got ${res.status}`,
    );
    const body = await res.json() as any;
    assert.equal(body.authorized, true);
  });
});
