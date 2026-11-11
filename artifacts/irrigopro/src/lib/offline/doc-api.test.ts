import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentationSite } from "@workspace/api-client-react";
import { docWrite, createDocRequest, overlayDocQueue, withDocSiteLock } from "./doc-api";
import { docTemporaryId } from "./doc-apply";
import { openOfflineDB } from "./db";
import { putDocSite, getDocSite, docOwner } from "./doc-store";
import { SyncEngine, __setEngineForTests } from "./engine";
import { readDocSite } from "./doc-read";

const site = (): DocumentationSite => ({ customer: { id: 1, name: "Field property", address: null, branches: [] },
  branchName: "", controllers: [], backflows: [],
  site: { status: "nothing_on_file", verifiedAt: null, verifiedByName: null, noBackflowConfirmed: false } });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
let engine: SyncEngine;
beforeEach(async () => {
  localStorage.setItem("user", JSON.stringify({ id: 1, companyId: 1 }));
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  const db = await openOfflineDB();
  await db.clear("mutationQueue"); await db.clear("docSites");
  await putDocSite(1, "", site());
  engine = new SyncEngine({ heartbeatIntervalMs: 0, fetchImpl: async () => json({}) });
  __setEngineForTests(engine);
});
describe("document direct-or-queued path", () => {
  it.each(["account", "logout"])("rejects a queued save whose %s changed while waiting for the site lock", async change => {
    let release: (() => void) | undefined;
    const gate = withDocSiteLock("1:", () => new Promise<void>(resolve => { release = resolve; }));
    await vi.waitFor(() => expect(release).toBeDefined());
    const pending = docWrite({ kind: "doc.controller.update", siteKey: "1:", method: "PUT", url: "/api/irrigation-controllers/7", body: { brand: "Hunter" } });
    const refusal = expect(pending).rejects.toThrow("Your account changed");
    if (change === "account") localStorage.setItem("user", JSON.stringify({ id: 2, companyId: 2 }));
    else localStorage.setItem("doc-session-generation", crypto.randomUUID());
    release!(); await gate; await refusal;
    expect(await engine.listMutations()).toHaveLength(0);
  });
  it("the documenter bootstrap drains only the current user's document queue", async () => {
    engine.setOnline(false);
    await docWrite({ kind: "doc.site.no_backflow", siteKey: "1:", method: "POST",
      url: "/api/system-documentation/customers/1/site/no-backflow", body: { confirmed: true } });
    const db = await openOfflineDB();
    const original = (await engine.listMutations())[0];
    await db.put("mutationQueue", { ...original, id: "legacy", clientId: "legacy", kind: "wet_check.update",
      siteKey: undefined, urlTemplate: "/api/wet-checks/7", status: "syncing" });
    await db.put("mutationQueue", { ...original, id: "foreign", clientId: "foreign", docOwner: "other-user", status: "syncing" });
    const calls: string[] = [];
    const replay = new SyncEngine({ heartbeatIntervalMs: 0, fetchImpl: async (url, init) => {
      calls.push(String(url)); return (init?.method ?? "GET") === "GET" ? json(site()) : json({});
    } });
    replay.setDocumentationOnly(true);
    await replay.start();
    await replay.tick();
    await vi.waitFor(async () => expect((await replay.listMutations()).find(m => m.id === original.id)?.status).toBe("completed"));
    replay.stop();
    expect(calls.every(url => url.startsWith("/api/system-documentation/"))).toBe(true);
    expect((await db.get("mutationQueue", "legacy"))?.status).toBe("syncing");
    expect((await db.get("mutationQueue", "foreign"))?.status).toBe("syncing");
  });
  const input = { kind: "doc.site.no_backflow" as const, siteKey: "1:", method: "POST" as const,
    url: "/api/system-documentation/customers/1/site/no-backflow", body: { confirmed: true } };
  it("sends direct with an empty online queue, and never queues an HTTP refusal", async () => {
    const fetch = vi.fn().mockResolvedValue(json({}));
    vi.stubGlobal("fetch", fetch);
    expect((await docWrite(input)).queued).toBe(false);
    fetch.mockResolvedValue(json({ message: "No" }, 400));
    await expect(docWrite(input)).rejects.toThrow("400");
    expect(await engine.listMutations()).toHaveLength(0);
  });
  it("queues a dropped direct request once, then joins that queue online", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    expect((await docWrite(input)).queued).toBe(true);
    expect((await docWrite(input)).queued).toBe(true);
    const all = (await engine.listMutations()).sort((a, b) => a.createdAt - b.createdAt);
    expect(all).toHaveLength(2);
    expect(all[1].docOrderAfter).toEqual([all[0].clientId]);
  });
  it("serializes concurrent site enqueues", async () => {
    engine.setOnline(false);
    await Promise.all(Array.from({ length: 5 }, () => docWrite(input)));
    const all = (await engine.listMutations()).sort((a, b) => a.createdAt - b.createdAt);
    expect(all).toHaveLength(5);
    expect(all[4].docOrderAfter).toHaveLength(4);
  });
  it("queues and replays a full clock in order with stable local ids and substituted server ids", async () => {
    engine.setOnline(false);
    const request = createDocRequest(1, "");
    const c = await request("/api/customers/1/controllers-profile", "POST", { letter: "K", confirmLetter: true,
      settingsPhotoUrl: "already-satisfied", brand: "Hunter", model: "Pro-C", location: "West" });
    await request(`/api/irrigation-controllers/${c.id}/zone-count`, "PUT", { totalZones: 8 });
    const numbers = [1, 2, 3, 4, 5, 6, 7, 8];
    await request(`/api/irrigation-controllers/${c.id}/zones/bulk`, "PUT", { zoneNumbers: numbers, patch: { zoneType: "rotor" } });
    const p = await request(`/api/irrigation-controllers/${c.id}/programs`, "POST", { name: "A", wateringDays: ["Mon"], startTimes: ["05:00"] });
    await request(`/api/irrigation-controllers/${c.id}/zones/bulk`, "PUT", { zoneNumbers: numbers, patch: { programId: p.id, runTimeMinutes: 0 } });
    await request(`/api/irrigation-controllers/${c.id}/field-verify`, "POST");
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const local = (await readDocSite(1, "")).payload;
    expect(local.controllers[0].verified).toBe(true);
    expect(local.controllers[0].gaps).toEqual([]);
    expect(local.controllers[0].id).toBe(c.id);
    expect((await readDocSite(1, "")).payload).toEqual(local);
    const queue = (await engine.listMutations()).sort((a, b) => a.createdAt - b.createdAt);
    expect(queue).toHaveLength(6);
    expect(queue[5].docRequiresSuccess).toHaveLength(5);
    const calls: { url: string; body: any }[] = [];
    const onlineEngine = new SyncEngine({ heartbeatIntervalMs: 0, fetchImpl: async (url, init) => {
      if ((init?.method ?? "GET") === "GET") return json(site());
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url: String(url), body });
      return json({ id: calls.length === 1 ? 70 : 80 });
    } });
    await onlineEngine.drainAll();
    expect(calls).toHaveLength(6);
    expect(calls[1].url).toBe("/api/irrigation-controllers/70/zone-count");
    expect(calls[4].body.patch.programId).toBe(80);
    expect(calls[5].url).toBe("/api/irrigation-controllers/70/field-verify");
    expect((await onlineEngine.listMutations()).every(m => m.status === "completed")).toBe(true);
  });
  it.each([400, 409])("removes refused %i optimistic changes and blocks Verify visibly", async status => {
    engine.setOnline(false);
    await docWrite({ ...input, kind: "doc.controller.zone_count", subjectLabel: "Controller D", subjectClientId: "4", localSubjectId: 4,
      url: "/api/irrigation-controllers/4/zone-count", method: "PUT", body: { totalZones: 1 } });
    await docWrite({ ...input, kind: "doc.controller.verify", subjectClientId: "4", url: "/api/irrigation-controllers/4/field-verify" });
    const events: any[] = [];
    const replay = new SyncEngine({ heartbeatIntervalMs: 0, fetchImpl: async (_url, init) =>
      (init?.method ?? "GET") === "GET" ? json(site()) : json({ message: "BILLED_ZONES" }, status) });
    replay.on(e => events.push(e));
    await replay.drainAll();
    const queue = await replay.listMutations();
    const count = queue.find(m => m.kind === "doc.controller.zone_count")!;
    expect(count.status).toBe(status === 409 ? "completed" : "failed");
    expect(count.docRefused).toBe(true);
    expect(queue.find(m => m.kind === "doc.controller.verify")!.status).toBe("failed");
    expect(events.some(e => e.type === "doc-refresh" && e.message.includes("Controller D: BILLED_ZONES"))).toBe(true);
    expect(overlayDocQueue((await getDocSite(1, ""))!.payload as DocumentationSite, queue)).toEqual(site());
  });
});
