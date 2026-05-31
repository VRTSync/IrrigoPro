/**
 * _capture.ts
 *
 * Pointer script for the WC Manager Experience visual audit (Slice 9) fixture
 * regeneration workflow.
 *
 * The real capture logic lives in:
 *   artifacts/irrigopro/src/test/wc-audit-capture.test.tsx
 *
 * That file uses @testing-library/react + React Query cache seeding + wouter
 * memory-location to render each of the four wet-check surfaces under each of
 * the four manager roles (16 combinations) and serialise container.innerHTML
 * to the .html files in this directory.
 *
 * Usage (run once to regenerate all 16 fixture files):
 *   npx tsx docs/wc-manager-experience-visual-audit-fixtures/_capture.ts
 *
 * Or equivalently:
 *   cd artifacts/irrigopro && npx vitest run src/test/wc-audit-capture.test.tsx
 */

import { execSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = resolve(__dirname, "../../artifacts/irrigopro");

console.log("Running wc-audit-capture.test.tsx to regenerate fixtures…");
execSync(
  "npx vitest run src/test/wc-audit-capture.test.tsx",
  { cwd: pkg, stdio: "inherit" },
);
console.log("✓ Done. See docs/wc-manager-experience-visual-audit-fixtures/ for output.");
