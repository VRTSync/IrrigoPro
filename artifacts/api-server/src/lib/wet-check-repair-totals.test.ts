import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildLaborCatalog, catalogLaborHoursForFinding, canAutoBillFinding,
  computeAutoZoneRepairLaborHours, computeRepairedInFieldTotals,
} from "./wet-check-repair-totals";

const catalog = buildLaborCatalog([
  { issueType: "Head Replacement", defaultLaborHours: "0.25" },
  { issueType: "nozzle_replacement", defaultLaborHours: "0.25" },
]);
const finding = (zoneRecordId: number, quantity = 1) =>
  ({ zoneRecordId, quantity, noPartNeeded: false, partPrice: "10.00" });

test("catalog resolves aliases, quantity fallback and unknown issue types", () => {
  assert.equal(catalogLaborHoursForFinding({ issueType: "head_replace", quantity: 3 }, catalog), 0.75);
  assert.equal(catalogLaborHoursForFinding({ issueType: "head_replacement", quantity: 0 }, catalog), 0.25);
  assert.equal(catalogLaborHoursForFinding({ issueType: "head_replacement", quantity: null }, catalog), 0.25);
  assert.equal(catalogLaborHoursForFinding({ issueType: "unknown", quantity: 4 }, catalog), 0);
});

test("one billed zone counts once even with multiple findings", () => {
  const totals = computeRepairedInFieldTotals({
    billed: [finding(1, 3), finding(1, 2)],
    zones: [{ id: 1, repairLaborHours: "99.00", repairLaborManuallySet: false }],
    zoneFindings: new Map([[1, [
      { issueType: "head_replacement", quantity: 3 },
      { issueType: "nozzle_replacement", quantity: 2 },
    ]]]),
    catalog, wcBaseLaborHours: 0, laborRate: 50,
  });
  assert.deepEqual(totals, { partsSubtotal: 50, laborHours: 1.25, laborSubtotal: 62.5, grandTotal: 112.5 });
});

test("manual override and base hours counted once over three zones", () => {
  const totals = computeRepairedInFieldTotals({
    billed: [finding(1), finding(2), finding(3)],
    zones: [
      { id: 1, repairLaborHours: "2.00", repairLaborManuallySet: true },
      { id: 2, repairLaborHours: "0", repairLaborManuallySet: false },
      { id: 3, repairLaborHours: "0", repairLaborManuallySet: false },
    ],
    zoneFindings: new Map([1, 2, 3].map(id => [id, [{ issueType: "head_replacement", quantity: 1 }]])),
    catalog, wcBaseLaborHours: 1.5, laborRate: 40,
  });
  assert.equal(totals.laborHours, 4);
  assert.equal(totals.laborSubtotal, 160);
  assert.equal(computeAutoZoneRepairLaborHours([{ issueType: "unknown", quantity: 1 }], catalog), 0);
});

test("submit and preview share billability including inherent labor-only", () => {
  const laborOnly = new Set(["head_adjustment"]);
  assert.equal(canAutoBillFinding({ partId: 1, noPartNeeded: false, issueType: null }, laborOnly), true);
  assert.equal(canAutoBillFinding({ partId: null, noPartNeeded: true, issueType: "other" }, laborOnly), true);
  assert.equal(canAutoBillFinding({ partId: null, noPartNeeded: false, issueType: "head_adjustment" }, laborOnly), true);
  assert.equal(canAutoBillFinding({ partId: null, noPartNeeded: false, issueType: "other" }, laborOnly), false);
});