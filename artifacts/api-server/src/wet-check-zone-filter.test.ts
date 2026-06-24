/**
 * Tests for isEmptyZone predicate and its integration with both wet-check PDF
 * renderers (internal and customer-facing).
 *
 * Coverage:
 *  (a) 100-zone wet check with only a handful inspected → only inspected rows
 *      and summary counts must reflect the filtered set.
 *  (b) A zone with only a reading (PSI/GPM) or only a note is kept.
 *  (c) A zone with findings is kept.
 *  (d) A bare not_checked zone with no data is dropped.
 *  (e) Both internal and customer PDFs exclude empty zones.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isEmptyZone } from './wet-check-zone-filter';
import { buildWetCheckHtml } from './wet-check-pdf';
import { buildWetCheckReportHtml, deriveHealthSummary } from './wet-check-report-pdf';
import type { WetCheckWithDetails, WetCheckZoneRecord, WetCheckFinding } from '@workspace/db/schema';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeZone(
  overrides: Partial<WetCheckZoneRecord & { findings: WetCheckFinding[] }> = {},
): WetCheckZoneRecord & { findings: WetCheckFinding[] } {
  return {
    id: 1,
    wetCheckId: 10,
    controllerLetter: 'A',
    zoneNumber: 1,
    status: 'not_checked',
    ranSuccessfully: null,
    observedPressure: null,
    observedFlow: null,
    repairLaborHours: null,
    notes: null,
    markedCompleteAt: null,
    findings: [],
    ...overrides,
  } as WetCheckZoneRecord & { findings: WetCheckFinding[] };
}

function makeFinding(overrides: Partial<WetCheckFinding> = {}): WetCheckFinding {
  return {
    id: 1,
    wetCheckId: 10,
    zoneRecordId: 1,
    issueType: 'head_replacement',
    issueGroup: 'quick_fix',
    partId: null,
    partName: null,
    quantity: 1,
    laborHours: null,
    resolution: 'pending',
    notes: null,
    noPartNeeded: false,
    techDisposition: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as unknown as WetCheckFinding;
}

function makeWc(
  overrides: Partial<WetCheckWithDetails> = {},
): WetCheckWithDetails {
  return {
    id: 42,
    customerId: 1,
    companyId: 1,
    customerName: 'Jane Customer',
    propertyAddress: '123 Main St',
    technicianName: 'Bob Tech',
    technicianId: 5,
    status: 'submitted',
    mode: 'service',
    startedAt: new Date('2025-06-01T10:00:00Z'),
    submittedAt: new Date('2025-06-01T12:00:00Z'),
    approvedAt: null,
    totalLaborHours: null,
    numControllers: 1,
    weather: null,
    notes: null,
    clientId: null,
    branchName: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    zoneRecords: [],
    photos: [],
    ...overrides,
  } as unknown as WetCheckWithDetails;
}

/** Build 100 seeded empty zones (simulating the default-100 creation pattern). */
function makeEmptyZoneSet(count = 100): (WetCheckZoneRecord & { findings: WetCheckFinding[] })[] {
  return Array.from({ length: count }, (_, i) =>
    makeZone({ id: i + 1, zoneNumber: i + 1, status: 'not_checked' }),
  );
}

// ─── isEmptyZone unit tests ───────────────────────────────────────────────────

describe('isEmptyZone', () => {
  it('(d) drops a bare not_checked zone with no data', () => {
    const zone = makeZone({ status: 'not_checked' });
    assert.equal(isEmptyZone(zone), true);
  });

  it('drops a zone with null/empty status and no data', () => {
    assert.equal(isEmptyZone(makeZone({ status: null as any })), true);
    assert.equal(isEmptyZone(makeZone({ status: '' as any })), true);
  });

  it('(c) keeps a zone with findings', () => {
    const zone = makeZone({ status: 'not_checked', findings: [makeFinding()] });
    assert.equal(isEmptyZone(zone), false);
  });

  it('keeps a zone with status checked_ok', () => {
    const zone = makeZone({ status: 'checked_ok' });
    assert.equal(isEmptyZone(zone), false);
  });

  it('keeps a zone with status checked_with_issues', () => {
    const zone = makeZone({ status: 'checked_with_issues' });
    assert.equal(isEmptyZone(zone), false);
  });

  it('keeps a zone with status not_applicable', () => {
    const zone = makeZone({ status: 'not_applicable' });
    assert.equal(isEmptyZone(zone), false);
  });

  it('(b) keeps a zone with only a PSI reading', () => {
    const zone = makeZone({ status: 'not_checked', observedPressure: '45.5' });
    assert.equal(isEmptyZone(zone), false);
  });

  it('(b) keeps a zone with only a GPM reading', () => {
    const zone = makeZone({ status: 'not_checked', observedFlow: '2.1' });
    assert.equal(isEmptyZone(zone), false);
  });

  it('(b) keeps a zone with only a note', () => {
    const zone = makeZone({ status: 'not_checked', notes: 'Valve appears corroded' });
    assert.equal(isEmptyZone(zone), false);
  });

  it('keeps a zone where ranSuccessfully is explicitly set to false', () => {
    const zone = makeZone({ status: 'not_checked', ranSuccessfully: false });
    assert.equal(isEmptyZone(zone), false);
  });

  it('keeps a zone where ranSuccessfully is explicitly set to true', () => {
    const zone = makeZone({ status: 'not_checked', ranSuccessfully: true });
    assert.equal(isEmptyZone(zone), false);
  });

  it('keeps a zone with non-zero repairLaborHours', () => {
    const zone = makeZone({ status: 'not_checked', repairLaborHours: '0.50' });
    assert.equal(isEmptyZone(zone), false);
  });

  it('drops a zone with repairLaborHours=0 (zero is treated as no data)', () => {
    const zone = makeZone({ status: 'not_checked', repairLaborHours: '0.00' });
    assert.equal(isEmptyZone(zone), true);
  });

  it('drops a zone with whitespace-only notes', () => {
    const zone = makeZone({ status: 'not_checked', notes: '   ' });
    assert.equal(isEmptyZone(zone), true);
  });
});

// ─── Internal PDF (buildWetCheckHtml) ────────────────────────────────────────

describe('buildWetCheckHtml — empty zone filtering', () => {
  it('(a) 100-zone wet check with 3 inspected renders only those 3 in summary counts', () => {
    const emptyZones = makeEmptyZoneSet(100);
    const inspectedZones = [
      makeZone({ id: 101, zoneNumber: 1, status: 'checked_ok' }),
      makeZone({ id: 102, zoneNumber: 2, status: 'checked_with_issues', findings: [makeFinding({ id: 10, zoneRecordId: 102 })] }),
      makeZone({ id: 103, zoneNumber: 3, status: 'checked_ok' }),
    ];
    const wc = makeWc({ zoneRecords: [...emptyZones, ...inspectedZones] as any });
    const html = buildWetCheckHtml(wc);

    // Summary bar: Total Zones should show 3, not 103
    // We look for ">3<" in the num div context; also assert ">100<" is absent in that position
    assert.ok(
      !html.includes('>100<') && !html.includes('>103<'),
      'Summary should not show 100 or 103 total zones',
    );
    // The total zones chip value
    const totalMatch = html.match(/<div class="num">(\d+)<\/div><div class="lbl">Total Zones/);
    assert.ok(totalMatch, 'Total Zones chip not found');
    assert.equal(totalMatch![1], '3', `Expected Total Zones=3, got ${totalMatch![1]}`);
  });

  it('(a) summary counts (OK/Issues/NA) reflect only filtered zones', () => {
    const emptyZones = makeEmptyZoneSet(97);
    const inspected = [
      makeZone({ id: 101, zoneNumber: 1, status: 'checked_ok' }),
      makeZone({ id: 102, zoneNumber: 2, status: 'checked_with_issues' }),
      makeZone({ id: 103, zoneNumber: 3, status: 'not_applicable' }),
    ];
    const wc = makeWc({ zoneRecords: [...emptyZones, ...inspected] as any });
    const html = buildWetCheckHtml(wc);

    const okMatch = html.match(/<div class="num">(\d+)<\/div><div class="lbl">Checked OK/);
    const issuesMatch = html.match(/<div class="num">(\d+)<\/div><div class="lbl">With Issues/);
    const naMatch = html.match(/<div class="num">(\d+)<\/div><div class="lbl">N\/A/);

    assert.ok(okMatch, 'Checked OK chip not found');
    assert.ok(issuesMatch, 'With Issues chip not found');
    assert.ok(naMatch, 'N/A chip not found');

    assert.equal(okMatch![1], '1', 'Expected 1 zone OK');
    assert.equal(issuesMatch![1], '1', 'Expected 1 zone with issues');
    assert.equal(naMatch![1], '1', 'Expected 1 zone N/A');
  });

  it('(d) empty zones do not appear as rows in the zone detail table', () => {
    const emptyZones = makeEmptyZoneSet(5);
    const inspected = makeZone({ id: 99, zoneNumber: 7, status: 'checked_ok', controllerLetter: 'B' });
    const wc = makeWc({ zoneRecords: [...emptyZones, inspected] as any });
    const html = buildWetCheckHtml(wc);

    // A-1 through A-5 are the empty zones and must not appear
    assert.ok(!html.includes('>A-1<'), 'Empty zone A-1 should not appear');
    assert.ok(!html.includes('>A-3<'), 'Empty zone A-3 should not appear');
    // The inspected zone B-7 must appear
    assert.ok(html.includes('B-7'), 'Inspected zone B-7 must appear');
  });

  it('(b) zone with only a note is included in the table', () => {
    const zone = makeZone({ id: 1, zoneNumber: 1, status: 'not_checked', notes: 'Valve sticky' });
    const wc = makeWc({ zoneRecords: [zone] as any });
    const html = buildWetCheckHtml(wc);
    assert.ok(html.includes('Valve sticky'), 'Note must appear in the zone row');
  });

  it('existing "No zones recorded" empty-state renders when all zones are empty', () => {
    const emptyZones = makeEmptyZoneSet(10);
    const wc = makeWc({ zoneRecords: emptyZones as any });
    const html = buildWetCheckHtml(wc);
    assert.ok(html.includes('No zones recorded') || html.includes('No zone data'), 'Empty-state message missing');
  });
});

// ─── Customer PDF (buildWetCheckReportHtml) ───────────────────────────────────

describe('buildWetCheckReportHtml — empty zone filtering', () => {
  it('(e) 100-zone wet check with 2 inspected → summary shows 2 zones checked', () => {
    const emptyZones = makeEmptyZoneSet(98);
    const inspected = [
      makeZone({ id: 101, zoneNumber: 5, status: 'checked_ok' }),
      makeZone({ id: 102, zoneNumber: 6, status: 'checked_with_issues', findings: [makeFinding({ id: 20, zoneRecordId: 102 })] }),
    ];
    const wc = makeWc({ zoneRecords: [...emptyZones, ...inspected] as any });
    const html = buildWetCheckReportHtml(wc);

    // "Zones Checked" chip must be 2, not 100
    assert.ok(!html.includes('>100<'), 'Should not show 100 zones checked');
    assert.ok(!html.includes('>98<'), 'Should not show 98 zones');

    const zoneCheckedMatch = html.match(/<div class="num">(\d+)<\/div><div class="lbl">Zones Checked/);
    assert.ok(zoneCheckedMatch, 'Zones Checked chip not found');
    assert.equal(zoneCheckedMatch![1], '2', `Expected 2 zones checked, got ${zoneCheckedMatch![1]}`);
  });

  it('(e) attention zone section lists only zones with real data', () => {
    const emptyZones = makeEmptyZoneSet(50);
    const attention = makeZone({ id: 99, zoneNumber: 3, controllerLetter: 'C', status: 'checked_with_issues' });
    const wc = makeWc({ zoneRecords: [...emptyZones, attention] as any });
    const html = buildWetCheckReportHtml(wc);

    assert.ok(html.includes('C-3'), 'Attention zone C-3 must appear');
    // Empty zones A-1..A-50 must not appear as attention zones
    assert.ok(!html.includes('A-1'), 'Empty zone A-1 must not appear in attention section');
  });

  it('(e) running-well section lists only inspected ok zones', () => {
    const emptyZones = makeEmptyZoneSet(10);
    const ok = makeZone({ id: 99, zoneNumber: 5, controllerLetter: 'B', status: 'checked_ok' });
    const wc = makeWc({ zoneRecords: [...emptyZones, ok] as any });
    const html = buildWetCheckReportHtml(wc);

    assert.ok(html.includes('B-5'), 'OK zone B-5 must appear in running-well section');
    assert.ok(!html.includes('A-1'), 'Empty zone A-1 must not appear in running-well section');
  });

  it('(b) zone with only a reading (PSI) is visible to health summary via deriveHealthSummary', () => {
    const notCheckedWithPressure = makeZone({
      id: 1, zoneNumber: 1,
      status: 'not_checked',
      observedPressure: '55.0',
    });
    const filtered = [notCheckedWithPressure].filter(z => !isEmptyZone(z));
    const summary = deriveHealthSummary(filtered as any);
    assert.equal(summary.total, 1, 'Zone with PSI reading must survive filtering');
  });

  it('(d) bare not_checked zones reduce to zero visible in customer PDF', () => {
    const emptyZones = makeEmptyZoneSet(5);
    const wc = makeWc({ zoneRecords: emptyZones as any });
    const html = buildWetCheckReportHtml(wc);

    const zoneCheckedMatch = html.match(/<div class="num">(\d+)<\/div><div class="lbl">Zones Checked/);
    assert.ok(zoneCheckedMatch, 'Zones Checked chip not found');
    assert.equal(zoneCheckedMatch![1], '0', 'All empty zones should be filtered out');
  });
});
