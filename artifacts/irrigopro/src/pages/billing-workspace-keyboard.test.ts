// Task #709 — keyboard contract regression for the Billing Workspace.
//
// Static-source guards so the keymap can't silently regress.
// Mount-based testing was tried first but the page's deep tree of
// providers/hooks made it brittle; the source check is sufficient
// because the keymap is a small switch in one file.

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const SRC = fs.readFileSync(
  path.resolve(__dirname, "billing-workspace.tsx"),
  "utf8",
);

function sliceBetween(src: string, startMarker: RegExp, endMarker: RegExp): string {
  const s = src.search(startMarker);
  if (s < 0) return "";
  const tail = src.slice(s);
  const e = tail.search(endMarker);
  return e < 0 ? tail : tail.slice(0, e);
}

describe("billing-workspace keyboard contract (Task #709)", () => {
  it("J moves to next row", () => {
    const jBranch = sliceBetween(
      SRC,
      /if \(e\.key === "j" \|\| e\.key === "J"\)/,
      /else if \(e\.key === "k"/,
    );
    expect(jBranch).toContain("moveSelection(1)");
  });

  it("K is previous-row navigation by default", () => {
    const kBranch = sliceBetween(
      SRC,
      /else if \(e\.key === "k" \|\| e\.key === "K"\)/,
      /else if \(e\.key === "a"/,
    );
    expect(kBranch).toContain("moveSelection(-1)");
  });

  it("K disambiguation: kicks back when the drawer is open", () => {
    const kBranch = sliceBetween(
      SRC,
      /else if \(e\.key === "k" \|\| e\.key === "K"\)/,
      /else if \(e\.key === "a"/,
    );
    expect(kBranch).toMatch(/drawerOpen/);
    expect(kBranch).toContain("kickbackActive(");
  });

  it("A approves the highlighted row", () => {
    const aBranch = sliceBetween(
      SRC,
      /else if \(e\.key === "a" \|\| e\.key === "A"\)/,
      /else if \(e\.key === "b"/,
    );
    expect(aBranch).toContain("approveActive()");
  });

  it("Ctrl/Cmd+S saves edits and does NOT call approve", () => {
    const ctrlBranch = sliceBetween(
      SRC,
      /if \(\(e\.ctrlKey \|\| e\.metaKey\) && e\.key\.toLowerCase\(\) === "s"\)/,
      /if \(inField\)/,
    );
    expect(ctrlBranch).toContain("saveActiveEdits()");
    expect(ctrlBranch).not.toContain("approveActive(");
  });

  it("/ focuses the search input", () => {
    const slashBranch = sliceBetween(
      SRC,
      /else if \(e\.key === "\/"\)/,
      /else if \(e\.key === "\?"\)/,
    );
    expect(slashBranch).toContain("searchRef");
  });

  it("? toggles the cheat sheet", () => {
    const qBranch = sliceBetween(
      SRC,
      /else if \(e\.key === "\?"\)/,
      /else if \(e\.key === "Escape"\)/,
    );
    expect(qBranch).toContain("setCheatsheetOpen");
  });

  it("Esc closes overlays", () => {
    expect(SRC).toMatch(/else if \(e\.key === "Escape"\)/);
  });

  it("filter presets All Pending / Just Parts / > $1,000 are present", () => {
    expect(SRC).toContain('data-testid="preset-all-pending"');
    expect(SRC).toContain('data-testid="preset-just-parts"');
    expect(SRC).toContain('data-testid="preset-over-1000"');
  });

  it("cheat sheet documents the K disambiguation", () => {
    expect(SRC).toMatch(/Previous row[\s\S]{0,40}Kickback/i);
  });

  it("kickbackActive posts to /return-for-correction (not /kickback)", () => {
    const fn = sliceBetween(
      SRC,
      /const kickbackActive = useCallback/,
      /const saveActiveEdits = useCallback/,
    );
    expect(fn).toContain("/return-for-correction");
    expect(fn).not.toMatch(/\/kickback[^s]/);
  });

  it("kickbackActive sends body key 'notes' (not 'reason')", () => {
    const fn = sliceBetween(
      SRC,
      /const kickbackActive = useCallback/,
      /const saveActiveEdits = useCallback/,
    );
    expect(fn).toMatch(/\{\s*notes:/);
    expect(fn).not.toMatch(/\{\s*reason:/);
  });

  it("kickbackActive short-circuits with 'Not supported' toast for unsupported item types", () => {
    const fn = sliceBetween(
      SRC,
      /const kickbackActive = useCallback/,
      /const saveActiveEdits = useCallback/,
    );
    expect(fn).toContain("Not supported");
    expect(fn).toMatch(/else\s*\{[\s\S]{0,200}Not supported/);
  });
});
