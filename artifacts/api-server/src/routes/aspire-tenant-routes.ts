// =============================================================================
// ASPIRE TENANT ADMIN ROUTES — Mission 8
// =============================================================================
//
// Exposes the Aspire integration surface to authenticated company admins.
// Mounted at /api/company/:companyId (caller passes deps from routes.ts).
//
// Routes:
//   GET    /api/company/:companyId/integrations
//   GET    /api/company/:companyId/integrations/aspire
//   PUT    /api/company/:companyId/integrations/aspire
//   POST   /api/company/:companyId/integrations/aspire/sync  ← NEW (Mission 10b)
//   POST   /api/company/:companyId/integrations/aspire/test
//   DELETE /api/company/:companyId/integrations/aspire
//   GET    /api/company/:companyId/integrations/aspire/sync-logs
//   GET    /api/company/:companyId/integrations/aspire/conflicts
//   POST   /api/company/:companyId/integrations/aspire/conflicts/:conflictId/resolve
//
// Auth:
//   All routes: requireAuthentication + companyId URL/session match.
//   Read-only hub (GET /integrations) + detail GET + sync-logs + conflicts:
//     company_admin | billing_manager | irrigation_manager.
//   Write/test/delete/resolve:
//     company_admin only.
//
// Security guardrail:
//   The Aspire GET detail route NEVER returns any encrypted credential field.
//   It returns only a masked preview ("XXXX...last4"), connectionStatus,
//   lastHealthCheckAt, and syncEnabled.
//
// =============================================================================

import type { Express, RequestHandler } from "express";
import { z } from "zod";
import { eq, and, desc } from "drizzle-orm";
import { db } from "../db";
import {
  aspireCredentials,
  externalIntegrations,
  aspireSyncJobs,
  aspireConflictQueue,
} from "@workspace/db";
import { decrypt } from "../services/aspire-token-service";
import {
  saveCredentials,
  revokeCredentials,
} from "../services/aspire-token-service";
import { testConnection } from "../services/aspire-api-client";
import { resolveConflict } from "../services/aspire-sync-service";
import { triggerManualSync } from "../cron/aspire-cron";
import { logger } from "../lib/logger";

// ---------------------------------------------------------------------------
// Role sets
// ---------------------------------------------------------------------------

/** Roles that may read integration status / sync logs / conflicts. */
const READ_ROLES = new Set(["company_admin", "billing_manager", "irrigation_manager"]);

/** Roles that may write (configure / test / delete / resolve). */
const WRITE_ROLES = new Set(["company_admin"]);

// ---------------------------------------------------------------------------
// Deps interface (injected so tests can swap middlewares without pulling the monolith)
// ---------------------------------------------------------------------------

export interface AspireTenantRouteDeps {
  requireAuthentication: RequestHandler;
  requireCompanyAdminAccess: RequestHandler;
  requireCompanySetup: RequestHandler;
}

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const putAspireBody = z.object({
  clientId: z.string().min(1, "clientId is required"),
  clientSecret: z.string().min(1, "clientSecret is required"),
});

const resolveConflictBody = z.object({
  resolution: z.enum(["use_aspire", "use_irrigo", "manual_edit", "dismissed"]),
  note: z.string().optional(),
  manualValue: z.string().nullable().optional(),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseCompanyId(raw: string): number | null {
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseConflictId(raw: string): number | null {
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Produces a masked credential preview: "XXXX...last4" derived from
 * decrypting only long enough to slice the last 4 characters,
 * then immediately discarding the plaintext.
 *
 * If decryption fails (e.g. key rotation, empty blob), returns "XXXX...????".
 * NEVER returns the full plaintext. This is the ONLY place a credential is
 * decrypted in this module and the result never leaves this function intact.
 */
function maskCredential(encryptedBlob: string): string {
  if (!encryptedBlob) return "XXXX...????";
  try {
    const plain = decrypt(encryptedBlob);
    if (plain.length < 4) return "XXXX...????";
    const last4 = plain.slice(-4);
    // Immediately overwrite the local variable by rebinding — JS GC will
    // collect the string; there is no manual memory wipe in V8 but we
    // avoid spreading the reference further.
    return `XXXX...${last4}`;
  } catch {
    return "XXXX...????";
  }
}

/**
 * Enforces that the session's companyId matches the URL's :companyId.
 * super_admin is always allowed through (cross-tenant access).
 *
 * Returns true if access is allowed (caller should continue), false if
 * a 403 was already sent (caller should return immediately).
 */
function enforceCompanyMatch(
  req: any,
  res: any,
  urlCompanyId: number,
): boolean {
  const role = req.authenticatedUserRole as string | undefined;
  if (role === "super_admin") return true;

  const sessionCompanyId = req.authenticatedUserCompanyId as number | null | undefined;
  if (sessionCompanyId == null) {
    res.status(401).json({ message: "Authentication required" });
    return false;
  }
  if (Number(sessionCompanyId) !== urlCompanyId) {
    res.status(403).json({
      message: "Access denied — you may only manage integrations for your own company.",
    });
    return false;
  }
  return true;
}

/**
 * Returns true if the caller role is in the allowed set, false if a 403
 * was already sent.
 */
function enforceRole(req: any, res: any, allowedRoles: Set<string>): boolean {
  const role = req.authenticatedUserRole as string | undefined;
  // super_admin always passes
  if (role === "super_admin") return true;
  if (!role || !allowedRoles.has(role)) {
    res.status(403).json({
      message: "Access denied — insufficient role for this operation.",
    });
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function registerAspireTenantRoutes(
  app: Express,
  deps: AspireTenantRouteDeps,
): void {
  const { requireAuthentication, requireCompanySetup } = deps;

  // ── GET /api/company/:companyId/integrations ─────────────────────────────
  //
  // Integrations hub: lists all integration types for this company with
  // their connection status. Read-only; accessible by company_admin,
  // billing_manager, and irrigation_manager.
  app.get(
    "/api/company/:companyId/integrations",
    requireAuthentication,
    requireCompanySetup,
    async (req: any, res: any) => {
      const companyId = parseCompanyId(req.params.companyId);
      if (!companyId) {
        return res.status(400).json({ message: "Invalid companyId" });
      }
      if (!enforceCompanyMatch(req, res, companyId)) return;
      if (!enforceRole(req, res, READ_ROLES)) return;

      try {
        // Fetch all known external_integrations rows for this company.
        const rows = await db
          .select({
            id: externalIntegrations.id,
            integrationType: externalIntegrations.integrationType,
            connectionStatus: externalIntegrations.connectionStatus,
            connectedAt: externalIntegrations.connectedAt,
            lastHealthCheckAt: externalIntegrations.lastHealthCheckAt,
            createdAt: externalIntegrations.createdAt,
            updatedAt: externalIntegrations.updatedAt,
          })
          .from(externalIntegrations)
          .where(eq(externalIntegrations.companyId, companyId))
          .orderBy(externalIntegrations.integrationType);

        // Always include "aspire" even if no row exists yet, so the UI
        // can render the "not configured" state without a separate request.
        type IntegrationRow = (typeof rows)[number];
        const aspireRow = rows.find((r: IntegrationRow) => r.integrationType === "aspire");

        const integrations = rows.map((r: IntegrationRow) => ({
          service: r.integrationType,
          connectionStatus: r.connectionStatus,
          connectedAt: r.connectedAt ?? null,
          lastHealthCheckAt: r.lastHealthCheckAt ?? null,
        }));

        if (!aspireRow) {
          integrations.push({
            service: "aspire",
            connectionStatus: "disconnected",
            connectedAt: null,
            lastHealthCheckAt: null,
          });
        }

        res.json({ integrations });
      } catch (err: any) {
        logger.error(
          { companyId, err },
          "[aspire-tenant-routes] GET /integrations failed",
        );
        res.status(500).json({ message: "Could not load integrations — please retry" });
      }
    },
  );

  // ── GET /api/company/:companyId/integrations/aspire ──────────────────────
  //
  // Returns Aspire integration detail WITHOUT any raw credential material.
  // Only masked previews of clientId / clientSecret are returned.
  // Accessible by company_admin, billing_manager, and irrigation_manager.
  app.get(
    "/api/company/:companyId/integrations/aspire",
    requireAuthentication,
    requireCompanySetup,
    async (req: any, res: any) => {
      const companyId = parseCompanyId(req.params.companyId);
      if (!companyId) {
        return res.status(400).json({ message: "Invalid companyId" });
      }
      if (!enforceCompanyMatch(req, res, companyId)) return;
      if (!enforceRole(req, res, READ_ROLES)) return;

      try {
        // Fetch credential row (for masked preview + syncEnabled).
        const credRows = await db
          .select({
            encryptedClientId: aspireCredentials.encryptedClientId,
            encryptedClientSecret: aspireCredentials.encryptedClientSecret,
            connectionStatus: aspireCredentials.connectionStatus,
            errorMessage: aspireCredentials.errorMessage,
            syncEnabled: aspireCredentials.syncEnabled,
            throttleUntil: aspireCredentials.throttleUntil,
            createdAt: aspireCredentials.createdAt,
            updatedAt: aspireCredentials.updatedAt,
          })
          .from(aspireCredentials)
          .where(eq(aspireCredentials.companyId, companyId))
          .limit(1);

        // Fetch external_integrations for lastHealthCheckAt.
        const intRows = await db
          .select({
            connectionStatus: externalIntegrations.connectionStatus,
            connectedAt: externalIntegrations.connectedAt,
            lastHealthCheckAt: externalIntegrations.lastHealthCheckAt,
          })
          .from(externalIntegrations)
          .where(
            and(
              eq(externalIntegrations.companyId, companyId),
              eq(externalIntegrations.integrationType, "aspire"),
            ),
          )
          .limit(1);

        const cred = credRows[0] ?? null;
        const integration = intRows[0] ?? null;

        if (!cred) {
          // Not configured yet — return a "disconnected" sentinel.
          return res.json({
            configured: false,
            connectionStatus: "disconnected",
            syncEnabled: false,
            clientIdPreview: null,
            clientSecretPreview: null,
            lastHealthCheckAt: null,
            connectedAt: null,
            errorMessage: null,
            throttleUntil: null,
          });
        }

        // Build masked previews — the ONLY credential-adjacent data returned.
        // encryptedClientId / encryptedClientSecret / encryptedAccessToken
        // are intentionally EXCLUDED from the response object. This is the
        // core security invariant of this route.
        const clientIdPreview = maskCredential(cred.encryptedClientId);
        const clientSecretPreview = maskCredential(cred.encryptedClientSecret);

        // Explicitly construct the response object to make the exclusion
        // of encrypted fields obvious and auditable.
        const safeResponse = {
          configured: true,
          connectionStatus: integration?.connectionStatus ?? cred.connectionStatus,
          syncEnabled: cred.syncEnabled,
          clientIdPreview,
          clientSecretPreview,
          lastHealthCheckAt: integration?.lastHealthCheckAt ?? null,
          connectedAt: integration?.connectedAt ?? null,
          errorMessage: cred.errorMessage ?? null,
          throttleUntil: cred.throttleUntil ?? null,
          createdAt: cred.createdAt,
          updatedAt: cred.updatedAt,
          // Explicitly omit — document the absence so readers know it was intentional:
          // encryptedClientId: OMITTED
          // encryptedClientSecret: OMITTED
          // encryptedAccessToken: OMITTED
        };

        res.json(safeResponse);
      } catch (err: any) {
        logger.error(
          { companyId, err },
          "[aspire-tenant-routes] GET /integrations/aspire failed",
        );
        res.status(500).json({ message: "Could not load Aspire integration — please retry" });
      }
    },
  );

  // ── PUT /api/company/:companyId/integrations/aspire ──────────────────────
  //
  // Save new credentials then immediately run testConnection so the admin
  // gets instant feedback. Requires company_admin.
  app.put(
    "/api/company/:companyId/integrations/aspire",
    requireAuthentication,
    requireCompanySetup,
    async (req: any, res: any) => {
      const companyId = parseCompanyId(req.params.companyId);
      if (!companyId) {
        return res.status(400).json({ message: "Invalid companyId" });
      }
      if (!enforceCompanyMatch(req, res, companyId)) return;
      if (!enforceRole(req, res, WRITE_ROLES)) return;

      const parsed = putAspireBody.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({
          message: "Invalid request body",
          issues: parsed.error.issues,
        });
      }

      const { clientId, clientSecret } = parsed.data;

      try {
        // Encrypt and persist credentials — token service enforces that
        // no plaintext ever reaches the DB.
        await saveCredentials(companyId, clientId, clientSecret);

        logger.info(
          { companyId },
          "[aspire-tenant-routes] PUT /integrations/aspire: credentials saved, running test",
        );

        // Immediately test — gives the admin instant feedback.
        // testConnection() never throws; it returns a typed result.
        const testResult = await testConnection(companyId);

        // Re-fetch the latest status after the test to return accurate state.
        const intRows = await db
          .select({
            connectionStatus: externalIntegrations.connectionStatus,
            lastHealthCheckAt: externalIntegrations.lastHealthCheckAt,
            connectedAt: externalIntegrations.connectedAt,
          })
          .from(externalIntegrations)
          .where(
            and(
              eq(externalIntegrations.companyId, companyId),
              eq(externalIntegrations.integrationType, "aspire"),
            ),
          )
          .limit(1);

        const integration = intRows[0] ?? null;

        res.json({
          ok: testResult.success,
          connectionStatus: integration?.connectionStatus ?? (testResult.success ? "connected" : "error"),
          lastHealthCheckAt: integration?.lastHealthCheckAt ?? null,
          connectedAt: integration?.connectedAt ?? null,
          errorMessage: testResult.success ? null : (testResult.errorMessage ?? "Connection test failed"),
          message: testResult.success
            ? "Credentials saved and connection verified."
            : "Credentials saved but connection test failed — verify your clientId and clientSecret.",
        });
      } catch (err: any) {
        logger.error(
          { companyId, err },
          "[aspire-tenant-routes] PUT /integrations/aspire failed",
        );
        res.status(500).json({ message: "Could not save Aspire credentials — please retry" });
      }
    },
  );

  // ── POST /api/company/:companyId/integrations/aspire/sync ────────────────
  //
  // Tenant-scoped manual sync trigger. Requires company_admin.
  // Guards against duplicate triggers: rejects if a full_sync is already
  // 'running' or was started for this company within the last 60 seconds.
  app.post(
    "/api/company/:companyId/integrations/aspire/sync",
    requireAuthentication,
    requireCompanySetup,
    async (req: any, res: any) => {
      const companyId = parseCompanyId(req.params.companyId);
      if (!companyId) {
        return res.status(400).json({ message: "Invalid companyId" });
      }
      if (!enforceCompanyMatch(req, res, companyId)) return;
      if (!enforceRole(req, res, WRITE_ROLES)) return;

      try {
        // Cooldown check: reject if a full_sync is running or was started
        // within the last 60 seconds for this company.
        const COOLDOWN_MS = 60_000;
        const cutoff = new Date(Date.now() - COOLDOWN_MS);

        const recentJobs = await db
          .select({
            id: aspireSyncJobs.id,
            status: aspireSyncJobs.status,
            startedAt: aspireSyncJobs.startedAt,
          })
          .from(aspireSyncJobs)
          .where(
            and(
              eq(aspireSyncJobs.companyId, companyId),
              eq(aspireSyncJobs.jobType, "full_sync"),
            ),
          )
          .orderBy(desc(aspireSyncJobs.createdAt))
          .limit(1);

        const latest = recentJobs[0] ?? null;
        if (latest) {
          if (latest.status === "running" || latest.status === "pending") {
            return res.status(409).json({
              message: "A sync is already in progress for this company. Please wait for it to complete.",
              syncJobId: latest.id,
            });
          }
          if (latest.startedAt && latest.startedAt > cutoff) {
            const remaining = Math.ceil(
              (COOLDOWN_MS - (Date.now() - latest.startedAt.getTime())) / 1000,
            );
            return res.status(429).json({
              message: `A sync was started recently. Please wait ${remaining}s before triggering another.`,
              retryAfterSeconds: remaining,
            });
          }
        }

        // Fire-and-forget — returns immediately.
        triggerManualSync(companyId, "full_sync", "manual_tenant");

        logger.info(
          { companyId, actorUserId: req.authenticatedUserId },
          "[aspire-tenant-routes] POST /integrations/aspire/sync: triggered",
        );

        res.json({
          ok: true,
          message: "Sync started. Check sync history for progress.",
          companyId,
        });
      } catch (err: any) {
        logger.error(
          { companyId, err },
          "[aspire-tenant-routes] POST /integrations/aspire/sync failed",
        );
        res.status(500).json({ message: "Could not start sync — please retry" });
      }
    },
  );

  // ── POST /api/company/:companyId/integrations/aspire/test ────────────────
  //
  // Manual connection test without changing credentials. Requires company_admin.
  app.post(
    "/api/company/:companyId/integrations/aspire/test",
    requireAuthentication,
    requireCompanySetup,
    async (req: any, res: any) => {
      const companyId = parseCompanyId(req.params.companyId);
      if (!companyId) {
        return res.status(400).json({ message: "Invalid companyId" });
      }
      if (!enforceCompanyMatch(req, res, companyId)) return;
      if (!enforceRole(req, res, WRITE_ROLES)) return;

      try {
        // Verify credentials exist before attempting a test.
        const credRows = await db
          .select({ encryptedClientId: aspireCredentials.encryptedClientId })
          .from(aspireCredentials)
          .where(eq(aspireCredentials.companyId, companyId))
          .limit(1);

        if (credRows.length === 0 || !credRows[0].encryptedClientId) {
          return res.status(422).json({
            message: "No Aspire credentials configured. Save credentials first.",
          });
        }

        logger.info(
          { companyId },
          "[aspire-tenant-routes] POST /integrations/aspire/test: running connection test",
        );

        const testResult = await testConnection(companyId);

        res.json({
          ok: testResult.success,
          connectionStatus: testResult.success ? "connected" : "error",
          errorMessage: testResult.success ? null : (testResult.errorMessage ?? "Connection test failed"),
        });
      } catch (err: any) {
        logger.error(
          { companyId, err },
          "[aspire-tenant-routes] POST /integrations/aspire/test failed",
        );
        res.status(500).json({ message: "Connection test encountered an error — please retry" });
      }
    },
  );

  // ── DELETE /api/company/:companyId/integrations/aspire ───────────────────
  //
  // Revokes credentials and marks integration disconnected. Requires company_admin.
  app.delete(
    "/api/company/:companyId/integrations/aspire",
    requireAuthentication,
    requireCompanySetup,
    async (req: any, res: any) => {
      const companyId = parseCompanyId(req.params.companyId);
      if (!companyId) {
        return res.status(400).json({ message: "Invalid companyId" });
      }
      if (!enforceCompanyMatch(req, res, companyId)) return;
      if (!enforceRole(req, res, WRITE_ROLES)) return;

      try {
        await revokeCredentials(companyId);

        logger.info(
          { companyId },
          "[aspire-tenant-routes] DELETE /integrations/aspire: credentials revoked",
        );

        res.json({
          ok: true,
          message: "Aspire integration disconnected. All credential material has been wiped.",
          connectionStatus: "disconnected",
        });
      } catch (err: any) {
        logger.error(
          { companyId, err },
          "[aspire-tenant-routes] DELETE /integrations/aspire failed",
        );
        res.status(500).json({ message: "Could not disconnect Aspire integration — please retry" });
      }
    },
  );

  // ── GET /api/company/:companyId/integrations/aspire/sync-logs ────────────
  //
  // Lists recent sync jobs for this company (descending, last 50).
  // Accessible by company_admin, billing_manager, irrigation_manager.
  app.get(
    "/api/company/:companyId/integrations/aspire/sync-logs",
    requireAuthentication,
    requireCompanySetup,
    async (req: any, res: any) => {
      const companyId = parseCompanyId(req.params.companyId);
      if (!companyId) {
        return res.status(400).json({ message: "Invalid companyId" });
      }
      if (!enforceCompanyMatch(req, res, companyId)) return;
      if (!enforceRole(req, res, READ_ROLES)) return;

      const limitRaw = parseInt(String(req.query.limit ?? "50"), 10);
      const limit = Number.isFinite(limitRaw) && limitRaw > 0 && limitRaw <= 200 ? limitRaw : 50;

      try {
        const jobs = await db
          .select({
            id: aspireSyncJobs.id,
            jobType: aspireSyncJobs.jobType,
            triggeredBy: aspireSyncJobs.triggeredBy,
            status: aspireSyncJobs.status,
            startedAt: aspireSyncJobs.startedAt,
            completedAt: aspireSyncJobs.completedAt,
            recordsProcessed: aspireSyncJobs.recordsProcessed,
            recordsFailed: aspireSyncJobs.recordsFailed,
            errorMessage: aspireSyncJobs.errorMessage,
            createdAt: aspireSyncJobs.createdAt,
          })
          .from(aspireSyncJobs)
          .where(eq(aspireSyncJobs.companyId, companyId))
          .orderBy(desc(aspireSyncJobs.createdAt))
          .limit(limit);

        res.json({ syncLogs: jobs, limit });
      } catch (err: any) {
        logger.error(
          { companyId, err },
          "[aspire-tenant-routes] GET /integrations/aspire/sync-logs failed",
        );
        res.status(500).json({ message: "Could not load sync logs — please retry" });
      }
    },
  );

  // ── GET /api/company/:companyId/integrations/aspire/conflicts ────────────
  //
  // Lists pending conflicts for this company.
  // Accessible by company_admin, billing_manager, irrigation_manager.
  app.get(
    "/api/company/:companyId/integrations/aspire/conflicts",
    requireAuthentication,
    requireCompanySetup,
    async (req: any, res: any) => {
      const companyId = parseCompanyId(req.params.companyId);
      if (!companyId) {
        return res.status(400).json({ message: "Invalid companyId" });
      }
      if (!enforceCompanyMatch(req, res, companyId)) return;
      if (!enforceRole(req, res, READ_ROLES)) return;

      // Optional status filter; default to pending only.
      const statusFilter = req.query.status as string | undefined;
      const allowedStatuses = new Set([
        "pending",
        "resolved_use_aspire",
        "resolved_use_irrigo",
        "resolved_manual_edit",
        "dismissed",
      ]);
      const effectiveStatus =
        statusFilter && allowedStatuses.has(statusFilter) ? statusFilter : "pending";

      const limitRaw = parseInt(String(req.query.limit ?? "100"), 10);
      const limit = Number.isFinite(limitRaw) && limitRaw > 0 && limitRaw <= 500 ? limitRaw : 100;

      try {
        const conflicts = await db
          .select({
            id: aspireConflictQueue.id,
            aspireEntity: aspireConflictQueue.aspireEntity,
            aspireId: aspireConflictQueue.aspireId,
            irrigoEntity: aspireConflictQueue.irrigoEntity,
            irrigoId: aspireConflictQueue.irrigoId,
            fieldName: aspireConflictQueue.fieldName,
            aspireValue: aspireConflictQueue.aspireValue,
            irrigoValue: aspireConflictQueue.irrigoValue,
            status: aspireConflictQueue.status,
            resolvedBy: aspireConflictQueue.resolvedBy,
            resolvedAt: aspireConflictQueue.resolvedAt,
            resolutionNote: aspireConflictQueue.resolutionNote,
            detectedAt: aspireConflictQueue.detectedAt,
            createdAt: aspireConflictQueue.createdAt,
            updatedAt: aspireConflictQueue.updatedAt,
          })
          .from(aspireConflictQueue)
          .where(
            and(
              eq(aspireConflictQueue.companyId, companyId),
              eq(aspireConflictQueue.status, effectiveStatus),
            ),
          )
          .orderBy(desc(aspireConflictQueue.detectedAt))
          .limit(limit);

        res.json({ conflicts, status: effectiveStatus, limit });
      } catch (err: any) {
        logger.error(
          { companyId, err },
          "[aspire-tenant-routes] GET /integrations/aspire/conflicts failed",
        );
        res.status(500).json({ message: "Could not load conflicts — please retry" });
      }
    },
  );

  // ── POST /api/company/:companyId/integrations/aspire/conflicts/:conflictId/resolve ──
  //
  // Resolve a specific conflict. Requires company_admin.
  app.post(
    "/api/company/:companyId/integrations/aspire/conflicts/:conflictId/resolve",
    requireAuthentication,
    requireCompanySetup,
    async (req: any, res: any) => {
      const companyId = parseCompanyId(req.params.companyId);
      if (!companyId) {
        return res.status(400).json({ message: "Invalid companyId" });
      }
      if (!enforceCompanyMatch(req, res, companyId)) return;
      if (!enforceRole(req, res, WRITE_ROLES)) return;

      const conflictId = parseConflictId(req.params.conflictId);
      if (!conflictId) {
        return res.status(400).json({ message: "Invalid conflictId" });
      }

      const parsed = resolveConflictBody.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({
          message: "Invalid request body",
          issues: parsed.error.issues,
        });
      }

      const resolvedByUserId = req.authenticatedUserId as number;
      if (!resolvedByUserId) {
        return res.status(401).json({ message: "Authentication required" });
      }

      try {
        // Verify the conflict belongs to this company before resolving.
        const [conflict] = await db
          .select({
            id: aspireConflictQueue.id,
            companyId: aspireConflictQueue.companyId,
            status: aspireConflictQueue.status,
          })
          .from(aspireConflictQueue)
          .where(eq(aspireConflictQueue.id, conflictId))
          .limit(1);

        if (!conflict) {
          return res.status(404).json({ message: "Conflict not found" });
        }

        // Tenant isolation: reject if the conflict belongs to a different company.
        if (conflict.companyId !== companyId) {
          return res.status(403).json({
            message: "Access denied — conflict belongs to a different company.",
          });
        }

        if (conflict.status !== "pending") {
          return res.status(409).json({
            message: `Conflict is already resolved (status: ${conflict.status})`,
          });
        }

        await resolveConflict(
          conflictId,
          parsed.data.resolution,
          resolvedByUserId,
          {
            note: parsed.data.note,
            manualValue: parsed.data.manualValue ?? null,
          },
        );

        logger.info(
          { companyId, conflictId, resolution: parsed.data.resolution, resolvedByUserId },
          "[aspire-tenant-routes] POST /conflicts/:conflictId/resolve: resolved",
        );

        res.json({
          ok: true,
          conflictId,
          resolution: parsed.data.resolution,
          message: "Conflict resolved successfully.",
        });
      } catch (err: any) {
        const msg = err instanceof Error ? err.message : String(err);

        // resolveConflict throws a typed error when the conflict is not found
        // or already resolved — surface those as 422 rather than 500.
        if (msg.includes("not found")) {
          return res.status(404).json({ message: "Conflict not found" });
        }
        if (msg.includes("already")) {
          return res.status(409).json({ message: msg });
        }
        // Validation error from manual_edit estimate-status path
        if (msg.includes("not a valid Aspire estimate status")) {
          return res.status(422).json({ message: msg });
        }

        logger.error(
          { companyId, conflictId, err },
          "[aspire-tenant-routes] POST /conflicts/:conflictId/resolve failed",
        );
        res.status(500).json({ message: "Could not resolve conflict — please retry" });
      }
    },
  );
}
