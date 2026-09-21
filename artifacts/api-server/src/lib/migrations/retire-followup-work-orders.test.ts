// Tests for the retire-followup-work-orders-v1 migration.
//
// All tests use in-memory deps — no shared dev DB. What matters here is the
// blast radius: the migration may only ever write the three named phantoms,
// must abort before writing when the database does not look the way the
// constants were verified against, and must leave the genuine follow-up
// (the keeper) and any newly-discovered follow-up-linked rows untouched.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildCancellationAuditEvent,
  buildRetireFollowUpPreview,
  preflightNamedRecords,
  resolveRetireFollowUpStatus,
  runRetireFollowUpMigration,
  extraFollowUpRows,
  EXPECTED_COMPANY_ID,
  KEEPER_WORK_ORDER_NUMBER,
  PHANTOM_WORK_ORDER_NUMBERS,
  type FollowUpWorkOrderRow,
  type RetireFollowUpDeps,
} from "./retire-followup-work-orders";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const [PHANTOM_A, PHANTOM_B, PHANTOM_C] = PHANTOM_WORK_ORDER_NUMBERS;

function makeRow(overrides: Partial<FollowUpWorkOrderRow> & { workOrderNumber: string }): FollowUpWorkOrderRow {
  return {
    id: 100,
    status: "pending",
    companyId: EXPECTED_COMPANY_ID,
    customerName: "Woodglenn Squares HOA",
    parentWorkOrderId: 900,
    parentWorkOrderNumber: "WO-parent",
    ...overrides,
  };
}

function namedFixture(overrides: Record<string, Partial<FollowUpWorkOrderRow>> = {}): FollowUpWorkOrderRow[] {
  return [
    makeRow({ workOrderNumber: PHANTOM_A, id: 101, parentWorkOrderNumber: "WO-parent-a", ...overrides[PHANTOM_A] }),
    makeRow({ workOrderNumber: PHANTOM_B, id: 102, parentWorkOrderNumber: "WO-parent-b", ...overrides[PHANTOM_B] }),
    makeRow({ workOrderNumber: PHANTOM_C, id: 103, parentWorkOrderNumber: "WO-parent-c", ...overrides[PHANTOM_C] }),
    makeRow({
      workOrderNumber: KEEPER_WORK_ORDER_NUMBER,
      id: 104,
      status: "assigned",
      parentWorkOrderNumber: "WO-1783955816671-314",
      ...overrides[KEEPER_WORK_ORDER_NUMBER],
    }),
  ];
}

/**
 * In-memory deps over a mutable row set. Every write is recorded so a test can
 * assert not only the end state but that a forbidden row was never addressed.
 */
function makeDeps(opts: {
  named: FollowUpWorkOrderRow[];
  linked?: FollowUpWorkOrderRow[];
  failFor?: Set<string>;
  zeroRowsFor?: Set<string>;
}) {
  const rows = new Map(opts.named.map((r) => [r.workOrderNumber, { ...r }]));
  const writes: string[] = [];
  // The fake records the REAL audit payload the DB path writes, so the
  // assertions below are about the production contract, not about the double.
  const audits: Array<{ workOrderNumber: string; event: ReturnType<typeof buildCancellationAuditEvent> }> = [];
  let markedDone = false;

  const deps: RetireFollowUpDeps = {
    getNamedRecords: async () => [...rows.values()].map((r) => ({ ...r })),
    getFollowUpLinkedRecords: async () => (opts.linked ?? []).map((r) => ({ ...r })),
    cancelPhantom: async (row) => {
      writes.push(row.workOrderNumber);
      if (opts.failFor?.has(row.workOrderNumber)) {
        throw new Error(`simulated write failure for ${row.workOrderNumber}`);
      }
      if (opts.zeroRowsFor?.has(row.workOrderNumber)) {
        return { rowsAffected: 0 };
      }
      const stored = rows.get(row.workOrderNumber)!;
      stored.status = "cancelled";
      audits.push({ workOrderNumber: row.workOrderNumber, event: buildCancellationAuditEvent(row) });
      return { rowsAffected: 1 };
    },
    reReadNamedRecords: async () => [...rows.values()].map((r) => ({ ...r })),
    markDone: async () => { markedDone = true; },
  };

  return {
    deps,
    rows,
    writes,
    audits,
    getMarkedDone: () => markedDone,
  };
}

const noopLog = () => {};

// ── preflight: abort conditions ───────────────────────────────────────────────

describe("retire-followup-work-orders — preflight abort conditions", () => {
  it("passes on the expected production shape", () => {
    const result = preflightNamedRecords(namedFixture());
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.phantoms.length, 3);
      assert.equal(result.keeper.workOrderNumber, KEEPER_WORK_ORDER_NUMBER);
    }
  });

  it("aborts when fewer than three phantoms resolve", () => {
    const named = namedFixture().filter((r) => r.workOrderNumber !== PHANTOM_B);
    const result = preflightNamedRecords(named);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.errors.some((e) => e.includes(PHANTOM_B)));
      assert.ok(result.errors.some((e) => /Only 2 of 3/.test(e)));
    }
  });

  it("aborts when a phantom is in a status other than pending/assigned", () => {
    const result = preflightNamedRecords(namedFixture({ [PHANTOM_C]: { status: "billed" } }));
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.errors.some((e) => e.includes(PHANTOM_C) && /billed/.test(e)));
    }
  });

  it("accepts an already-cancelled phantom (idempotent re-run, not an abort)", () => {
    const result = preflightNamedRecords(namedFixture({ [PHANTOM_A]: { status: "cancelled" } }));
    assert.equal(result.ok, true);
  });

  it("aborts when a resolved row belongs to another company", () => {
    const result = preflightNamedRecords(namedFixture({ [PHANTOM_A]: { companyId: 7 } }));
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.errors.some((e) => e.includes(PHANTOM_A) && /company 7/.test(e)));
    }
  });

  it("aborts when the keeper's company is wrong, even though the keeper is never written", () => {
    const result = preflightNamedRecords(
      namedFixture({ [KEEPER_WORK_ORDER_NUMBER]: { companyId: 9 } }),
    );
    assert.equal(result.ok, false);
  });

  it("aborts when the keeper is no longer live", () => {
    // The keeper is the proof that the outstanding work is still owed. If
    // something already moved it, this is not the database these constants
    // were verified against — abort rather than cancel around it.
    for (const status of ["cancelled", "work_completed", "billed", null]) {
      const result = preflightNamedRecords(
        namedFixture({ [KEEPER_WORK_ORDER_NUMBER]: { status } as Partial<FollowUpWorkOrderRow> }),
      );
      assert.equal(result.ok, false, `keeper status "${status}" must abort`);
      if (!result.ok) {
        assert.ok(result.errors.some((e) => e.includes(KEEPER_WORK_ORDER_NUMBER)));
      }
    }
  });

  it("aborts when the keeper does not resolve", () => {
    const named = namedFixture().filter((r) => r.workOrderNumber !== KEEPER_WORK_ORDER_NUMBER);
    const result = preflightNamedRecords(named);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.errors.some((e) => e.includes(KEEPER_WORK_ORDER_NUMBER)));
    }
  });
});

// ── run: abort conditions write nothing ───────────────────────────────────────

describe("retire-followup-work-orders — run aborts without writing", () => {
  for (const [label, named] of [
    ["fewer than three phantoms resolve", namedFixture().filter((r) => r.workOrderNumber !== PHANTOM_A)],
    ["a phantom is in an unexpected status", namedFixture({ [PHANTOM_B]: { status: "work_completed" } })],
    ["a phantom belongs to another company", namedFixture({ [PHANTOM_C]: { companyId: 42 } })],
    ["the keeper is missing", namedFixture().filter((r) => r.workOrderNumber !== KEEPER_WORK_ORDER_NUMBER)],
    ["the keeper is no longer live", namedFixture({ [KEEPER_WORK_ORDER_NUMBER]: { status: "cancelled" } })],
  ] as Array<[string, FollowUpWorkOrderRow[]]>) {
    it(`aborts at preflight when ${label}`, async () => {
      const h = makeDeps({ named });
      const emits: Array<{ step: string; status: string }> = [];
      const results = await runRetireFollowUpMigration(h.deps, (e) => emits.push(e), noopLog);

      assert.equal(results.length, 1, "an aborted run reports only the failed preflight");
      assert.equal(results[0].id, "preflight");
      assert.equal(results[0].status, "failed");
      assert.equal(h.writes.length, 0, "no record may be written when preflight fails");
      assert.equal(h.audits.length, 0);
      assert.equal(h.getMarkedDone(), false);
      assert.ok(emits.some((e) => e.step === "preflight" && e.status === "failed"));
    });
  }
});

// ── run: happy path ───────────────────────────────────────────────────────────

describe("retire-followup-work-orders — cancels exactly the three phantoms", () => {
  it("cancels each phantom, audits it, and never writes the keeper", async () => {
    const h = makeDeps({ named: namedFixture() });
    const results = await runRetireFollowUpMigration(h.deps, () => {}, noopLog);

    for (const number of PHANTOM_WORK_ORDER_NUMBERS) {
      const step = results.find((r) => r.id === `cancel_${number}`)!;
      assert.equal(step.status, "success", `${number} should be cancelled`);
      assert.equal(step.rowsAffected, 1);
      assert.equal(h.rows.get(number)!.status, "cancelled");
    }

    assert.deepEqual([...h.writes].sort(), [...PHANTOM_WORK_ORDER_NUMBERS].sort());
    assert.equal(h.audits.length, 3, "one audit entry per cancelled record");
    for (const audit of h.audits) {
      assert.equal(audit.event.severity, "warning");
      assert.equal(audit.event.action, "work_order.cancelled");
      assert.equal(audit.event.targetType, "work_order");
      assert.match(audit.event.summary ?? "", /parent work order WO-parent-/);
    }

    // The keeper is reported as an explicit no-op and left exactly as found.
    const keeperStep = results.find((r) => r.id === `keep_${KEEPER_WORK_ORDER_NUMBER}`)!;
    assert.equal(keeperStep.status, "skipped");
    assert.equal(h.rows.get(KEEPER_WORK_ORDER_NUMBER)!.status, "assigned");
    assert.ok(!h.writes.includes(KEEPER_WORK_ORDER_NUMBER), "the keeper must never be written");

    assert.equal(results.find((r) => r.id === "verify")!.status, "success");
    assert.ok(h.getMarkedDone());
  });

  it("re-run reports the three cancel steps as skipped and changes nothing", async () => {
    const h = makeDeps({ named: namedFixture() });
    await runRetireFollowUpMigration(h.deps, () => {}, noopLog);
    const writesAfterFirstRun = h.writes.length;

    const results = await runRetireFollowUpMigration(h.deps, () => {}, noopLog);
    for (const number of PHANTOM_WORK_ORDER_NUMBERS) {
      assert.equal(results.find((r) => r.id === `cancel_${number}`)!.status, "skipped");
    }
    assert.equal(h.writes.length, writesAfterFirstRun, "the re-run must write nothing");
    assert.equal(h.audits.length, 3, "the re-run must not add audit entries");
    assert.equal(h.rows.get(KEEPER_WORK_ORDER_NUMBER)!.status, "assigned");
  });

  it("a guarded update that matches 0 rows fails its step and blocks the completion marker", async () => {
    const h = makeDeps({ named: namedFixture(), zeroRowsFor: new Set([PHANTOM_B]) });
    const results = await runRetireFollowUpMigration(h.deps, () => {}, noopLog);

    assert.equal(results.find((r) => r.id === `cancel_${PHANTOM_B}`)!.status, "failed");
    assert.equal(results.find((r) => r.id === `cancel_${PHANTOM_A}`)!.status, "success");
    assert.equal(h.getMarkedDone(), false);
  });

  it("a post-write re-read that disagrees with the run fails the verify step", async () => {
    const h = makeDeps({ named: namedFixture() });
    const deps: RetireFollowUpDeps = {
      ...h.deps,
      // Fresh read says one phantom is still pending — the run's own report
      // is not proof, so this must surface as a failure.
      reReadNamedRecords: async () =>
        (await h.deps.reReadNamedRecords()).map((row) =>
          row.workOrderNumber === PHANTOM_C ? { ...row, status: "pending" } : row,
        ),
    };
    const results = await runRetireFollowUpMigration(deps, () => {}, noopLog);
    const verify = results.find((r) => r.id === "verify")!;
    assert.equal(verify.status, "failed");
    assert.match(verify.error ?? "", new RegExp(PHANTOM_C));
    assert.equal(h.getMarkedDone(), false);
  });

  it("fails verify when the keeper changed during the run", async () => {
    const h = makeDeps({ named: namedFixture() });
    const deps: RetireFollowUpDeps = {
      ...h.deps,
      reReadNamedRecords: async () =>
        (await h.deps.reReadNamedRecords()).map((row) =>
          row.workOrderNumber === KEEPER_WORK_ORDER_NUMBER ? { ...row, status: "cancelled" } : row,
        ),
    };
    const results = await runRetireFollowUpMigration(deps, () => {}, noopLog);
    const verify = results.find((r) => r.id === "verify")!;
    assert.equal(verify.status, "failed");
    assert.match(verify.error ?? "", new RegExp(KEEPER_WORK_ORDER_NUMBER));
  });
});

// ── Extra follow-up-linked rows: reported, never written, never blocking ──────

describe("retire-followup-work-orders — unenumerated follow-up rows", () => {
  const extras = [
    makeRow({ workOrderNumber: "WO-9999999999999-111", id: 501, status: "pending", parentWorkOrderNumber: "WO-parent-x" }),
    makeRow({ workOrderNumber: "WO-8888888888888-222", id: 502, status: "assigned", companyId: 3, parentWorkOrderNumber: "WO-parent-y" }),
  ];

  it("extraFollowUpRows excludes the four named records", () => {
    const linked = [...namedFixture(), ...extras];
    const found = extraFollowUpRows(linked);
    assert.deepEqual(found.map((r) => r.workOrderNumber), extras.map((r) => r.workOrderNumber));
  });

  it("the run reports them and writes nothing to them", async () => {
    const h = makeDeps({ named: namedFixture(), linked: [...namedFixture(), ...extras] });
    const results = await runRetireFollowUpMigration(h.deps, () => {}, noopLog);

    for (const extra of extras) {
      const step = results.find((r) => r.id === `finding_extra_${extra.workOrderNumber}`)!;
      assert.ok(step, `${extra.workOrderNumber} should be reported as a finding`);
      assert.equal(step.status, "skipped");
      assert.equal(step.rowsAffected, 0);
      assert.ok(!h.writes.includes(extra.workOrderNumber), "a discovered extra must never be written");
    }

    // Discovering extras must not abort or fail the run.
    assert.equal(results.find((r) => r.id === "verify")!.status, "success");
    assert.ok(h.getMarkedDone());
    assert.deepEqual([...h.writes].sort(), [...PHANTOM_WORK_ORDER_NUMBERS].sort());
  });

  it("a failing enumeration does not fail the run", async () => {
    const h = makeDeps({ named: namedFixture() });
    const deps: RetireFollowUpDeps = {
      ...h.deps,
      getFollowUpLinkedRecords: async () => { throw new Error("column dropped"); },
    };
    const results = await runRetireFollowUpMigration(deps, () => {}, noopLog);
    assert.equal(results.find((r) => r.id === "verify")!.status, "success");
    assert.ok(h.getMarkedDone());
  });
});

// ── The audit payload the DB path actually writes ─────────────────────────────

describe("retire-followup-work-orders — cancellation audit payload", () => {
  it("writes a work_order.cancelled warning against the work order, naming the retirement and parent", () => {
    const event = buildCancellationAuditEvent(
      makeRow({ workOrderNumber: PHANTOM_A, id: 101, status: "pending", parentWorkOrderNumber: "WO-parent-a" }),
    );
    assert.equal(event.action, "work_order.cancelled");
    assert.equal(event.actionType, "data_repair");
    assert.equal(event.targetType, "work_order");
    assert.equal(event.targetId, "101", "targetId must be the work order id the Activity tab queries by");
    assert.equal(event.severity, "warning");
    assert.equal(event.actorLabel, "super_admin_migration");
    assert.equal(event.actorCompanyId, EXPECTED_COMPANY_ID);
    assert.match(event.summary ?? "", /retire-followup-work-orders-v1/);
    assert.match(event.summary ?? "", /Task #2028/);
    assert.match(event.summary ?? "", /parent work order WO-parent-a/);
    assert.deepEqual(event.details, {
      migrationId: "retire-followup-work-orders-v1",
      taskRef: "2028",
      workOrderNumber: PHANTOM_A,
      previousStatus: "pending",
      newStatus: "cancelled",
      parentWorkOrderId: 900,
      parentWorkOrderNumber: "WO-parent-a",
    });
  });

  it("falls back to the parent id when the parent number cannot be resolved", () => {
    const event = buildCancellationAuditEvent(
      makeRow({ workOrderNumber: PHANTOM_B, id: 102, parentWorkOrderId: 77, parentWorkOrderNumber: null }),
    );
    assert.match(event.summary ?? "", /parent work order #77/);
  });
});

// ── preview ───────────────────────────────────────────────────────────────────

describe("retire-followup-work-orders — preview", () => {
  const extras = [
    makeRow({ workOrderNumber: "WO-7777777777777-333", id: 601, status: "pending", companyId: 4, parentWorkOrderNumber: "WO-parent-z" }),
  ];

  it("resolves all four named records and names the one that is left alone", () => {
    const preview = buildRetireFollowUpPreview(namedFixture(), namedFixture());
    for (const number of PHANTOM_WORK_ORDER_NUMBERS) {
      const step = preview.steps.find((s) => s.id === `cancel_${number}`)!;
      assert.ok(step, `${number} should appear in the preview`);
      assert.match(step.description, /company 1/);
      assert.match(step.description, /"cancelled"/);
    }
    const keeperStep = preview.steps.find((s) => s.id === `keep_${KEEPER_WORK_ORDER_NUMBER}`)!;
    assert.match(keeperStep.description, /NOT modified/);
    assert.equal(preview.orphanRows.phantomsToCancel, 3);
    assert.equal(preview.orphanRows.extraFollowUpLinked, 0);
  });

  it("lists every other follow-up-linked row as a distinct finding with number, status, company and parent", () => {
    const preview = buildRetireFollowUpPreview(namedFixture(), [...namedFixture(), ...extras]);
    const finding = preview.steps.find((s) => s.id === "finding_extra_WO-7777777777777-333")!;
    assert.ok(finding, "the extra row should be a distinct finding step");
    assert.match(finding.description, /WO-7777777777777-333/);
    assert.match(finding.description, /status pending/);
    assert.match(finding.description, /company 4/);
    assert.match(finding.description, /parent WO-parent-z/);
    assert.match(finding.description, /does NOT cancel/);
    assert.equal(preview.orphanRows.extraFollowUpLinked, 1);
    assert.ok(preview.warnings.some((w) => /REPORTED ONLY/.test(w)));
  });

  it("surfaces the abort conditions it would hit", () => {
    const preview = buildRetireFollowUpPreview(
      namedFixture({ [PHANTOM_A]: { status: "billed" } }),
      [],
    );
    assert.ok(preview.warnings.some((w) => w.startsWith("ABORT CONDITION")));
  });

  it("already-cancelled phantoms are counted as skips, not writes", () => {
    const preview = buildRetireFollowUpPreview(
      namedFixture({
        [PHANTOM_A]: { status: "cancelled" },
        [PHANTOM_B]: { status: "cancelled" },
        [PHANTOM_C]: { status: "cancelled" },
      }),
      [],
    );
    assert.equal(preview.orphanRows.phantomsToCancel, 0);
    assert.equal(preview.orphanRows.phantomsAlreadyCancelled, 3);
  });
});

// ── check ─────────────────────────────────────────────────────────────────────

describe("retire-followup-work-orders — check", () => {
  it("not started when the phantoms are still active and no marker exists", () => {
    assert.deepEqual(resolveRetireFollowUpStatus(namedFixture(), null), { state: "not_started" });
  });

  it("partially applied when a marker exists but a phantom is still active", () => {
    const status = resolveRetireFollowUpStatus(
      namedFixture({
        [PHANTOM_A]: { status: "cancelled" },
        [PHANTOM_B]: { status: "cancelled" },
      }),
      "2026-09-16T00:00:00.000Z",
    );
    assert.equal(status.state, "partially_applied");
  });

  it("completed once every phantom is cancelled", () => {
    const status = resolveRetireFollowUpStatus(
      namedFixture({
        [PHANTOM_A]: { status: "cancelled" },
        [PHANTOM_B]: { status: "cancelled" },
        [PHANTOM_C]: { status: "cancelled" },
      }),
      "2026-09-16T00:00:00.000Z",
    );
    assert.deepEqual(status, { state: "completed", completedAt: "2026-09-16T00:00:00.000Z" });
  });

  it("not started in a database that has none of these records", () => {
    assert.deepEqual(resolveRetireFollowUpStatus([], null), { state: "not_started" });
  });
});
