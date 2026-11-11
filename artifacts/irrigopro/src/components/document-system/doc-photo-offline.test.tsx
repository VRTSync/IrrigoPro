import "fake-indexeddb/auto";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DocPhotoField } from "./doc-photo-field";
import { DocOfflineContext } from "./doc-offline-context";
import { getPhotoBlob, openOfflineDB } from "@/lib/offline/db";
import { putDocSite } from "@/lib/offline/doc-store";
import { SyncEngine, __setEngineForTests } from "@/lib/offline/engine";

vi.mock("@/lib/photo-prep", () => ({ preparePhotoForUpload: async (file: File) => ({ displayFile: file, usedFallback: false }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
let engine: SyncEngine;
let captured: string | null = null;
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
afterEach(() => { engine.stop(); vi.unstubAllGlobals(); });
beforeEach(async () => {
  localStorage.setItem("user", JSON.stringify({ id: 1, companyId: 1 }));
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  URL.createObjectURL = vi.fn().mockReturnValue("blob:durable-photo");
  URL.revokeObjectURL = vi.fn();
  const db = await openOfflineDB(); await db.clear("mutationQueue"); await db.clear("photoBlobs");
  await putDocSite(1, "", { customer: { id: 1, name: "Property", address: null, branches: [] }, branchName: "", controllers: [], backflows: [],
    site: { status: "nothing_on_file", noBackflowConfirmed: false, verifiedAt: null, verifiedByName: null } });
  engine = new SyncEngine({ heartbeatIntervalMs: 0 }); engine.setOnline(false); __setEngineForTests(engine);
  captured = null;
});
function Harness({ kind, initial }: { kind: "controller" | "backflow"; initial: string | null }) {
  const [photo, setPhoto] = useState(initial);
  return <DocOfflineContext.Provider value={{ fromCopy: true, savedAt: 1, siteKey: "1:", online: false, queuedCount: 0, failedCount: 0 }}>
    <DocPhotoField photoId={photo} subjectKind={kind} subjectId={7} onUploaded={id => { captured = id; setPhoto(id); }} />
  </DocOfflineContext.Provider>;
}
describe.each(["controller", "backflow"] as const)("%s offline capture controls", kind => {
  it.each([null, "saved-photo"])("captures and replaces from both inputs, permits same-file reselection and restores the durable preview", async initial => {
    const view = render(<Harness kind={kind} initial={initial} />);
    expect(screen.getByTestId("doc-photo-input")).toHaveAttribute("capture", "environment");
    expect(screen.getByTestId("doc-photo-library-input")).not.toHaveAttribute("capture");
    expect(screen.getByTestId("doc-photo-take")).not.toBeDisabled();
    expect(screen.getByTestId("doc-photo-choose")).not.toBeDisabled();
    const file = new File(["photo"], "field.jpg", { type: "image/jpeg" });
    fireEvent.change(screen.getByTestId("doc-photo-input"), { target: { files: [file] } });
    await screen.findByText("Waiting to upload");
    await waitFor(async () => expect(await engine.listMutations()).toHaveLength(1));
    expect(screen.getByTestId("doc-photo-input")).toHaveValue("");
    const first = captured;
    fireEvent.change(screen.getByTestId("doc-photo-library-input"), { target: { files: [file] } });
    await waitFor(() => expect(captured).not.toBe(first));
    expect(screen.getByTestId("doc-photo-library-input")).toHaveValue("");
    const marker = captured!;
    view.unmount();
    render(<Harness kind={kind} initial={marker} />);
    expect(await screen.findByText("Waiting to upload")).toBeVisible();
    await waitFor(() => expect(screen.getByTestId("doc-photo-preview")).toHaveAttribute("src", "blob:durable-photo"));
    expect(URL.revokeObjectURL).toHaveBeenCalled();
    expect((await engine.listMutations()).every(m => m.kind === `doc.${kind}.photo`)).toBe(true);
  });
  it("does not claim success when durable enqueue fails", async () => {
    vi.spyOn(engine, "enqueueMany").mockRejectedValueOnce(new DOMException("Storage full", "QuotaExceededError"));
    render(<Harness kind={kind} initial="saved-photo" />);
    fireEvent.change(screen.getByTestId("doc-photo-library-input"), { target: { files: [new File(["x"], "field.jpg", { type: "image/jpeg" })] } });
    expect(await screen.findByTestId("doc-photo-error")).toHaveTextContent("Storage full");
    expect(screen.queryByText("Waiting to upload")).toBeNull();
    expect(captured).toBeNull();
    const db = await openOfflineDB();
    expect(await db.count("photoBlobs")).toBe(0);
    fireEvent.click(screen.getByTestId("doc-photo-discard"));
    expect(screen.getByTestId("doc-photo-preview")).toHaveAttribute("src", "/api/photos/saved-photo?variant=medium");
  });
  it.each([
    { failedHop: "sign", status: null }, { failedHop: "put", status: null }, { failedHop: "finalize", status: null },
    { failedHop: "sign", status: 502 }, { failedHop: "put", status: 503 }, { failedHop: "finalize", status: 502 },
    { failedHop: "sign", status: 408 }, { failedHop: "put", status: 429 },
  ])("durably queues direct $failedHop failure $status while still online, then reopens and replays", async ({ failedHop, status }) => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    engine.setOnline(true);
    const direct = vi.fn(async (url: string) => {
      const hop = url.includes("/finalize") ? "finalize" : url.startsWith("https:") ? "put" : "sign";
      if (hop === failedHop) {
        if (status != null) return json({ message: "Temporary upload failure" }, status);
        throw new TypeError("Failed to fetch");
      }
      return json(hop === "sign" ? { signedUrl: "https://storage.example/put", url: "unfinished-photo" } : {});
    });
    vi.stubGlobal("fetch", direct);
    const view = render(<Harness kind={kind} initial="saved-photo" />);
    fireEvent.change(screen.getByTestId("doc-photo-input"), { target: { files: [new File(["durable capture"], "field.jpg", { type: "image/jpeg" })] } });
    await screen.findByText("Waiting to upload");
    expect(direct).toHaveBeenCalledTimes(["sign", "put", "finalize"].indexOf(failedHop) + 1);
    expect(navigator.onLine).toBe(true);
    expect(engine.isOnline()).toBe(false);
    const marker = captured!;
    const rows = await engine.listMutations();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: `doc.${kind}.photo`, status: "pending", clientId: marker.slice(6), docOwner: "1:1" });
    expect(await getPhotoBlob(await openOfflineDB(), marker.slice(6))).toMatchObject({ byteSize: 15, name: "field.jpg" });
    view.unmount();
    const calls: { url: string; method?: string; body?: unknown }[] = [];
    engine = new SyncEngine({ heartbeatIntervalMs: 0, fetchImpl: async (url, init) => {
      const address = String(url); calls.push({ url: address, method: init?.method, body: init?.body });
      return json(address.startsWith("/api/upload/photo?") ? { signedUrl: "https://storage.example/put", url: "synced-photo" } : {});
    } });
    __setEngineForTests(engine);
    render(<Harness kind={kind} initial={marker} />);
    await screen.findByText("Waiting to upload");
    await waitFor(() => expect(screen.getByTestId("doc-photo-preview")).toHaveAttribute("src", "blob:durable-photo"));
    await engine.drainAll();
    expect((await engine.listMutations())[0].status).toBe("completed");
    expect(calls.slice(0, 4).map(c => c.url)).toEqual([
      "/api/upload/photo?originalName=field.jpg", "https://storage.example/put", "/api/upload/photo/finalize",
      kind === "controller" ? "/api/irrigation-controllers/7/photo" : "/api/backflows/7",
    ]);
    expect(JSON.parse(String(calls[3].body))).toEqual(kind === "controller" ? { url: "synced-photo" } : { photoUrl: "synced-photo" });
    expect(await getPhotoBlob(await openOfflineDB(), marker.slice(6))).toBeUndefined();
  });
  it.each([400, 401, 403, 409, 422])("keeps HTTP %i refusals as upload errors rather than silently queuing them", async status => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true); engine.setOnline(true);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ message: "Not allowed" }, status)));
    render(<Harness kind={kind} initial="saved-photo" />);
    fireEvent.change(screen.getByTestId("doc-photo-library-input"), { target: { files: [new File(["x"], "field.jpg", { type: "image/jpeg" })] } });
    expect(await screen.findByTestId("doc-photo-error")).toHaveTextContent(String(status));
    expect(captured).toBeNull();
    expect(await engine.listMutations()).toHaveLength(0);
    expect(await (await openOfflineDB()).count("photoBlobs")).toBe(0);
  });
  it("does not claim a dropped direct upload was saved if its fallback enqueue fails", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true); engine.setOnline(true);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    vi.spyOn(engine, "enqueueMany").mockRejectedValueOnce(new DOMException("Storage full", "QuotaExceededError"));
    render(<Harness kind={kind} initial="saved-photo" />);
    fireEvent.change(screen.getByTestId("doc-photo-input"), { target: { files: [new File(["x"], "field.jpg", { type: "image/jpeg" })] } });
    expect(await screen.findByTestId("doc-photo-error")).toHaveTextContent("Storage full");
    expect(captured).toBeNull();
    expect(await engine.listMutations()).toHaveLength(0);
    expect(await (await openOfflineDB()).count("photoBlobs")).toBe(0);
  });
  it("never queues a late direct-upload failure under a different account", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true); engine.setOnline(true);
    vi.stubGlobal("fetch", vi.fn(async () => {
      localStorage.setItem("user", JSON.stringify({ id: 2, companyId: 2 }));
      throw new TypeError("Failed to fetch");
    }));
    render(<Harness kind={kind} initial="saved-photo" />);
    fireEvent.change(screen.getByTestId("doc-photo-input"), { target: { files: [new File(["x"], "field.jpg", { type: "image/jpeg" })] } });
    expect(await screen.findByTestId("doc-photo-error")).toHaveTextContent("Your account changed");
    expect(captured).toBeNull();
    expect(await engine.listMutations()).toHaveLength(0);
    expect(await (await openOfflineDB()).count("photoBlobs")).toBe(0);
  });
});
