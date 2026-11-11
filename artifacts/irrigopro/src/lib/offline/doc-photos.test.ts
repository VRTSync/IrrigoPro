import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentationSite } from "@workspace/api-client-react";
import { captureDocPhoto, discardDocPhoto } from "./doc-photos";
import { createDocRequest } from "./doc-api";
import { readDocSite, readDocSitesList } from "./doc-read";
import { openOfflineDB, getPhotoBlob } from "./db";
import { putDocSite, putDocSitesList } from "./doc-store";
import { SyncEngine, __setEngineForTests } from "./engine";
import { applyDocMutation } from "./doc-apply";
import type { QueuedMutation } from "./types";

vi.mock("@/lib/photo-prep", () => ({ preparePhotoForUpload: async (file: File) => ({ displayFile: file, usedFallback: false }) }));
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
let engine: SyncEngine;
const empty = (): DocumentationSite => ({ customer: { id: 1, name: "Property", address: null, branches: [] }, branchName: "",
  controllers: [], backflows: [], site: { status: "nothing_on_file", verifiedAt: null, verifiedByName: null, noBackflowConfirmed: false } });
beforeEach(async () => {
  localStorage.setItem("user", JSON.stringify({ id: 1, companyId: 1 }));
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  const db = await openOfflineDB();
  await db.clear("mutationQueue"); await db.clear("docSites"); await db.clear("photoBlobs");
  await putDocSite(1, "", empty());
  engine = new SyncEngine({ heartbeatIntervalMs: 0 });
  engine.setOnline(false); __setEngineForTests(engine);
});
const photo = (kind: "controller" | "backflow", subjectId: number | null, warn = vi.fn()) => captureDocPhoto({
  file: new File(["image-bytes"], "field.jpg", { type: "image/jpeg" }), siteKey: "1:", kind, subjectId, subjectLabel: kind === "controller" ? "Controller K" : "West valve", warn,
});
describe("offline documentation photos", () => {
  it("requests storage once, warns once and retains a durable marker before an offline create", async () => {
    const persist = vi.fn().mockResolvedValue(false);
    Object.defineProperty(navigator, "storage", { configurable: true, value: { persist } });
    const warn = vi.fn();
    const marker = await photo("controller", null, warn);
    await photo("backflow", null, warn);
    expect(persist).toHaveBeenCalledTimes(1); expect(warn).toHaveBeenCalledTimes(1);
    expect(await getPhotoBlob(await openOfflineDB(), marker.slice(6))).toBeDefined();
    expect(await engine.listMutations()).toHaveLength(0);
  });
  it("atomically queues create → photo → changes → Verify → Finish and substitutes subject/program ids", async () => {
    const marker = await photo("controller", null);
    const request = createDocRequest(1, "");
    const clock = await request("/api/customers/1/controllers-profile", "POST", { letter: "K", confirmLetter: true,
      location: "West", brand: "Hunter", model: "Pro-C", settingsPhotoUrl: marker });
    await request(`/api/irrigation-controllers/${clock.id}/zone-count`, "PUT", { totalZones: 1 });
    await request(`/api/irrigation-controllers/${clock.id}/zones/bulk`, "PUT", { zoneNumbers: [1], patch: { zoneType: "rotor" } });
    const program = await request(`/api/irrigation-controllers/${clock.id}/programs`, "POST", { name: "A", wateringDays: ["Mon"], startTimes: ["05:00"] });
    await request(`/api/irrigation-controllers/${clock.id}/zones/bulk`, "PUT", { zoneNumbers: [1], patch: { programId: program.id, runTimeMinutes: 0 } });
    await request(`/api/irrigation-controllers/${clock.id}/field-verify`, "POST");
    await request("/api/system-documentation/customers/1/site/no-backflow", "POST", { confirmed: true });
    await request("/api/system-documentation/customers/1/site/verify", "POST", {});
    const local = (await readDocSite(1, "")).payload;
    expect(local.controllers[0].settingsPhotoUrl).toBe(marker);
    expect(local.controllers[0].gaps).toEqual([]);
    expect(local.controllers[0].verified).toBe(true);
    expect(local.site.status).toBe("verified");
    await putDocSitesList({ customers: [{ customerId: 1, name: "Property", address: null, branches: [],
      sites: [{ branchName: "", status: "nothing_on_file", controllerCount: 0, backflowCount: 0 }] }] });
    expect((await readDocSitesList()).payload.customers[0].sites[0]).toMatchObject({ status: "verified", controllerCount: 1 });
    const queue = (await engine.listMutations()).sort((a, b) => a.createdAt - b.createdAt);
    expect(queue.map(m => m.kind).slice(0, 3)).toEqual(["doc.controller.create", "doc.controller.photo", "doc.controller.zone_count"]);
    expect(queue[0].body).toHaveProperty("settingsPhotoUrl", null);
    expect(queue[1].placeholders).toEqual({ subject: queue[0].clientId });
    const calls: { url: string; body: any; method?: string }[] = [];
    const synced = structuredClone(local);
    synced.controllers[0].id = 70; synced.controllers[0].settingsPhotoUrl = "photo-77";
    synced.controllers[0].programs[0].id = 80; synced.controllers[0].zones[0].programId = 80;
    const replay = new SyncEngine({ heartbeatIntervalMs: 0, fetchImpl: async (url, init) => {
      const address = String(url);
      if ((init?.method ?? "GET") === "GET") return json(synced);
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : init?.body;
      calls.push({ url: address, body, method: init?.method });
      if (address.startsWith("/api/upload/photo?")) return json({ signedUrl: "https://signed.example/put", url: "photo-77" });
      return json({ id: address.includes("/programs") ? 80 : 70 });
    } });
    await replay.drainAll();
    expect(calls.find(c => c.url === "/api/irrigation-controllers/70/photo")?.body).toEqual({ url: "photo-77" });
    expect(calls.findIndex(c => c.url.endsWith("/photo"))).toBeLessThan(calls.findIndex(c => c.url.endsWith("/field-verify")));
    expect(calls.at(-1)?.url).toBe("/api/system-documentation/customers/1/site/verify");
    expect((await replay.listMutations()).every(m => m.status === "completed")).toBe(true);
    expect(await getPhotoBlob(await openOfflineDB(), marker.slice(6))).toBeUndefined();
    const stored = (await readDocSite(1, "")).payload;
    expect(stored.controllers[0].settingsPhotoUrl).toBe("photo-77");
    expect(stored.controllers[0].id).toBe(70);
  });
  it.each(["controller", "backflow"] as const)("keeps a %s blob after failed attachment, and retries it before Verify", async kind => {
    const request = createDocRequest(1, "");
    const marker = await photo(kind, null);
    const record = await request(`/api/customers/1/${kind === "controller" ? "controllers-profile" : "backflows"}`, "POST",
      kind === "controller" ? { letter: "K", settingsPhotoUrl: marker, confirmLetter: true } : { name: "West valve", photoUrl: marker });
    await request(`/api/${kind === "controller" ? "irrigation-controllers" : "backflows"}/${record.id}/field-verify`, "POST");
    let fail = true; const calls: string[] = [];
    const replay = new SyncEngine({ heartbeatIntervalMs: 0, fetchImpl: async (url, init) => {
      const address = String(url); calls.push(address);
      if ((init?.method ?? "GET") === "GET") return json(empty());
      if (address.startsWith("/api/upload/photo?")) return json({ signedUrl: "https://signed.example/put", url: "photo-77" });
      const attaching = kind === "controller" ? address.endsWith("/70/photo") : address === "/api/backflows/70";
      if (attaching && fail) return json({ message: "Retry attachment" }, 500);
      if (attaching) expect(JSON.parse(String(init!.body))).toEqual(kind === "controller" ? { url: "photo-77" } : { photoUrl: "photo-77" });
      return json({ id: 70 });
    } });
    await replay.drainAll();
    expect(await getPhotoBlob(await openOfflineDB(), marker.slice(6))).toBeDefined();
    expect(calls.some(url => url.endsWith("/field-verify"))).toBe(false);
    const upload = (await replay.listMutations()).find(m => m.clientId === marker.slice(6))!;
    fail = false;
    await replay.retryMutation(upload.id);
    replay.setOnline(true);
    await replay.drainAll();
    expect(calls.some(url => url.endsWith("/field-verify"))).toBe(true);
    expect(await getPhotoBlob(await openOfflineDB(), marker.slice(6))).toBeUndefined();
  });
  it("discarding a queued replacement preserves the existing photo", async () => {
    const baseline = applyDocMutation(empty(), { kind: "doc.controller.create", clientId: "clock",
      body: { letter: "K", settingsPhotoUrl: "old-photo" }, createdAt: 1 } as QueuedMutation);
    baseline.controllers[0].id = 7; baseline.controllers[0].clientId = null;
    await putDocSite(1, "", baseline);
    const marker = await photo("controller", 7);
    expect((await readDocSite(1, "")).payload.controllers[0].settingsPhotoUrl).toBe(marker);
    await discardDocPhoto(marker);
    expect((await readDocSite(1, "")).payload.controllers[0].settingsPhotoUrl).toBe("old-photo");
    expect(await getPhotoBlob(await openOfflineDB(), marker.slice(6))).toBeUndefined();
  });
});
