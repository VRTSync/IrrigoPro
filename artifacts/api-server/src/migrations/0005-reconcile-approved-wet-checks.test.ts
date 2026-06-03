/**
 * Migration 0005 — finding-based reconciliation logic tests
 *
 * Tests the three fixture branches described in the task spec without
 * hitting the database. We extract the deriveTarget logic and test it
 * with in-memory fixture arrays.
 *
 * Branches:
 *   A) All findings converted (no pending) → "converted"
 *   B) Mixed (some converted, some pending) → "partially_converted"
 *   C) Zero convertedAt stamps (all pending) → "submitted"
 *   D) No findings at all → "converted"
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ── types matching what the migration queries from the ORM ──────────────────
interface Fixture {
  id: number;
  resolution: string;
  convertedAt: Date | null;
}

// ── inline the logic (mirrors the migration's deriveTarget function) ─────────
type TargetStatus = "converted" | "partially_converted" | "submitted";

function deriveTarget(findings: Fixture[]): TargetStatus {
  if (findings.length === 0) return "converted";
  const hasAnyConverted = findings.some(f => f.convertedAt != null);
  const hasPending = findings.some(f => f.resolution === "pending");
  if (hasAnyConverted && !hasPending) return "converted";
  if (hasAnyConverted && hasPending) return "partially_converted";
  return "submitted";
}

// ── fixtures ─────────────────────────────────────────────────────────────────
const NOW = new Date("2026-06-01T00:00:00Z");

const allConverted: Fixture[] = [
  { id: 1, resolution: "sent_to_estimate", convertedAt: NOW },
  { id: 2, resolution: "deferred_to_work_order", convertedAt: NOW },
  { id: 3, resolution: "repaired_in_field", convertedAt: NOW },
];

const mixed: Fixture[] = [
  { id: 4, resolution: "sent_to_estimate", convertedAt: NOW },
  { id: 5, resolution: "pending", convertedAt: null },
];

const allPending: Fixture[] = [
  { id: 6, resolution: "pending", convertedAt: null },
  { id: 7, resolution: "pending", convertedAt: null },
];

// ── tests ─────────────────────────────────────────────────────────────────────
describe("0005 migration — deriveTarget logic", () => {
  it("Branch A: all findings converted → 'converted'", () => {
    assert.equal(deriveTarget(allConverted), "converted");
  });

  it("Branch B: some converted, some pending → 'partially_converted'", () => {
    assert.equal(deriveTarget(mixed), "partially_converted");
  });

  it("Branch C: zero convertedAt stamps (all pending) → 'submitted'", () => {
    assert.equal(deriveTarget(allPending), "submitted");
  });

  it("Branch D: no findings at all → 'converted'", () => {
    assert.equal(deriveTarget([]), "converted");
  });

  it("single converted finding, no pending → 'converted'", () => {
    const findings: Fixture[] = [{ id: 8, resolution: "repaired_in_field", convertedAt: NOW }];
    assert.equal(deriveTarget(findings), "converted");
  });

  it("single pending finding → 'submitted'", () => {
    const findings: Fixture[] = [{ id: 9, resolution: "pending", convertedAt: null }];
    assert.equal(deriveTarget(findings), "submitted");
  });

  it("two converted + one pending → 'partially_converted'", () => {
    const findings: Fixture[] = [
      { id: 10, resolution: "sent_to_estimate", convertedAt: NOW },
      { id: 11, resolution: "deferred_to_work_order", convertedAt: NOW },
      { id: 12, resolution: "pending", convertedAt: null },
    ];
    assert.equal(deriveTarget(findings), "partially_converted");
  });
});
