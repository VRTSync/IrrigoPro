// Development-only acceptance using disposable accounts and a disposable company.
// Real login and API handlers; no mail is sent and no existing tenant is modified.
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { db, pool } from "../lib/db/src/index.ts";
import { companies, users } from "../lib/db/src/schema/index.ts";
import { eq } from "drizzle-orm";
const require = createRequire(new URL("../artifacts/api-server/package.json", import.meta.url));
const bcrypt = require("bcrypt");
const puppeteer = require("puppeteer-core");
const output = "generated-artifacts/outgoing-email";
await mkdir(output, { recursive: true });
const suffix = randomUUID().replaceAll("-", "");
const password = randomUUID();
const accounts = [];
let company, browser;
const evidence = { screenshots: [], widths: [], errors: [], forbidden: [], assertions: [] };
try {
  [company] = await db.insert(companies).values({
    name: "Outgoing Email Acceptance", email: "office@example.invalid", address: "Synthetic acceptance address", subscription: "enterprise",
  }).returning();
  for (const role of ["super_admin", "company_admin"]) {
    const [user] = await db.insert(users).values({
      username: `sender-${role}-${suffix}`, password: await bcrypt.hash(password, 10),
      name: "Sender acceptance", emailVerified: true, role,
      companyId: role === "super_admin" ? null : company.id,
    }).returning();
    accounts.push(user);
  }
  browser = await puppeteer.launch({
    executablePath: process.env.REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    headless: true, args: ["--no-sandbox"],
  });
  const origin = "http://localhost:80";
  async function login(user) {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    await page.setViewport({ width: 1280, height: 1000 });
    page.on("pageerror", (err) => evidence.errors.push(err.message));
    page.on("response", (res) => { if (res.status() === 403) evidence.forbidden.push(new URL(res.url()).pathname); });
    page.on("response", async (res) => {
      if (res.request().method() === "PUT" && res.url().includes("/email-sender")) {
        console.log("Sender save response", res.status(), await res.text());
      }
    });
    await page.goto(`${origin}/login`, { waitUntil: "networkidle2" });
    await page.waitForSelector('[data-testid="input-username"]');
    await page.type('[data-testid="input-username"]', user.username);
    await page.type('[data-testid="input-password"]', password);
    await Promise.all([
      page.waitForNavigation({ waitUntil: "networkidle2" }),
      page.click('[data-testid="button-login"]'),
    ]);
    return { page, context };
  }
  async function api(page, path, method = "GET", body) {
    return page.evaluate(async ({ path, method, body }) => {
      const res = await fetch(path, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      return { status: res.status, data: await res.json() };
    }, { path, method, body });
  }
  const admin = await login(accounts[0]);
  const assignment = await api(admin.page, `/api/admin/companies/${company.id}/email-sending-domain`, "PUT", { domain: `sender-${suffix}.example.com` });
  assert.equal(assignment.status, 200);
  assert.equal(assignment.data.domainVerifiedAt, null);
  assert(assignment.data.domainCheckError);
  evidence.assertions.push("Real super-admin assignment persisted domain and unauthenticated check status.");
  const office = await login(accounts[1]);
  await office.page.goto(`${origin}/company-profile`, { waitUntil: "networkidle2" });
  await office.page.waitForSelector('[data-testid="input-from-name"]');
  for (const [id, value] of [["input-from-name", "High Plains Property Maintenance"], ["input-from-local-part", "billing"], ["input-reply-to", "billing@highplainsprop.com"]]) {
    await office.page.click(`[data-testid="${id}"]`, { clickCount: 3 });
    await office.page.type(`[data-testid="${id}"]`, value);
  }
  const saveButton = await office.page.$('[data-testid="button-save-outgoing-email"]');
  await saveButton.evaluate((node) => node.scrollIntoView({ block: "center", behavior: "instant" }));
  await office.page.waitForFunction(() => {
    const node = document.querySelector('[data-testid="button-save-outgoing-email"]');
    const rect = node?.getBoundingClientRect();
    return node && !node.disabled && node.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
  });
  await saveButton.click();
  await office.page.waitForFunction(() => document.querySelector('[data-testid="text-effective-sender"]')?.textContent.includes("High Plains Property Maintenance"));
  const saved = await api(office.page, "/api/company/email-sender");
  assert.equal(saved.data.fromName, "High Plains Property Maintenance");
  assert.equal(saved.data.effective.usingCompanyAddress, false);
  assert.equal(saved.data.effective.replyTo, "billing@highplainsprop.com");
  assert.equal(saved.data.domainVerifiedAt, null);
  evidence.assertions.push("Company-admin card saved sender; real API used safe platform fallback and company Reply-To.");
  await office.page.reload({ waitUntil: "networkidle2" });
  await office.page.waitForFunction(() => document.querySelector('[data-testid="input-from-name"]')?.value === "High Plains Property Maintenance");
  evidence.assertions.push("Saved sender survived full page reload.");
  for (const width of [375, 1280]) {
    await office.page.setViewport({ width, height: width < 768 ? 1600 : 1000 });
    const card = await office.page.$('[data-testid="card-outgoing-email"]');
    await card.scrollIntoView();
    await new Promise((resolve) => setTimeout(resolve, 350));
    const geometry = await office.page.evaluate(() => {
      const card = document.querySelector('[data-testid="card-outgoing-email"]');
      return { viewport: innerWidth, pageWidth: document.documentElement.scrollWidth, cardWidth: card.clientWidth, cardScroll: card.scrollWidth };
    });
    evidence.widths.push(geometry);
    console.log("Card geometry", geometry);
    if (geometry.pageWidth > width) console.log("Overflowing elements", await office.page.$$eval("body *", (nodes) => nodes.filter((node) => node.getBoundingClientRect().right > innerWidth + 1).slice(-15).map((node) => ({ tag: node.tagName, class: node.className, text: node.textContent?.slice(0, 100), right: node.getBoundingClientRect().right }))));
    assert(geometry.pageWidth <= width, `Page overflow at ${width}`);
    assert(geometry.cardScroll <= geometry.cardWidth, `Card overflow at ${width}`);
    const filename = `${output}/card-${width}.png`;
    await card.screenshot({ path: filename });
    evidence.screenshots.push(filename);
  }
  const cleared = await api(admin.page, `/api/admin/companies/${company.id}/email-sending-domain`, "PUT", { domain: null });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.data.fromAddress, null);
  assert.equal(cleared.data.domainCheckedAt, null);
  assert.equal(cleared.data.effective.usingCompanyAddress, false);
  assert.equal(cleared.data.effective.replyTo, "billing@highplainsprop.com");
  evidence.assertions.push("Clearing domain removed From address and check timestamps, preserving company name and Reply-To.");
  await office.page.reload({ waitUntil: "networkidle2" });
  await office.page.waitForSelector('[data-testid="text-sending-domain-none"]');
  await office.page.setViewport({ width: 375, height: 1600 });
  const emptyCard = await office.page.$('[data-testid="card-outgoing-email"]');
  await emptyCard.screenshot({ path: `${output}/card-no-domain-375.png` });
  evidence.screenshots.push(`${output}/card-no-domain-375.png`);
  assert.equal(evidence.errors.length, 0, evidence.errors.join("\n"));
  await writeFile(`${output}/browser-evidence.json`, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
} catch (error) {
  for (const page of browser ? await browser.pages() : []) {
    if (page.url().includes("company-profile")) {
      console.log("Company page state", (await page.evaluate(() => document.body.innerText)).slice(-6500));
      console.log("Field values", await page.$$eval('[data-testid^="input-from"],[data-testid="input-reply-to"]', (nodes) => nodes.map((node) => ({ id: node.dataset.testid, value: node.value, disabled: node.disabled }))));
      await page.screenshot({ path: `${output}/browser-failure.png`, fullPage: true });
    }
  }
  throw error;
} finally {
  if (browser) await browser.close();
  for (const user of accounts) await db.delete(users).where(eq(users.id, user.id));
  if (company) await db.delete(companies).where(eq(companies.id, company.id));
  await pool.end();
}
