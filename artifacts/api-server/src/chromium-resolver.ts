import { execSync } from 'child_process';
import { existsSync } from 'fs';

let cached: string | null | undefined;

function tryWhich(bin: string): string | null {
  try {
    const out = execSync(`which ${bin}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    return out && existsSync(out) ? out : null;
  } catch {
    return null;
  }
}

function tryPuppeteerBundled(): string | null {
  try {
    const mod = require('puppeteer-core') as { executablePath?: () => string };
    if (typeof mod.executablePath === 'function') {
      const p = mod.executablePath();
      return p && existsSync(p) ? p : null;
    }
  } catch {}
  try {
    const mod = require('puppeteer') as { executablePath?: () => string };
    if (typeof mod.executablePath === 'function') {
      const p = mod.executablePath();
      return p && existsSync(p) ? p : null;
    }
  } catch {}
  return null;
}

export function resolveChromiumExecutable(): string {
  if (cached !== undefined) {
    if (cached === null) {
      throw new Error(
        'No Chromium/Chrome executable found. Set PUPPETEER_EXECUTABLE_PATH ' +
        'or REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE to a working browser binary.',
      );
    }
    return cached;
  }

  const candidates: Array<[string, string | null | undefined]> = [
    ['PUPPETEER_EXECUTABLE_PATH', process.env.PUPPETEER_EXECUTABLE_PATH ?? null],
    ['REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE', process.env.REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? null],
    ['CHROMIUM_PATH', process.env.CHROMIUM_PATH ?? null],
    ['which chromium', tryWhich('chromium')],
    ['which chromium-browser', tryWhich('chromium-browser')],
    ['which google-chrome', tryWhich('google-chrome')],
    ['which google-chrome-stable', tryWhich('google-chrome-stable')],
    ['puppeteer bundled', tryPuppeteerBundled()],
  ];

  for (const [source, path] of candidates) {
    if (path && existsSync(path)) {
      cached = path;
      console.log(`[pdf] Using chromium: ${path} (source: ${source})`);
      return path;
    }
  }

  cached = null;
  throw new Error(
    'No Chromium/Chrome executable found. Set PUPPETEER_EXECUTABLE_PATH ' +
    'or REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE to a working browser binary.',
  );
}
