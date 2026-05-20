/**
 * Task #753 (Slice 4) — Unit tests for backfill-zone-repair-labor logic.
 *
 * Tests the core backfill algorithm in isolation (no DB, no file I/O):
 *   1. Correct sum: zone with billed findings gets SUM(laborHours)
 *   2. Zero-finding zone is left at 0.00
 *   3. Idempotent: running twice produces same result
 *   4. Dry-run: does not mutate state
 *   5. Resumable: zone already in done-set is skipped
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ─── Pure algorithm extracted from the backfill script ─────────────────────

interface Finding {
  zoneRecordId: number;
  billingSheetId: number | null;
  laborHours: string;
}

interface ZoneRecord {
  id: number;
  repairLaborHours: string;
}

/**
 * Core backfill function — computes the target repairLaborHours for a given
 * zone record id based on its billed findings' labor_hours. Returns null
 * when the zone already has the correct value (skip).
 */
function computeZoneRepairLabor(
  zoneRecordId: number,
  findings: Finding[],
  existing: ZoneRecord,
): string | null {
  const billedFindings = findings.filter(
    (f) => f.zoneRecordId === zoneRecordId && f.billingSheetId != null,
  );
  const sumHours = billedFindings.reduce((acc, f) => {
    const v = parseFloat(String(f.laborHours ?? "0")) || 0;
    return acc + v;
  }, 0);
  const existingVal = parseFloat(String(existing.repairLaborHours ?? "0")) || 0;
  if (Math.abs(existingVal - sumHours) < 0.001) {
    return null; // already correct
  }
  return sumHours.toFixed(2);
}

/**
 * Simulated backfill run. Returns the mutations that would be applied.
 * dryRun=true returns the mutations without persisting. done is the set of
 * already-processed ids (resume state).
 */
function runBackfill(opts: {
  candidateZoneIds: number[];
  findings: Finding[];
  zoneRecords: ZoneRecord[];
  dryRun: boolean;
  done: Set<number>;
}): { id: number; newValue: string }[] {
  const { candidateZoneIds, findings, zoneRecords, dryRun, done } = opts;
  const mutations: { id: number; newValue: string }[] = [];

  for (const zoneRecordId of candidateZoneIds) {
    if (done.has(zoneRecordId)) continue;
    const existing = zoneRecords.find((z) => z.id === zoneRecordId)!;
    const target = computeZoneRepairLabor(zoneRecordId, findings, existing);
    if (target == null) {
      done.add(zoneRecordId);
      continue;
    }
    if (!dryRun) {
      // Simulate a write
      existing.repairLaborHours = target;
      done.add(zoneRecordId);
    }
    mutations.push({ id: zoneRecordId, newValue: target });
  }

  return mutations;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("backfill-zone-repair-labor algorithm", () => {
  it("computes correct sum for a zone with billed findings", () => {
    const findings: Finding[] = [
      { zoneRecordId: 1, billingSheetId: 10, laborHours: "0.50" },
      { zoneRecordId: 1, billingSheetId: 10, laborHours: "1.25" },
      { zoneRecordId: 1, billingSheetId: null, laborHours: "0.75" }, // unbilled — excluded
    ];
    const existing: ZoneRecord = { id: 1, repairLaborHours: "0.00" };
    const target = computeZoneRepairLabor(1, findings, existing);
    assert.equal(target, "1.75");
  });

  it("returns null (skip) when zone already has the correct value", () => {
    const findings: Finding[] = [
      { zoneRecordId: 1, billingSheetId: 10, laborHours: "0.50" },
    ];
    const existing: ZoneRecord = { id: 1, repairLaborHours: "0.50" };
    const target = computeZoneRepairLabor(1, findings, existing);
    assert.equal(target, null);
  });

  it("computes 0.00 for a zone that has no billed findings", () => {
    const findings: Finding[] = [
      { zoneRecordId: 1, billingSheetId: null, laborHours: "0.75" },
    ];
    const existing: ZoneRecord = { id: 1, repairLaborHours: "0.00" };
    const target = computeZoneRepairLabor(1, findings, existing);
    // Already 0.00 — skip (idempotent).
    assert.equal(target, null);
  });

  it("dry-run does not mutate state", () => {
    const findings: Finding[] = [
      { zoneRecordId: 1, billingSheetId: 5, laborHours: "1.00" },
    ];
    const zoneRecords: ZoneRecord[] = [{ id: 1, repairLaborHours: "0.00" }];
    const done = new Set<number>();

    const mutations = runBackfill({
      candidateZoneIds: [1],
      findings,
      zoneRecords,
      dryRun: true,
      done,
    });

    // Mutation is reported but zone record is unchanged (dry-run).
    assert.equal(mutations.length, 1);
    assert.equal(mutations[0].newValue, "1.00");
    assert.equal(zoneRecords[0].repairLaborHours, "0.00"); // not written
    assert.equal(done.has(1), false); // not added to done set
  });

  it("applies mutations when dryRun=false", () => {
    const findings: Finding[] = [
      { zoneRecordId: 1, billingSheetId: 5, laborHours: "1.00" },
    ];
    const zoneRecords: ZoneRecord[] = [{ id: 1, repairLaborHours: "0.00" }];
    const done = new Set<number>();

    runBackfill({ candidateZoneIds: [1], findings, zoneRecords, dryRun: false, done });

    assert.equal(zoneRecords[0].repairLaborHours, "1.00");
    assert.ok(done.has(1));
  });

  it("idempotent: running a second time with same input produces zero mutations", () => {
    const findings: Finding[] = [
      { zoneRecordId: 1, billingSheetId: 5, laborHours: "0.75" },
    ];
    const zoneRecords: ZoneRecord[] = [{ id: 1, repairLaborHours: "0.00" }];
    const done = new Set<number>();

    // First run
    const run1 = runBackfill({ candidateZoneIds: [1], findings, zoneRecords, dryRun: false, done });
    assert.equal(run1.length, 1);
    assert.equal(zoneRecords[0].repairLaborHours, "0.75");

    // Second run — done set has zone 1, so it is skipped.
    const run2 = runBackfill({ candidateZoneIds: [1], findings, zoneRecords, dryRun: false, done });
    assert.equal(run2.length, 0);
  });

  it("resumes: already-done zone ids are skipped", () => {
    const findings: Finding[] = [
      { zoneRecordId: 1, billingSheetId: 5, laborHours: "0.50" },
      { zoneRecordId: 2, billingSheetId: 5, laborHours: "1.00" },
    ];
    const zoneRecords: ZoneRecord[] = [
      { id: 1, repairLaborHours: "0.00" },
      { id: 2, repairLaborHours: "0.00" },
    ];
    // Simulate prior run having processed zone 1.
    const done = new Set<number>([1]);

    const mutations = runBackfill({
      candidateZoneIds: [1, 2],
      findings,
      zoneRecords,
      dryRun: false,
      done,
    });

    // Only zone 2 should be updated.
    assert.equal(mutations.length, 1);
    assert.equal(mutations[0].id, 2);
    assert.equal(zoneRecords[0].repairLaborHours, "0.00"); // zone 1 skipped
    assert.equal(zoneRecords[1].repairLaborHours, "1.00"); // zone 2 updated
  });

  it("multiple zones processed correctly in one pass", () => {
    const findings: Finding[] = [
      { zoneRecordId: 1, billingSheetId: 5, laborHours: "0.25" },
      { zoneRecordId: 1, billingSheetId: 5, laborHours: "0.50" },
      { zoneRecordId: 2, billingSheetId: 7, laborHours: "1.00" },
      { zoneRecordId: 3, billingSheetId: null, laborHours: "2.00" }, // unbilled
    ];
    const zoneRecords: ZoneRecord[] = [
      { id: 1, repairLaborHours: "0.00" },
      { id: 2, repairLaborHours: "0.00" },
      { id: 3, repairLaborHours: "0.00" },
    ];
    const done = new Set<number>();

    runBackfill({
      candidateZoneIds: [1, 2],
      findings,
      zoneRecords,
      dryRun: false,
      done,
    });

    assert.equal(zoneRecords[0].repairLaborHours, "0.75");  // 0.25 + 0.50
    assert.equal(zoneRecords[1].repairLaborHours, "1.00");  // 1.00
    assert.equal(zoneRecords[2].repairLaborHours, "0.00");  // not in candidateZoneIds
  });
});
