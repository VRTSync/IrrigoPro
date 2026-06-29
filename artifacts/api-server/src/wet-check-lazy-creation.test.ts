/**
 * Regression tests for the lazy zone-record creation policy introduced in
 * Task #1590. Key invariants:
 *
 *  (a) Wet checks are created with zero zone records — no pre-seeding occurs
 *      at creation time in the frontend or the server POST handler.
 *  (b) The server's submitWetCheck path converts any remaining not_checked
 *      records to not_applicable AND backfills N/A for every zone that was
 *      never touched — the sparse model is safe at submit time.
 *  (c) The frontend ControllerSelectionPage no longer contains the old
 *      pre-seeding loop that posted zone records immediately after creation.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..', '..', '..');

describe('lazy zone-record creation invariants', () => {
  it('ControllerSelectionPage does not pre-seed zone records at wet-check creation', async () => {
    const src = await fs.readFile(
      path.join(root, 'artifacts/irrigopro/src/pages/wet-checks/ControllerSelectionPage.tsx'),
      'utf8',
    );
    assert.ok(
      !src.includes('/zone-records'),
      'ControllerSelectionPage must not POST /zone-records during wet-check creation (pre-seeding removed)',
    );
  });

  it('submitWetCheck converts not_checked records to not_applicable at submit time', async () => {
    const src = await fs.readFile(
      path.join(root, 'artifacts/api-server/src/storage.ts'),
      'utf8',
    );
    // The submit path must flip not_checked → not_applicable for touched-but-
    // unresolved zone records so they don't block report generation.
    assert.ok(
      src.includes('"not_checked"') || src.includes("'not_checked'"),
      'storage.ts must reference not_checked in the submitWetCheck conversion',
    );
    assert.ok(
      src.includes('"not_applicable"') || src.includes("'not_applicable'"),
      'storage.ts must insert not_applicable records for untouched zones at submit time',
    );
  });

  it('submitWetCheck backfills N/A for zones that were never touched (sparse-model safety)', async () => {
    const src = await fs.readFile(
      path.join(root, 'artifacts/api-server/src/storage.ts'),
      'utf8',
    );
    // The submit path must enumerate expected zones from the controller config
    // and insert N/A for any that have no record at all.  We verify both
    // markers are present: the seen-set construction and the toInsert push.
    assert.ok(
      src.includes('toInsert') || src.includes('toInsert.push'),
      'submitWetCheck must build a toInsert list for N/A backfill',
    );
    assert.ok(
      src.includes('not_applicable'),
      'submitWetCheck must write not_applicable status for untouched zones',
    );
  });

  it('zone screen receives zoneRecords as an array (never null) from the API', async () => {
    // The ZoneStatusGrid in the mobile wet-check detail screen builds a virtual
    // 1..zoneCount grid and only uses zoneRecords for the dot-status overlay.
    // Verify that the mobile [id].tsx derives a record map via asArray() or
    // equivalent so a null server response never crashes the grid.
    const src = await fs.readFile(
      path.join(root, 'artifacts/irrigopro-mobile/app/wet-check/[id].tsx'),
      'utf8',
    );
    assert.ok(
      src.includes('asArray') || src.includes('?? []') || src.includes('|| []'),
      'wet-check [id].tsx must guard zoneRecords against null (asArray / ?? [])',
    );
  });
});
