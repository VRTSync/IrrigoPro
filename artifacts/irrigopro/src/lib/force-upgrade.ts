// Task #554 — client-side force-upgrade poller. Every 5 minutes, asks
// the server for the current minimum app version. If the pin is newer
// than the last one we've seen AND the running build hash doesn't
// match, we render a single-screen "App updated, reloading…" splash,
// unregister the service worker, clear caches, and hard reload so
// the user picks up the deployed bundle. The splash gives the user
// (and any in-flight tap) a beat to see *why* the app is reloading
// instead of having the page snap to a blank state mid-action.

import { safeGet, safeSet } from "@/utils/safeStorage";

const POLL_INTERVAL_MS = 5 * 60_000;
const STORAGE_KEY = "irrigopro:lastForceUpgrade";
const SPLASH_MIN_MS = 1500;

type MinAppVersionResponse = {
  minAppVersion: string | null;
  scope: string | null;
  setAt: string | null;
};

function currentBuildHash(): string {
  try {
    return ((import.meta as unknown as { env: Record<string, string | undefined> }).env?.VITE_BUILD_HASH) ?? "";
  } catch { return ""; }
}

function readUserCompanyId(): number | null {
  try {
    const raw = safeGet("user");
    if (!raw) return null;
    const u = JSON.parse(raw) as { companyId?: number | null };
    return typeof u?.companyId === "number" ? u.companyId : null;
  } catch { return null; }
}

async function clearAllCaches(): Promise<void> {
  try {
    if (typeof caches !== "undefined" && caches?.keys) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch { /* best-effort */ }
  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
  } catch { /* best-effort */ }
}

let splashMounted = false;
function showUpgradeSplash(targetVersion: string): void {
  if (splashMounted || typeof document === "undefined") return;
  splashMounted = true;
  const overlay = document.createElement("div");
  overlay.id = "irrigopro-force-upgrade-splash";
  overlay.setAttribute("role", "alert");
  overlay.setAttribute("aria-live", "assertive");
  overlay.setAttribute("data-testid", "force-upgrade-splash");
  overlay.style.cssText = [
    "position:fixed",
    "inset:0",
    "z-index:2147483647",
    "display:flex",
    "flex-direction:column",
    "align-items:center",
    "justify-content:center",
    "gap:18px",
    "background:#0f172a",
    "color:#f8fafc",
    "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",
    "padding:24px",
    "text-align:center",
  ].join(";");
  overlay.innerHTML = `
    <div style="width:48px;height:48px;border:4px solid rgba(255,255,255,0.18);border-top-color:#38bdf8;border-radius:50%;animation:irrigopro-spin 0.9s linear infinite"></div>
    <div style="font-size:18px;font-weight:600">App updated, reloading…</div>
    <div style="font-size:13px;color:#94a3b8;max-width:340px;line-height:1.45">
      A new version of IrrigoPro was just published. We're refreshing your screen so you don't run into stale data.
    </div>
    <div style="font-size:11px;color:#64748b;font-family:ui-monospace,SFMono-Regular,Menlo,monospace">
      build · ${targetVersion.slice(0, 12)}
    </div>
    <style>@keyframes irrigopro-spin{to{transform:rotate(360deg)}}</style>
  `;
  try { document.body.appendChild(overlay); } catch { /* ignore */ }
}

async function checkOnce(): Promise<void> {
  try {
    const cid = readUserCompanyId();
    const url = cid != null
      ? `/api/config/min-app-version?company_id=${cid}`
      : "/api/config/min-app-version";
    const res = await fetch(url, {
      credentials: "include",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return;
    const body = (await res.json()) as MinAppVersionResponse;
    if (!body?.minAppVersion || !body.setAt) return;
    const lastSeen = safeGet(STORAGE_KEY) || "";
    if (lastSeen === body.setAt) return; // already honored this pin
    const build = currentBuildHash();
    // If we're already on the pinned build, just remember the pin so
    // we don't reload on every tick.
    if (!build || build === body.minAppVersion) {
      safeSet(STORAGE_KEY, body.setAt);
      return;
    }
    // Stale client. Record the pin BEFORE reloading so the next mount
    // doesn't bounce on the same pin.
    safeSet(STORAGE_KEY, body.setAt);
    // Show the splash first so the user sees *why* the page is about
    // to refresh (especially mid-tap on a slow LTE truck connection).
    showUpgradeSplash(body.minAppVersion);
    const splashStart = Date.now();
    await clearAllCaches();
    const elapsed = Date.now() - splashStart;
    if (elapsed < SPLASH_MIN_MS) {
      await new Promise((r) => setTimeout(r, SPLASH_MIN_MS - elapsed));
    }
    // Replace history entry so back-button doesn't return to the
    // pre-upgrade SPA state.
    window.location.replace(window.location.pathname + window.location.search);
  } catch { /* swallow — next tick retries */ }
}

let started = false;
export function startForceUpgradePoll(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  // Initial check is intentionally deferred — `deferredBoot` already
  // runs after first paint, so we add a small extra delay so the poll
  // doesn't compete with auth + first dashboard query.
  setTimeout(() => { void checkOnce(); }, 4000);
  const t = setInterval(() => { void checkOnce(); }, POLL_INTERVAL_MS);
  // Don't keep test runners alive.
  if (typeof t === "object" && t && "unref" in (t as object)) {
    try { (t as unknown as { unref: () => void }).unref(); } catch { /* ignore */ }
  }
}
