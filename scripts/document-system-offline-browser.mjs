// Production-bundle acceptance against synthetic HTTP fixtures. No login
// bypass is added to the app, and no development/production DB is touched.
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import assert from "node:assert/strict";
const require = createRequire(new URL("../artifacts/api-server/package.json", import.meta.url));
const puppeteer = require("puppeteer-core");
const root = path.resolve("artifacts/irrigopro/dist/public");
const output = "generated-artifacts/document-offline";
await mkdir(output, { recursive: true });
const pixel = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZfoAAAAASUVORK5CYII=", "base64");
const captureFile = path.resolve(output, "capture.png");
await writeFile(captureFile, pixel);
const now = new Date().toISOString();
const user = { id: 1, companyId: 1, username: "offline-fixture", name: "Offline fixture tech", email: "fixture@example.invalid", role: "system_documenter", isActive: true };
const audit = { isActive: true, lastUpdatedByUserId: 1, lastUpdatedByName: user.name, lastUpdatedAt: now, fieldVerifiedByUserId: null, fieldVerifiedByName: null, fieldVerifiedAt: null, createdAt: now, updatedAt: now };
const site = {
  customer: { id: 1, name: "Offline acceptance fixture", address: "Synthetic test property", branches: [] }, branchName: "",
  controllers: [{ id: 7, clientId: null, name: "Controller K", letter: "K", letterConfirmed: true, location: "West", brand: "Hunter", model: "Pro-C",
    totalZones: 1, settingsPhotoUrl: "old-clock", notes: null, lastUpdatedAt: now, fieldVerifiedAt: null, fieldVerifiedByName: null, verified: false, gaps: [],
    programs: [{ id: 10, name: "A", clientId: null, companyId: 1, controllerId: 7, wateringDays: ["Mon"], startTimes: ["05:00"], seasonalAdjustPct: 100, sortOrder: 0, isActive: true, createdAt: now, updatedAt: now }],
    zones: [{ id: 11, zoneNumber: 1, name: "Zone 1", zoneType: "rotor", zoneTypeConfirmed: true, programId: 10, runTimeMinutes: 0, extraPrograms: [] }] }],
  backflows: [{ ...audit, id: 9, clientId: null, branchName: "", name: "West valve", deviceType: "rpz", size: '1"', brand: "Watts", model: "009",
    serialNumber: "FIXTURE", location: "West", installDate: null, notes: null, photoUrl: "old-valve",
    lastTestedDate: "2026-01-01", nextTestDueDate: "2027-01-01", lastTestResult: "pass", lastTestedBy: "Fixture tester", testUnknownReason: null, verified: false, gaps: [] }],
  site: { status: "not_verified", verifiedAt: null, verifiedByName: null, noBackflowConfirmed: false },
};
let origin, uploads = 0, photoFailure = null;
const mutations = [], forbidden = [];
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, origin);
    const json = (value, status = 200) => { res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify(value)); };
    let bytes = Buffer.alloc(0);
    for await (const part of req) bytes = Buffer.concat([bytes, part]);
    const body = bytes.length && req.headers["content-type"]?.includes("application/json") ? JSON.parse(bytes) : {};
    if (url.pathname.startsWith("/api/photos/")) { res.writeHead(200, { "Content-Type": "image/png" }); return res.end(pixel); }
    if (url.pathname === "/signed-upload") {
      if (photoFailure === "connection") return req.socket.destroy();
      if (photoFailure === 503) return json({ message: "Temporary storage failure" }, 503);
      return json({});
    }
    if (url.pathname === "/api/upload/photo") return json({ signedUrl: `${origin}/signed-upload`, url: `fixture-photo-${++uploads}` });
    if (url.pathname === "/api/upload/photo/finalize") return json({ ok: true });
    if (url.pathname === "/api/system-documentation/sites") return json({ customers: [{
      customerId: 1, name: site.customer.name, address: site.customer.address, branches: [], sites: [{ branchName: "", status: site.site.status, controllerCount: 1, backflowCount: 1 }],
    }] });
    if (req.method === "GET" && url.pathname === "/api/system-documentation/customers/1/site") return json(site);
    if (req.method !== "GET" && url.pathname.startsWith("/api/")) {
      mutations.push(url.pathname);
      if (url.pathname === "/api/irrigation-controllers/7/photo") site.controllers[0].settingsPhotoUrl = body.url;
      else if (url.pathname === "/api/backflows/9") site.backflows[0].photoUrl = body.photoUrl;
      else if (url.pathname === "/api/irrigation-controllers/7/field-verify") site.controllers[0].verified = true;
      else if (url.pathname === "/api/backflows/9/field-verify") site.backflows[0].verified = true;
      else if (url.pathname === "/api/system-documentation/customers/1/site/verify") {
        assert(site.controllers[0].verified && site.backflows[0].verified);
        site.site.status = "verified"; site.site.verifiedAt = new Date().toISOString(); site.site.verifiedByName = user.name;
      } else { forbidden.push(url.pathname); return json({ message: "Unexpected fixture write" }, 403); }
      return json({ id: 7 });
    }
    if (url.pathname.startsWith("/api/")) { forbidden.push(url.pathname); return json({ message: "Unexpected fixture read" }, 403); }
    const target = path.resolve(root, `.${decodeURIComponent(url.pathname)}`);
    if (!target.startsWith(`${root}/`) && target !== root) return res.end();
    const file = url.pathname === "/" || !path.extname(url.pathname) ? path.join(root, "index.html") : target;
    const type = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2" }[path.extname(file)] ?? "application/octet-stream";
    const contents = await readFile(file);
    res.writeHead(200, { "Content-Type": type }); res.end(contents);
  } catch (error) { if (!res.headersSent) res.writeHead(500); res.end(String(error)); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
origin = `http://127.0.0.1:${server.address().port}`;
const browser = await puppeteer.launch({ executablePath: process.env.REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE, headless: true, args: ["--no-sandbox"] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await page.evaluateOnNewDocument(user => localStorage.setItem("user", JSON.stringify(user)), user);
  const errors = []; page.on("pageerror", error => errors.push(String(error)));
  async function clickVisible(selector) {
    await page.$eval(selector, element => element.scrollIntoView({ block: "center" }));
    await page.waitForFunction(selector => {
      const element = document.querySelector(selector);
      if (!element || element.disabled) return false;
      const box = element.getBoundingClientRect();
      const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return hit === element || element.contains(hit);
    }, {}, selector);
    await page.click(selector);
  }
  await page.goto(origin, { waitUntil: "networkidle0" });
  await page.waitForSelector('[data-testid="text-offline-saved-1"]');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await page.click('[data-testid="card-property-1"]');
  await page.waitForSelector('[data-testid="row-controller-7"]');
  await page.setOfflineMode(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="strip-doc-offline"]');
  await page.screenshot({ path: `${output}/offline-shell.jpg`, fullPage: true });
  for (const [kind, id] of [["controller", 7], ["backflow", 9]]) {
    await page.click(`[data-testid="row-${kind}-${id}"]`);
    await page.waitForSelector('[data-testid="button-edit-photo"]');
    await page.click('[data-testid="button-edit-photo"]');
    const input = await page.$(`[data-testid="${kind === "controller" ? "doc-photo-input" : "doc-photo-library-input"}"]`);
    await input.uploadFile(captureFile);
    await page.waitForFunction(() => document.body.textContent.includes("Waiting to upload"));
    await clickVisible('[data-testid="button-save-exit"]');
    await page.waitForSelector(`[data-testid="row-${kind}-${id}"]`);
    await page.click(`[data-testid="row-${kind}-${id}"]`);
    if (kind === "backflow") {
      await page.waitForSelector('[data-testid="button-edit-last-test"]');
      await page.click('[data-testid="button-edit-last-test"]');
      await page.waitForSelector('[data-testid="chip-test-matches"]');
      await page.click('[data-testid="chip-test-matches"]');
      await page.click('[data-testid="button-next"]');
    }
    await page.waitForSelector('[data-testid="button-verify"]:not([disabled])');
    await page.click('[data-testid="button-verify"]');
    await page.waitForSelector(`[data-testid="row-${kind}-${id}"]`);
  }
  await page.waitForSelector('[data-testid="button-finish"]:not([disabled])');
  await page.click('[data-testid="button-finish"]');
  await page.waitForSelector('[data-testid="button-back-to-properties"]');
  await page.screenshot({ path: `${output}/offline-finished.jpg`, fullPage: true });
  await page.setOfflineMode(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await page.waitForFunction(() => !document.querySelector('[data-testid="strip-doc-syncing"]') && !document.querySelector('[data-testid="strip-doc-offline"]'), { timeout: 60000 });
  assert.equal(site.site.status, "verified");
  assert.match(site.controllers[0].settingsPhotoUrl, /^fixture-photo-/);
  assert.match(site.backflows[0].photoUrl, /^fixture-photo-/);
  assert(mutations.indexOf("/api/irrigation-controllers/7/photo") < mutations.indexOf("/api/irrigation-controllers/7/field-verify"));
  assert(mutations.indexOf("/api/backflows/9") < mutations.indexOf("/api/backflows/9/field-verify"));
  await page.screenshot({ path: `${output}/synced-phone.jpg`, fullPage: true });
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(`${origin}/customers/1/document-system`, { waitUntil: "networkidle0" });
  await page.waitForSelector('[data-testid="row-controller-7"]');
  await page.screenshot({ path: `${output}/synced-desktop-viewport.jpg`, fullPage: true });
  // Both rejected fetches and transient HTTP storage failures can happen while
  // navigator.onLine stays true. Both captures must survive a real reload.
  for (const failure of ["connection", 503]) {
    await page.setViewport({ width: 390, height: 844 });
    if (failure !== "connection") await clickVisible('[data-testid="button-save-exit"]');
    await page.waitForSelector('[data-testid="row-controller-7"]');
    await page.click('[data-testid="row-controller-7"]');
    await page.waitForSelector('[data-testid="button-edit-photo"]');
    await page.click('[data-testid="button-edit-photo"]');
    photoFailure = failure;
    await (await page.$('[data-testid="doc-photo-input"]')).uploadFile(captureFile);
    await page.waitForFunction(() => document.body.textContent.includes("Waiting to upload"));
    assert.equal(await page.evaluate(() => navigator.onLine), true);
    // Active upload retries intentionally keep the network busy; wait for the
    // shell and the explicit durable-preview assertions, not global idleness.
    await page.goto(`${origin}/customers/1/document-system`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="row-controller-7"]');
    await page.click('[data-testid="row-controller-7"]');
    await page.waitForFunction(() => document.body.textContent.includes("Waiting to upload") &&
      [...document.querySelectorAll("img")].some(image => image.src.startsWith("blob:")));
    const evidence = failure === 503 ? "http-503-upload-reopened" : "interrupted-upload-reopened";
    await page.screenshot({ path: `${output}/${evidence}.jpg`, fullPage: true });
    const priorPhoto = site.controllers[0].settingsPhotoUrl;
    photoFailure = null;
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await page.waitForFunction(() => document.querySelector('[data-testid="sync-badge"]')?.textContent.includes("Uploads synced"));
    assert.notEqual(site.controllers[0].settingsPhotoUrl, priorPhoto);
    await page.waitForFunction(photoId => [...document.querySelectorAll("img")].some(image =>
      image.src.includes(`/api/photos/${photoId}?`)) && !document.body.textContent.includes("Waiting to upload"), {}, site.controllers[0].settingsPhotoUrl);
  }
  assert.deepEqual(errors, []); assert.deepEqual(forbidden, []);
  console.log(JSON.stringify({ result: "PASS", environment: "headless Chromium, synthetic HTTP fixture, real production bundle and service worker", physicalDevice: false, published: false, mutations, output }, null, 2));
} catch (error) {
  for (const page of await browser.pages()) {
    await page.screenshot({ path: `${output}/failure.jpg`, fullPage: true }).catch(() => {});
    await writeFile(`${output}/failure.txt`, await page.evaluate(() => document.body.innerText).catch(() => "")).catch(() => {});
  }
  throw error;
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
