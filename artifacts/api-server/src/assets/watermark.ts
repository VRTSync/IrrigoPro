/**
 * WATERMARK_DATA_URI — IrrigoPro droplet brand asset embedded as a base64
 * data-URI for use as a low-opacity background watermark on the PDF cover page.
 *
 * Source: attached_assets/IrrigoPro_2026-05_1780427958317.png
 * Rendered at ~0.07 opacity, anchored to the lower-right corner of the cover.
 *
 * Path resolution follows the same pattern as vrt-logo.ts:
 *   - Primary: process.cwd() = workspace root (pnpm dev / production start)
 *   - Fallback 1: tsx dev path (src/assets/ — 4 hops to workspace root)
 *   - Fallback 2: built bundle path (dist/ — 3 hops to workspace root)
 * If no candidate resolves, exports an empty string so the cover page degrades
 * gracefully (watermark div renders but has no visible content).
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const ASSET_FILE = 'IrrigoPro_2026-05_1780427958317.png';

const _candidates: string[] = [
  join(process.cwd(), 'attached_assets', ASSET_FILE),
];

try {
  const _dir = fileURLToPath(new URL('.', import.meta.url));
  _candidates.push(join(_dir, '..', '..', '..', '..', 'attached_assets', ASSET_FILE));
  _candidates.push(join(_dir, '..', '..', '..', 'attached_assets', ASSET_FILE));
} catch {
  // import.meta.url not available in some CJS contexts — skip
}

function _loadWatermark(): string {
  for (const p of _candidates) {
    if (existsSync(p)) {
      try {
        const b64 = readFileSync(p).toString('base64');
        return `data:image/png;base64,${b64}`;
      } catch (err) {
        console.warn(`[PDF] Watermark read failed at ${p}:`, err instanceof Error ? err.message : err);
      }
    }
  }
  console.warn('[PDF] IrrigoPro watermark asset not found — cover page watermark will be blank');
  return '';
}

export const WATERMARK_DATA_URI: string = _loadWatermark();
