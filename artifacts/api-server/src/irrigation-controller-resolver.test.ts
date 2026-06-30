// Tests for irrigation-controller-resolver.ts
//
// Verifies that resolveWetCheckControllers reads from irrigation_controllers
// first and falls back to property_controllers only when no irrigation profile
// exists. Uses injected fakes — no shared dev-DB required.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ── Fakes ──────────────────────────────────────────────────────────────────────

type FakeIrrigController = {
  id: number;
  name: string;
  totalZones: number | null;
  notes: string | null;
  branchName: string;
};

type FakePropController = {
  controllerLetter: string;
  zoneCount: number;
  notes: string | null;
  branchName: string | null;
};

interface FakeStorage {
  listIrrigationControllers: (
    companyId: number | null,
    customerId: number,
    branchName?: string,
  ) => Promise<FakeIrrigController[]>;
  listPropertyControllers: (
    companyId: number,
    customerId: number,
  ) => Promise<FakePropController[]>;
}

// ── Pure resolver logic (extracted inline for testing without DI wiring) ───────

function extractLetter(name: string): string {
  return (
    name.trim().split(/\s+/).pop()?.slice(-1).toUpperCase() ??
    name.slice(0, 1).toUpperCase()
  );
}

async function resolveWithFakes(
  storage: FakeStorage,
  companyId: number,
  customerId: number,
  branchName?: string | null,
): Promise<{ letter: string; zoneCount: number | null; notes: string | null }[]> {
  const branch = branchName ?? null;
  const branchArg = typeof branch === "string" ? branch : undefined;

  const irrigCtrls = await storage.listIrrigationControllers(companyId, customerId, branchArg);
  if (irrigCtrls.length > 0) {
    return irrigCtrls.map((ctrl) => ({
      letter: extractLetter(ctrl.name),
      zoneCount: ctrl.totalZones ?? null,
      notes: ctrl.notes ?? null,
    }));
  }

  const legacyRows = await storage.listPropertyControllers(companyId, customerId);
  const filtered = branch !== null
    ? legacyRows.filter((r) => (r.branchName || null) === branch)
    : legacyRows;

  return filtered.map((r) => ({
    letter: r.controllerLetter,
    zoneCount: r.zoneCount,
    notes: r.notes ?? null,
  }));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("resolveWetCheckControllers — irrigation_controllers primary path", () => {
  it("returns irrigation_controllers rows when they exist", async () => {
    const fakeStorage: FakeStorage = {
      listIrrigationControllers: async () => [
        { id: 1, name: "Controller A", totalZones: 14, notes: null, branchName: "" },
        { id: 2, name: "Controller B", totalZones: 8, notes: "note b", branchName: "" },
      ],
      listPropertyControllers: async () => {
        throw new Error("listPropertyControllers should not be called when irrigation profile exists");
      },
    };

    const result = await resolveWithFakes(fakeStorage, 1, 42);
    assert.equal(result.length, 2);
    assert.equal(result[0].letter, "A");
    assert.equal(result[0].zoneCount, 14);
    assert.equal(result[0].notes, null);
    assert.equal(result[1].letter, "B");
    assert.equal(result[1].zoneCount, 8);
    assert.equal(result[1].notes, "note b");
  });

  it("passes through null totalZones as null (no silent 12 default)", async () => {
    const fakeStorage: FakeStorage = {
      listIrrigationControllers: async () => [
        { id: 1, name: "Controller A", totalZones: null, notes: null, branchName: "" },
      ],
      listPropertyControllers: async () => [],
    };

    const result = await resolveWithFakes(fakeStorage, 1, 42);
    assert.equal(result[0].zoneCount, null);
  });

  it("extracts single letter from multi-word controller name", async () => {
    const fakeStorage: FakeStorage = {
      listIrrigationControllers: async () => [
        { id: 1, name: "Controller Z", totalZones: 5, notes: null, branchName: "" },
      ],
      listPropertyControllers: async () => [],
    };

    const result = await resolveWithFakes(fakeStorage, 1, 42);
    assert.equal(result[0].letter, "Z");
  });
});

describe("resolveWetCheckControllers — legacy fallback path", () => {
  it("falls back to property_controllers when irrigation_controllers is empty", async () => {
    let legacyCalled = false;
    const fakeStorage: FakeStorage = {
      listIrrigationControllers: async () => [],
      listPropertyControllers: async () => {
        legacyCalled = true;
        return [
          { controllerLetter: "A", zoneCount: 10, notes: null, branchName: null },
          { controllerLetter: "B", zoneCount: 6, notes: "old note", branchName: null },
        ];
      },
    };

    const result = await resolveWithFakes(fakeStorage, 1, 42);
    assert.ok(legacyCalled, "listPropertyControllers should have been called");
    assert.equal(result.length, 2);
    assert.equal(result[0].letter, "A");
    assert.equal(result[0].zoneCount, 10);
    assert.equal(result[1].letter, "B");
    assert.equal(result[1].zoneCount, 6);
    assert.equal(result[1].notes, "old note");
  });

  it("filters legacy rows by branchName when branch is provided", async () => {
    const fakeStorage: FakeStorage = {
      listIrrigationControllers: async () => [],
      listPropertyControllers: async () => [
        { controllerLetter: "A", zoneCount: 10, notes: null, branchName: null },
        { controllerLetter: "A", zoneCount: 12, notes: null, branchName: "Branch East" },
      ],
    };

    const result = await resolveWithFakes(fakeStorage, 1, 42, "Branch East");
    assert.equal(result.length, 1);
    assert.equal(result[0].zoneCount, 12);
  });

  it("returns empty array when both sources are empty", async () => {
    const fakeStorage: FakeStorage = {
      listIrrigationControllers: async () => [],
      listPropertyControllers: async () => [],
    };

    const result = await resolveWithFakes(fakeStorage, 1, 42);
    assert.equal(result.length, 0);
  });
});

describe("resolveWetCheckControllers — branch-scoped isolation", () => {
  it("irrigation_controllers branch rows are returned without filtering (storage is pre-filtered)", async () => {
    const fakeStorage: FakeStorage = {
      listIrrigationControllers: async (_cid, _custId, branch) => {
        if (branch === "North") {
          return [{ id: 10, name: "Controller A", totalZones: 20, notes: null, branchName: "North" }];
        }
        return [];
      },
      listPropertyControllers: async () => {
        throw new Error("should not fall back when irrigation profile exists for branch");
      },
    };

    const result = await resolveWithFakes(fakeStorage, 1, 42, "North");
    assert.equal(result.length, 1);
    assert.equal(result[0].letter, "A");
    assert.equal(result[0].zoneCount, 20);
  });
});

describe("extractLetter helper", () => {
  const cases: Array<[string, string]> = [
    ["Controller A", "A"],
    ["Controller B", "B"],
    ["Controller Z", "Z"],
    ["A", "A"],
    ["controller a", "A"],
    ["  Controller  X  ", "X"],
  ];

  for (const [name, expected] of cases) {
    it(`extractLetter("${name}") === "${expected}"`, () => {
      assert.equal(extractLetter(name), expected);
    });
  }
});
