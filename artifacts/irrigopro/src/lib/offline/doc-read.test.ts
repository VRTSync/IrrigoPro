import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readDocSite, OfflineNotDownloadedError } from "./doc-read";
import { autoDownloadDocSites, downloadAllDocSites } from "./doc-download";
import { clearDocCopies, getDocSite, getDocSitesList, putDocSite } from "./doc-store";
import { openOfflineDB } from "./db";

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
beforeEach(async () => {
  localStorage.setItem("user", JSON.stringify({ id: 1, companyId: 2 }));
  vi.stubGlobal("navigator", { onLine: true });
  await clearDocCopies();
});
describe("documentation read-through", () => {
  it("times out after six seconds and uses the copy", async () => {
    await putDocSite(1, "", { controllers: [] });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.stubGlobal("fetch", vi.fn((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new DOMException("Timed out", "AbortError")));
    })));
    try {
      const pending = readDocSite(1, "");
      await vi.advanceTimersByTimeAsync(6000);
      expect((await pending).fromCopy).toBe(true);
    } finally { vi.useRealTimers(); }
  });
  it("does not repopulate copies from a response arriving after logout", async () => {
    let release!: (value: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(resolve => { release = resolve; })));
    const pending = readDocSite(1, "");
    await clearDocCopies();
    release(json({ controllers: [] }));
    await pending;
    expect(await getDocSite(1, "")).toBeNull();
  });
  it("downloads at most four sites concurrently", async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let active = 0, peak = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.endsWith("/sites")) return json({ customers: [1, 2, 3, 4, 5, 6, 7].map(customerId => ({ customerId, branches: [] })) });
      active++; peak = Math.max(peak, active);
      await gate; active--;
      return json({ controllers: [] });
    }));
    const pending = downloadAllDocSites();
    await vi.waitFor(() => expect(active).toBe(4));
    release();
    expect(await pending).toEqual({ saved: 7, failed: 0 });
    expect(peak).toBe(4);
  });
  it("throttles automatic reconnect downloads to ten minutes", async () => {
    const fetch = vi.fn().mockResolvedValue(json({ customers: [] }));
    vi.stubGlobal("fetch", fetch);
    await autoDownloadDocSites();
    await autoDownloadDocSites();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("stores an online payload and returns the saved copy only on a connection failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ controllers: [] })));
    expect((await readDocSite(1, "North")).fromCopy).toBe(false);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    expect((await readDocSite(1, "North")).fromCopy).toBe(true);
    await expect(readDocSite(1, "South")).rejects.toBeInstanceOf(OfflineNotDownloadedError);
  });
  it.each([403, 500])("does not hide HTTP %i behind a copy", async (status) => {
    await putDocSite(1, "", {});
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ message: "Refused" }, status)));
    await expect(readDocSite(1, "")).rejects.toThrow(String(status));
  });
  it("shares the download promise and continues after a site fails", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.endsWith("/sites")) { await gate; return json({ customers: [1, 2, 3].map((customerId) => ({ customerId, branches: [] })) }); }
      if (url.includes("/2/")) return json({}, 500);
      return json({ controllers: [] });
    }));
    const first = downloadAllDocSites();
    expect(downloadAllDocSites()).toBe(first);
    release();
    expect(await first).toEqual({ saved: 2, failed: 1 });
    expect(await getDocSite(1, "")).not.toBeNull();
    expect(await getDocSite(3, "")).not.toBeNull();
  });
  it("isolates users and clears only document stores on logout", async () => {
    await putDocSite(1, "", {});
    const db = await openOfflineDB();
    await db.put("apiCache", { key: "keep", data: 1, updatedAt: 0 });
    localStorage.setItem("user", JSON.stringify({ id: 9, companyId: 2 }));
    expect(await getDocSite(1, "")).toBeNull();
    await clearDocCopies();
    expect(await db.count("docSites")).toBe(0);
    expect(await getDocSitesList()).toBeNull();
    expect(await db.get("apiCache", "keep")).toBeDefined();
  });
});
