/**
 * Task #1090 — WCB Billing Gate
 * Frontend regression: ManagerWetCheckDetailPage must NOT render
 * any "Approve" button or approve-related UI for ANY wet-check status.
 *
 * We use a static source-text guard so the test runs fast without
 * needing router / fetch mocks. Only actionable (JSX element) patterns
 * are banned — "approved" in comments is allowed because it describes
 * historical context.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const PAGE_SRC = readFileSync(
  resolve(__dirname, "ManagerWetCheckDetailPage.tsx"),
  "utf8",
);

// Strip // line comments and /* block comments */ so the guards below
// only fire on live JSX / TS code, not documentation.
const CODE_ONLY = PAGE_SRC
  // block comments
  .replace(/\/\*[\s\S]*?\*\//g, "")
  // line comments
  .replace(/\/\/[^\n]*/g, "");

describe("ManagerWetCheckDetailPage — approve CTA removed (Task #1090)", () => {
  it("no approve mutation variable (approveMut)", () => {
    expect(CODE_ONLY).not.toContain("approveMut");
  });

  it("no handleApprove handler", () => {
    expect(CODE_ONLY).not.toContain("handleApprove");
  });

  it("no approve API endpoint call", () => {
    // The endpoint was /api/wet-checks/:id/approve
    expect(CODE_ONLY).not.toMatch(/\/api\/wet-checks[^"']*\/approve/);
  });

  it("no 'approved' branch in STATUS_LABELS object", () => {
    // STATUS_LABELS should not have an "approved" key
    expect(CODE_ONLY).not.toMatch(/STATUS_LABELS\s*=\s*\{[^}]*["']approved["']/s);
  });

  it("no mgr-cta-approved data-testid in JSX", () => {
    expect(CODE_ONLY).not.toContain("mgr-cta-approved");
  });

  it("no Approve button label in JSX", () => {
    // No JSX text node with >Approve< or >Approve Wet Check<
    expect(CODE_ONLY).not.toMatch(/>Approve[\s<]/);
  });

  it("still has the convert CTA for submitted status", () => {
    expect(CODE_ONLY).toContain("mgr-cta-submitted");
    expect(CODE_ONLY).toContain("Begin Triage");
  });

  it("still has outcome display for converted status", () => {
    expect(CODE_ONLY).toContain("converted");
  });
});
