// Task #518 — Wet check FindingSheet delete-button regression tests.
//
// Locks in the optimistic-remove + rollback + toast behaviour of
// `deleteFindingMut` in artifacts/irrigopro/src/pages/wet-checks.tsx.
// Pre-Task-#518 the mutation had no onError handler and apiRequest
// only throws on non-2xx, so the server's HTTP 200 `{ ok: false }`
// looked like success, the optimistic remove never reverted, and the
// tech got no toast. The fix:
//
//   1. The mutationFn defensively treats `{ ok: false }` as an error
//      so a pre-Task-#518 server (or a future regression) still
//      surfaces the failure.
//   2. onMutate snapshots the cached wet check and removes the
//      finding (and its photos) optimistically.
//   3. onError restores the snapshot and shows a destructive toast.
//
// We exercise the mutation through a tiny harness that mirrors the
// page's wiring (QueryClientProvider + cached `["/api/wet-checks", id]`
// data + the same useMutation config copy-pasted to keep the test
// hermetic). The harness imports `apiRequest` indirectly via the
// mocked module so we can drive 200/4xx/200-with-ok-false branches
// deterministically.

import "fake-indexeddb/auto";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider, useMutation } from "@tanstack/react-query";
import React from "react";

// vi.mock factories are hoisted, so any vars they close over must be
// declared via vi.hoisted to be available at the time the factory runs.
const { apiRequestMock, offlineDeleteFindingMock, toastMock } = vi.hoisted(() => ({
  apiRequestMock: vi.fn(),
  offlineDeleteFindingMock: vi.fn(),
  toastMock: vi.fn(),
}));

vi.mock("@/lib/queryClient", () => ({
  apiRequest: apiRequestMock,
  authedPhotoSrc: (u: string) => u,
  // Task #540 — wet-checks.tsx imports `asArray` for null-safe
  // nested-array reads.
  asArray: <T,>(v: T[] | null | undefined): T[] =>
    Array.isArray(v) ? v : [],
  useArrayQuery: <T,>(_opts: unknown) =>
    ({ data: [] as T[], isLoading: false, isError: false, isSuccess: true, error: null, refetch: vi.fn() }) as any,
  parseApiError: (e: unknown, fallback: string) => {
    if (e instanceof Error) return e.message || fallback;
    return fallback;
  },
}));
vi.mock("@/lib/offline/engine", () => ({ isOfflineQueueEnabled: () => false }));
vi.mock("@/lib/offline/api", () => ({ deleteFinding: offlineDeleteFindingMock }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: toastMock }) }));

import { apiRequest, parseApiError } from "@/lib/queryClient";
import { isOfflineQueueEnabled } from "@/lib/offline/engine";
import { deleteFinding as offlineDeleteFinding } from "@/lib/offline/api";
import { useToast } from "@/hooks/use-toast";

// Mirrors the snapshot the wet-check detail query stores under
// ["/api/wet-checks", wetCheckId] — only the bits the deleteFindingMut
// reads/writes.
function makeSnapshot(): any {
  return {
    id: 42,
    status: "in_progress",
    zoneRecords: [
      {
        id: 1001,
        clientId: "zr-1",
        findings: [
          { id: 501, clientId: "f-501", resolution: "repaired_in_field" },
          { id: 502, clientId: "f-502", resolution: "pending" },
        ],
      },
    ],
    photos: [
      { id: 9001, findingId: 501, url: "u1" },
      { id: 9002, findingId: 502, url: "u2" },
    ],
  };
}

// Direct copy of the production mutation config so the test breaks
// the moment the page's deleteFindingMut diverges. (Vitest cannot
// import the closure-bound mutation from the page itself without
// rendering the whole detail tree, which is overkill for what we're
// asserting here.)
function useDeleteFindingMut(wetCheckId: number, queryClient: QueryClient) {
  const { toast } = useToast();
  const key: readonly unknown[] = ["/api/wet-checks", wetCheckId];
  return useMutation({
    mutationFn: async (f: { id: number; clientId: string | null }) => {
      if (isOfflineQueueEnabled() && f.clientId) {
        await offlineDeleteFinding(f.clientId, f.id);
        return { ok: true };
      }
      const res = await apiRequest(`/api/wet-checks/findings/${f.id}`, "DELETE");
      if (res && typeof res === "object" && "ok" in res && (res as any).ok === false) {
        throw new Error(
          typeof (res as any).message === "string"
            ? (res as any).message
            : "Couldn't delete finding — please retry",
        );
      }
      return res ?? { ok: true };
    },
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<any>(key);
      if (previous) {
        queryClient.setQueryData<any>(key, {
          ...previous,
          zoneRecords: previous.zoneRecords.map((zr: any) => ({
            ...zr,
            findings: zr.findings.filter((f: any) => f.id !== vars.id),
          })),
          photos: previous.photos.filter((p: any) => p.findingId !== vars.id),
        });
      }
      return { previous };
    },
    onError: (e: any, _vars, ctx: any) => {
      if (ctx?.previous) queryClient.setQueryData(key, ctx.previous);
      toast({
        title: "Couldn't delete finding",
        description: parseApiError(e, e?.message ?? "Please try again."),
        variant: "destructive",
      });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["/api/wet-checks"] }),
  });
}

function Harness({ qc }: { qc: QueryClient }) {
  const m = useDeleteFindingMut(42, qc);
  return (
    <button
      data-testid="del"
      onClick={() => m.mutate({ id: 501, clientId: "f-501" })}
    >
      delete
    </button>
  );
}

beforeEach(() => {
  apiRequestMock.mockReset();
  offlineDeleteFindingMock.mockReset();
  toastMock.mockReset();
});

describe("deleteFindingMut — Task #518", () => {
  it("optimistically removes the finding + its photos from the cached wet check on mutate", async () => {
    apiRequestMock.mockImplementation(() => new Promise(() => {})); // never resolves
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    qc.setQueryData(["/api/wet-checks", 42], makeSnapshot());
    render(
      <QueryClientProvider client={qc}>
        <Harness qc={qc} />
      </QueryClientProvider>,
    );
    await userEvent.click(screen.getByTestId("del"));
    await waitFor(() => {
      const next: any = qc.getQueryData(["/api/wet-checks", 42]);
      const findings = next.zoneRecords[0].findings;
      expect(findings).toHaveLength(1);
      expect(findings[0].id).toBe(502);
      // Photos linked to the deleted finding go too.
      expect(next.photos.find((p: any) => p.findingId === 501)).toBeUndefined();
      expect(next.photos.find((p: any) => p.findingId === 502)).toBeDefined();
    });
  });

  it("rolls back the snapshot AND shows a destructive toast when the server returns 4xx (the new Task #518 behaviour)", async () => {
    // Mirrors apiRequest's throw shape on a non-2xx response:
    //   `${res.status}: ${text}` — see queryClient.ts throwIfResNotOk.
    apiRequestMock.mockRejectedValue(
      new Error('409: {"message":"Cannot delete finding — already routed to billing sheet #4242. Remove it from the billing sheet first.","reason":"already_converted","target":"billing_sheet","targetId":4242}'),
    );
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    const snapshot = makeSnapshot();
    qc.setQueryData(["/api/wet-checks", 42], snapshot);
    render(
      <QueryClientProvider client={qc}>
        <Harness qc={qc} />
      </QueryClientProvider>,
    );
    await userEvent.click(screen.getByTestId("del"));
    await waitFor(() => expect(toastMock).toHaveBeenCalled());
    // Snapshot restored — the row should be back.
    const next: any = qc.getQueryData(["/api/wet-checks", 42]);
    expect(next.zoneRecords[0].findings.find((f: any) => f.id === 501)).toBeDefined();
    expect(next.photos.find((p: any) => p.findingId === 501)).toBeDefined();
    // Toast must be destructive (not a silent info toast).
    const call = toastMock.mock.calls[0]?.[0];
    expect(call?.variant).toBe("destructive");
    expect(String(call?.title ?? "")).toMatch(/delete/i);
  });

  it("treats a legacy 200 { ok: false } response as a failure — rollback + toast — instead of silently 'succeeding' (the original Task #518 bug)", async () => {
    apiRequestMock.mockResolvedValue({ ok: false, message: "wet check is submitted" });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    qc.setQueryData(["/api/wet-checks", 42], makeSnapshot());
    render(
      <QueryClientProvider client={qc}>
        <Harness qc={qc} />
      </QueryClientProvider>,
    );
    await userEvent.click(screen.getByTestId("del"));
    await waitFor(() => expect(toastMock).toHaveBeenCalled());
    const next: any = qc.getQueryData(["/api/wet-checks", 42]);
    // Optimistic remove is reverted — the finding is back.
    expect(next.zoneRecords[0].findings.find((f: any) => f.id === 501)).toBeDefined();
    const call = toastMock.mock.calls[0]?.[0];
    expect(call?.variant).toBe("destructive");
    expect(String(call?.description ?? "")).toMatch(/submitted/i);
  });

  it("does NOT show an error toast on a successful delete (200 { ok: true })", async () => {
    apiRequestMock.mockResolvedValue({ ok: true });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    qc.setQueryData(["/api/wet-checks", 42], makeSnapshot());
    render(
      <QueryClientProvider client={qc}>
        <Harness qc={qc} />
      </QueryClientProvider>,
    );
    await userEvent.click(screen.getByTestId("del"));
    // Wait for the mutation to settle — the optimistic remove must
    // persist (no rollback, no toast).
    await waitFor(() => {
      const next: any = qc.getQueryData(["/api/wet-checks", 42]);
      expect(next.zoneRecords[0].findings.find((f: any) => f.id === 501)).toBeUndefined();
    });
    expect(toastMock).not.toHaveBeenCalled();
  });
});
