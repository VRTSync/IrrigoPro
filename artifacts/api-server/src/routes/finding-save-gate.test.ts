// Task #1735 — server-side enforcement of complete-or-flag at finding save.
// Task #1757 — fix over-application of the 0.25 labor floor.
//
// Guards apply only when the parent wet check is in "service" mode.
// Inspection wet checks are document-only; their findings skip all gates.
//
// POST guard:  non-custom must have repairedInField + billability; service mode only.
// PATCH guard 1: explicit repairedInField:false blocked for non-custom (effective type).
// PATCH guard 2: merge-state billability — only when patch touches billability fields.
// Labor floor rules (Task #1757):
//   custom_review → always "0.00"
//   billable service (non-custom + service mode + repairedInField) → floor 0.25
//   inspection, or non-billable service → quantize, no floor
//
// Uses node:test / node:assert — no vitest dependency required.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { LABOR_ONLY_ISSUE_TYPES } from "../storage";

const CUSTOM_REVIEW_ISSUE_TYPE = "custom_review";

// ─── Shared types ─────────────────────────────────────────────────────────────

type FindingSnapshot = {
  issueType: string;
  resolution: string;
  partId: number | null;
  noPartNeeded: boolean;
};

// ─── POST guard helper ────────────────────────────────────────────────────────

function applyPostGuards(
  wcMode: "service" | "inspection",
  body: {
    issueType: string;
    repairedInField?: boolean;
    partId?: number | null;
    noPartNeeded?: boolean;
    laborHours?: string | number;
  }
): { ok: true; quantizedLabor: string } | { ok: false; status: number; message: string } {
  if (wcMode === "service") {
    const isCustom = body.issueType === CUSTOM_REVIEW_ISSUE_TYPE;
    if (!isCustom) {
      if (!body.repairedInField) {
        return { ok: false, status: 400, message: "Non-custom findings must be marked complete." };
      }
      const isLaborOnly = LABOR_ONLY_ISSUE_TYPES.has(body.issueType);
      const hasPartId = body.partId != null;
      const noPartNeeded = body.noPartNeeded ?? false;
      if (!hasPartId && !noPartNeeded && !isLaborOnly) {
        return { ok: false, status: 400, message: "Select a part or confirm no part needed before saving." };
      }
    }
  }
  const rawLabor = parseFloat(String(body.laborHours ?? "0"));
  if (!isFinite(rawLabor) || rawLabor < 0) {
    return { ok: false, status: 400, message: "Labor hours must be a non-negative number." };
  }
  // Task #1757 — three-way floor branch.
  const isPostCustom = body.issueType === CUSTOM_REVIEW_ISSUE_TYPE;
  const quantizedLabor = isPostCustom
    ? "0.00"
    : (wcMode === "service" && body.repairedInField)
      ? Math.max(0.25, Math.round(rawLabor * 4) / 4).toFixed(2)
      : (Math.round(rawLabor * 4) / 4).toFixed(2);
  return { ok: true, quantizedLabor };
}

// ─── PATCH guard 1 helper (repairedInField:false gate) ───────────────────────
// Uses effective issue type (snapshot merged with body) so an already-custom
// finding is correctly treated as custom even when body omits issueType.
// Task #1757 — also applies the three-way labor floor and unconditional
// custom-force (mirrors the route: custom_review always gets labor="0.00"
// even when laborHours is absent from the body).

function applyPatchGuard1(
  wcMode: "service" | "inspection",
  snapshot: FindingSnapshot,
  body: {
    issueType?: string;
    repairedInField?: boolean;
    laborHours?: string | number;
  }
): { ok: true; quantizedLabor?: string } | { ok: false; status: number; message: string } {
  const effectivePatchIssueType = body.issueType ?? snapshot.issueType;
  const effectivePatchIsCustom = effectivePatchIssueType === CUSTOM_REVIEW_ISSUE_TYPE;

  if (wcMode === "service") {
    if (body.repairedInField === false && !effectivePatchIsCustom) {
      return { ok: false, status: 400, message: "Non-custom findings cannot be saved without marking them complete." };
    }
  }

  // Task #1757 — custom_review always stores 0.00, regardless of whether
  // laborHours was supplied. Mirror the unconditional post-buildPatch force.
  if (effectivePatchIsCustom) {
    return { ok: true, quantizedLabor: "0.00" };
  }

  if (body.laborHours !== undefined) {
    const raw = parseFloat(String(body.laborHours));
    if (!isFinite(raw) || raw < 0) {
      return { ok: false, status: 400, message: "Labor hours must be a non-negative number." };
    }
    // Task #1757 — three-way floor branch (mirrors route logic).
    const isBillableService =
      wcMode === "service" &&
      (body.repairedInField === true || snapshot.resolution === "repaired_in_field");
    const quantizedLabor = isBillableService
      ? Math.max(0.25, Math.round(raw * 4) / 4).toFixed(2)
      : (Math.round(raw * 4) / 4).toFixed(2);
    return { ok: true, quantizedLabor };
  }
  return { ok: true };
}

// ─── PATCH guard 2 helper (merge-state billability) ──────────────────────────
// Only fires when the patch touches a billability-relevant field.
// Notes-only / metadata PATCHes on legacy unbillable completed rows pass through.

function applyPatchGuard2(
  wcMode: "service" | "inspection",
  snapshot: FindingSnapshot,
  body: {
    issueType?: string;
    repairedInField?: boolean;
    partId?: number | null;
    noPartNeeded?: boolean;
  }
): { ok: true } | { ok: false; status: number; message: string } {
  if (wcMode !== "service") return { ok: true };

  const effectiveIssueType = body.issueType ?? snapshot.issueType;
  const effectiveIsCustom = effectiveIssueType === CUSTOM_REVIEW_ISSUE_TYPE;

  const isTouchingBillability =
    body.repairedInField !== undefined ||
    body.partId !== undefined ||
    body.noPartNeeded !== undefined ||
    body.issueType !== undefined;

  if (isTouchingBillability && !effectiveIsCustom) {
    const resultResolution =
      body.repairedInField === true ? "repaired_in_field"
      : body.repairedInField === false ? "pending"
      : snapshot.resolution;
    const resultPartId = body.partId !== undefined ? body.partId : snapshot.partId;
    const resultNoPartNeeded = body.noPartNeeded !== undefined ? body.noPartNeeded : snapshot.noPartNeeded;

    if (resultResolution === "repaired_in_field") {
      const isLaborOnly = LABOR_ONLY_ISSUE_TYPES.has(effectiveIssueType);
      if (!resultPartId && !resultNoPartNeeded && !isLaborOnly) {
        return { ok: false, status: 400, message: "Select a part or confirm no part needed before saving." };
      }
    }
  }
  return { ok: true };
}

// ─── POST guard tests — service mode ─────────────────────────────────────────

describe("POST finding (service mode) — complete-or-flag guard", () => {
  it("rejects non-custom finding without repairedInField", () => {
    const result = applyPostGuards("service", { issueType: "broken_head", repairedInField: false, partId: 1 });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 400);
  });

  it("rejects non-custom finding with repairedInField omitted", () => {
    const result = applyPostGuards("service", { issueType: "broken_head", partId: 1 });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 400);
  });

  it("rejects billability gap — no part, no noPartNeeded, non-labor-only type", () => {
    const result = applyPostGuards("service", { issueType: "broken_head", repairedInField: true, partId: null, noPartNeeded: false });
    assert.equal(result.ok, false);
    if (!result.ok) { assert.equal(result.status, 400); assert.match(result.message, /part/i); }
  });

  it("accepts non-custom with repairedInField + part", () => {
    const result = applyPostGuards("service", { issueType: "broken_head", repairedInField: true, partId: 42, laborHours: "1.0" });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.quantizedLabor, "1.00");
  });

  it("accepts non-custom with repairedInField + noPartNeeded", () => {
    const result = applyPostGuards("service", { issueType: "broken_head", repairedInField: true, partId: null, noPartNeeded: true, laborHours: "0.75" });
    assert.equal(result.ok, true);
  });

  it("accepts non-custom with labor-only issue type (no part required)", () => {
    const laborOnlyType = [...LABOR_ONLY_ISSUE_TYPES][0];
    if (!laborOnlyType) return;
    const result = applyPostGuards("service", { issueType: laborOnlyType, repairedInField: true, partId: null, noPartNeeded: false, laborHours: "1.0" });
    assert.equal(result.ok, true);
  });

  it("accepts custom_review with repairedInField: false — no billability required", () => {
    const result = applyPostGuards("service", { issueType: CUSTOM_REVIEW_ISSUE_TYPE, repairedInField: false, partId: null, noPartNeeded: false, laborHours: "0.25" });
    assert.equal(result.ok, true);
  });

  it("rejects negative laborHours", () => {
    const result = applyPostGuards("service", { issueType: "broken_head", repairedInField: true, partId: 1, laborHours: "-1" });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.message, /labor hours/i);
  });

  it("rejects NaN laborHours", () => {
    const result = applyPostGuards("service", { issueType: "broken_head", repairedInField: true, partId: 1, laborHours: "not-a-number" });
    assert.equal(result.ok, false);
  });

  it("snaps labor 0.3 to 0.25", () => {
    const result = applyPostGuards("service", { issueType: "broken_head", repairedInField: true, partId: 1, laborHours: "0.3" });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.quantizedLabor, "0.25");
  });

  it("snaps labor 0.6 to 0.50", () => {
    const result = applyPostGuards("service", { issueType: "broken_head", repairedInField: true, partId: 1, laborHours: "0.6" });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.quantizedLabor, "0.50");
  });

  it("snaps labor 0 up to 0.25 (floor)", () => {
    const result = applyPostGuards("service", { issueType: "broken_head", repairedInField: true, partId: 1, laborHours: "0" });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.quantizedLabor, "0.25");
  });
});

// ─── POST guard tests — inspection mode (regression) ─────────────────────────

describe("POST finding (inspection mode) — complete-or-flag gate is bypassed", () => {
  it("saves with no repairedInField — no 400", () => {
    const result = applyPostGuards("inspection", { issueType: "broken_head", partId: 1, laborHours: "0.5" });
    assert.equal(result.ok, true);
  });

  it("saves with repairedInField: false — no 400", () => {
    const result = applyPostGuards("inspection", { issueType: "broken_head", repairedInField: false, partId: null, noPartNeeded: false, laborHours: "0.25" });
    assert.equal(result.ok, true);
  });

  it("saves with no part and no noPartNeeded (billability gap) — no 400", () => {
    const result = applyPostGuards("inspection", { issueType: "broken_head", repairedInField: false, partId: null, noPartNeeded: false, laborHours: "0.5" });
    assert.equal(result.ok, true);
  });

  it("still quantizes laborHours in inspection mode", () => {
    const result = applyPostGuards("inspection", { issueType: "broken_head", laborHours: "0.3" });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.quantizedLabor, "0.25");
  });

  it("still rejects negative laborHours in inspection mode", () => {
    const result = applyPostGuards("inspection", { issueType: "broken_head", laborHours: "-1" });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.message, /labor hours/i);
  });
});

// ─── PATCH guard 1 tests — service mode ──────────────────────────────────────

const nonCustomSnapshot: FindingSnapshot = { issueType: "broken_head", resolution: "pending", partId: null, noPartNeeded: false };
const customSnapshot: FindingSnapshot = { issueType: CUSTOM_REVIEW_ISSUE_TYPE, resolution: "pending", partId: null, noPartNeeded: false };

describe("PATCH finding (service mode) — guard 1 (repairedInField:false gate)", () => {
  it("rejects explicit repairedInField: false on non-custom finding (stored)", () => {
    const result = applyPatchGuard1("service", nonCustomSnapshot, { repairedInField: false });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 400);
  });

  it("rejects explicit repairedInField: false with non-custom issueType in body", () => {
    const result = applyPatchGuard1("service", nonCustomSnapshot, { repairedInField: false, issueType: "broken_head" });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 400);
  });

  it("allows explicit repairedInField: false when body sets issueType to custom_review", () => {
    const result = applyPatchGuard1("service", nonCustomSnapshot, { repairedInField: false, issueType: CUSTOM_REVIEW_ISSUE_TYPE });
    assert.equal(result.ok, true);
  });

  it("allows explicit repairedInField: false on already-custom finding (no issueType in body)", () => {
    // Stored finding is already custom_review; client omits issueType — still allowed.
    const result = applyPatchGuard1("service", customSnapshot, { repairedInField: false });
    assert.equal(result.ok, true);
  });

  it("allows PATCH that omits repairedInField entirely (manager qty/price edit)", () => {
    const result = applyPatchGuard1("service", nonCustomSnapshot, { laborHours: "2.0" });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.quantizedLabor, "2.00");
  });

  it("allows PATCH with repairedInField: true (marking complete)", () => {
    const result = applyPatchGuard1("service", nonCustomSnapshot, { repairedInField: true });
    assert.equal(result.ok, true);
  });

  it("quantizes PATCH labor 1.1 to 1.00", () => {
    const result = applyPatchGuard1("service", nonCustomSnapshot, { laborHours: "1.1" });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.quantizedLabor, "1.00");
  });

  it("quantizes PATCH labor 1.4 to 1.50", () => {
    const result = applyPatchGuard1("service", nonCustomSnapshot, { laborHours: "1.4" });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.quantizedLabor, "1.50");
  });

  it("rejects PATCH negative laborHours", () => {
    const result = applyPatchGuard1("service", nonCustomSnapshot, { laborHours: -0.5 });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.message, /labor hours/i);
  });
});

// ─── PATCH guard 1 tests — inspection mode bypass ────────────────────────────

describe("PATCH finding (inspection mode) — guard 1 is bypassed", () => {
  it("saves with repairedInField: false — no 400", () => {
    const result = applyPatchGuard1("inspection", nonCustomSnapshot, { repairedInField: false });
    assert.equal(result.ok, true);
  });

  it("saves with repairedInField: false and non-custom issueType — no 400", () => {
    const result = applyPatchGuard1("inspection", nonCustomSnapshot, { repairedInField: false, issueType: "broken_head" });
    assert.equal(result.ok, true);
  });

  it("still quantizes PATCH labor in inspection mode", () => {
    const result = applyPatchGuard1("inspection", nonCustomSnapshot, { laborHours: "1.4" });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.quantizedLabor, "1.50");
  });
});

// ─── PATCH guard 2 tests — merge-state billability (service mode) ─────────────

describe("PATCH finding (service mode) — guard 2 (merge-state billability)", () => {
  const completedWithPart: FindingSnapshot = { issueType: "broken_head", resolution: "repaired_in_field", partId: 42, noPartNeeded: false };
  const completedNoPart: FindingSnapshot = { issueType: "broken_head", resolution: "repaired_in_field", partId: null, noPartNeeded: false };
  const pendingNoPart: FindingSnapshot = { issueType: "broken_head", resolution: "pending", partId: null, noPartNeeded: false };
  const completedUnbillable: FindingSnapshot = { issueType: "broken_head", resolution: "repaired_in_field", partId: null, noPartNeeded: false };

  it("rejects manager clearing part on a completed finding (billability gap)", () => {
    const result = applyPatchGuard2("service", completedWithPart, { partId: null });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 400);
  });

  it("allows manager clearing part when noPartNeeded is also set in body", () => {
    const result = applyPatchGuard2("service", completedWithPart, { partId: null, noPartNeeded: true });
    assert.equal(result.ok, true);
  });

  it("rejects tech marking complete without a part (pending → repaired_in_field, no billability)", () => {
    const result = applyPatchGuard2("service", pendingNoPart, { repairedInField: true });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 400);
  });

  it("allows tech marking complete with a part in body", () => {
    const result = applyPatchGuard2("service", pendingNoPart, { repairedInField: true, partId: 99 });
    assert.equal(result.ok, true);
  });

  it("allows manager editing qty/price on an already-billable completed finding (no billability fields touched)", () => {
    // Only laborHours in body — not a billability field, guard 2 skips entirely.
    const result = applyPatchGuard2("service", completedWithPart, {});
    assert.equal(result.ok, true);
  });

  it("allows notes-only PATCH on a legacy unbillable completed finding (backward-compat)", () => {
    // Body has no billability-relevant fields → guard 2 does NOT fire, legacy rows unaffected.
    const result = applyPatchGuard2("service", completedUnbillable, {});
    assert.equal(result.ok, true);
  });

  it("rejects billability-field PATCH that would create billability gap on completed finding", () => {
    // noPartNeeded explicitly cleared on a finding with no part
    const snapshot: FindingSnapshot = { issueType: "broken_head", resolution: "repaired_in_field", partId: null, noPartNeeded: true };
    const result = applyPatchGuard2("service", snapshot, { noPartNeeded: false });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 400);
  });

  it("allows completed finding with only noPartNeeded (no part present)", () => {
    const snapshot: FindingSnapshot = { issueType: "broken_head", resolution: "repaired_in_field", partId: null, noPartNeeded: true };
    const result = applyPatchGuard2("service", snapshot, {});
    assert.equal(result.ok, true);
  });

  it("pending finding stays pending — no billability check fires (not completed)", () => {
    const result = applyPatchGuard2("service", pendingNoPart, {});
    assert.equal(result.ok, true);
  });

  it("completed non-custom finding being converted to custom_review — billability skipped (result is custom)", () => {
    const result = applyPatchGuard2("service", completedNoPart, { issueType: CUSTOM_REVIEW_ISSUE_TYPE, repairedInField: false });
    assert.equal(result.ok, true);
  });
});

// ─── PATCH guard 2 tests — inspection mode bypass ────────────────────────────

describe("PATCH finding (inspection mode) — guard 2 is bypassed", () => {
  const completedWithPart: FindingSnapshot = { issueType: "broken_head", resolution: "repaired_in_field", partId: 42, noPartNeeded: false };

  it("clearing part on completed finding → ok in inspection mode", () => {
    const result = applyPatchGuard2("inspection", completedWithPart, { partId: null });
    assert.equal(result.ok, true);
  });

  it("marking complete without part → ok in inspection mode", () => {
    const snap: FindingSnapshot = { issueType: "broken_head", resolution: "pending", partId: null, noPartNeeded: false };
    const result = applyPatchGuard2("inspection", snap, { repairedInField: true });
    assert.equal(result.ok, true);
  });
});

// ─── LABOR_ONLY_ISSUE_TYPES contract ─────────────────────────────────────────

describe("LABOR_ONLY_ISSUE_TYPES", () => {
  it("is a Set instance (may be empty if no labor-only issue types are seeded)", () => {
    assert.ok(LABOR_ONLY_ISSUE_TYPES instanceof Set);
  });

  it("does not include custom_review", () => {
    assert.equal(LABOR_ONLY_ISSUE_TYPES.has(CUSTOM_REVIEW_ISSUE_TYPE), false);
  });
});

// ─── Task #1757 — Labor floor correctness ─────────────────────────────────────
// Verifies the three-way floor branch introduced in Task #1757:
//   custom_review → always "0.00"
//   billable service (non-custom + service + repairedInField) → floor 0.25
//   inspection / non-billable service → quantize, no floor

describe("POST labor floor — custom_review always stores 0.00", () => {
  it("service mode: custom_review with any laborHours value → 0.00", () => {
    const result = applyPostGuards("service", {
      issueType: CUSTOM_REVIEW_ISSUE_TYPE,
      repairedInField: false,
      laborHours: "0.25",
    });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.quantizedLabor, "0.00");
  });

  it("service mode: custom_review with 1.5 laborHours → still 0.00", () => {
    const result = applyPostGuards("service", {
      issueType: CUSTOM_REVIEW_ISSUE_TYPE,
      repairedInField: false,
      laborHours: "1.5",
    });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.quantizedLabor, "0.00");
  });

  it("inspection mode: custom_review with any laborHours value → 0.00", () => {
    const result = applyPostGuards("inspection", {
      issueType: CUSTOM_REVIEW_ISSUE_TYPE,
      laborHours: "0.25",
    });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.quantizedLabor, "0.00");
  });
});

describe("POST labor floor — billable service capture keeps the 0.25 floor", () => {
  it("laborHours 0 → floor to 0.25 (service + repairedInField)", () => {
    const result = applyPostGuards("service", {
      issueType: "broken_head",
      repairedInField: true,
      partId: 1,
      laborHours: "0",
    });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.quantizedLabor, "0.25");
  });

  it("laborHours 0 (blank) → floor to 0.25 (service + repairedInField)", () => {
    const result = applyPostGuards("service", {
      issueType: "broken_head",
      repairedInField: true,
      partId: 1,
      laborHours: "0.0",
    });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.quantizedLabor, "0.25");
  });

  it("laborHours 1.1 → quantized to 1.00 with floor preserved", () => {
    const result = applyPostGuards("service", {
      issueType: "broken_head",
      repairedInField: true,
      partId: 1,
      laborHours: "1.1",
    });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.quantizedLabor, "1.00");
  });
});

describe("POST labor floor — inspection mode allows 0 labor (no floor)", () => {
  it("inspection: laborHours 0 → stored as 0.00 (no floor applied)", () => {
    const result = applyPostGuards("inspection", {
      issueType: "broken_head",
      laborHours: "0",
    });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.quantizedLabor, "0.00");
  });

  it("inspection: laborHours 1.6 → quantized to 1.50 (nearest 0.25, no floor)", () => {
    const result = applyPostGuards("inspection", {
      issueType: "broken_head",
      laborHours: "1.6",
    });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.quantizedLabor, "1.50");
  });

  it("inspection: NaN laborHours → 400", () => {
    const result = applyPostGuards("inspection", {
      issueType: "broken_head",
      laborHours: "not-a-number",
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.message, /labor hours/i);
  });

  it("inspection: negative laborHours → 400", () => {
    const result = applyPostGuards("inspection", {
      issueType: "broken_head",
      laborHours: "-0.5",
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.message, /labor hours/i);
  });
});

describe("PATCH labor floor — custom_review (stored or effective) forces 0.00", () => {
  const customStoredSnap: FindingSnapshot = {
    issueType: CUSTOM_REVIEW_ISSUE_TYPE,
    resolution: "pending",
    partId: null,
    noPartNeeded: false,
  };
  const nonCustomPendingSnap: FindingSnapshot = {
    issueType: "broken_head",
    resolution: "pending",
    partId: null,
    noPartNeeded: false,
  };

  it("PATCH on already-custom finding: body omits issueType → effective custom, labor forced 0.00", () => {
    const result = applyPatchGuard1("service", customStoredSnap, { laborHours: "0.5" });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.quantizedLabor, "0.00");
  });

  it("notes-only PATCH on already-custom finding (no laborHours in body) → labor still forced 0.00", () => {
    // Regression for the code-review finding: a notes-only PATCH that omits laborHours
    // must still ensure the patch carries labor=0.00. The helper returns quantizedLabor="0.00"
    // unconditionally for custom findings, mirroring the always-force in the route.
    const result = applyPatchGuard1("service", customStoredSnap, {});
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.quantizedLabor, "0.00");
  });

  it("notes-only PATCH on already-custom finding in inspection mode: labor still 0.00", () => {
    const result = applyPatchGuard1("inspection", customStoredSnap, {});
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.quantizedLabor, "0.00");
  });

  it("PATCH converting non-custom to custom_review: body sets issueType → labor forced 0.00", () => {
    const result = applyPatchGuard1("service", nonCustomPendingSnap, {
      issueType: CUSTOM_REVIEW_ISSUE_TYPE,
      repairedInField: false,
      laborHours: "0.75",
    });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.quantizedLabor, "0.00");
  });

  it("PATCH on already-custom finding in inspection mode: labor forced 0.00", () => {
    const result = applyPatchGuard1("inspection", customStoredSnap, { laborHours: "1.0" });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.quantizedLabor, "0.00");
  });
});

describe("PATCH labor floor — billable service (stored resolution=repaired_in_field) keeps floor", () => {
  const completedSnap: FindingSnapshot = {
    issueType: "broken_head",
    resolution: "repaired_in_field",
    partId: 42,
    noPartNeeded: false,
  };

  it("manager edits labor on a completed service finding: 0 → floored to 0.25", () => {
    const result = applyPatchGuard1("service", completedSnap, { laborHours: "0" });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.quantizedLabor, "0.25");
  });

  it("manager edits labor on a completed service finding: 1.4 → 1.50", () => {
    const result = applyPatchGuard1("service", completedSnap, { laborHours: "1.4" });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.quantizedLabor, "1.50");
  });
});

describe("PATCH labor floor — inspection mode allows 0 labor (no floor)", () => {
  const nonCustomPendingSnap: FindingSnapshot = {
    issueType: "broken_head",
    resolution: "pending",
    partId: null,
    noPartNeeded: false,
  };

  it("inspection PATCH: labor 0 → 0.00 (no floor)", () => {
    const result = applyPatchGuard1("inspection", nonCustomPendingSnap, { laborHours: "0" });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.quantizedLabor, "0.00");
  });

  it("inspection PATCH: labor 1.6 → 1.50 (quantized, no floor)", () => {
    const result = applyPatchGuard1("inspection", nonCustomPendingSnap, { laborHours: "1.6" });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.quantizedLabor, "1.50");
  });
});

describe("Regression (Task #1735 service guards unchanged by Task #1757)", () => {
  it("service POST: non-custom without repairedInField still 400", () => {
    const result = applyPostGuards("service", { issueType: "broken_head", partId: 1 });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 400);
  });

  it("service POST: billable service finding with 0 labor → floor to 0.25", () => {
    const result = applyPostGuards("service", {
      issueType: "broken_head",
      repairedInField: true,
      partId: 1,
      laborHours: "0",
    });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.quantizedLabor, "0.25");
  });
});
