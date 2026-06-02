/**
 * wcb-zone-photo-groups.test.ts  (Task #854)
 *
 * Unit tests for buildWcbZonePhotoGroups — the pure assembler that routes
 * wet-check photos into per-zone, per-finding buckets for the WCB PDF ticket.
 *
 * Also includes a static-source guard that verifies zonePhotoGroups is
 * threaded through to ticketPageWCB in pdf-helpers.ts.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildWcbZonePhotoGroups } from './wcb-zone-photo-groups';
import type { WetCheckBillingView } from './wet-check-billing-view';

// ── shared fixture helpers ─────────────────────────────────────────────────────

function makeLineItem(findingId: number, issueDisplayLabel: string, opts: Partial<{
  noPartNeeded: boolean; partsTotal: string;
}> = {}) {
  return {
    findingId,
    issueType: 'head_replacement',
    issueDisplayLabel,
    partName: 'Rotor Head',
    quantity: 1,
    unitPrice: '10.00',
    partsTotal: opts.partsTotal ?? '10.00',
    laborHours: '0.50',
    laborTotal: '40.00',
    lineTotal: '50.00',
    noPartNeeded: opts.noPartNeeded ?? false,
    notes: null,
    findingPhotoUrls: [] as string[],
  };
}

function makeView(zones: WetCheckBillingView['zones']): WetCheckBillingView {
  return {
    wetCheckBillingId: 42,
    billingNumber: 'WCB-2026-001',
    customerId: 10,
    customerName: 'Drip Corp',
    workDate: new Date('2026-05-15').toISOString(),
    laborRate: '80.00',
    inspection: {
      wetCheckId: 5,
      technicianName: 'Jane Smith',
      inspectionDate: new Date('2026-05-15').toISOString(),
      propertyAddress: '99 Drip Lane',
      weather: 'Sunny',
      notes: null,
    },
    zones,
    repairsSummary: '1 repair across 1 zone',
    partsSubtotal: '10.00',
    laborSubtotal: '40.00',
    grandTotal: '50.00',
    totalsSource: 'live_derive',
    zonesHaveStaleLaborData: false,
  };
}

// ── two-zone fixture ───────────────────────────────────────────────────────────

const ZONE_A1 = {
  zoneRecordId: 1,
  controllerLetter: 'A',
  zoneNumber: 1,
  zoneLabel: 'A-1',
  repairLaborHours: '1.00',
  repairLaborManuallySet: false,
  lineItems: [makeLineItem(1, 'Head Replacement'), makeLineItem(2, 'Adjustment', { noPartNeeded: true })],
  zonePartsSubtotal: '10.00',
  zoneLaborSubtotal: '80.00',
  zoneTotal: '90.00',
  zonePhotoUrls: [],
};

const ZONE_B2 = {
  zoneRecordId: 2,
  controllerLetter: 'B',
  zoneNumber: 2,
  zoneLabel: 'B-2',
  repairLaborHours: '0.50',
  repairLaborManuallySet: false,
  lineItems: [makeLineItem(3, 'Valve Repair')],
  zonePartsSubtotal: '20.00',
  zoneLaborSubtotal: '40.00',
  zoneTotal: '60.00',
  zonePhotoUrls: [],
};

const TWO_ZONE_VIEW = makeView([ZONE_A1, ZONE_B2]);

// ── tests ─────────────────────────────────────────────────────────────────────

describe('buildWcbZonePhotoGroups — empty / degenerate cases', () => {
  it('returns [] when photos array is empty', () => {
    const result = buildWcbZonePhotoGroups([], TWO_ZONE_VIEW);
    assert.deepEqual(result, []);
  });

  it('returns [] when view has no zones', () => {
    const emptyView = makeView([]);
    const result = buildWcbZonePhotoGroups(
      [{ url: 'data:image/jpeg;base64,AAA', zoneRecordId: 10, findingId: 1 }],
      emptyView,
    );
    assert.deepEqual(result, []);
  });

  it('excludes photos with url empty string', () => {
    const result = buildWcbZonePhotoGroups(
      [{ url: '', zoneRecordId: 10, findingId: 1 }],
      TWO_ZONE_VIEW,
    );
    assert.equal(result.length, 0);
  });
});

describe('buildWcbZonePhotoGroups — finding-linked photos', () => {
  it('routes a finding-linked photo to the correct zone and finding group', () => {
    const photos = [
      { url: 'data:image/jpeg;base64,PHOTO_A1_F1', zoneRecordId: 10, findingId: 1 },
    ];
    const result = buildWcbZonePhotoGroups(photos, TWO_ZONE_VIEW);

    assert.equal(result.length, 1);
    assert.equal(result[0].zoneLabel, 'A-1');
    assert.equal(result[0].findingGroups.length, 1);
    assert.equal(result[0].findingGroups[0].findingId, 1);
    assert.equal(result[0].findingGroups[0].issueDisplayLabel, 'Head Replacement');
    assert.deepEqual(result[0].findingGroups[0].photoUrls, ['data:image/jpeg;base64,PHOTO_A1_F1']);
    assert.deepEqual(result[0].zonePhotoUrls, []);
  });

  it('routes photos from different zones into separate groups', () => {
    const photos = [
      { url: 'data:image/jpeg;base64,PHOTO_A1', zoneRecordId: 10, findingId: 1 },
      { url: 'data:image/jpeg;base64,PHOTO_B2', zoneRecordId: 20, findingId: 3 },
    ];
    const result = buildWcbZonePhotoGroups(photos, TWO_ZONE_VIEW);

    assert.equal(result.length, 2);
    const groupA = result.find(g => g.zoneLabel === 'A-1');
    const groupB = result.find(g => g.zoneLabel === 'B-2');
    assert.ok(groupA, 'A-1 group should exist');
    assert.ok(groupB, 'B-2 group should exist');

    assert.deepEqual(groupA!.findingGroups[0].photoUrls, ['data:image/jpeg;base64,PHOTO_A1']);
    assert.deepEqual(groupB!.findingGroups[0].photoUrls, ['data:image/jpeg;base64,PHOTO_B2']);
  });

  it('does NOT place zone A photos in zone B group', () => {
    const photos = [
      { url: 'data:image/jpeg;base64,ONLY_FOR_A1', zoneRecordId: 10, findingId: 1 },
      { url: 'data:image/jpeg;base64,ONLY_FOR_B2', zoneRecordId: 20, findingId: 3 },
    ];
    const result = buildWcbZonePhotoGroups(photos, TWO_ZONE_VIEW);

    const groupB = result.find(g => g.zoneLabel === 'B-2');
    assert.ok(groupB, 'B-2 group should exist');

    const allUrlsInB = [
      ...groupB!.zonePhotoUrls,
      ...groupB!.findingGroups.flatMap(fg => fg.photoUrls),
    ];
    assert.ok(
      !allUrlsInB.includes('data:image/jpeg;base64,ONLY_FOR_A1'),
      'A-1 photo must not appear inside the B-2 group',
    );
  });

  it('accumulates multiple finding groups within the same zone', () => {
    const photos = [
      { url: 'data:image/jpeg;base64,F1_1', zoneRecordId: 10, findingId: 1 },
      { url: 'data:image/jpeg;base64,F2_1', zoneRecordId: 10, findingId: 2 },
      { url: 'data:image/jpeg;base64,F1_2', zoneRecordId: 10, findingId: 1 },
    ];
    const result = buildWcbZonePhotoGroups(photos, TWO_ZONE_VIEW);

    assert.equal(result.length, 1);
    assert.equal(result[0].zoneLabel, 'A-1');
    assert.equal(result[0].findingGroups.length, 2);

    const fg1 = result[0].findingGroups.find(f => f.findingId === 1);
    const fg2 = result[0].findingGroups.find(f => f.findingId === 2);
    assert.deepEqual(fg1!.photoUrls, ['data:image/jpeg;base64,F1_1', 'data:image/jpeg;base64,F1_2']);
    assert.deepEqual(fg2!.photoUrls, ['data:image/jpeg;base64,F2_1']);
  });

  it('uses issueDisplayLabel from the view for the finding group', () => {
    const photos = [{ url: 'data:image/jpeg;base64,X', zoneRecordId: 10, findingId: 2 }];
    const result = buildWcbZonePhotoGroups(photos, TWO_ZONE_VIEW);

    assert.equal(result[0].findingGroups[0].issueDisplayLabel, 'Adjustment');
  });
});

describe('buildWcbZonePhotoGroups — zone-level photos (findingId null)', () => {
  it('routes a zone-level photo to the correct zone via zoneRecordId inference', () => {
    const photos = [
      // finding-linked photo establishes zoneRecordId 10 → A-1
      { url: 'data:image/jpeg;base64,FINDING_ANCHOR', zoneRecordId: 10, findingId: 1 },
      // zone-level photo for the same zoneRecordId
      { url: 'data:image/jpeg;base64,ZONE_LEVEL_A1', zoneRecordId: 10, findingId: null },
    ];
    const result = buildWcbZonePhotoGroups(photos, TWO_ZONE_VIEW);

    assert.equal(result.length, 1);
    assert.equal(result[0].zoneLabel, 'A-1');
    assert.deepEqual(result[0].zonePhotoUrls, ['data:image/jpeg;base64,ZONE_LEVEL_A1']);
  });

  it('places zone-level photo only in zone-level bucket, not in any finding group', () => {
    const photos = [
      { url: 'data:image/jpeg;base64,ANCHOR', zoneRecordId: 10, findingId: 1 },
      { url: 'data:image/jpeg;base64,ZONE', zoneRecordId: 10, findingId: null },
    ];
    const result = buildWcbZonePhotoGroups(photos, TWO_ZONE_VIEW);

    const allFindingUrls = result.flatMap(g => g.findingGroups.flatMap(fg => fg.photoUrls));
    assert.ok(
      !allFindingUrls.includes('data:image/jpeg;base64,ZONE'),
      'Zone-level photo must not appear inside any finding group',
    );
  });
});

describe('buildWcbZonePhotoGroups — unlinked photos excluded', () => {
  it('drops a photo whose zoneRecordId cannot be resolved to any zone', () => {
    const photos = [
      { url: 'data:image/jpeg;base64,ORPHAN', zoneRecordId: 999, findingId: null },
    ];
    const result = buildWcbZonePhotoGroups(photos, TWO_ZONE_VIEW);
    assert.equal(result.length, 0, 'Unresolvable photo should produce no groups');
  });

  it('drops a photo where both findingId and zoneRecordId are null', () => {
    const photos = [
      { url: 'data:image/jpeg;base64,BLANK', zoneRecordId: null, findingId: null },
    ];
    const result = buildWcbZonePhotoGroups(photos, TWO_ZONE_VIEW);
    assert.equal(result.length, 0);
  });
});

describe('buildWcbZonePhotoGroups — result ordering', () => {
  it('returns groups in view.zones order (A-1 before B-2)', () => {
    const photos = [
      { url: 'data:image/jpeg;base64,B2', zoneRecordId: 20, findingId: 3 },
      { url: 'data:image/jpeg;base64,A1', zoneRecordId: 10, findingId: 1 },
    ];
    const result = buildWcbZonePhotoGroups(photos, TWO_ZONE_VIEW);

    assert.equal(result.length, 2);
    assert.equal(result[0].zoneLabel, 'A-1', 'A-1 zone should come first in output');
    assert.equal(result[1].zoneLabel, 'B-2', 'B-2 zone should come second in output');
  });
});

// ── static-source guard ───────────────────────────────────────────────────────

describe('static-source guard — zonePhotoGroups threaded through to ticketPageWCB', () => {
  const helpersSource = readFileSync(
    join(import.meta.dirname ?? __dirname, 'pdf-helpers.ts'),
    'utf8',
  );

  it('ticketPageWCB signature declares zonePhotoGroups parameter', () => {
    assert.match(
      helpersSource,
      /export function ticketPageWCB[\s\S]{0,300}zonePhotoGroups/,
      'ticketPageWCB must accept a zonePhotoGroups parameter',
    );
  });

  it('ticketPageWCB passes zonePhotoGroups to partsBlockForWetCheckBS', () => {
    assert.match(
      helpersSource,
      /partsBlockForWetCheckBS\([^)]*zonePhotoGroups/,
      'partsBlockForWetCheckBS call inside ticketPageWCB must forward zonePhotoGroups',
    );
  });

  it('partsBlockForWetCheckBS signature accepts zonePhotoGroups parameter', () => {
    assert.match(
      helpersSource,
      /export function partsBlockForWetCheckBS[\s\S]{0,200}zonePhotoGroups/,
      'partsBlockForWetCheckBS must declare zonePhotoGroups parameter',
    );
  });
});
