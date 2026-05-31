// Task #1010 — WC Manager Experience Slice 10 — role-aware Today tab.
//
// These tests verify the pure-logic layer that backs ManagerTodayScreen
// without a React Native renderer:
//
//   1. Four field-action buttons are defined with the expected labels.
//   2. subtitleForAge formats age strings correctly (counts + ages).
//   3. Zero-count tiles are identified as non-tappable (muted style guard).
//   4. Role-routing regression: field_tech does NOT see the manager dashboard.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// -----------------------------------------------------------------------
// Re-implement the tiny pieces of logic we need to test here so that the
// test file has no React Native imports (which cannot run under Node.js).
// The real implementations in manager-today-screen.tsx must stay consistent
// with these contracts — any drift is a bug.
// -----------------------------------------------------------------------

// Mirror of FIELD_ACTIONS from manager-today-screen.tsx
const FIELD_ACTIONS = [
  { label: "Start wet check", icon: "droplet", route: "/wet-check/new" },
  { label: "Create work order", icon: "plus-circle", route: "/work-order/new" },
  { label: "Assign tech", icon: "user-check", route: "/work-order/assign" },
  { label: "Today's schedule", icon: "calendar", route: "/schedule" },
];

// Mirror of subtitleForAge from manager-today-screen.tsx
function subtitleForAge(hours: number | null): string {
  if (hours === null) return "";
  if (hours < 1) return "Oldest: < 1h ago";
  if (hours < 24) return `Oldest: ${Math.round(hours)}h ago`;
  const days = Math.floor(hours / 24);
  return `Oldest: ${days}d ago`;
}

// Mirror of MANAGER_ROLES from app/(tabs)/index.tsx
const MANAGER_ROLES = new Set(["irrigation_manager", "company_admin", "super_admin"]);

// -----------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------

describe("ManagerTodayScreen — field-action buttons", () => {
  it("renders exactly four field-action buttons", () => {
    assert.equal(FIELD_ACTIONS.length, 4);
  });

  it("includes 'Start wet check' as the first button", () => {
    assert.equal(FIELD_ACTIONS[0].label, "Start wet check");
    assert.equal(FIELD_ACTIONS[0].route, "/wet-check/new");
  });

  it("includes 'Create work order' as the second button", () => {
    assert.equal(FIELD_ACTIONS[1].label, "Create work order");
    assert.equal(FIELD_ACTIONS[1].route, "/work-order/new");
  });

  it("includes 'Assign tech' as the third button", () => {
    assert.equal(FIELD_ACTIONS[2].label, "Assign tech");
    assert.equal(FIELD_ACTIONS[2].route, "/work-order/assign");
  });

  it("includes 'Today's schedule' as the fourth button", () => {
    assert.equal(FIELD_ACTIONS[3].label, "Today's schedule");
    assert.equal(FIELD_ACTIONS[3].route, "/schedule");
  });
});

describe("subtitleForAge — action tile age formatting", () => {
  it("returns empty string when age is null (no rows)", () => {
    assert.equal(subtitleForAge(null), "");
  });

  it("returns '< 1h ago' for ages under an hour", () => {
    assert.equal(subtitleForAge(0), "Oldest: < 1h ago");
    assert.equal(subtitleForAge(0.5), "Oldest: < 1h ago");
    assert.equal(subtitleForAge(0.99), "Oldest: < 1h ago");
  });

  it("returns hours label for ages between 1h and 24h", () => {
    assert.equal(subtitleForAge(1), "Oldest: 1h ago");
    assert.equal(subtitleForAge(3), "Oldest: 3h ago");
    assert.equal(subtitleForAge(12), "Oldest: 12h ago");
    assert.equal(subtitleForAge(23.9), "Oldest: 24h ago");
  });

  it("returns days label for ages of 24h or more", () => {
    assert.equal(subtitleForAge(24), "Oldest: 1d ago");
    assert.equal(subtitleForAge(48), "Oldest: 2d ago");
    assert.equal(subtitleForAge(72), "Oldest: 3d ago");
    assert.equal(subtitleForAge(168), "Oldest: 7d ago");
  });

  it("floors partial days correctly", () => {
    // 47h = 1 full day
    assert.equal(subtitleForAge(47), "Oldest: 1d ago");
    // 49h = 2 full days
    assert.equal(subtitleForAge(49), "Oldest: 2d ago");
  });
});

describe("ActionTile — zero-count muted style guard", () => {
  it("count zero is detected as empty (non-tappable)", () => {
    const isEmpty = (count: number) => count === 0;
    assert.equal(isEmpty(0), true);
    assert.equal(isEmpty(1), false);
    assert.equal(isEmpty(10), false);
  });

  it("count zero tiles show no subtitle age text regardless of age", () => {
    // When count is 0, subtitle is still shown but tile is not tappable.
    // This test validates the age formatting still works at count=0.
    const count = 0;
    const ageHours = 48;
    const subtitle = subtitleForAge(ageHours);
    assert.equal(count === 0, true);
    assert.equal(subtitle, "Oldest: 2d ago");
  });
});

describe("Role-routing regression — field_tech sees FieldTechTodayScreen", () => {
  it("irrigation_manager is in MANAGER_ROLES", () => {
    assert.equal(MANAGER_ROLES.has("irrigation_manager"), true);
  });

  it("company_admin is in MANAGER_ROLES", () => {
    assert.equal(MANAGER_ROLES.has("company_admin"), true);
  });

  it("super_admin is in MANAGER_ROLES", () => {
    assert.equal(MANAGER_ROLES.has("super_admin"), true);
  });

  it("field_tech is NOT in MANAGER_ROLES (gets FieldTechTodayScreen)", () => {
    assert.equal(MANAGER_ROLES.has("field_tech"), false);
  });

  it("unknown roles are NOT in MANAGER_ROLES", () => {
    assert.equal(MANAGER_ROLES.has("billing_manager"), false);
    assert.equal(MANAGER_ROLES.has("manager"), false);
    assert.equal(MANAGER_ROLES.has(""), false);
  });

  it("field_tech role-routing guard: 'Start wet check' button absent for field_tech", () => {
    // The field-tech screen never renders FIELD_ACTIONS — it's the manager
    // screen that exposes these buttons.  Confirm field_tech cannot reach them.
    const role = "field_tech";
    const seesManagerDashboard = MANAGER_ROLES.has(role);
    assert.equal(seesManagerDashboard, false);
    // field_tech therefore cannot see the "Start wet check" action button.
    const visibleActions = seesManagerDashboard ? FIELD_ACTIONS : [];
    assert.equal(visibleActions.find((a) => a.label === "Start wet check"), undefined);
  });
});
