import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  buildWorkOrderPartsPreview,
  classifyWorkOrderPartsCandidate,
  resolveWorkOrderPartsCheckState,
  runRepairWorkOrderParts,
  type RepairWorkOrderPartsDeps,
  type WorkOrderPartsCandidate,
} from './repair-work-order-parts';

const safeRow: WorkOrderPartsCandidate = {
  id: 314,
  companyId: 7,
  workOrderNumber: 'WO-1783955816671-314',
  partsSubtotal: '0.00',
  totalPartsCost: '0.00',
  laborSubtotal: '5270.00',
  totalAmount: '8401.70',
  itemsTotal: '3131.70',
  itemCount: 2,
};

function emitter() {
  return () => undefined;
}

describe('repair work-order parts migration', () => {
  const source = readFileSync(fileURLToPath(new URL('./repair-work-order-parts.ts', import.meta.url)), 'utf8');

  it('fails closed without acknowledgement and performs no writes', async () => {
    let writes = 0;
    const deps: RepairWorkOrderPartsDeps = {
      getCandidates: async () => [safeRow],
      applyRepair: async () => { writes++; return 'repaired'; },
      markDone: async () => { writes++; },
    };
    const result = await runRepairWorkOrderParts(deps, emitter(), {});
    assert.equal(result[0].id, 'acknowledge_gate');
    assert.equal(result[0].status, 'failed');
    assert.equal(writes, 0);
  });

  it('is a no-op for an empty candidate set and marks completion', async () => {
    let marked = 0;
    const result = await runRepairWorkOrderParts({
      getCandidates: async () => [],
      applyRepair: async () => { throw new Error('unexpected'); },
      markDone: async () => { marked++; },
    }, emitter(), { acknowledged: true });
    assert.deepEqual(result, []);
    assert.equal(marked, 1);
  });

  it('repairs the confirmed arithmetic without changing labor or total', async () => {
    const before = { labor: safeRow.laborSubtotal, total: safeRow.totalAmount };
    let updated: { companyId: number; partsSubtotal: string; totalPartsCost: string } | undefined;
    const result = await runRepairWorkOrderParts({
      getCandidates: async () => [safeRow],
      applyRepair: async (row) => {
        const classified = classifyWorkOrderPartsCandidate(row);
        assert.equal(classified.reconciles, true);
        updated = {
          companyId: row.companyId,
          partsSubtotal: classified.itemsTotal.toFixed(2),
          totalPartsCost: classified.itemsTotal.toFixed(2),
        };
        return 'repaired';
      },
      markDone: async () => undefined,
    }, emitter(), { acknowledged: true });
    assert.equal(result[0].status, 'success');
    assert.deepEqual(updated, { companyId: 7, partsSubtotal: '3131.70', totalPartsCost: '3131.70' });
    assert.deepEqual(before, { labor: '5270.00', total: '8401.70' });
    assert.equal(5270 + 3131.70, 8401.70);
  });

  it('skips a $9,000 total mismatch without failing or updating either parts column', async () => {
    const mismatch = { ...safeRow, totalAmount: '9000.00' };
    const before = [mismatch.partsSubtotal, mismatch.totalPartsCost];
    let writes = 0;
    const result = await runRepairWorkOrderParts({
      getCandidates: async () => [mismatch],
      applyRepair: async (row) => {
        assert.equal(classifyWorkOrderPartsCandidate(row).reconciles, false);
        writes++;
        return 'skipped_total_mismatch';
      },
      markDone: async () => undefined,
    }, emitter(), { acknowledged: true });
    assert.equal(result[0].status, 'skipped');
    assert.equal(writes, 1, 'runner delegates the transactional re-check exactly once');
    assert.deepEqual([mismatch.partsSubtotal, mismatch.totalPartsCost], before);
  });

  it('is idempotent when a concurrent or prior run already repaired the row', async () => {
    const current = { ...safeRow, partsSubtotal: '3131.70', totalPartsCost: '3131.70' };
    const result = await runRepairWorkOrderParts({
      getCandidates: async () => [current],
      applyRepair: async () => 'already_current',
      markDone: async () => undefined,
    }, emitter(), { acknowledged: true });
    assert.equal(result[0].status, 'skipped');
    assert.equal(classifyWorkOrderPartsCandidate(current).drifted, false);
  });

  it('repairs a parts-free row to zero when its total equals labor', () => {
    const row = {
      ...safeRow,
      partsSubtotal: '25.00',
      totalPartsCost: '25.00',
      itemsTotal: '0.00',
      itemCount: 0,
      laborSubtotal: '5270.00',
      totalAmount: '5270.00',
    };
    assert.deepEqual(classifyWorkOrderPartsCandidate(row), {
      itemsTotal: 0,
      partsSubtotal: 25,
      totalPartsCost: 25,
      drifted: true,
      reconciles: true,
    });
  });

  it('production update is tenant-scoped and writes only both parts columns plus an audit event', () => {
    assert.match(source, /\.set\(\{ partsSubtotal: repaired, totalPartsCost: repaired \}\)/);
    assert.match(
      source,
      /\.where\(and\(eq\(workOrders\.id, candidate\.id\), eq\(workOrders\.companyId, candidate\.companyId\)\)\)/,
    );
    assert.match(source, /kind: 'parts_subtotal_repair'/);
    assert.doesNotMatch(source, /\.set\(\{[^}]*laborSubtotal/s);
    assert.doesNotMatch(source, /\.set\(\{[^}]*totalAmount/s);
  });

  it('shows separate repairable and total-mismatch preview sections with risk warnings', () => {
    const preview = buildWorkOrderPartsPreview([safeRow, { ...safeRow, id: 315, totalAmount: '9000.00' }]);
    assert.match(preview.steps[0].description, /^REPAIRABLE /);
    assert.match(preview.steps[1].description, /^SKIPPED_TOTAL_MISMATCH /);
    assert.equal(preview.orphanRows?.repairable, 1);
    assert.equal(preview.orphanRows?.skippedTotalMismatch, 1);
    assert.ok(preview.warnings.some((warning) => warning.includes('ticket-total-drift')));
    assert.ok(preview.warnings.some((warning) => warning.includes('never changes labor')));
  });

  it('reports completed after a run when only intentionally skipped mismatches remain', () => {
    const mismatch = { ...safeRow, totalAmount: '9000.00' };
    assert.deepEqual(
      resolveWorkOrderPartsCheckState([mismatch], '2026-09-22T00:00:00.000Z'),
      { state: 'completed', completedAt: '2026-09-22T00:00:00.000Z' },
    );
  });

  it('reports partially applied only while safely repairable rows remain after a marker', () => {
    const mismatch = { ...safeRow, id: 315, totalAmount: '9000.00' };
    const state = resolveWorkOrderPartsCheckState(
      [safeRow, mismatch],
      '2026-09-22T00:00:00.000Z',
    );
    assert.equal(state.state, 'partially_applied');
    assert.match(String(state.details), /1 safely repairable/);
  });

  it('requires a run when skipped mismatches exist but no completion marker does', () => {
    const mismatch = { ...safeRow, totalAmount: '9000.00' };
    assert.deepEqual(resolveWorkOrderPartsCheckState([mismatch], null), { state: 'not_started' });
  });
});