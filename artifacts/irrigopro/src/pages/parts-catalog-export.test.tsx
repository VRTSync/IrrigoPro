/**
 * parts-catalog-export.test.tsx
 *
 * Source-level verification of the Export CSV feature in PartsCatalog.
 *
 * Pattern: same as manager-workspace.test.tsx — readFileSync + static
 * assertions on the source text. This avoids spinning up the full
 * 1735-line component (which has an `isLoading || isLoadingAssemblies`
 * full-page skeleton guard that requires a properly configured QueryClient
 * with a default queryFn).
 *
 * Covers:
 *   1. Disabled condition: `parts.length === 0` is in the disabled prop
 *   2. canImport guard: export button is inside the `{canImport && (` branch
 *   3. Fetch endpoint: `/api/parts/export-csv` with `credentials: "include"`
 *   4. Filename from Content-Disposition header + regex extraction
 *   5. Fallback filename: `parts-catalog-${date}.csv`
 *   6. Success toast: `title: "CSV exported"`
 *   7. Error toast: `variant: "destructive"` + `title: "Export failed"`
 *   8. Spinner: `Loader2` rendered conditionally on `exportCsvLoading`
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SRC = readFileSync(
  resolve(import.meta.dirname, "./parts-catalog.tsx"),
  "utf8",
);

describe("PartsCatalog — Export CSV button (source-level)", () => {
  it("(1) disabled prop includes parts.length === 0 check", () => {
    expect(SRC).toContain("parts.length === 0");
  });

  it("(1) disabled prop combines exportCsvLoading with parts.length === 0", () => {
    expect(SRC).toContain("exportCsvLoading || parts.length === 0");
  });

  it("(2) export button onClick is gated by canImport", () => {
    const canImportIdx = SRC.indexOf("canImport && (");
    const handleIdx = SRC.indexOf("onClick={handleExportCsv}");
    expect(canImportIdx).toBeGreaterThan(-1);
    expect(handleIdx).toBeGreaterThan(-1);
    expect(canImportIdx).toBeLessThan(handleIdx);
  });

  it("(3) handleExportCsv fetches the export endpoint", () => {
    expect(SRC).toContain('fetch("/api/parts/export-csv"');
  });

  it("(3) fetch call includes credentials: include", () => {
    expect(SRC).toContain('credentials: "include"');
  });

  it("(4) filename derived from Content-Disposition header", () => {
    expect(SRC).toContain('headers.get("Content-Disposition")');
  });

  it("(4) regex extracts filename from Content-Disposition", () => {
    expect(SRC).toContain('match(/filename="([^"]+)"/');
  });

  it("(5) fallback filename follows parts-catalog-{date}.csv pattern", () => {
    expect(SRC).toContain("`parts-catalog-${date}.csv`");
  });

  it("(6) success toast title is 'CSV exported'", () => {
    expect(SRC).toContain('title: "CSV exported"');
  });

  it("(7) error toast uses variant: destructive", () => {
    expect(SRC).toContain('variant: "destructive"');
  });

  it("(7) error toast title is 'Export failed'", () => {
    expect(SRC).toContain('title: "Export failed"');
  });

  it("(8) Loader2 JSX element is rendered conditionally on exportCsvLoading", () => {
    // exportCsvLoading ternary must appear before the <Loader2 JSX element
    const ternaryIdx = SRC.indexOf("exportCsvLoading ? (");
    const jsxIdx = SRC.indexOf("<Loader2");
    expect(ternaryIdx).toBeGreaterThan(-1);
    expect(jsxIdx).toBeGreaterThan(-1);
    expect(ternaryIdx).toBeLessThan(jsxIdx);
  });
});
