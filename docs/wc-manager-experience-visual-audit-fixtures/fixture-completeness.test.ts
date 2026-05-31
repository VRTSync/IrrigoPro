/**
 * fixture-completeness.test.ts
 *
 * Guards the 16 (surface × role) fixture files required by the
 * WC Manager Experience visual audit (Slice 9).  If a future re-run of
 * _capture.ts silently drops a combination this test will catch it before
 * the sub-slice reviewers notice the baseline is broken.
 *
 * Run: pnpm --filter @workspace/irrigopro run vitest run docs/wc-manager-experience-visual-audit-fixtures/fixture-completeness.test.ts
 */

import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const SURFACES = ["wc-list", "wc-detail", "wc-review", "wc-dashboard"] as const;
const ROLES = [
  "irrigation_manager",
  "company_admin",
  "super_admin",
  "billing_manager",
] as const;

describe("WC visual audit — fixture completeness (16 files)", () => {
  for (const surface of SURFACES) {
    for (const role of ROLES) {
      const filename = `${surface}.${role}.html`;
      it(`exists: ${filename}`, () => {
        const fullPath = join(__dirname, filename);
        expect(
          existsSync(fullPath),
          `Missing fixture: ${filename}. Re-run _capture.ts to regenerate.`,
        ).toBe(true);
      });
    }
  }
});
