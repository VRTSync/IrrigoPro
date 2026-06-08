// Static-source regression guard for the estimate → work order conversion
// status-stamp contract.
//
// Two storage functions create work orders from estimates:
//   - createWorkOrderFromEstimate  (manual convert button)
//   - approveEstimateAndCreateWorkOrder (manual-approve-and-create path)
//
// After creating a work order both functions must stamp
// `status: 'converted_to_work_order'` on the estimate row so that:
//   (a) isConvertedToWorkOrder() returns true and the "Convert" button hides
//   (b) the lifecycle column stays in sync (converted_to_work_order → 'approved')
//
// Previously both functions left `status: 'approved'` which caused the
// "Convert to Work Order" button to remain visible indefinitely and a second
// click to fail with a generic 400 / toast error.
//
// This test reads the storage.ts source text and asserts the correct patterns
// are present, so any future regression reverts are caught at test time.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

const STORAGE_PATH = path.resolve(import.meta.dirname, "../storage.ts");
const src = fs.readFileSync(STORAGE_PATH, "utf8");

// ── helpers ───────────────────────────────────────────────────────────────────

/**
 * Extract the source text of a named async method. Works by:
 * 1. Finding `async <name>(` in the source.
 * 2. Scanning past the parameter list (balanced parens).
 * 3. Scanning past the return type annotation (which may itself contain `{}`
 *    as in `Promise<{ field: Type }>`). We do this by scanning until we find
 *    `{` at brace-depth 0 *outside* angle brackets.
 * 4. Then counting braces to find the matching `}` that closes the method body.
 */
function extractMethod(source: string, methodName: string): string {
  const startRe = new RegExp(`async ${methodName}\\s*\\(`);
  const startMatch = startRe.exec(source);
  assert.ok(startMatch, `Method '${methodName}' not found in storage.ts`);

  let i = startMatch.index + startMatch[0].length - 1; // position of '('

  // Step 1: scan past the parameter list (balanced parens)
  let parenDepth = 0;
  while (i < source.length) {
    if (source[i] === "(") parenDepth++;
    else if (source[i] === ")") {
      parenDepth--;
      if (parenDepth === 0) { i++; break; }
    }
    i++;
  }

  // Step 2: scan past the return type annotation to find the opening `{` of
  // the method body. The return type may contain `<{...}>` generics so we
  // track angle-bracket depth and only stop at `{` when angleDepth === 0.
  let angleDepth = 0;
  while (i < source.length) {
    const ch = source[i];
    if (ch === "<") { angleDepth++; i++; continue; }
    if (ch === ">") { angleDepth--; i++; continue; }
    if (ch === "{" && angleDepth === 0) break; // found the method body open
    i++;
  }

  // Step 3: count braces to find the matching close of the method body.
  const bodyStart = i;
  let braceDepth = 0;
  while (i < source.length) {
    if (source[i] === "{") braceDepth++;
    else if (source[i] === "}") {
      braceDepth--;
      if (braceDepth === 0) return source.slice(startMatch.index, i + 1);
    }
    i++;
  }
  throw new Error(`Could not find closing brace for method '${methodName}' (bodyStart=${bodyStart})`);
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("estimate → work order conversion status-stamp regression guard", () => {
  it("createWorkOrderFromEstimate stamps status: 'converted_to_work_order'", () => {
    const body = extractMethod(src, "createWorkOrderFromEstimate");
    assert.ok(
      body.includes("status: 'converted_to_work_order'") ||
        body.includes('status: "converted_to_work_order"'),
      "createWorkOrderFromEstimate must write status: 'converted_to_work_order' on the estimate update",
    );
  });

  it("createWorkOrderFromEstimate does NOT write status: 'approved' after inserting the work order", () => {
    const body = extractMethod(src, "createWorkOrderFromEstimate");

    // Find the position of the work order insert
    const insertIdx = body.indexOf("insert(workOrders)");
    assert.ok(
      insertIdx !== -1,
      "Could not locate insert(workOrders) in createWorkOrderFromEstimate",
    );

    // Everything after the insert must not contain status: 'approved'
    const afterInsert = body.slice(insertIdx);
    const hasApprovedStamp =
      afterInsert.includes("status: 'approved'") ||
      afterInsert.includes('status: "approved"');
    assert.ok(
      !hasApprovedStamp,
      "createWorkOrderFromEstimate must not write status: 'approved' after creating the work order",
    );
  });

  it("approveEstimateAndCreateWorkOrder back-link update stamps status: 'converted_to_work_order'", () => {
    const body = extractMethod(src, "approveEstimateAndCreateWorkOrder");

    // The back-link update is the estimates.set({...}) that contains both
    // `workOrderId: newWorkOrder.id` AND the status stamp. We search for a
    // pattern that is unique to the back-link set() block and cannot match
    // the workOrderItems insert (which also has `workOrderId: newWorkOrder.id`
    // but as the first field in a different .values() call).
    // The estimates update uses .update(estimates).set({...}), so searching
    // for `update(estimates)` and then checking the surrounding block is reliable.
    const updateEstimatesPattern = /\.update\(estimates\)[^;]+;/gs;
    const updateBlocks: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = updateEstimatesPattern.exec(body)) !== null) {
      updateBlocks.push(m[0]);
    }
    assert.ok(
      updateBlocks.length > 0,
      "No .update(estimates) call found in approveEstimateAndCreateWorkOrder",
    );

    // The back-link update is the last .update(estimates) block (the first
    // is the approve flip that sets status='approved').
    const backLinkBlock = updateBlocks[updateBlocks.length - 1];
    assert.ok(
      backLinkBlock.includes("status: 'converted_to_work_order'") ||
        backLinkBlock.includes('status: "converted_to_work_order"'),
      `approveEstimateAndCreateWorkOrder back-link update must set status: 'converted_to_work_order'.\nBack-link block found:\n${backLinkBlock}`,
    );
  });

  it("approveEstimateAndCreateWorkOrder does NOT write status: 'approved' in the back-link update", () => {
    const body = extractMethod(src, "approveEstimateAndCreateWorkOrder");

    // Collect all .update(estimates) blocks; the last one is the back-link.
    const updateEstimatesPattern = /\.update\(estimates\)[^;]+;/gs;
    const updateBlocks: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = updateEstimatesPattern.exec(body)) !== null) {
      updateBlocks.push(m[0]);
    }
    assert.ok(
      updateBlocks.length > 0,
      "No .update(estimates) call found in approveEstimateAndCreateWorkOrder",
    );

    const backLinkBlock = updateBlocks[updateBlocks.length - 1];
    const hasApprovedStamp =
      backLinkBlock.includes("status: 'approved'") ||
      backLinkBlock.includes('status: "approved"');
    assert.ok(
      !hasApprovedStamp,
      `approveEstimateAndCreateWorkOrder back-link update must not write status: 'approved'.\nBack-link block found:\n${backLinkBlock}`,
    );
  });
});
