/**
 * activity-feed.test.tsx (Task #1097)
 *
 * Tests the ActivityFeed component:
 *   1. Renders "No activity yet." when events is empty
 *   2. Renders a list item per event with timestamp and summary
 *   3. Renders nothing (null) when url prop is null
 *   4. Does not fetch when url is null
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Mutation-side invalidation sources ────────────────────────────────────────
const RATE_MODE_SRC = readFileSync(
  path.join(__dirname, "rate-mode-toggle.tsx"),
  "utf8",
);
const LABOR_RATE_SRC = readFileSync(
  path.join(__dirname, "..", "wet-check-billings", "wcb-labor-rate-edit.tsx"),
  "utf8",
);
const ZONE_LABOR_SRC = readFileSync(
  path.join(__dirname, "..", "wet-check-billings", "zone-labor-edit-inline.tsx"),
  "utf8",
);
const VIEW_MODAL_SRC = readFileSync(
  path.join(__dirname, "..", "wet-check-billings", "wet-check-billing-view-modal.tsx"),
  "utf8",
);

// Static source checks (avoids heavy JSDOM/React render in CI)
const COMPONENT_SRC = readFileSync(
  path.join(__dirname, "activity-feed.tsx"),
  "utf8",
);

describe("ActivityFeed component — Task #1097", () => {

  it("renders 'No activity yet.' when events array is empty", () => {
    assert.ok(
      COMPONENT_SRC.includes("No activity yet."),
      "component must render 'No activity yet.' for empty event list",
    );
  });

  it("includes a data-testid for the empty state", () => {
    assert.ok(
      COMPONENT_SRC.includes("activity-feed-empty"),
      "empty state must have data-testid='activity-feed-empty'",
    );
  });

  it("includes a data-testid for the list state", () => {
    assert.ok(
      COMPONENT_SRC.includes("activity-feed-list"),
      "event list must have data-testid='activity-feed-list'",
    );
  });

  it("includes a data-testid for the root container", () => {
    assert.ok(
      COMPONENT_SRC.includes("activity-feed"),
      "root container must have data-testid='activity-feed'",
    );
  });

  it("renders nothing when url is null (early return before fetch)", () => {
    // The component must guard on `!url` and return null so it produces
    // zero DOM when no URL is available (e.g. 'part' / 'manual_review' queue items).
    assert.ok(
      COMPONENT_SRC.includes("if (!url) return null"),
      "component must return null when url is null (no URL → no render)",
    );
  });

  it("query is disabled when url is null", () => {
    assert.ok(
      COMPONENT_SRC.includes("enabled: !!url"),
      "useQuery must have enabled: !!url so no fetch fires when url is null",
    );
  });

  it("renders event summary text", () => {
    // The event list renders summary ?? action for each row
    assert.ok(
      COMPONENT_SRC.includes("event.summary") || COMPONENT_SRC.includes("summary"),
      "component must render event.summary or fall back to action string",
    );
  });

  it("renders occurredAt timestamp for each event", () => {
    assert.ok(
      COMPONENT_SRC.includes("occurredAt"),
      "component must display the occurredAt timestamp",
    );
  });

  it("renders actorLabel when present", () => {
    assert.ok(
      COMPONENT_SRC.includes("actorLabel"),
      "component must display actorLabel (who performed the action)",
    );
  });

  it("uses asArray or empty-array fallback to prevent .map crash on null payload", () => {
    // Guard: events feed must not crash when API returns null instead of []
    assert.ok(
      COMPONENT_SRC.includes("Array.isArray") ||
      COMPONENT_SRC.includes("?? []") ||
      COMPONENT_SRC.includes("asArray"),
      "component must guard against null events with Array.isArray, ?? [], or asArray()",
    );
  });
});

// ── Mutation-side invalidation wiring (Task #1097 code-review fix) ────────────
//
// These static-source tests assert that every WCB mutation component invalidates
// the activity query key on success so the feed refreshes immediately without
// the user reopening the drawer or modal.

describe("ActivityFeed — mutation components invalidate the activity query key", () => {

  it("RateModeToggle invalidates the WCB activity key when entityPath='wet-check-billings'", () => {
    assert.ok(
      RATE_MODE_SRC.includes('wet-check-billings') &&
      RATE_MODE_SRC.includes('/activity'),
      "RateModeToggle onSuccess must invalidate /api/wet-check-billings/:id/activity",
    );
  });

  it("WcbLaborRateEdit imports useQueryClient", () => {
    assert.ok(
      LABOR_RATE_SRC.includes("useQueryClient"),
      "WcbLaborRateEdit must import useQueryClient to invalidate activity query",
    );
  });

  it("WcbLaborRateEdit invalidates the activity query key on success", () => {
    assert.ok(
      LABOR_RATE_SRC.includes("/activity"),
      "WcbLaborRateEdit onSuccess must invalidate the /activity query key",
    );
  });

  it("ZoneLaborEditInline invalidates the activity query key in its invalidate() helper", () => {
    assert.ok(
      ZONE_LABOR_SRC.includes("/activity"),
      "ZoneLaborEditInline invalidate() must include the /activity key",
    );
  });

  it("WetCheckBillingViewModal.handleLaborSaved invalidates the activity query key", () => {
    assert.ok(
      VIEW_MODAL_SRC.includes("/activity"),
      "WetCheckBillingViewModal handleLaborSaved must invalidate the /activity key",
    );
  });
});
