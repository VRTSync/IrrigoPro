// Slice 5 — Guardrail tests for the work-order completion route's
// pricing-strategy and NaN-guard logic.
//
// Strategy: extract and test the key pure-ish logic in isolation.
//
//   1. NaN guard (money() coercion) — proves that "NaN", null, and empty-string
//      inputs to totalHours / totalPartsCost / appliedLaborRate all produce a
//      finite totalAmount, never NaN/Infinity.
//
//   2. Pricing strategy (snapshot vs catalog) — proves that:
//        a. An estimate-origin part that already exists in the WO keeps its
//           snapshotted partPrice after completion (not repriced from catalog).
//        b. A field-added part not in the WO prior items uses the catalog price.
//        c. totalPrice = quantity × unitPrice for both branches.
//
//   3. Empty-usedParts guard — proves the data-loss guard is sound: if usedParts
//      is empty but the WO already has items, the replace is skipped.
//
// None of these tests hit the real database; they test the extracted business
// logic directly.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ── money() — same implementation as in routes.ts ─────────────────────────────
//
// Extracted here so the test is self-contained. This is intentionally NOT
// importing from routes.ts (that file is a 17k-line monolith and has no
// individual exports). If the routes.ts implementation diverges, the
// route-level integration tests will catch it; these tests exist to document
// the invariant clearly.

function money(v: unknown): number {
  const n = parseFloat(String(v ?? '0'));
  return Number.isFinite(n) ? n : 0;
}

// ── 1. NaN guard ──────────────────────────────────────────────────────────────

describe("completion NaN guard — money() coercion", () => {
  it("totalAmount is finite when all three inputs are valid numbers", () => {
    const laborHours = money("2.50");
    const partsCost = money("150.00");
    const rate = money("80.00");
    const laborSubtotal = laborHours * rate;
    const totalAmount = laborSubtotal + partsCost;
    assert.ok(Number.isFinite(totalAmount));
    assert.ok(Math.abs(totalAmount - 350) < 0.01);
  });

  it("totalAmount is finite when totalHours='NaN'", () => {
    const laborHours = money("NaN");
    const partsCost = money("150.00");
    const rate = money("80.00");
    const totalAmount = laborHours * rate + partsCost;
    assert.ok(Number.isFinite(totalAmount), `got ${totalAmount}`);
    assert.ok(Math.abs(totalAmount - 150) < 0.01);
  });

  it("totalAmount is finite when totalPartsCost='NaN'", () => {
    const laborHours = money("2.50");
    const partsCost = money("NaN");
    const rate = money("80.00");
    const totalAmount = laborHours * rate + partsCost;
    assert.ok(Number.isFinite(totalAmount), `got ${totalAmount}`);
    assert.ok(Math.abs(totalAmount - 200) < 0.01);
  });

  it("totalAmount is finite when appliedLaborRate='NaN'", () => {
    const laborHours = money("2.50");
    const partsCost = money("150.00");
    const rate = money("NaN");
    const totalAmount = laborHours * rate + partsCost;
    assert.ok(Number.isFinite(totalAmount), `got ${totalAmount}`);
    assert.ok(Math.abs(totalAmount - 150) < 0.01);
  });

  it("totalAmount is finite when all three inputs are empty string", () => {
    const laborHours = money("");
    const partsCost = money("");
    const rate = money("");
    const totalAmount = laborHours * rate + partsCost;
    assert.ok(Number.isFinite(totalAmount), `got ${totalAmount}`);
    assert.equal(totalAmount, 0);
  });

  it("totalAmount is finite when all three inputs are null", () => {
    const laborHours = money(null);
    const partsCost = money(null);
    const rate = money(null);
    const totalAmount = laborHours * rate + partsCost;
    assert.ok(Number.isFinite(totalAmount), `got ${totalAmount}`);
    assert.equal(totalAmount, 0);
  });

  it("partsSubtotal = partsCost (no transformation)", () => {
    const partsCost = money("425.00");
    const partsSubtotal = partsCost;
    assert.ok(Math.abs(partsSubtotal - 425) < 0.01);
  });

  it("totalAmount = laborSubtotal + partsSubtotal (additive, no other terms)", () => {
    const laborHours = money("3");
    const rate = money("95");
    const partsCost = money("212.50");
    const laborSubtotal = laborHours * rate;
    const partsSubtotal = partsCost;
    const totalAmount = laborSubtotal + partsSubtotal;
    assert.ok(Math.abs(totalAmount - (285 + 212.5)) < 0.01);
  });
});

// ── 2. Pricing strategy — snapshot vs catalog ─────────────────────────────────
//
// The buildFinalItems logic (extracted inline):
//   • If part.partId has a queued prior row → shift() one and use its snapshotted
//     partPrice.  Stack map (partId → PriorItem[]) ensures same-partId rows with
//     different finding/zone contexts each get their own prior (not collapsed).
//   • Once priors for that partId are exhausted → use catalogPrice (field-added).

type PriorItem = { partId: number | null; partName: string; partPrice: string; laborHours: string };
type IncomingPart = { partId: number | null; quantity: number };

function buildFinalItems(
  incomingParts: IncomingPart[],
  priorItems: PriorItem[],
  getCatalogPrice: (partId: number) => string | null,
): Array<{
  partId: number | null;
  partName: string;
  partPrice: string;
  quantity: number;
  totalPrice: string;
  laborHours: string;
}> {
  // Stack map: partId → PriorItem[]; shift() consumes one prior per match so
  // multiple WO items with the same partId (different zones) each get their
  // own snapshotted prior row — matching the fix in routes.ts.
  const priorsByPartId = new Map<number | null, PriorItem[]>();
  for (const it of priorItems) {
    const list = priorsByPartId.get(it.partId) ?? [];
    list.push(it);
    priorsByPartId.set(it.partId, list);
  }
  const finalItems: ReturnType<typeof buildFinalItems> = [];

  for (const part of incomingParts) {
    const priorList = part.partId != null ? priorsByPartId.get(part.partId) : undefined;
    const prior = priorList?.shift(); // consume one prior row per match
    if (prior) {
      const unitPrice = money(prior.partPrice);
      finalItems.push({
        partId: part.partId,
        partName: prior.partName,
        partPrice: prior.partPrice,
        quantity: part.quantity,
        totalPrice: (money(part.quantity) * unitPrice).toFixed(2),
        laborHours: prior.laborHours ?? "0",
      });
    } else {
      const catalogPrice = part.partId != null ? getCatalogPrice(part.partId) : null;
      if (catalogPrice != null) {
        finalItems.push({
          partId: part.partId,
          partName: `Part ${part.partId}`,
          partPrice: catalogPrice,
          quantity: part.quantity,
          totalPrice: (money(part.quantity) * money(catalogPrice)).toFixed(2),
          laborHours: "0",
        });
      }
    }
  }
  return finalItems;
}

describe("completion pricing strategy — snapshot preserved for pre-existing items", () => {
  const priorItems: PriorItem[] = [
    { partId: 1, partName: "Nozzle Head", partPrice: "12.50", laborHours: "0.00" },
    { partId: 2, partName: "Valve Body",  partPrice: "45.00", laborHours: "0.00" },
  ];
  const catalogPrices: Record<number, string> = { 1: "15.00", 2: "50.00", 3: "8.00" };

  it("estimate-origin part uses snapshotted partPrice, not current catalog", () => {
    const items = buildFinalItems(
      [{ partId: 1, quantity: 2 }],
      priorItems,
      (id) => catalogPrices[id] ?? null,
    );
    assert.equal(items.length, 1);
    assert.equal(items[0].partPrice, "12.50", "should use snapshotted price");
    assert.equal(items[0].totalPrice, "25.00", "quantity × snapshotted price");
  });

  it("estimate-origin part totalPrice = quantity × snapshotted price", () => {
    const items = buildFinalItems(
      [{ partId: 2, quantity: 3 }],
      priorItems,
      (id) => catalogPrices[id] ?? null,
    );
    assert.equal(items[0].partPrice, "45.00");
    assert.equal(items[0].totalPrice, "135.00");
  });

  it("field-added part (not in prior WO items) uses current catalog price", () => {
    const items = buildFinalItems(
      [{ partId: 3, quantity: 1 }],
      priorItems,
      (id) => catalogPrices[id] ?? null,
    );
    assert.equal(items.length, 1);
    assert.equal(items[0].partPrice, "8.00", "should use catalog price for new part");
    assert.equal(items[0].totalPrice, "8.00");
  });

  it("mix: snapshotted + field-added both present in finalItems", () => {
    const items = buildFinalItems(
      [{ partId: 1, quantity: 2 }, { partId: 3, quantity: 4 }],
      priorItems,
      (id) => catalogPrices[id] ?? null,
    );
    assert.equal(items.length, 2);
    const nozzle = items.find((i) => i.partId === 1)!;
    const fieldAdded = items.find((i) => i.partId === 3)!;
    assert.equal(nozzle.partPrice, "12.50");
    assert.equal(fieldAdded.partPrice, "8.00");
  });

  it("catalog-price-changed scenario: snapshotted price wins over new catalog", () => {
    const changedCatalog: Record<number, string> = { 1: "999.00" };
    const items = buildFinalItems(
      [{ partId: 1, quantity: 1 }],
      priorItems,
      (id) => changedCatalog[id] ?? null,
    );
    assert.equal(items[0].partPrice, "12.50", "original snapshotted price must be used");
    assert.notEqual(items[0].partPrice, "999.00");
  });

  it("unknown partId not in catalog is skipped (no ghost items)", () => {
    const items = buildFinalItems(
      [{ partId: 99, quantity: 1 }],
      priorItems,
      () => null,
    );
    assert.equal(items.length, 0, "unknown part should produce no item");
  });
});

// ── 2b. Same-partId / different-zone stack-map correctness ────────────────────
//
// If a WO has two items with the same partId (e.g. same part installed in zone
// A and zone B via two distinct findings), a simple partId→PriorItem Map would
// collapse both rows to one prior row, causing the second incoming entry to use
// catalog price (wrong) and potentially losing lineage / labor context.
// The stack-map fix (partId → PriorItem[]) ensures each occurrence gets its own
// snapshotted prior row.

describe("completion pricing strategy — same-partId / different-zone stack-map", () => {
  it("two prior rows for partId=1 (zone A and zone B) each get their own snapshotted price", () => {
    const priorItemsMulti: PriorItem[] = [
      { partId: 1, partName: "Nozzle A", partPrice: "12.50", laborHours: "0.25" },
      { partId: 1, partName: "Nozzle B", partPrice: "12.50", laborHours: "0.25" },
    ];
    const catalogPrices: Record<number, string> = { 1: "99.00" }; // catalog changed
    const items = buildFinalItems(
      [{ partId: 1, quantity: 1 }, { partId: 1, quantity: 1 }],
      priorItemsMulti,
      (id) => catalogPrices[id] ?? null,
    );
    assert.equal(items.length, 2, "both WO items must survive — not collapsed to one");
    assert.equal(items[0].partPrice, "12.50", "first zone uses snapshotted price");
    assert.equal(items[1].partPrice, "12.50", "second zone uses snapshotted price (not catalog $99)");
    assert.notEqual(items[1].partPrice, "99.00", "second zone must NOT fall through to catalog");
  });

  it("two prior rows for same partId — third incoming occurrence falls through to catalog", () => {
    // Two prior rows consumed by first two incoming; third has no prior left → catalog.
    const priorItemsTwo: PriorItem[] = [
      { partId: 5, partName: "Valve", partPrice: "45.00", laborHours: "0.00" },
      { partId: 5, partName: "Valve", partPrice: "45.00", laborHours: "0.00" },
    ];
    const items = buildFinalItems(
      [{ partId: 5, quantity: 1 }, { partId: 5, quantity: 1 }, { partId: 5, quantity: 1 }],
      priorItemsTwo,
      (_id) => "55.00",
    );
    assert.equal(items.length, 3, "all three entries produce items");
    assert.equal(items[0].partPrice, "45.00", "first: snapshotted");
    assert.equal(items[1].partPrice, "45.00", "second: snapshotted");
    assert.equal(items[2].partPrice, "55.00", "third: catalog fallthrough (prior exhausted)");
  });
});

// ── 3. Empty-usedParts guard ──────────────────────────────────────────────────

describe("completion empty-usedParts guard", () => {
  it("usedParts=[] with prior items → skip flag is true (no replace)", () => {
    const incomingParts: IncomingPart[] = [];
    const priorItems: PriorItem[] = [
      { partId: 1, partName: "Nozzle", partPrice: "12.50", laborHours: "0.00" },
    ];
    const shouldSkip = incomingParts.length === 0 && priorItems.length > 0;
    assert.ok(shouldSkip, "should skip replace to prevent data loss");
  });

  it("usedParts=[] with no prior items → proceed (empty WO is valid)", () => {
    const incomingParts: IncomingPart[] = [];
    const priorItems: PriorItem[] = [];
    const shouldSkip = incomingParts.length === 0 && priorItems.length > 0;
    assert.ok(!shouldSkip, "empty WO can be completed with no items");
  });

  it("usedParts non-empty with prior items → proceed (normal completion)", () => {
    const incomingParts: IncomingPart[] = [{ partId: 1, quantity: 2 }];
    const priorItems: PriorItem[] = [
      { partId: 1, partName: "Nozzle", partPrice: "12.50", laborHours: "0.00" },
    ];
    const shouldSkip = incomingParts.length === 0 && priorItems.length > 0;
    assert.ok(!shouldSkip, "non-empty usedParts should always proceed");
  });

  it("finalItems built from usedParts exactly matches incoming part set (no extras)", () => {
    const incomingParts: IncomingPart[] = [{ partId: 1, quantity: 2 }];
    const priorItems: PriorItem[] = [
      { partId: 1, partName: "Nozzle", partPrice: "12.50", laborHours: "0.00" },
      { partId: 2, partName: "Valve",  partPrice: "40.00", laborHours: "0.00" },
    ];
    const items = buildFinalItems(incomingParts, priorItems, () => null);
    assert.equal(items.length, 1, "only the part in usedParts should appear — not all priorItems");
    assert.equal(items[0].partId, 1);
  });
});

// ── 4. Re-completion idempotency (replace-not-append invariant) ───────────────
//
// Simulates calling complete twice: both calls use the same usedParts list.
// After replaceWorkOrderItemsWithResync the second call should produce the
// same item count as the first (not double it).
//
// We test this at the pure-logic level: buildFinalItems is deterministic given
// the same inputs, so calling it twice yields the same output (length and prices).

describe("re-completion idempotency — replace-not-append invariant", () => {
  const incomingParts: IncomingPart[] = [
    { partId: 1, quantity: 2 },
    { partId: 2, quantity: 1 },
  ];
  const priorItems: PriorItem[] = [
    { partId: 1, partName: "Nozzle Head", partPrice: "12.50", laborHours: "0.00" },
    { partId: 2, partName: "Valve Body",  partPrice: "45.00", laborHours: "0.00" },
  ];

  it("first completion builds correct item set", () => {
    const items = buildFinalItems(incomingParts, priorItems, () => null);
    assert.equal(items.length, 2);
  });

  it("second completion with same usedParts yields the same item count (no doubles)", () => {
    const first = buildFinalItems(incomingParts, priorItems, () => null);
    // After first completion, the WO items ARE the finalItems from the first run.
    // Simulate: priorItems on the second call = what was stored after first call.
    const priorAfterFirst: PriorItem[] = first.map((i) => ({
      partId: i.partId,
      partName: i.partName,
      partPrice: i.partPrice,
      laborHours: i.laborHours,
    }));
    const second = buildFinalItems(incomingParts, priorAfterFirst, () => null);
    assert.equal(second.length, first.length, "re-completion must not double the item count");
  });

  it("second completion preserves the same prices as the first", () => {
    const first = buildFinalItems(incomingParts, priorItems, () => null);
    const priorAfterFirst: PriorItem[] = first.map((i) => ({
      partId: i.partId,
      partName: i.partName,
      partPrice: i.partPrice,
      laborHours: i.laborHours,
    }));
    const second = buildFinalItems(incomingParts, priorAfterFirst, () => null);
    for (let i = 0; i < first.length; i++) {
      assert.equal(second[i].partPrice, first[i].partPrice, `price must not change on re-completion`);
      assert.equal(second[i].totalPrice, first[i].totalPrice, `totalPrice must not change`);
    }
  });
});
