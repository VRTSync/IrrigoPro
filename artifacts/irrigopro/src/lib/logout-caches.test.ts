import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearDocCopies } from "./offline/doc-store";
import { clearSessionAndLogout } from "./queryClient";

vi.mock("@/lib/offline/doc-store", () => ({ clearDocCopies: vi.fn() }));

const replace = vi.fn();
const keys = vi.fn();
const deleteCache = vi.fn();

beforeEach(() => {
  vi.mocked(clearDocCopies).mockReset().mockResolvedValue(undefined);
  replace.mockClear();
  keys.mockReset().mockResolvedValue(["wc-parts-v1", "workbox-precache-v2", "wc-controllers-v1"]);
  deleteCache.mockReset().mockResolvedValue(true);
  vi.stubGlobal("window", Object.create(window, { location: { value: { replace } } }));
  vi.stubGlobal("caches", { keys, delete: deleteCache });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
});

afterEach(() => vi.unstubAllGlobals());

describe("logout read caches", () => {
  it.each(["documents", "caches"])("preserves the app shell and waits when %s finish last", async (last) => {
    let finishDocs!: () => void;
    vi.mocked(clearDocCopies).mockReturnValue(new Promise<void>((resolve) => { finishDocs = resolve; }));
    let finishCache!: (deleted: boolean) => void;
    deleteCache.mockReturnValueOnce(new Promise<boolean>((resolve) => { finishCache = resolve; }));

    clearSessionAndLogout();

    await vi.waitFor(() => expect(deleteCache.mock.calls).toEqual([["wc-parts-v1"], ["wc-controllers-v1"]]));
    expect(replace).not.toHaveBeenCalled();
    const finishReadCaches = () => finishCache(true);
    const [first, second] = last === "documents" ? [finishReadCaches, finishDocs] : [finishDocs, finishReadCaches];
    first();
    await Promise.resolve();
    expect(replace).not.toHaveBeenCalled();
    second();
    await vi.waitFor(() => expect(replace.mock.calls).toEqual([["/login"]]));
  });

  it("still redirects when Cache Storage is unavailable", async () => {
    vi.stubGlobal("caches", undefined);
    clearSessionAndLogout();
    await vi.waitFor(() => expect(replace.mock.calls).toEqual([["/login"]]));
  });
});
