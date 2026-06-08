import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  formatEstimateNumber,
  sanitizeFilenameSegment,
  buildEstimatePdfFilename,
} from "./estimate-number.js";

describe("formatEstimateNumber", () => {
  it("returns empty string for null", () => {
    assert.equal(formatEstimateNumber(null), "");
  });

  it("returns empty string for undefined", () => {
    assert.equal(formatEstimateNumber(undefined), "");
  });

  it("returns empty string for empty string", () => {
    assert.equal(formatEstimateNumber(""), "");
  });

  it("returns empty string for whitespace-only string", () => {
    assert.equal(formatEstimateNumber("   "), "");
  });

  it("prefixes plain digits with EST-", () => {
    assert.equal(formatEstimateNumber("50001"), "EST-50001");
  });

  it("accepts a number value", () => {
    assert.equal(formatEstimateNumber(50001), "EST-50001");
  });

  it("strips existing EST- prefix and re-applies it", () => {
    assert.equal(formatEstimateNumber("EST-50001"), "EST-50001");
  });

  it("strips EST prefix without dash", () => {
    assert.equal(formatEstimateNumber("EST50001"), "EST-50001");
  });

  it("strips EST prefix case-insensitively", () => {
    assert.equal(formatEstimateNumber("est-50001"), "EST-50001");
    assert.equal(formatEstimateNumber("Est-50001"), "EST-50001");
  });

  it("strips leading # prefix", () => {
    assert.equal(formatEstimateNumber("#50001"), "EST-50001");
  });

  it("strips # with trailing space", () => {
    assert.equal(formatEstimateNumber("# 50001"), "EST-50001");
  });

  it("handles alphanumeric identifiers", () => {
    assert.equal(formatEstimateNumber("A-001"), "EST-A-001");
  });
});

describe("sanitizeFilenameSegment", () => {
  it("returns empty string for null", () => {
    assert.equal(sanitizeFilenameSegment(null), "");
  });

  it("returns empty string for undefined", () => {
    assert.equal(sanitizeFilenameSegment(undefined), "");
  });

  it("returns empty string for empty string", () => {
    assert.equal(sanitizeFilenameSegment(""), "");
  });

  it("passes through a plain name unchanged", () => {
    assert.equal(sanitizeFilenameSegment("Acme Corp"), "Acme Corp");
  });

  it("replaces forward slash", () => {
    assert.equal(sanitizeFilenameSegment("A/B"), "A B");
  });

  it("replaces backslash", () => {
    assert.equal(sanitizeFilenameSegment("A\\B"), "A B");
  });

  it("replaces colon", () => {
    assert.equal(sanitizeFilenameSegment("A:B"), "A B");
  });

  it("replaces asterisk", () => {
    assert.equal(sanitizeFilenameSegment("A*B"), "A B");
  });

  it("replaces question mark", () => {
    assert.equal(sanitizeFilenameSegment("A?B"), "A B");
  });

  it('replaces double-quote', () => {
    assert.equal(sanitizeFilenameSegment('A"B'), "A B");
  });

  it("replaces less-than", () => {
    assert.equal(sanitizeFilenameSegment("A<B"), "A B");
  });

  it("replaces greater-than", () => {
    assert.equal(sanitizeFilenameSegment("A>B"), "A B");
  });

  it("replaces pipe", () => {
    assert.equal(sanitizeFilenameSegment("A|B"), "A B");
  });

  it("replaces ASCII control characters", () => {
    assert.equal(sanitizeFilenameSegment("A\x00B\x1fC"), "A B C");
  });

  it("collapses multiple reserved characters into a single space", () => {
    assert.equal(sanitizeFilenameSegment("A/*?B"), "A   B".replace(/\s+/g, " ").trim());
    assert.equal(sanitizeFilenameSegment("A/*?B"), "A B");
  });

  it("collapses multiple whitespace runs", () => {
    assert.equal(sanitizeFilenameSegment("A   B"), "A B");
  });

  it("trims leading and trailing whitespace", () => {
    assert.equal(sanitizeFilenameSegment("  Acme  "), "Acme");
  });

  it("handles a name with only reserved characters", () => {
    assert.equal(sanitizeFilenameSegment("/*?"), "");
  });
});

describe("buildEstimatePdfFilename", () => {
  it("returns 'estimate.pdf' when number is null", () => {
    assert.equal(buildEstimatePdfFilename(null, "Acme Corp"), "estimate.pdf");
  });

  it("returns 'estimate.pdf' when number is undefined", () => {
    assert.equal(buildEstimatePdfFilename(undefined, "Acme Corp"), "estimate.pdf");
  });

  it("returns 'estimate.pdf' when number is empty string", () => {
    assert.equal(buildEstimatePdfFilename("", "Acme Corp"), "estimate.pdf");
  });

  it("returns fallback filename without customer prefix when customer name is null", () => {
    assert.equal(buildEstimatePdfFilename("50001", null), "estimate-EST-50001.pdf");
  });

  it("returns fallback filename without customer prefix when customer name is empty", () => {
    assert.equal(buildEstimatePdfFilename("50001", ""), "estimate-EST-50001.pdf");
  });

  it("returns fallback filename when customer sanitizes to empty (only reserved chars)", () => {
    assert.equal(buildEstimatePdfFilename("50001", "/*?"), "estimate-EST-50001.pdf");
  });

  it("builds the full filename with customer name and estimate number", () => {
    assert.equal(
      buildEstimatePdfFilename("50001", "Acme Corp"),
      "Acme Corp - EST-50001.pdf",
    );
  });

  it("strips EST- prefix from an already-prefixed number", () => {
    assert.equal(
      buildEstimatePdfFilename("EST-50001", "Acme Corp"),
      "Acme Corp - EST-50001.pdf",
    );
  });

  it("sanitizes reserved characters in the customer name", () => {
    assert.equal(
      buildEstimatePdfFilename("50001", "A/B Corp"),
      "A B Corp - EST-50001.pdf",
    );
  });

  it("accepts a numeric estimate number", () => {
    assert.equal(
      buildEstimatePdfFilename(50001, "Acme Corp"),
      "Acme Corp - EST-50001.pdf",
    );
  });
});
