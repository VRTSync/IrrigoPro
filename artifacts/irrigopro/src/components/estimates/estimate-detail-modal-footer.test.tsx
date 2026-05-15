// Task #630 — Regression test for bug #2.
//
// The detail modal footer used to be a single
// `flex flex-col sm:flex-row justify-end gap-3` row, which on the
// `pending` track renders up to seven buttons (Close, View PDF,
// Download PDF, Resend, Edit, Email, Approve, Reject). At any
// `sm:`-and-up viewport that doesn't fit on the narrower laptop
// widths and the rightmost actions overflowed past the modal edge.
//
// The fix groups secondary actions on the left and primary actions
// on the right, wraps the outer container with `flex-wrap`, and
// keeps each inner cluster flex-wrap as well. This test is a
// static-source guard — Tailwind's responsive classes don't apply
// in jsdom so we assert directly on the class strings that the fix
// is in place and can't silently regress.

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const SOURCE_PATH = path.resolve(
  import.meta.dirname,
  "estimate-detail-modal.tsx",
);
const source = fs.readFileSync(SOURCE_PATH, "utf8");

describe("Estimate detail modal footer layout (Task #630, bug #2)", () => {
  it("the footer container is tagged with data-testid='detail-modal-footer'", () => {
    expect(source).toContain('data-testid="detail-modal-footer"');
  });

  it("the outer footer row uses flex-wrap so buttons cannot overflow off-screen", () => {
    // The whole point of the fix: the outer wrapper must allow wrapping
    // at sm+ widths. Without `sm:flex-wrap` the seven-button pending
    // toolbar slices off the right edge on a 1024x600 laptop.
    expect(source).toMatch(
      /flex flex-col-reverse sm:flex-row sm:flex-wrap[^"]*sm:justify-between/,
    );
  });

  it("each inner cluster (secondary + primary) is also flex-wrap so dense rows wrap onto two lines instead of clipping", () => {
    const inner = source.match(/sm:flex-wrap/g) ?? [];
    // outer + secondary + primary
    expect(inner.length).toBeGreaterThanOrEqual(3);
  });

  it("does not regress to the legacy single-row layout with `justify-end` and no wrap", () => {
    // The exact pre-fix class string. If anyone reverts the JSX this
    // string will reappear and we want the regression to fail loudly.
    expect(source).not.toContain(
      'className="flex flex-col sm:flex-row justify-end gap-3"',
    );
  });

  it("Download PDF and View PDF buttons live inside the footer and carry stable testids", () => {
    expect(source).toContain('data-testid="detail-modal-download-pdf"');
    expect(source).toContain('data-testid="detail-modal-view-pdf"');
    expect(source).toContain('data-testid="detail-modal-close"');
  });

  it("Approve / Reject / Email Customer / Convert buttons all carry stable testids so future overflow tests have anchors", () => {
    for (const id of [
      "detail-modal-send-email",
      "detail-modal-approve",
      "detail-modal-reject",
      "detail-modal-convert",
    ]) {
      expect(source).toContain(`data-testid="${id}"`);
    }
  });
});
