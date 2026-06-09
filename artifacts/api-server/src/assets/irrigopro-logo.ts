/**
 * IRRIGOPRO_LOGO_DATA_URI — IrrigoPro brand logo embedded as a base64 data-URI
 * for server-side PDF generation (puppeteer cannot use Vite @assets aliases).
 *
 * Source: attached_assets/irrigopro - logo - BLUE - FINAL_1756061385150.png
 * Used on the first-page "IrrigoPro · Powered by VRT Sync" attribution block.
 *
 * Path resolution: process.cwd() is always the workspace root when the server
 * is started by pnpm from the repo root. Falls back to __dirname-relative paths
 * for the built bundle (dist/) and the tsx dev path (src/assets/).
 * If no candidate resolves, exports an empty string so the block degrades
 * gracefully with a logged warning.
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const ASSET_FILE = 'IrrigoPro_2026-03_1780427958317.png';

const _candidates: string[] = [
  // Primary: cwd = workspace root (pnpm dev / production start)
  join(process.cwd(), 'attached_assets', ASSET_FILE),
];

try {
  const _dir = fileURLToPath(new URL('.', import.meta.url));
  // tsx dev: src/assets/ — 4 hops to workspace root
  _candidates.push(join(_dir, '..', '..', '..', '..', 'attached_assets', ASSET_FILE));
  // built bundle: dist/ — 3 hops to workspace root
  _candidates.push(join(_dir, '..', '..', '..', 'attached_assets', ASSET_FILE));
} catch {
  // import.meta.url not available in some CJS contexts — skip
}

function _loadLogo(): string {
  for (const p of _candidates) {
    if (existsSync(p)) {
      try {
        const b64 = readFileSync(p).toString('base64');
        return `data:image/png;base64,${b64}`;
      } catch (err) {
        console.warn(`[PDF] IrrigoPro logo read failed at ${p}:`, err instanceof Error ? err.message : err);
      }
    }
  }
  console.warn('[PDF] IrrigoPro logo asset not found — first-page attribution block falls back to text-only');
  return '';
}

export const IRRIGOPRO_LOGO_DATA_URI: string = _loadLogo();
