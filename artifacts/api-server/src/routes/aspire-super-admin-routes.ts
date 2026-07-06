// =============================================================================
// ASPIRE SUPER-ADMIN ROUTES — Mission 9
// =============================================================================
//
// Cross-tenant admin surface for the Aspire integration. Mounted at
// /api/super-admin/integrations by registerRoutes() in routes.ts.
//
// Security model:
//   • Every handler calls requireSuperAdmin(req, res) FIRST — inside the
//     handler, not only via requireAuthentication middleware. This ensures the
//     role check cannot be bypassed even if the middleware chain changes.
//   • Credential material is NEVER returned in any response — only masked
//     placeholders. The override route writes a new value but never reads back
//     the stored value.
//   • PUT .../credentials writes an audit_log row (actionType: 'admin') with
//     actor, target companyId, and timestamp for every credential override.
//
// Routes:
//   GET  /api/super-admin/integrations
//   GET  /api/super-admin/integrations/aspire
//   GET  /api/super-admin/integrations/aspire/:companyId
//   PUT  /api/super-admin/integrations/aspire/:companyId/credentials
//   POST /api/super-admin/integrations/aspire/:companyId/test
//   POST /api/super-admin/integrations/aspire/:companyId/sync
//   GET  /api/super-admin/integrations/aspire/:companyId/sync-logs
//   GET  /api/super-admin/integrations/aspire/:companyId/field-mappings
//   PUT  /api/super-admin/integrations/aspire/:companyId/field-mappings
//   POST /api/super-admin/integrations/aspire/:companyId/throttle
//   GET  /api/super-admin/integrations/conflicts
//   POST /api/super-admin/integrations/conflicts/:conflictId/resolve
//   GET  /api/super-admin/integrations/cron-jobs
//   POST /api/super-admin/integrations/cron-jobs/trigger
// =============================================================================

import type { Express, Request, Response } from "express";
import { eq, and, desc, isNull, or } from "drizzle-orm";
import { db } from "../db";
import {
  externalIntegrations,
  aspireCredentials,
  aspireSyncJobs,
  aspireFieldMappings,
  aspireConflictQueue,
  type InsertAspireFieldMapping,
} from "@workspace/db";
import { saveCredentials } from "../services/aspire-token-service";
import { testConnection } from "../services/aspire-api-client";
import { triggerManualSync } from "../cron/aspire-cron";
import { resolveConflict } from "../services/aspire-sync-service";
import { recordAuditEvent } from "./audit-log";
import { logger } from "../lib/logger";

// ---------------------------------------------------------------------------
// Inline super-admin role guard
// Every handler calls this first — not just the middleware.
// ---------------------------------------------------------------------------

function requireSuperAdmin(req: Request, res: Response): boolean {
  if ((req as any).authenticatedUserRole !== "super_admin") {
    res.status(403).json({ message: "Forbidden: super_admin role required" });
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse a positive integer from a route param; returns null on bad input. */
function parseCompanyId(raw: string): number | null {
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Mask credential fields so they are never sent over the wire. */
function maskCredentials<T extends Record<string, unknown>>(row: T): Omit<T, "encryptedClientId" | "encryptedClientSecret" | "encryptedAccessToken"> & {
  clientIdSet: boolean;
  clientSecretSet: boolean;
  accessTokenSet: boolean;
} {
  const { encryptedClientId, encryptedClientSecret, encryptedAccessToken, ...rest } = row as any;
  return {
    ...rest,
    clientIdSet: Boolean(encryptedClientId),
    clientSecretSet: Boolean(encryptedClientSecret),
    accessTokenSet: Boolean(encryptedAccessToken),
  };
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function registerAspireSuperAdminRoutes(
  app: Express,
  requireAuthentication: any,
): void {

  // -------------------------------------------------------------------------
  // GET /api/super-admin/integrations
  // Returns all companies that have an external_integrations row, along with
  // summary connection status. Cross-tenant list — super admin only.
  // -------------------------------------------------------------------------
  app.get(
    "/api/super-admin/integrations",
    requireAuthentication,
    async (req: any, res: Response) => {
      if (!requireSuperAdmin(req, res)) return;
      try {
        const rows = await db
          .select({
            id: externalIntegrations.id,
            companyId: externalIntegrations.companyId,
            integrationType: externalIntegrations.integrationType,
            connectionStatus: externalIntegrations.connectionStatus,
            connectedAt: externalIntegrations.connectedAt,
            lastHealthCheckAt: externalIntegrations.lastHealthCheckAt,
            createdAt: externalIntegrations.createdAt,
            updatedAt: externalIntegrations.updatedAt,
          })
          .from(externalIntegrations)
          .orderBy(desc(externalIntegrations.updatedAt));

        res.json({ integrations: rows });
      } catch (err) {
        logger.error({ err }, "[super-admin] GET /integrations failed");
        res.status(500).json({ message: "Failed to list integrations" });
      }
    },
  );

  // -------------------------------------------------------------------------
  // GET /api/super-admin/integrations/aspire
  // Returns all companies with an Aspire integration row, with masked creds.
  // -------------------------------------------------------------------------
  app.get(
    "/api/super-admin/integrations/aspire",
    requireAuthentication,
    async (req: any, res: Response) => {
      if (!requireSuperAdmin(req, res)) return;
      try {
        const rows = await db
          .select({
            id: aspireCredentials.id,
            companyId: aspireCredentials.companyId,
            encryptedClientId: aspireCredentials.encryptedClientId,
            encryptedClientSecret: aspireCredentials.encryptedClientSecret,
            encryptedAccessToken: aspireCredentials.encryptedAccessToken,
            accessTokenExpiresAt: aspireCredentials.accessTokenExpiresAt,
            connectionStatus: aspireCredentials.connectionStatus,
            throttleUntil: aspireCredentials.throttleUntil,
            errorMessage: aspireCredentials.errorMessage,
            syncEnabled: aspireCredentials.syncEnabled,
            createdAt: aspireCredentials.createdAt,
            updatedAt: aspireCredentials.updatedAt,
          })
          .from(aspireCredentials)
          .orderBy(desc(aspireCredentials.updatedAt));

        res.json({ companies: rows.map(maskCredentials) });
      } catch (err) {
        logger.error({ err }, "[super-admin] GET /integrations/aspire failed");
        res.status(500).json({ message: "Failed to list Aspire integrations" });
      }
    },
  );

  // -------------------------------------------------------------------------
  // GET /api/super-admin/integrations/aspire/:companyId
  // Returns the Aspire integration detail for a specific company.
  // -------------------------------------------------------------------------
  app.get(
    "/api/super-admin/integrations/aspire/:companyId",
    requireAuthentication,
    async (req: any, res: Response) => {
      if (!requireSuperAdmin(req, res)) return;
      const companyId = parseCompanyId(req.params.companyId);
      if (!companyId) {
        res.status(400).json({ message: "Invalid companyId" });
        return;
      }
      try {
        const [creds] = await db
          .select()
          .from(aspireCredentials)
          .where(eq(aspireCredentials.companyId, companyId))
          .limit(1);

        const [extInt] = await db
          .select()
          .from(externalIntegrations)
          .where(
            and(
              eq(externalIntegrations.companyId, companyId),
              eq(externalIntegrations.integrationType, "aspire"),
            ),
          )
          .limit(1);

        if (!creds && !extInt) {
          res.status(404).json({ message: "No Aspire integration found for this company" });
          return;
        }

        res.json({
          credentials: creds ? maskCredentials(creds) : null,
          integration: extInt ?? null,
        });
      } catch (err) {
        logger.error({ err, companyId }, "[super-admin] GET /integrations/aspire/:companyId failed");
        res.status(500).json({ message: "Failed to load Aspire integration" });
      }
    },
  );

  // -------------------------------------------------------------------------
  // PUT /api/super-admin/integrations/aspire/:companyId/credentials
  // Override (set) Aspire credentials for a tenant.
  // NEVER reads back or returns the stored credential values.
  // Writes an audit_log row on every call.
  // -------------------------------------------------------------------------
  app.put(
    "/api/super-admin/integrations/aspire/:companyId/credentials",
    requireAuthentication,
    async (req: any, res: Response) => {
      if (!requireSuperAdmin(req, res)) return;
      const companyId = parseCompanyId(req.params.companyId);
      if (!companyId) {
        res.status(400).json({ message: "Invalid companyId" });
        return;
      }

      const { clientId, clientSecret } = req.body ?? {};
      if (typeof clientId !== "string" || !clientId.trim()) {
        res.status(400).json({ message: "clientId is required" });
        return;
      }
      if (typeof clientSecret !== "string" || !clientSecret.trim()) {
        res.status(400).json({ message: "clientSecret is required" });
        return;
      }

      try {
        await saveCredentials(companyId, clientId.trim(), clientSecret.trim());

        // Audit log — required for every credential override (Mission 9 acceptance criteria).
        await recordAuditEvent(req, {
          actionType: "admin",
          action: "aspire.credentials.override",
          severity: "info",
          actorUserId: req.authenticatedUserId ?? null,
          actorRole: req.authenticatedUserRole ?? null,
          actorCompanyId: req.authenticatedUserCompanyId ?? null,
          targetType: "company",
          targetId: String(companyId),
          summary: `Super admin overrode Aspire credentials for company ${companyId}`,
          details: {
            targetCompanyId: companyId,
            actorUserId: req.authenticatedUserId ?? null,
            occurredAt: new Date().toISOString(),
          },
        });

        logger.info(
          { companyId, actorUserId: req.authenticatedUserId },
          "[super-admin] Aspire credentials overridden",
        );

        res.json({
          message: "Aspire credentials updated successfully",
          companyId,
          clientIdSet: true,
          clientSecretSet: true,
        });
      } catch (err) {
        logger.error({ err, companyId }, "[super-admin] PUT /credentials failed");
        res.status(500).json({ message: "Failed to save credentials" });
      }
    },
  );

  // -------------------------------------------------------------------------
  // POST /api/super-admin/integrations/aspire/:companyId/test
  // Runs a live connection test for the given company.
  // -------------------------------------------------------------------------
  app.post(
    "/api/super-admin/integrations/aspire/:companyId/test",
    requireAuthentication,
    async (req: any, res: Response) => {
      if (!requireSuperAdmin(req, res)) return;
      const companyId = parseCompanyId(req.params.companyId);
      if (!companyId) {
        res.status(400).json({ message: "Invalid companyId" });
        return;
      }
      try {
        const result = await testConnection(companyId);
        res.json(result);
      } catch (err) {
        logger.error({ err, companyId }, "[super-admin] POST /test failed");
        res.status(500).json({ message: "Connection test failed unexpectedly" });
      }
    },
  );

  // -------------------------------------------------------------------------
  // POST /api/super-admin/integrations/aspire/:companyId/sync
  // Manually triggers a full sync for the specified company.
  // Fire-and-forget; poll sync-logs to track progress.
  // -------------------------------------------------------------------------
  app.post(
    "/api/super-admin/integrations/aspire/:companyId/sync",
    requireAuthentication,
    async (req: any, res: Response) => {
      if (!requireSuperAdmin(req, res)) return;
      const companyId = parseCompanyId(req.params.companyId);
      if (!companyId) {
        res.status(400).json({ message: "Invalid companyId" });
        return;
      }
      try {
        triggerManualSync(companyId, "full_sync", "manual_admin");
        logger.info(
          { companyId, actorUserId: req.authenticatedUserId },
          "[super-admin] manual sync triggered",
        );
        res.json({ message: "Sync triggered", companyId });
      } catch (err) {
        logger.error({ err, companyId }, "[super-admin] POST /sync failed");
        res.status(500).json({ message: "Failed to trigger sync" });
      }
    },
  );

  // -------------------------------------------------------------------------
  // GET /api/super-admin/integrations/aspire/:companyId/sync-logs
  // Returns recent aspire_sync_jobs rows for the company, newest first.
  // -------------------------------------------------------------------------
  app.get(
    "/api/super-admin/integrations/aspire/:companyId/sync-logs",
    requireAuthentication,
    async (req: any, res: Response) => {
      if (!requireSuperAdmin(req, res)) return;
      const companyId = parseCompanyId(req.params.companyId);
      if (!companyId) {
        res.status(400).json({ message: "Invalid companyId" });
        return;
      }
      const limitRaw = typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) : 50;
      const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, limitRaw)) : 50;
      try {
        const rows = await db
          .select()
          .from(aspireSyncJobs)
          .where(eq(aspireSyncJobs.companyId, companyId))
          .orderBy(desc(aspireSyncJobs.createdAt))
          .limit(limit);

        res.json({ syncLogs: rows, companyId });
      } catch (err) {
        logger.error({ err, companyId }, "[super-admin] GET /sync-logs failed");
        res.status(500).json({ message: "Failed to fetch sync logs" });
      }
    },
  );

  // -------------------------------------------------------------------------
  // GET /api/super-admin/integrations/aspire/:companyId/field-mappings
  // Returns all field mappings for the company.
  // -------------------------------------------------------------------------
  app.get(
    "/api/super-admin/integrations/aspire/:companyId/field-mappings",
    requireAuthentication,
    async (req: any, res: Response) => {
      if (!requireSuperAdmin(req, res)) return;
      const companyId = parseCompanyId(req.params.companyId);
      if (!companyId) {
        res.status(400).json({ message: "Invalid companyId" });
        return;
      }
      try {
        const rows = await db
          .select()
          .from(aspireFieldMappings)
          .where(eq(aspireFieldMappings.companyId, companyId))
          .orderBy(aspireFieldMappings.aspireEntity, aspireFieldMappings.aspireField);

        res.json({ fieldMappings: rows, companyId });
      } catch (err) {
        logger.error({ err, companyId }, "[super-admin] GET /field-mappings failed");
        res.status(500).json({ message: "Failed to fetch field mappings" });
      }
    },
  );

  // -------------------------------------------------------------------------
  // PUT /api/super-admin/integrations/aspire/:companyId/field-mappings
  // Replace all field mappings for the company (full replace, not patch).
  // Body: { mappings: Array<{ aspireEntity, aspireField, irrigoField, transformFn?, isActive? }> }
  // -------------------------------------------------------------------------
  app.put(
    "/api/super-admin/integrations/aspire/:companyId/field-mappings",
    requireAuthentication,
    async (req: any, res: Response) => {
      if (!requireSuperAdmin(req, res)) return;
      const companyId = parseCompanyId(req.params.companyId);
      if (!companyId) {
        res.status(400).json({ message: "Invalid companyId" });
        return;
      }

      const { mappings } = req.body ?? {};
      if (!Array.isArray(mappings)) {
        res.status(400).json({ message: "mappings must be an array" });
        return;
      }

      // Validate each mapping entry has the required fields.
      for (let i = 0; i < mappings.length; i++) {
        const m = mappings[i];
        if (
          typeof m?.aspireEntity !== "string" ||
          typeof m?.aspireField !== "string" ||
          typeof m?.irrigoField !== "string"
        ) {
          res.status(400).json({
            message: `mappings[${i}] must have aspireEntity, aspireField, and irrigoField strings`,
          });
          return;
        }
      }

      try {
        await db.transaction(async (tx: typeof db) => {
          // Delete all existing mappings for this company.
          await tx
            .delete(aspireFieldMappings)
            .where(eq(aspireFieldMappings.companyId, companyId));

          // Insert new mappings if any.
          if (mappings.length > 0) {
            const values: InsertAspireFieldMapping[] = mappings.map((m: any) => ({
              companyId,
              aspireEntity: m.aspireEntity,
              aspireField: m.aspireField,
              irrigoField: m.irrigoField,
              transformFn: typeof m.transformFn === "string" ? m.transformFn : null,
              isActive: typeof m.isActive === "boolean" ? m.isActive : true,
            }));
            await tx.insert(aspireFieldMappings).values(values);
          }
        });

        res.json({ message: "Field mappings updated", companyId, count: mappings.length });
      } catch (err) {
        logger.error({ err, companyId }, "[super-admin] PUT /field-mappings failed");
        res.status(500).json({ message: "Failed to update field mappings" });
      }
    },
  );

  // -------------------------------------------------------------------------
  // POST /api/super-admin/integrations/aspire/:companyId/throttle
  // Sets or clears a rate-limit throttle for the company.
  // Body: { throttleUntil: ISO string | null }
  // -------------------------------------------------------------------------
  app.post(
    "/api/super-admin/integrations/aspire/:companyId/throttle",
    requireAuthentication,
    async (req: any, res: Response) => {
      if (!requireSuperAdmin(req, res)) return;
      const companyId = parseCompanyId(req.params.companyId);
      if (!companyId) {
        res.status(400).json({ message: "Invalid companyId" });
        return;
      }

      const { throttleUntil } = req.body ?? {};

      let throttleDate: Date | null = null;
      if (throttleUntil !== null && throttleUntil !== undefined) {
        const d = new Date(throttleUntil);
        if (isNaN(d.getTime())) {
          res.status(400).json({ message: "throttleUntil must be a valid ISO date string or null" });
          return;
        }
        throttleDate = d;
      }

      try {
        const [updated] = await db
          .update(aspireCredentials)
          .set({ throttleUntil: throttleDate, updatedAt: new Date() })
          .where(eq(aspireCredentials.companyId, companyId))
          .returning({ companyId: aspireCredentials.companyId, throttleUntil: aspireCredentials.throttleUntil });

        if (!updated) {
          res.status(404).json({ message: "No Aspire credentials found for this company" });
          return;
        }

        logger.info(
          { companyId, throttleUntil: throttleDate, actorUserId: req.authenticatedUserId },
          "[super-admin] throttle updated",
        );
        res.json({ message: "Throttle updated", companyId, throttleUntil: throttleDate });
      } catch (err) {
        logger.error({ err, companyId }, "[super-admin] POST /throttle failed");
        res.status(500).json({ message: "Failed to set throttle" });
      }
    },
  );

  // -------------------------------------------------------------------------
  // GET /api/super-admin/integrations/conflicts
  // Returns conflict queue rows across all tenants.
  // Supports ?companyId=<id> filter (acceptance criteria).
  // -------------------------------------------------------------------------
  app.get(
    "/api/super-admin/integrations/conflicts",
    requireAuthentication,
    async (req: any, res: Response) => {
      if (!requireSuperAdmin(req, res)) return;
      try {
        const companyIdFilter =
          typeof req.query.companyId === "string"
            ? parseCompanyId(req.query.companyId)
            : null;

        const statusFilter =
          typeof req.query.status === "string" ? req.query.status : "pending";

        const limitRaw = typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) : 50;
        const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, limitRaw)) : 50;

        const conditions = [];
        if (companyIdFilter) {
          conditions.push(eq(aspireConflictQueue.companyId, companyIdFilter));
        }
        if (statusFilter) {
          conditions.push(eq(aspireConflictQueue.status, statusFilter));
        }

        const rows = await db
          .select()
          .from(aspireConflictQueue)
          .where(conditions.length > 0 ? and(...conditions) : undefined)
          .orderBy(desc(aspireConflictQueue.detectedAt))
          .limit(limit);

        res.json({ conflicts: rows, filter: { companyId: companyIdFilter, status: statusFilter } });
      } catch (err) {
        logger.error({ err }, "[super-admin] GET /conflicts failed");
        res.status(500).json({ message: "Failed to fetch conflicts" });
      }
    },
  );

  // -------------------------------------------------------------------------
  // POST /api/super-admin/integrations/conflicts/:conflictId/resolve
  // Resolves a specific conflict. Body: { resolution, resolutionNote?, manualValue? }
  // resolution must be one of: 'use_aspire' | 'use_irrigo' | 'manual_edit' | 'dismissed'
  //
  // Delegates to resolveConflict() from aspire-sync-service so the same
  // applyConflictResolution logic (three-column estimate discipline, dismissed
  // short-circuit, etc.) applies to super-admin resolutions.
  // -------------------------------------------------------------------------
  app.post(
    "/api/super-admin/integrations/conflicts/:conflictId/resolve",
    requireAuthentication,
    async (req: any, res: Response) => {
      if (!requireSuperAdmin(req, res)) return;
      const conflictIdRaw = parseInt(req.params.conflictId, 10);
      if (!Number.isFinite(conflictIdRaw) || conflictIdRaw <= 0) {
        res.status(400).json({ message: "Invalid conflictId" });
        return;
      }

      const VALID_RESOLUTIONS = new Set([
        "use_aspire",
        "use_irrigo",
        "manual_edit",
        "dismissed",
      ]);

      const { resolution, resolutionNote, manualValue } = req.body ?? {};
      if (typeof resolution !== "string" || !VALID_RESOLUTIONS.has(resolution)) {
        res.status(400).json({
          message: `resolution must be one of: ${[...VALID_RESOLUTIONS].join(", ")}`,
        });
        return;
      }

      if (resolution === "manual_edit" && typeof manualValue !== "string") {
        res.status(400).json({ message: "manualValue is required for manual_edit resolution" });
        return;
      }

      const resolvedByUserId = req.authenticatedUserId as number | undefined;
      if (!resolvedByUserId) {
        res.status(401).json({ message: "Authentication required" });
        return;
      }

      try {
        await resolveConflict(
          conflictIdRaw,
          resolution as "use_aspire" | "use_irrigo" | "manual_edit" | "dismissed",
          resolvedByUserId,
          {
            note: typeof resolutionNote === "string" ? resolutionNote : undefined,
            manualValue: typeof manualValue === "string" ? manualValue : null,
          },
        );

        logger.info(
          { conflictId: conflictIdRaw, resolution, resolvedByUserId },
          "[super-admin] POST /conflicts/:id/resolve: resolved",
        );

        res.json({ ok: true, conflictId: conflictIdRaw, resolution });
      } catch (err: any) {
        const msg = err instanceof Error ? err.message : String(err);

        if (msg.includes("not found")) {
          res.status(404).json({ message: "Conflict not found" });
          return;
        }
        if (msg.includes("already")) {
          res.status(409).json({ message: msg });
          return;
        }
        // Validation errors from manual_edit (e.g. invalid estimate status)
        if (msg.includes("not a valid Aspire estimate status")) {
          res.status(422).json({ message: msg });
          return;
        }

        logger.error({ err, conflictId: conflictIdRaw }, "[super-admin] POST /conflicts/:id/resolve failed");
        res.status(500).json({ message: "Failed to resolve conflict" });
      }
    },
  );

  // -------------------------------------------------------------------------
  // GET /api/super-admin/integrations/cron-jobs
  // Returns recent global + per-tenant sync job rows (companyId IS NULL for
  // global runs), newest first.
  // -------------------------------------------------------------------------
  app.get(
    "/api/super-admin/integrations/cron-jobs",
    requireAuthentication,
    async (req: any, res: Response) => {
      if (!requireSuperAdmin(req, res)) return;
      const limitRaw = typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) : 50;
      const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, limitRaw)) : 50;
      try {
        const rows = await db
          .select()
          .from(aspireSyncJobs)
          .orderBy(desc(aspireSyncJobs.createdAt))
          .limit(limit);

        res.json({ cronJobs: rows });
      } catch (err) {
        logger.error({ err }, "[super-admin] GET /cron-jobs failed");
        res.status(500).json({ message: "Failed to fetch cron jobs" });
      }
    },
  );

  // -------------------------------------------------------------------------
  // POST /api/super-admin/integrations/cron-jobs/trigger
  // Manually triggers a cron job. Fire-and-forget.
  // Body: { jobType: 'health_check' | 'full_sync', companyId?: number | null }
  // -------------------------------------------------------------------------
  app.post(
    "/api/super-admin/integrations/cron-jobs/trigger",
    requireAuthentication,
    async (req: any, res: Response) => {
      if (!requireSuperAdmin(req, res)) return;

      const VALID_JOB_TYPES = new Set(["health_check", "full_sync"]);
      const { jobType, companyId: rawCompanyId } = req.body ?? {};

      if (typeof jobType !== "string" || !VALID_JOB_TYPES.has(jobType)) {
        res.status(400).json({
          message: `jobType must be one of: ${[...VALID_JOB_TYPES].join(", ")}`,
        });
        return;
      }

      // companyId is optional — null means run across all tenants.
      let companyId: number | null = null;
      if (rawCompanyId !== null && rawCompanyId !== undefined) {
        const parsed = typeof rawCompanyId === "number"
          ? rawCompanyId
          : parseInt(rawCompanyId, 10);
        if (!Number.isFinite(parsed) || parsed <= 0) {
          res.status(400).json({ message: "companyId must be a positive integer or null" });
          return;
        }
        companyId = parsed;
      }

      try {
        triggerManualSync(
          companyId,
          jobType as "health_check" | "full_sync",
          "manual_admin",
        );

        logger.info(
          { jobType, companyId, actorUserId: req.authenticatedUserId },
          "[super-admin] cron job triggered manually",
        );

        res.json({ message: "Job triggered", jobType, companyId });
      } catch (err) {
        logger.error({ err, jobType, companyId }, "[super-admin] POST /cron-jobs/trigger failed");
        res.status(500).json({ message: "Failed to trigger job" });
      }
    },
  );
}
