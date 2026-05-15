// Shared audit-log helper. Previously a closure inside
// `registerRoutes()` in routes.ts. Lifted to a module so other route
// files (estimate-routes.ts, etc.) can record audit events without
// importing through routes.ts.
//
// Behavior unchanged from the original implementation — best-effort
// insert; never throws out of the helper so an audit-log write
// failure cannot fail the originating request.
//
// Task #641 — `tx` and `strict` were added so lifecycle transitions
// can co-transact the audit row with the state mutation. When
// `strict: true` is passed, any audit-insert failure propagates so
// the enclosing `db.transaction()` rolls back the state change too.
// The default (no tx / non-strict) preserves the original
// best-effort behavior for non-lifecycle audit emitters like the
// admin / auth pipelines.

import type { Request } from "express";
import { db } from "../db";
import { auditLog } from "@workspace/db/schema";

export type AuditEventInput = {
  occurredAt?: Date;
  actorUserId?: number | null;
  actorLabel?: string | null;
  actorRole?: string | null;
  actorCompanyId?: number | null;
  actionType?: string;
  action: string;
  severity?: "info" | "warning" | "error" | "critical";
  targetType?: string | null;
  targetId?: string | null;
  summary?: string | null;
  details?: Record<string, unknown> | null;
  ip?: string | null;
  userAgent?: string | null;
  sessionId?: string | null;
};

export type AuditEventOpts = { tx?: any; strict?: boolean };

export async function recordAuditEvent(
  req: Request | null,
  evt: AuditEventInput,
  opts: AuditEventOpts = {},
): Promise<void> {
  const executor: any = opts.tx ?? db;
  try {
    const ip =
      evt.ip ??
      (req
        ? req.ip ||
          (req.headers["x-forwarded-for"] as string | undefined)
            ?.split(",")[0]
            ?.trim() ||
          null
        : null);
    const userAgent =
      evt.userAgent ??
      (req ? ((req.headers["user-agent"] as string | undefined) ?? null) : null);
    // Task #554 — when the request is running under impersonation,
    // attribute the action to the target user (so business data
    // stays consistent) but keep the super-admin actor in details
    // so the audit trail shows "performed by X impersonating Y".
    const impersonatorId = (req as any)?.impersonatorUserId ?? null;
    let details = evt.details ?? null;
    if (impersonatorId) {
      details = { ...(details ?? {}), impersonatorUserId: impersonatorId };
    }
    await executor.insert(auditLog).values({
      occurredAt: evt.occurredAt ?? new Date(),
      actorUserId: evt.actorUserId ?? null,
      actorLabel:
        evt.actorLabel ??
        (impersonatorId ? `impersonated by user ${impersonatorId}` : null),
      actorRole: evt.actorRole ?? null,
      actorCompanyId: evt.actorCompanyId ?? null,
      actionType: evt.actionType ?? "other",
      action: evt.action,
      severity: evt.severity ?? "info",
      targetType: evt.targetType ?? null,
      targetId: evt.targetId ?? null,
      summary: evt.summary ?? null,
      details,
      ip: ip ? String(ip).slice(0, 64) : null,
      userAgent: userAgent ? String(userAgent).slice(0, 512) : null,
      sessionId: evt.sessionId ?? null,
    });
  } catch (err) {
    if (opts.strict) throw err;
    try {
      req?.log?.warn({ err }, "audit log write failed");
    } catch {
      /* ignore */
    }
  }
}

// Task #641 — lifecycle transition audit shape. The actual emitter
// lives in routes.ts (it needs storage.getUser to resolve a human
// actor label); estimate-routes.ts receives the emitter as a dep so
// route-level handlers can record lifecycle audit rows without
// re-implementing actor extraction.
export type LifecycleAuditOpts = {
  resource: "estimate" | "wet_check" | "work_order";
  action: string;
  targetId: number | string;
  before?: unknown;
  after?: unknown;
  summary?: string | null;
  note?: string | null;
  companyId?: number | null;
  // When set, the audit row is attributed to the synthetic "customer"
  // actor (no user id / role) — used by /approve-via-token and
  // /reject-via-token paths.
  customer?: {
    email?: string | null;
    name?: string | null;
    token?: string | null;
  } | null;
  extra?: Record<string, unknown>;
};
