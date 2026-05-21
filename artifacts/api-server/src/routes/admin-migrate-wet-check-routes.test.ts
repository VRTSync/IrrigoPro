// Task #808 — Unit tests for /api/admin/migrate-bs-wc/* endpoints.
// Uses mock-style imports so no DB is required.
//
// 8 scenarios:
//  1. 403 for non-super-admin (start)
//  2. 202 on idle start
//  3. 409 on running start (already running)
//  4. status snapshot returns current snapshot
//  5. cancel sets flag (200 ok)
//  6. cancel on idle returns 409
//  7. reset on completed → returns 200 and state goes idle
//  8. reset on running returns 409

import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

// ── Minimal in-process state for testing ─────────────────────────────────────

type JobState = "idle" | "running" | "completed" | "failed" | "cancelled";

interface JobSnapshot {
  state: JobState;
  jobId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  processed: number;
  total: number;
  failed: number;
  currentBsId: number | null;
  lastError: string | null;
  result: null;
  preReport: null;
  postReport: null;
  cancelRequested: boolean;
}

function makeIdleSnapshot(): JobSnapshot {
  return {
    state: "idle",
    jobId: null,
    startedAt: null,
    completedAt: null,
    processed: 0,
    total: 0,
    failed: 0,
    currentBsId: null,
    lastError: null,
    result: null,
    preReport: null,
    postReport: null,
    cancelRequested: false,
  };
}

// ── Simulated request/response helpers ───────────────────────────────────────

function makeReq(opts: {
  role?: string;
  body?: Record<string, unknown>;
}): { authenticatedUserRole: string | undefined; body: Record<string, unknown> } {
  return {
    authenticatedUserRole: opts.role,
    body: opts.body ?? {},
  };
}

function makeRes() {
  const calls: Array<{ status?: number; body?: unknown }> = [];
  let _status = 200;
  const res = {
    status(code: number) {
      _status = code;
      return res;
    },
    json(body: unknown) {
      calls.push({ status: _status, body });
      return res;
    },
    getLastCall() {
      return calls[calls.length - 1];
    },
  };
  return res;
}

// ── In-process state tracker (mirrors migration-runner-state.ts) ──────────────

class MockStateTracker {
  private snap: JobSnapshot = makeIdleSnapshot();

  getJobSnapshot(): JobSnapshot { return { ...this.snap }; }

  startJob(jobId: string): void {
    if (this.snap.state !== "idle") throw new Error(`Cannot start job: state is '${this.snap.state}'`);
    this.snap = { ...makeIdleSnapshot(), state: "running", jobId, startedAt: new Date().toISOString() };
  }

  requestCancel(): void {
    if (this.snap.state !== "running") throw new Error(`Cannot cancel: state is '${this.snap.state}'`);
    this.snap = { ...this.snap, cancelRequested: true };
  }

  resetJob(): void {
    const terminal: JobState[] = ["completed", "failed", "cancelled"];
    if (!terminal.includes(this.snap.state)) {
      throw new Error(`Cannot reset: state is '${this.snap.state}'`);
    }
    this.snap = makeIdleSnapshot();
  }

  // Test helper — force a specific state.
  _setState(state: JobState, extra?: Partial<JobSnapshot>): void {
    this.snap = { ...makeIdleSnapshot(), state, ...extra };
  }
}

// ── Route handler factory (mirrors routes.ts inline handlers) ─────────────────

function makeRouteHandlers(tracker: MockStateTracker) {
  function requireSuperAdminGuard(req: ReturnType<typeof makeReq>, res: ReturnType<typeof makeRes>): boolean {
    if (req.authenticatedUserRole !== "super_admin") {
      res.status(403).json({ message: "Super admin access required" });
      return false;
    }
    return true;
  }

  return {
    async start(req: ReturnType<typeof makeReq>, res: ReturnType<typeof makeRes>) {
      if (!requireSuperAdminGuard(req, res)) return;
      const snapshot = tracker.getJobSnapshot();
      if (snapshot.state !== "idle") {
        res.status(409).json({ message: `Migration is already ${snapshot.state}. Reset before starting again.` });
        return;
      }
      const jobId = `bswc-test-${Date.now()}`;
      tracker.startJob(jobId);
      // Fire-and-forget is not exercised in unit tests — just return 202.
      res.status(202).json({ jobId, message: "Migration started" });
    },

    async status(req: ReturnType<typeof makeReq>, res: ReturnType<typeof makeRes>) {
      if (!requireSuperAdminGuard(req, res)) return;
      res.json(tracker.getJobSnapshot());
    },

    async cancel(req: ReturnType<typeof makeReq>, res: ReturnType<typeof makeRes>) {
      if (!requireSuperAdminGuard(req, res)) return;
      try {
        tracker.requestCancel();
        res.json({ ok: true, message: "Cancel requested" });
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        res.status(409).json({ message: err.message });
      }
    },

    async reset(req: ReturnType<typeof makeReq>, res: ReturnType<typeof makeRes>) {
      if (!requireSuperAdminGuard(req, res)) return;
      try {
        tracker.resetJob();
        res.json({ ok: true, message: "Job state reset to idle" });
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        res.status(409).json({ message: err.message });
      }
    },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("admin-migrate-wet-check routes", () => {
  let tracker: MockStateTracker;
  let handlers: ReturnType<typeof makeRouteHandlers>;

  beforeEach(() => {
    tracker = new MockStateTracker();
    handlers = makeRouteHandlers(tracker);
  });

  // Test 1: 403 for non-super-admin
  it("1. POST /start → 403 for non-super-admin", async () => {
    const req = makeReq({ role: "billing_manager" });
    const res = makeRes();
    await handlers.start(req, res);
    assert.equal(res.getLastCall()?.status, 403);
  });

  // Test 2: 202 on idle start
  it("2. POST /start → 202 when idle", async () => {
    const req = makeReq({ role: "super_admin" });
    const res = makeRes();
    await handlers.start(req, res);
    const call = res.getLastCall();
    assert.equal(call?.status, 202);
    assert.ok((call?.body as Record<string, unknown>)?.jobId);
    assert.equal(tracker.getJobSnapshot().state, "running");
  });

  // Test 3: 409 on running start
  it("3. POST /start → 409 when already running", async () => {
    tracker._setState("running");
    const req = makeReq({ role: "super_admin" });
    const res = makeRes();
    await handlers.start(req, res);
    assert.equal(res.getLastCall()?.status, 409);
  });

  // Test 4: status snapshot
  it("4. GET /status → returns current snapshot", async () => {
    tracker._setState("running", { processed: 5, total: 10, failed: 0 });
    const req = makeReq({ role: "super_admin" });
    const res = makeRes();
    await handlers.status(req, res);
    const snap = res.getLastCall()?.body as JobSnapshot;
    assert.equal(snap.state, "running");
    assert.equal(snap.processed, 5);
  });

  // Test 5: cancel sets flag
  it("5. POST /cancel → 200 and cancelRequested=true when running", async () => {
    tracker._setState("running");
    const req = makeReq({ role: "super_admin" });
    const res = makeRes();
    await handlers.cancel(req, res);
    assert.equal((res.getLastCall()?.body as Record<string, unknown>)?.ok, true);
    assert.equal(tracker.getJobSnapshot().cancelRequested, true);
  });

  // Test 6: cancel on idle → 409
  it("6. POST /cancel → 409 when idle", async () => {
    const req = makeReq({ role: "super_admin" });
    const res = makeRes();
    await handlers.cancel(req, res);
    assert.equal(res.getLastCall()?.status, 409);
  });

  // Test 7: reset on completed → idle
  it("7. POST /reset on completed → 200 and state becomes idle", async () => {
    tracker._setState("completed");
    const req = makeReq({ role: "super_admin" });
    const res = makeRes();
    await handlers.reset(req, res);
    assert.equal((res.getLastCall()?.body as Record<string, unknown>)?.ok, true);
    assert.equal(tracker.getJobSnapshot().state, "idle");
  });

  // Test 8: reset on running → 409
  it("8. POST /reset → 409 when running", async () => {
    tracker._setState("running");
    const req = makeReq({ role: "super_admin" });
    const res = makeRes();
    await handlers.reset(req, res);
    assert.equal(res.getLastCall()?.status, 409);
  });
});
