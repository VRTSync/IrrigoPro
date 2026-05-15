// Task #612 — locks in the wet-check finding invariants:
//   1. partId set       → noPartNeeded must be false
//   2. noPartNeeded=true → partId/partName/partPrice must be null
//
// Without these, a tech flipping "no part needed" on a finding that
// already had a part assigned could land the row in the forbidden
// double-true state, which tripped the auto-bill preview.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { applyNoPartNeededInvariant } from "./wet-check-finding-invariants";

describe("applyNoPartNeededInvariant — wet-check finding two-state invariant", () => {
  it("clears noPartNeeded when the patch assigns a partId (rule 1)", () => {
    // Caller has already loaded the part snapshot into `next` before
    // calling the helper. The helper just enforces the cross-field rule.
    const patch = { partId: 42 } as const;
    const next: Record<string, unknown> = {
      partId: 42,
      partName: "1804-PRS40",
      partPrice: "12.50",
      noPartNeeded: true, // stale value carried from the prior row
    };
    applyNoPartNeededInvariant(patch, next);
    assert.equal(next.noPartNeeded, false);
    assert.equal(next.partId, 42);
    assert.equal(next.partName, "1804-PRS40");
  });

  it("clears the part snapshot when the patch flips noPartNeeded=true without touching partId (rule 2 — Task #612 fix)", () => {
    // This is the regression path: tech flipped the labor-only checkbox
    // on a finding that already had a part. Before #612, storage left
    // partId/partName/partPrice in place AND set noPartNeeded=true,
    // violating the invariant.
    const patch = { noPartNeeded: true } as const;
    const next: Record<string, unknown> = {
      // Drizzle spread of `...patch` only carries noPartNeeded; the
      // partId/partName/partPrice columns are unchanged at this point
      // because they were not in the patch — but the DB row still has
      // them. The helper must explicitly null them so the UPDATE wipes
      // the part snapshot.
      noPartNeeded: true,
    };
    applyNoPartNeededInvariant(patch, next);
    assert.equal(next.noPartNeeded, true);
    assert.equal(next.partId, null);
    assert.equal(next.partName, null);
    assert.equal(next.partPrice, null);
  });

  it("does not touch part fields when noPartNeeded is flipped together with a partId (the patch is explicit, caller wins)", () => {
    const patch = { noPartNeeded: true, partId: 7 } as const;
    const next: Record<string, unknown> = {
      noPartNeeded: true,
      partId: 7,
      partName: "1812",
      partPrice: "8.00",
    };
    applyNoPartNeededInvariant(patch, next);
    // Rule 1 wins: partId is being explicitly assigned, so the
    // labor-only flag is cleared even though the body sent true.
    assert.equal(next.noPartNeeded, false);
    assert.equal(next.partId, 7);
    assert.equal(next.partName, "1812");
  });

  it("is a no-op when neither partId nor noPartNeeded is in the patch (e.g. a notes-only edit)", () => {
    const patch = { notes: "new note" } as const;
    const next: Record<string, unknown> = { notes: "new note" };
    applyNoPartNeededInvariant(patch, next);
    assert.deepEqual(next, { notes: "new note" });
  });

  it("an explicit partId=null + noPartNeeded=true is honored — the row lands labor-only with no part snapshot (non-UI caller path)", () => {
    // First-party clients already send { partId: null, partName: null,
    // partPrice: null, noPartNeeded: true } as the labor-only payload,
    // so `next` already has those nulls when this helper runs and
    // there is nothing to clear. This test pins that contract for
    // non-UI API callers who send the same body shape.
    const patch = { partId: null, noPartNeeded: true } as const;
    const next: Record<string, unknown> = {
      partId: null,
      partName: null,
      partPrice: null,
      noPartNeeded: true,
    };
    applyNoPartNeededInvariant(patch, next);
    assert.equal(next.noPartNeeded, true);
    assert.equal(next.partId, null);
    assert.equal(next.partName, null);
    assert.equal(next.partPrice, null);
  });

  it("does not touch the part snapshot when the patch flips noPartNeeded=false", () => {
    // Flipping the flag OFF is unambiguous — leave the part fields
    // alone so the caller's explicit patch wins.
    const patch = { noPartNeeded: false } as const;
    const next: Record<string, unknown> = {
      noPartNeeded: false,
      // pretend the DB row already had a part — we should leave it.
    };
    applyNoPartNeededInvariant(patch, next);
    assert.equal(next.noPartNeeded, false);
    assert.equal("partId" in next, false);
    assert.equal("partName" in next, false);
  });
});
