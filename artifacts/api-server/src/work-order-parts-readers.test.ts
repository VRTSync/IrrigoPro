import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolveTicketPartsSubtotal, ticketItemRowTotal } from './pdf-view-model';
import { deriveCompletionPartsCost } from './lib/work-order-parts';

describe('work-order item-authoritative parts readers', () => {
  const routesSource = readFileSync(fileURLToPath(new URL('./routes/routes.ts', import.meta.url)), 'utf8');

  it('Bill Separately resolves $500 from items when the legacy header is zero', () => {
    const items = [{ totalPrice: '500.00', partPrice: '500.00', quantity: 1 }];
    const resolved = resolveTicketPartsSubtotal(
      ['500.00', '0.00'],
      items.map((item) => ({ rowTotal: ticketItemRowTotal(item) })),
    );
    assert.equal(resolved.value, 500);
  });

  it('completion derives a non-empty item total from a submitted zero', () => {
    const result = deriveCompletionPartsCost({
      submittedTotalPartsCost: 0,
      incomingItems: [{ quantity: 2, partPrice: '125.00', totalPrice: '250.00' }],
      persistedItems: [],
      skipReplace: false,
    });
    assert.deepEqual(result, {
      partsCost: 250,
      derivedFromSubmittedItems: true,
      itemsTotal: 250,
    });
  });

  it('routes use the shared item-authoritative resolver for QuickBooks and Bill Separately', () => {
    const calls = routesSource.match(/resolveTicketPartsSubtotal\(/g) ?? [];
    assert.ok(calls.length >= 2);
    assert.match(routesSource, /workOrderItemsForQb/);
    assert.match(routesSource, /workOrderItemsForStandalone/);
  });

  it('bulk replacement persists both parts columns outside the labor-rate gate', () => {
    const start = routesSource.indexOf('const computedPartsCost = itemsToInsert.reduce');
    const gate = routesSource.indexOf('if (freshWo && freshWo.appliedLaborRate)', start);
    const beforeGate = routesSource.slice(start, gate);
    assert.match(beforeGate, /totalPartsCost: computedPartsCost\.toFixed\(2\)/);
    assert.match(beforeGate, /partsSubtotal: computedPartsCost\.toFixed\(2\)/);
  });

  it('completion emits the required derived-parts audit line', () => {
    assert.match(
      routesSource,
      /\[AUDIT\] work_order_completion_parts_derived workOrderId=\$\{workOrderId\} /,
    );
    assert.match(routesSource, /formValue=0 itemsTotal=\$\{completionParts\.itemsTotal\.toFixed\(2\)\}/);
  });
});