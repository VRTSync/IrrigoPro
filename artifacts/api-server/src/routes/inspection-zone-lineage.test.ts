// Tests for the zone-lineage carry-through and sourceItemId matching logic
// introduced in the inspection WO completion task.
//
// All tests are pure-logic: they operate on extracted helper functions and never
// touch the database or the Express app. The patterns mirror the existing
// work-order-completion-guards.test.ts.
//
// Coverage:
//  1. Inspection WO round-trip  — zone columns survive completion replace.
//  2. isInspectionOriginWorkOrder — returns true after completion.
//  3. Return-for-correction     — check-offs (completedAt) survive round-trip.
//  4. Re-complete after correction — no duplication, stable totals.
//  5. Cross-wire / same-part two zones — removing one zone keeps the other's tag.
//  6. Legacy / offline payload (no sourceItemId) — partId stack-map fallback.
//  7. Non-inspection WO regression — null zone fields throughout.
//  8. Double-submit safety — single item set, stable totals.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ── Helpers copied from routes.ts (pure, no side-effects) ─────────────────────

function money(v: unknown): number {
  const n = parseFloat(String(v ?? "0"));
  return Number.isFinite(n) ? n : 0;
}

type PriorItem = {
  id: number;
  partId: number | null;
  partName: string;
  partPrice: string;
  laborHours: string;
  findingId?: number | null;
  controllerLetter?: string | null;
  zoneNumber?: number | null;
  issueType?: string | null;
  completedAt?: string | null;
};

type IncomingPart = {
  partId: number | null;
  quantity: number;
  partName?: string;
  partPrice?: string;
  laborHours?: string;
  sourceItemId?: number | null;
};

type FinalItem = {
  partId: number | null;
  partName: string;
  partPrice: string;
  quantity: number;
  totalPrice: string;
  laborHours: string;
  findingId: number | null;
  controllerLetter: string | null;
  zoneNumber: number | null;
  issueType: string | null;
  completedAt: string | null;
};

// Extracted buildFinalItems — mirrors the logic in routes.ts exactly, including
// Slice 1 (zone lineage) and Slice 2 (sourceItemId exact-id match with fallback).
function buildFinalItems(
  incomingParts: IncomingPart[],
  priorItems: PriorItem[],
  getCatalogEntry: (partId: number) => { name: string; price: string } | null,
): FinalItem[] {
  // Slice 2 (server) — id-keyed lookup for sourceItemId matching.
  const priorsById = new Map<number, PriorItem>();
  for (const it of priorItems) {
    priorsById.set(it.id, it);
  }

  const priorsByPartId = new Map<number | null, PriorItem[]>();
  for (const it of priorItems) {
    const list = priorsByPartId.get(it.partId) ?? [];
    list.push(it);
    priorsByPartId.set(it.partId, list);
  }

  const consumedPriorIds = new Set<number>();
  const finalItems: FinalItem[] = [];

  for (const part of incomingParts) {
    let prior: PriorItem | undefined;

    // Exact-id match when sourceItemId is present.
    if (part.sourceItemId != null) {
      const sid = Number(part.sourceItemId);
      if (Number.isFinite(sid)) {
        const candidate = priorsById.get(sid);
        if (candidate && !consumedPriorIds.has(candidate.id)) {
          prior = candidate;
          consumedPriorIds.add(candidate.id);
          const list = priorsByPartId.get(candidate.partId) ?? [];
          const idx = list.indexOf(candidate);
          if (idx >= 0) list.splice(idx, 1);
        }
      }
    }

    // Fallback: partId stack-map.
    if (!prior) {
      const priorList =
        part.partId != null ? priorsByPartId.get(part.partId) : undefined;
      while (
        priorList &&
        priorList.length > 0 &&
        consumedPriorIds.has(priorList[0].id)
      ) {
        priorList.shift();
      }
      const candidate = priorList?.shift();
      if (candidate) {
        prior = candidate;
        consumedPriorIds.add(candidate.id);
      }
    }

    if (prior) {
      const unitPrice = money(prior.partPrice);
      finalItems.push({
        partId: part.partId,
        partName: prior.partName,
        partPrice: prior.partPrice,
        quantity: part.quantity,
        totalPrice: (money(part.quantity) * unitPrice).toFixed(2),
        laborHours: prior.laborHours ?? "0",
        findingId: prior.findingId ?? null,
        controllerLetter: prior.controllerLetter ?? null,
        zoneNumber: prior.zoneNumber ?? null,
        issueType: prior.issueType ?? null,
        completedAt: prior.completedAt ?? null,
      });
    } else {
      const catalog =
        part.partId != null ? getCatalogEntry(part.partId) : null;
      const resolvedName =
        part.partName ?? catalog?.name ?? `Part ${part.partId}`;
      const resolvedPrice = part.partPrice ?? catalog?.price ?? "0";
      if (catalog != null || part.partName) {
        const unitPrice = money(resolvedPrice);
        finalItems.push({
          partId: part.partId,
          partName: resolvedName,
          partPrice: resolvedPrice,
          quantity: part.quantity,
          totalPrice: (money(part.quantity) * unitPrice).toFixed(2),
          laborHours: part.laborHours ?? "0",
          findingId: null,
          controllerLetter: null,
          zoneNumber: null,
          issueType: null,
          completedAt: null,
        });
      }
    }
  }

  return finalItems;
}

// isInspectionOriginWorkOrder — mirrors inspection-zone-checklist.tsx
function isInspectionOriginWorkOrder(
  wo: { originWetCheckId?: number | null },
  items: Array<{ controllerLetter?: string | null; zoneNumber?: number | null }> | undefined,
): boolean {
  if (wo.originWetCheckId != null) return true;
  return Array.isArray(items)
    ? items.some((i) => i.controllerLetter != null || i.zoneNumber != null)
    : false;
}

// ── 1. Inspection WO round-trip: zone columns survive completion replace ───────

describe("zone lineage carry-through (Slice 1)", () => {
  const priorItems: PriorItem[] = [
    {
      id: 101,
      partId: 1,
      partName: "Nozzle Head",
      partPrice: "12.50",
      laborHours: "0.25",
      findingId: 55,
      controllerLetter: "A",
      zoneNumber: 3,
      issueType: "broken_head",
      completedAt: null,
    },
    {
      id: 102,
      partId: 2,
      partName: "Valve Body",
      partPrice: "45.00",
      laborHours: "0.50",
      findingId: 56,
      controllerLetter: "B",
      zoneNumber: 1,
      issueType: "valve_failure",
      completedAt: null,
    },
  ];

  it("controllerLetter is preserved from the prior row on match", () => {
    const items = buildFinalItems(
      [{ partId: 1, quantity: 1, sourceItemId: 101 }],
      priorItems,
      () => null,
    );
    assert.equal(items.length, 1);
    assert.equal(items[0].controllerLetter, "A");
  });

  it("zoneNumber is preserved from the prior row on match", () => {
    const items = buildFinalItems(
      [{ partId: 1, quantity: 1, sourceItemId: 101 }],
      priorItems,
      () => null,
    );
    assert.equal(items[0].zoneNumber, 3);
  });

  it("issueType is preserved from the prior row on match", () => {
    const items = buildFinalItems(
      [{ partId: 1, quantity: 1, sourceItemId: 101 }],
      priorItems,
      () => null,
    );
    assert.equal(items[0].issueType, "broken_head");
  });

  it("findingId is preserved from the prior row on match", () => {
    const items = buildFinalItems(
      [{ partId: 1, quantity: 1, sourceItemId: 101 }],
      priorItems,
      () => null,
    );
    assert.equal(items[0].findingId, 55);
  });

  it("field-added rows get null zone columns", () => {
    const items = buildFinalItems(
      [{ partId: 99, quantity: 1, partName: "Custom part", partPrice: "5.00", sourceItemId: null }],
      priorItems,
      () => ({ name: "Custom part", price: "5.00" }),
    );
    assert.equal(items.length, 1);
    assert.equal(items[0].controllerLetter, null);
    assert.equal(items[0].zoneNumber, null);
    assert.equal(items[0].issueType, null);
    assert.equal(items[0].findingId, null);
  });

  it("both inspection-origin items preserve their respective zone tags", () => {
    const items = buildFinalItems(
      [
        { partId: 1, quantity: 1, sourceItemId: 101 },
        { partId: 2, quantity: 1, sourceItemId: 102 },
      ],
      priorItems,
      () => null,
    );
    assert.equal(items.length, 2);
    const nozzle = items.find((i) => i.partId === 1)!;
    const valve = items.find((i) => i.partId === 2)!;
    assert.equal(nozzle.controllerLetter, "A");
    assert.equal(nozzle.zoneNumber, 3);
    assert.equal(valve.controllerLetter, "B");
    assert.equal(valve.zoneNumber, 1);
  });
});

// ── 2. isInspectionOriginWorkOrder returns true after completion ──────────────

describe("isInspectionOriginWorkOrder after completion", () => {
  it("returns true when items carry controllerLetter", () => {
    const items = [
      { controllerLetter: "A", zoneNumber: 1 },
    ];
    assert.ok(isInspectionOriginWorkOrder({}, items));
  });

  it("returns true when WO links an originWetCheckId", () => {
    assert.ok(isInspectionOriginWorkOrder({ originWetCheckId: 42 }, []));
  });

  it("returns false when items have no zone tags and no originWetCheckId", () => {
    const items = [
      { controllerLetter: null, zoneNumber: null },
    ];
    assert.ok(!isInspectionOriginWorkOrder({}, items));
  });
});

// ── 3. Return-for-correction: completedAt (check-off state) survives ──────────

describe("completedAt / check-off state preserved on correction round-trip", () => {
  it("completedAt is carried from the prior row when present", () => {
    const completedTs = "2026-07-13T10:00:00.000Z";
    const priorItems: PriorItem[] = [
      {
        id: 201,
        partId: 5,
        partName: "Sprinkler Head",
        partPrice: "8.00",
        laborHours: "0.10",
        findingId: null,
        controllerLetter: "A",
        zoneNumber: 2,
        issueType: "clogged",
        completedAt: completedTs,
      },
    ];
    const items = buildFinalItems(
      [{ partId: 5, quantity: 1, sourceItemId: 201 }],
      priorItems,
      () => null,
    );
    assert.equal(items.length, 1);
    assert.equal(items[0].completedAt, completedTs);
  });

  it("completedAt is null for unchecked prior rows", () => {
    const priorItems: PriorItem[] = [
      {
        id: 202,
        partId: 5,
        partName: "Sprinkler Head",
        partPrice: "8.00",
        laborHours: "0.10",
        findingId: null,
        controllerLetter: "A",
        zoneNumber: 2,
        issueType: "clogged",
        completedAt: null,
      },
    ];
    const items = buildFinalItems(
      [{ partId: 5, quantity: 1, sourceItemId: 202 }],
      priorItems,
      () => null,
    );
    assert.equal(items[0].completedAt, null);
  });
});

// ── 4. Re-complete after correction: no duplication, stable totals ────────────

describe("re-completion after correction: no duplication, stable totals", () => {
  const priorItems: PriorItem[] = [
    {
      id: 301,
      partId: 7,
      partName: "Pop-up Head",
      partPrice: "14.00",
      laborHours: "0.50",
      findingId: 77,
      controllerLetter: "C",
      zoneNumber: 4,
      issueType: "low_pressure",
      completedAt: null,
    },
  ];

  it("first completion produces exactly one item", () => {
    const items = buildFinalItems(
      [{ partId: 7, quantity: 2, sourceItemId: 301 }],
      priorItems,
      () => null,
    );
    assert.equal(items.length, 1);
  });

  it("re-completion with same usedParts produces the same item count (no doubles)", () => {
    const first = buildFinalItems(
      [{ partId: 7, quantity: 2, sourceItemId: 301 }],
      priorItems,
      () => null,
    );
    // After the first completion the old rows are deleted and new ones inserted.
    // The second completion's prior items are those new rows (new ids, stale sourceItemId).
    const priorAfterFirst: PriorItem[] = first.map((i, idx) => ({
      id: 1000 + idx,
      partId: i.partId,
      partName: i.partName,
      partPrice: i.partPrice,
      laborHours: i.laborHours,
      findingId: i.findingId,
      controllerLetter: i.controllerLetter,
      zoneNumber: i.zoneNumber,
      issueType: i.issueType,
      completedAt: i.completedAt,
    }));
    // sourceItemId 301 is now stale — falls back to partId stack-map.
    const second = buildFinalItems(
      [{ partId: 7, quantity: 2, sourceItemId: 301 }],
      priorAfterFirst,
      () => null,
    );
    assert.equal(second.length, first.length, "re-completion must not double items");
  });

  it("re-completion prices are stable even when sourceItemId is stale", () => {
    const first = buildFinalItems(
      [{ partId: 7, quantity: 2, sourceItemId: 301 }],
      priorItems,
      () => null,
    );
    const priorAfterFirst: PriorItem[] = first.map((i, idx) => ({
      id: 1000 + idx,
      partId: i.partId,
      partName: i.partName,
      partPrice: i.partPrice,
      laborHours: i.laborHours,
      findingId: i.findingId,
      controllerLetter: i.controllerLetter,
      zoneNumber: i.zoneNumber,
      issueType: i.issueType,
      completedAt: i.completedAt,
    }));
    const second = buildFinalItems(
      [{ partId: 7, quantity: 2, sourceItemId: 301 }],
      priorAfterFirst,
      () => null,
    );
    assert.equal(second[0].partPrice, first[0].partPrice, "price must be stable");
    assert.equal(second[0].totalPrice, first[0].totalPrice, "totalPrice must be stable");
  });

  it("zone tag is carried through after stale sourceItemId falls back to stack-map", () => {
    const first = buildFinalItems(
      [{ partId: 7, quantity: 2, sourceItemId: 301 }],
      priorItems,
      () => null,
    );
    const priorAfterFirst: PriorItem[] = first.map((i, idx) => ({
      id: 1000 + idx,
      partId: i.partId,
      partName: i.partName,
      partPrice: i.partPrice,
      laborHours: i.laborHours,
      findingId: i.findingId,
      controllerLetter: i.controllerLetter,
      zoneNumber: i.zoneNumber,
      issueType: i.issueType,
      completedAt: i.completedAt,
    }));
    const second = buildFinalItems(
      [{ partId: 7, quantity: 2, sourceItemId: 301 }],
      priorAfterFirst,
      () => null,
    );
    // Zone lineage must survive the second round even with a stale sourceItemId.
    assert.equal(second[0].controllerLetter, "C");
    assert.equal(second[0].zoneNumber, 4);
  });
});

// ── 5. Cross-wire scenario: same part, two zones, remove one ─────────────────

describe("cross-wire scenario: same part in two zones, remove one", () => {
  // WO has the same part (partId=10) in two zones: zone A (id 401) and zone B (id 402).
  const priorItems: PriorItem[] = [
    {
      id: 401,
      partId: 10,
      partName: "Nozzle",
      partPrice: "9.00",
      laborHours: "0.20",
      findingId: 91,
      controllerLetter: "A",
      zoneNumber: 5,
      issueType: "broken_head",
      completedAt: null,
    },
    {
      id: 402,
      partId: 10,
      partName: "Nozzle",
      partPrice: "9.00",
      laborHours: "0.20",
      findingId: 92,
      controllerLetter: "B",
      zoneNumber: 7,
      issueType: "broken_head",
      completedAt: null,
    },
  ];

  it("removing zone B leaves zone A's tag intact (sourceItemId 401 matches exactly)", () => {
    const items = buildFinalItems(
      [{ partId: 10, quantity: 1, sourceItemId: 401 }], // only zone A survives
      priorItems,
      () => null,
    );
    assert.equal(items.length, 1);
    assert.equal(items[0].controllerLetter, "A", "should keep zone A tag");
    assert.equal(items[0].zoneNumber, 5);
    assert.equal(items[0].findingId, 91);
  });

  it("removing zone A leaves zone B's tag intact (sourceItemId 402 matches exactly)", () => {
    const items = buildFinalItems(
      [{ partId: 10, quantity: 1, sourceItemId: 402 }], // only zone B survives
      priorItems,
      () => null,
    );
    assert.equal(items.length, 1);
    assert.equal(items[0].controllerLetter, "B", "should keep zone B tag");
    assert.equal(items[0].zoneNumber, 7);
    assert.equal(items[0].findingId, 92);
  });

  it("keeping both zones: each gets the correct independent tag (no cross-wire)", () => {
    const items = buildFinalItems(
      [
        { partId: 10, quantity: 1, sourceItemId: 401 },
        { partId: 10, quantity: 1, sourceItemId: 402 },
      ],
      priorItems,
      () => null,
    );
    assert.equal(items.length, 2);
    const zoneA = items.find((i) => i.controllerLetter === "A")!;
    const zoneB = items.find((i) => i.controllerLetter === "B")!;
    assert.ok(zoneA, "zone A must be present");
    assert.ok(zoneB, "zone B must be present");
    assert.equal(zoneA.zoneNumber, 5);
    assert.equal(zoneB.zoneNumber, 7);
    assert.equal(zoneA.findingId, 91);
    assert.equal(zoneB.findingId, 92);
  });

  it("without sourceItemId (legacy), stack-map still assigns distinct priors (no collapse)", () => {
    const items = buildFinalItems(
      [
        { partId: 10, quantity: 1 }, // no sourceItemId
        { partId: 10, quantity: 1 }, // no sourceItemId
      ],
      priorItems,
      () => null,
    );
    assert.equal(items.length, 2, "both occurrences must produce items");
    assert.notEqual(
      items[0].findingId,
      items[1].findingId,
      "each gets a distinct prior (different findingIds)",
    );
  });
});

// ── 6. Legacy / offline payload: no sourceItemId → partId stack-map fallback ──

describe("legacy / offline payload: no sourceItemId (stack-map fallback)", () => {
  it("without sourceItemId, partId stack-map assigns snapshot price correctly", () => {
    const priorItems: PriorItem[] = [
      { id: 501, partId: 3, partName: "Head", partPrice: "7.50", laborHours: "0" },
    ];
    const items = buildFinalItems(
      [{ partId: 3, quantity: 2 }], // no sourceItemId
      priorItems,
      () => ({ name: "Head", price: "99.00" }), // catalog changed
    );
    assert.equal(items.length, 1);
    assert.equal(items[0].partPrice, "7.50", "snapshotted price wins even without sourceItemId");
  });

  it("zone lineage is still carried via stack-map when sourceItemId is absent", () => {
    const priorItems: PriorItem[] = [
      {
        id: 502,
        partId: 4,
        partName: "Valve",
        partPrice: "20.00",
        laborHours: "0.5",
        controllerLetter: "D",
        zoneNumber: 9,
        issueType: "valve_failure",
      },
    ];
    const items = buildFinalItems(
      [{ partId: 4, quantity: 1 }], // no sourceItemId
      priorItems,
      () => null,
    );
    assert.equal(items[0].controllerLetter, "D");
    assert.equal(items[0].zoneNumber, 9);
    assert.equal(items[0].issueType, "valve_failure");
  });
});

// ── 7. Non-inspection WO regression: null zone fields throughout ──────────────

describe("non-inspection WO regression: zone fields are null", () => {
  it("direct WO items (no zone tags on priors) produce null zone fields", () => {
    const priorItems: PriorItem[] = [
      {
        id: 601,
        partId: 8,
        partName: "Pipe",
        partPrice: "3.00",
        laborHours: "0",
        controllerLetter: null,
        zoneNumber: null,
        issueType: null,
        completedAt: null,
      },
    ];
    const items = buildFinalItems(
      [{ partId: 8, quantity: 1, sourceItemId: 601 }],
      priorItems,
      () => null,
    );
    assert.equal(items.length, 1);
    assert.equal(items[0].controllerLetter, null);
    assert.equal(items[0].zoneNumber, null);
    assert.equal(items[0].issueType, null);
    assert.equal(items[0].findingId, null);
  });

  it("isInspectionOriginWorkOrder returns false for non-inspection WO with no tags", () => {
    assert.ok(!isInspectionOriginWorkOrder({}, [{ controllerLetter: null, zoneNumber: null }]));
  });

  it("price snapshot still applies correctly on non-inspection WOs", () => {
    const priorItems: PriorItem[] = [
      { id: 602, partId: 9, partName: "Fitting", partPrice: "6.00", laborHours: "0" },
    ];
    const items = buildFinalItems(
      [{ partId: 9, quantity: 3, sourceItemId: 602 }],
      priorItems,
      () => ({ name: "Fitting", price: "99.00" }),
    );
    assert.equal(items[0].partPrice, "6.00", "snapshot price wins on non-inspection WO");
    assert.equal(items[0].totalPrice, "18.00");
  });
});

// ── 8. Double-submit safety: collapses to a single item set ───────────────────

describe("double-submit (money safety): single item set, stable totals", () => {
  const priorItems: PriorItem[] = [
    {
      id: 701,
      partId: 11,
      partName: "Controller Head",
      partPrice: "22.00",
      laborHours: "1.00",
      controllerLetter: "A",
      zoneNumber: 1,
      issueType: "broken_head",
      completedAt: null,
    },
  ];

  it("calling buildFinalItems twice with the same inputs yields the same count", () => {
    const incoming: IncomingPart[] = [{ partId: 11, quantity: 1, sourceItemId: 701 }];
    const first = buildFinalItems(incoming, priorItems, () => null);
    // Simulate: after first completion, new rows inserted with new ids.
    const priorAfterFirst: PriorItem[] = first.map((i, idx) => ({
      id: 2000 + idx,
      partId: i.partId,
      partName: i.partName,
      partPrice: i.partPrice,
      laborHours: i.laborHours,
      controllerLetter: i.controllerLetter,
      zoneNumber: i.zoneNumber,
      issueType: i.issueType,
      completedAt: i.completedAt,
      findingId: i.findingId,
    }));
    // Second call: stale sourceItemId (701 no longer exists) → stack-map fallback.
    const second = buildFinalItems(incoming, priorAfterFirst, () => null);
    assert.equal(second.length, first.length, "no item duplication on re-submit");
  });

  it("totals are stable across both submissions", () => {
    const incoming: IncomingPart[] = [{ partId: 11, quantity: 1, sourceItemId: 701 }];
    const first = buildFinalItems(incoming, priorItems, () => null);
    const priorAfterFirst: PriorItem[] = first.map((i, idx) => ({
      id: 2000 + idx,
      partId: i.partId,
      partName: i.partName,
      partPrice: i.partPrice,
      laborHours: i.laborHours,
      controllerLetter: i.controllerLetter,
      zoneNumber: i.zoneNumber,
      issueType: i.issueType,
      completedAt: i.completedAt,
      findingId: i.findingId,
    }));
    const second = buildFinalItems(incoming, priorAfterFirst, () => null);
    assert.equal(second[0].totalPrice, first[0].totalPrice, "total must be stable");
    assert.equal(second[0].partPrice, first[0].partPrice, "price must be stable");
  });
});
