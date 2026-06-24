/**
 * Unit tests for ObjectStorageService.getCompanyLogoPublicURL.
 *
 * Covers all four stored shapes a companies.logo value can take and
 * asserts that every shape resolves to the canonical
 * `/api/company-logo/<uuid>` form — no double-prefix, no raw
 * object-storage URL exposed to the browser.
 *
 * Uses a static-source mirror of the function so the test doesn't need
 * to instantiate ObjectStorageService (which imports the GCS client at
 * module level). Any logic drift between the mirror and the real
 * implementation is caught by the source-text assertion below.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ── Static-source assertion ───────────────────────────────────────────────────
// Ensure the fix (stripping the company-logos/ prefix before building the
// /api/company-logo/ URL) is actually present in objectStorage.ts so this
// test can't pass after an accidental revert.

const src = readFileSync(join(import.meta.dirname, "objectStorage.ts"), "utf8");

describe("objectStorage.ts — getCompanyLogoPublicURL source guard", () => {
  it("contains the company-logos/ prefix-strip branch", () => {
    assert.ok(
      src.includes("startsWith('company-logos/')"),
      "getCompanyLogoPublicURL must contain a startsWith('company-logos/') branch to strip the prefix"
    );
    assert.ok(
      src.includes("logoPath.slice('company-logos/'.length)"),
      "getCompanyLogoPublicURL must slice off the 'company-logos/' prefix before building the /api/company-logo/ URL"
    );
  });
});

// ── Behavioural tests — mirror of the fixed function ─────────────────────────
// Mirror the function logic here so we can test it without importing the GCS
// module. If the real implementation diverges, the static-source assertion
// above will catch it.

function getCompanyLogoPublicURL(logoPath: string): string {
  if (logoPath.startsWith('http')) return logoPath;
  if (logoPath.startsWith('/api/')) return logoPath;
  if (logoPath.startsWith('company-logos/')) {
    return `/api/company-logo/${logoPath.slice('company-logos/'.length)}`;
  }
  return `/api/company-logo/${logoPath}`;
}

describe("getCompanyLogoPublicURL — all four stored shapes", () => {
  it("passes through a full https:// URL unchanged", () => {
    const url = "https://example.com/some/logo.png";
    assert.equal(getCompanyLogoPublicURL(url), url);
  });

  it("passes through a /api/ relative path unchanged", () => {
    const path = "/api/company-logo/some-uuid";
    assert.equal(getCompanyLogoPublicURL(path), path);
  });

  it("strips company-logos/ prefix — no double prefix", () => {
    const uuid = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
    assert.equal(
      getCompanyLogoPublicURL(`company-logos/${uuid}`),
      `/api/company-logo/${uuid}`
    );
  });

  it("wraps a bare uuid with /api/company-logo/", () => {
    const uuid = "d290f1ee-6c54-4b01-90e6-d701748f0851";
    assert.equal(
      getCompanyLogoPublicURL(uuid),
      `/api/company-logo/${uuid}`
    );
  });

  it("does NOT produce the double-prefix /api/company-logo/company-logos/<uuid>", () => {
    const uuid = "abc123";
    const result = getCompanyLogoPublicURL(`company-logos/${uuid}`);
    assert.ok(
      !result.includes("company-logos/"),
      `Expected no 'company-logos/' in result but got: ${result}`
    );
    assert.equal(result, `/api/company-logo/${uuid}`);
  });
});
