// Task #468 — locks in the FindingSheet edit-save payload for findings the
// tech already marked as repaired-in-field.
//
// Task #467 unlocked the pencil/photo/delete buttons on completed-in-field
// findings. The risk these tests guard against: when the tech opens such a
// finding and saves it (e.g. just to attach a photo), the resulting PATCH
// body must NOT silently demote the finding back to pending. That would
// quietly break the auto-bill / completed-in-field accounting.

import { describe, it, expect } from "vitest";
import {
  buildFindingSavePayload,
  type FindingSavePayloadInput,
} from "./finding-save-payload";

// Defaults mirror the FindingSheet useEffect that hydrates form state from
// the existing finding (resolution → repairedInField, noPartNeeded passes
// through). Tests override only the fields they care about.
function inputFromEditing(overrides: Partial<FindingSavePayloadInput> = {}): FindingSavePayloadInput {
  return {
    selectedPart: null,
    partFromEdit: null,
    quantity: "1",
    laborHours: "0.5",
    notes: "leaking head replaced on the spot",
    repairedInField: true,
    noPartNeeded: false,
    ...overrides,
  };
}

describe("buildFindingSavePayload — edit save preserves completed-in-field state", () => {
  it("keeps repairedInField=true and techDisposition=completed_in_field for a labor-only repaired-in-field finding", () => {
    // Mirrors a finding that was created via Mark Complete with no part
    // (noPartNeeded=true) and is now being re-saved from the edit sheet.
    const payload = buildFindingSavePayload(
      inputFromEditing({
        selectedPart: null,
        partFromEdit: { id: null, name: null, price: null },
        repairedInField: true,
        noPartNeeded: true,
      }),
    );
    expect(payload.repairedInField).toBe(true);
    expect(payload.techDisposition).toBe("completed_in_field");
    // Labor-only confirmation must survive the edit — without it the
    // server's submit-time guard would reject the finding as unbillable.
    expect(payload.noPartNeeded).toBe(true);
    expect(payload.partId).toBeNull();
  });

  it("keeps repairedInField=true and clears noPartNeeded when the finding has a part assigned (mirrors server guard)", () => {
    // A repaired-in-field finding that also has a part on it. Server-side
    // updateWetCheckFinding force-clears noPartNeeded whenever partId is
    // set, so the client must do the same to avoid sending a contradictory
    // pair the server will reject.
    const payload = buildFindingSavePayload(
      inputFromEditing({
        selectedPart: null,
        partFromEdit: { id: 42, name: "Hunter PGP", price: "12.50" },
        repairedInField: true,
        noPartNeeded: false,
      }),
    );
    expect(payload.repairedInField).toBe(true);
    expect(payload.techDisposition).toBe("completed_in_field");
    expect(payload.noPartNeeded).toBe(false);
    expect(payload.partId).toBe(42);
    expect(payload.partName).toBe("Hunter PGP");
    expect(payload.partPrice).toBe("12.50");
  });

  it("a fresh part picked in the edit sheet wins over the previously stored part", () => {
    // selectedPart (just picked) takes precedence over partFromEdit
    // (hydrated from the existing finding). Locks in the effectivePart()
    // tiebreak that the edit UI relies on.
    const payload = buildFindingSavePayload(
      inputFromEditing({
        selectedPart: { id: 7, name: "Rain Bird 5000", price: "9.99" },
        partFromEdit: { id: 42, name: "Hunter PGP", price: "12.50" },
        repairedInField: true,
        noPartNeeded: false,
      }),
    );
    expect(payload.partId).toBe(7);
    expect(payload.partName).toBe("Rain Bird 5000");
    expect(payload.partPrice).toBe("9.99");
  });

  it("flips to needs_review/repairedInField=false when the tech turns Mark Complete off", () => {
    const payload = buildFindingSavePayload(
      inputFromEditing({
        partFromEdit: { id: null, name: null, price: null },
        repairedInField: false,
        // Even if noPartNeeded was true on the row, repairedInField=false
        // forces noPartNeeded back to false in the payload (the labor-only
        // confirmation is meaningless without Mark Complete).
        noPartNeeded: true,
      }),
    );
    expect(payload.repairedInField).toBe(false);
    expect(payload.techDisposition).toBe("needs_review");
    expect(payload.noPartNeeded).toBe(false);
  });
});

import { quantizeLaborHours } from "./finding-save-payload";

describe("quantizeLaborHours integration", () => {
  it('"0.33" rounds down to "0.25"', () => {
    expect(quantizeLaborHours("0.33")).toBe("0.25");
  });

  it('"0.40" rounds up to "0.50"', () => {
    expect(quantizeLaborHours("0.40")).toBe("0.50");
  });

  it('"1.00" is an exact multiple and stays "1.00"', () => {
    expect(quantizeLaborHours("1.00")).toBe("1.00");
  });

  it('"0.10" is below the 0.25 minimum and clamps to "0.25"', () => {
    expect(quantizeLaborHours("0.10")).toBe("0.25");
  });

  it('empty string falls back to the default "0.25"', () => {
    expect(quantizeLaborHours("")).toBe("0.25");
  });
});
