/**
 * admin-wo-correction-routes.ts
 *
 * Work-Order Correction Review — De-dup to Actuals (Task #1718)
 *
 * Endpoints:
 *   GET  /api/admin/wo-corrections           — worklist of flagged WOs
 *   GET  /api/admin/wo-corrections/:woId     — per-WO dedup actuals (read-only)
 *   POST /api/admin/wo-corrections/:woId/apply — human-confirmed apply + audit
 */

import type { Express, Request, Response } from 'express';
import { z } from 'zod/v4';
import { db } from '../db';
import { eq } from 'drizzle-orm';
import {
  workOrders,
  workOrderItems,
  workOrderCorrections,
  estimateItems,
} from '@workspace/db';
import { storage } from '../storage';
import { logger } from '../lib/logger';
import { money } from '../lib/money';
import {
  findCandidates,
  reconcileQuantitiesByPartId,
  type WoItemRow,
  type EstimateItemRow,
} from '../lib/migrations/repair-wo-items-from-source';

// ── Stable row-identity key ───────────────────────────────────────────────────
//
// Must match the `groupKey` logic inlined in storage.computeWorkOrderDedupActuals.
// For non-null partId the key is just the id string; for null-part lines we use
// name-only (price excluded) so price-drifted estimate-backed null-part rows are
// classified as 'drifted' (not 'fieldAdd') and the labor-hours lookup succeeds.
function groupKey(partId: number | null, partName: string): string {
  if (partId != null) return String(partId);
  return `null|${partName}`;
}

// ── Guards ────────────────────────────────────────────────────────────────────

const ALLOWED_ROLES = new Set(['super_admin', 'billing_manager']);

function requireCorrectionAccess(req: Request, res: Response): boolean {
  const role = (req as any).authenticatedUserRole;
  if (!role || !ALLOWED_ROLES.has(role)) {
    res.status(403).json({ message: 'super_admin or billing_manager only' });
    return false;
  }
  return true;
}

/** Returns caller's companyId or null (super_admin bypasses scoping). */
function callerCompanyId(req: Request): number | null {
  const role = (req as any).authenticatedUserRole;
  if (role === 'super_admin') return null;
  const cid = (req as any).authenticatedUserCompanyId;
  return cid != null ? Number(cid) : null;
}

// ── Zod schema for apply body ─────────────────────────────────────────────────
//
// The client sends ONLY operator decisions — partKey, finalQty, keep.
// partId, partName, and unit prices are NEVER accepted from the client;
// the server derives them from the canonical computeWorkOrderDedupActuals result.

const applyBodySchema = z.object({
  reason: z.string().min(1, 'Reason is required'),
  rows: z.array(z.object({
    partKey: z.string(),
    finalQty: z.number().int().min(0),
    keep: z.boolean(),
  })).min(1, 'At least one row required'),
  underQtyAcknowledged: z.boolean().default(false),
});

// ── Route registration ────────────────────────────────────────────────────────

export function registerAdminWoCorrectionRoutes(
  app: Express,
  requireAuthentication: any,
): void {

  /**
   * GET /api/admin/wo-corrections
   * Returns the worklist of flagged WOs driven exclusively by findCandidates().
   * Billed WOs are included (marked isBilled=true) so the operator can route them.
   */
  app.get('/api/admin/wo-corrections', requireAuthentication, async (req: any, res: Response) => {
    if (!requireCorrectionAccess(req, res)) return;
    const companyId = callerCompanyId(req);

    try {
      const candidates = await findCandidates();
      const rows = await Promise.all(
        candidates.map(async (cand) => {
          const woId = Number(cand.wo_id);
          try {
            const [wo] = await db.select().from(workOrders).where(eq(workOrders.id, woId));
            if (!wo) return null;

            // Company scope for billing_manager
            if (companyId != null && wo.companyId !== companyId) return null;

            const [items, estItems] = await Promise.all([
              db.select().from(workOrderItems).where(eq(workOrderItems.workOrderId, woId)),
              db.select().from(estimateItems).where(eq(estimateItems.estimateId, Number(cand.estimate_id))),
            ]);

            const typedItems = items as unknown as WoItemRow[];
            const typedEstItems = estItems as unknown as EstimateItemRow[];
            const qtyRecon = reconcileQuantitiesByPartId(typedItems, typedEstItems);
            const currentTotal = typedItems.reduce((s, wi) => s + money(wi.totalPrice), 0);
            const estimateTotal = typedEstItems.reduce((s, ei) => s + money(ei.partPrice) * Number(ei.quantity), 0);

            return {
              woId,
              workOrderNumber: wo.workOrderNumber ?? null,
              companyId: wo.companyId,
              estimateId: Number(cand.estimate_id),
              isBilled: wo.invoiceId != null,
              invoiceId: wo.invoiceId ?? null,
              woItemCount: Number(cand.wo_item_count),
              estItemCount: Number(cand.est_item_count),
              canAutoRepair: qtyRecon.canAutoRepair,
              reviewReason: wo.invoiceId != null
                ? 'WO is already billed — route to invoice correction/reissue flow'
                : !qtyRecon.hadDuplicates
                ? 'No duplicate signatures detected — item count exceeds estimate for unknown reason'
                : !qtyRecon.canAutoRepair
                ? 'Quantity overage or field-adds after de-duplication — operator review required'
                : null,
              currentTotal,
              estimateTotal,
              strippedCount: Math.max(0, typedItems.length - qtyRecon.dedupedDistinctCount),
            };
          } catch (err) {
            logger.warn({ woId, err }, 'wo-corrections worklist: skipping WO due to error');
            return null;
          }
        }),
      );

      res.json(rows.filter(Boolean));
    } catch (err) {
      logger.error({ err }, 'GET /api/admin/wo-corrections failed');
      res.status(500).json({ message: 'Failed to load worklist' });
    }
  });

  /**
   * GET /api/admin/wo-corrections/:woId
   * Returns per-WO dedup actuals — delegates to the canonical
   * storage.computeWorkOrderDedupActuals (read-only, no writes).
   */
  app.get('/api/admin/wo-corrections/:woId', requireAuthentication, async (req: any, res: Response) => {
    if (!requireCorrectionAccess(req, res)) return;
    const companyId = callerCompanyId(req);
    const woId = Number(req.params.woId);
    if (!Number.isFinite(woId)) {
      res.status(400).json({ message: 'Invalid woId' });
      return;
    }

    try {
      const result = await storage.computeWorkOrderDedupActuals(woId, companyId);
      if (!result) {
        // Could be not-found, wrong company, or no estimate source.
        // Distinguish for the client:
        const [wo] = await db.select({ id: workOrders.id, companyId: workOrders.companyId, estimateId: workOrders.estimateId })
          .from(workOrders).where(eq(workOrders.id, woId));
        if (!wo) {
          res.status(404).json({ message: 'Work order not found' });
          return;
        }
        if (companyId != null && wo.companyId !== companyId) {
          res.status(403).json({ message: 'Access denied' });
          return;
        }
        res.status(422).json({ message: 'WO has no estimate source — not eligible for estimate de-dup correction' });
        return;
      }
      res.json(result);
    } catch (err) {
      logger.error({ woId, err }, 'GET /api/admin/wo-corrections/:woId failed');
      res.status(500).json({ message: 'Failed to load WO correction detail' });
    }
  });

  /**
   * POST /api/admin/wo-corrections/:woId/apply
   *
   * Accepts only operator decisions: {partKey, finalQty, keep} per row.
   * The server derives the authoritative row set from computeWorkOrderDedupActuals
   * and re-resolves all unit prices independently. Client-supplied row identity
   * (partId, partName) is never used — unknown partKeys are rejected (400).
   */
  app.post('/api/admin/wo-corrections/:woId/apply', requireAuthentication, async (req: any, res: Response) => {
    if (!requireCorrectionAccess(req, res)) return;
    const companyId = callerCompanyId(req);
    const callerUserId: number | null = req.authenticatedUserId ? Number(req.authenticatedUserId) : null;
    const woId = Number(req.params.woId);
    if (!Number.isFinite(woId)) {
      res.status(400).json({ message: 'Invalid woId' });
      return;
    }

    const parsed = applyBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: 'Invalid request body', errors: parsed.error.issues });
      return;
    }
    const { reason, rows: clientDecisions, underQtyAcknowledged } = parsed.data;

    try {
      // Load WO for billed-check and company scope
      const [wo] = await db.select().from(workOrders).where(eq(workOrders.id, woId));
      if (!wo) { res.status(404).json({ message: 'Work order not found' }); return; }
      if (companyId != null && wo.companyId !== companyId) {
        res.status(403).json({ message: 'Access denied' });
        return;
      }
      if (wo.invoiceId != null) {
        res.status(409).json({
          code: 'WO_LOCKED',
          message: `Work order ${wo.workOrderNumber ?? woId} is already billed (invoice ${wo.invoiceId}). Use the invoice correction/reissue flow.`,
          invoiceId: wo.invoiceId,
        });
        return;
      }
      if (!wo.estimateId) {
        res.status(422).json({ message: 'WO has no estimate source — cannot apply estimate de-dup correction' });
        return;
      }

      // ── Derive the authoritative row set server-side ──────────────────────
      // This is the single source of truth for partId, partName, unitPrice, and
      // estimateQty. Client rows are validated against this set; unknown keys → 400.
      const serverActuals = await storage.computeWorkOrderDedupActuals(woId, companyId);
      if (!serverActuals) {
        res.status(422).json({ message: 'Could not compute dedup actuals for this WO' });
        return;
      }
      const serverRowsByPartKey = new Map(serverActuals.rows.map((r) => [r.partKey, r]));

      // Build O(1) decision lookup
      const clientDecisionByKey = new Map(clientDecisions.map((d) => [d.partKey, d]));

      // Validate: no unknown partKeys (client fabricating row identities)
      const unknownKeys = clientDecisions
        .map((d) => d.partKey)
        .filter((k) => !serverRowsByPartKey.has(k));
      if (unknownKeys.length > 0) {
        res.status(400).json({
          code: 'UNKNOWN_PART_KEYS',
          message: `Client submitted partKeys not in server-computed dedup set: ${unknownKeys.join(', ')}`,
        });
        return;
      }

      // Validate: decision completeness — every server-computed row must have a decision.
      // Omitting a row would silently drop it from the final item set without acknowledgement.
      const missingKeys = serverActuals.rows
        .map((r) => r.partKey)
        .filter((k) => !clientDecisionByKey.has(k));
      if (missingKeys.length > 0) {
        res.status(400).json({
          code: 'MISSING_ROW_DECISIONS',
          message: `Client must provide a decision for every server-computed row. Missing: ${missingKeys.join(', ')}`,
        });
        return;
      }

      // ── Under-qty acknowledgement check ──────────────────────────────────
      // Evaluated against ALL server rows, not just those the client listed as kept.
      // effectiveFinalQty is 0 for removed (keep=false) and zeroed (finalQty≤0) rows.
      // A client cannot bypass the ack by omitting keep=true or sending finalQty=0
      // on any estimate-backed row.
      const hasUnderQtyRows = serverActuals.rows.some((serverRow) => {
        if (serverRow.estimateQty <= 0) return false; // Not estimate-backed — no ack needed
        const d = clientDecisionByKey.get(serverRow.partKey)!;
        const effectiveFinalQty = (d.keep && d.finalQty > 0) ? d.finalQty : 0;
        return effectiveFinalQty < serverRow.estimateQty;
      });
      if (hasUnderQtyRows && !underQtyAcknowledged) {
        res.status(400).json({
          code: 'UNDER_QTY_UNACKNOWLEDGED',
          message: 'One or more rows have final qty less than estimate qty. Set underQtyAcknowledged=true to confirm this deliberate reduction.',
        });
        return;
      }

      // ── Re-resolve unit prices from authoritative sources ─────────────────
      // - pureKept / drifted (in estimate): use estimate snapshot price
      // - fieldAdd (not in estimate, partId non-null): re-resolve from parts catalog
      // - fieldAdd with partId=null (manual line): use existing WO item price
      const currentItems = await db
        .select()
        .from(workOrderItems)
        .where(eq(workOrderItems.workOrderId, woId)) as unknown as WoItemRow[];
      const currentPriceByPartKey = new Map<string, number>();
      for (const wi of currentItems) {
        const key = String(wi.partId ?? '');
        if (!currentPriceByPartKey.has(key)) {
          currentPriceByPartKey.set(key, money(wi.partPrice));
        }
      }

      const estItems = await db
        .select()
        .from(estimateItems)
        .where(eq(estimateItems.estimateId, wo.estimateId)) as unknown as EstimateItemRow[];
      const estLaborByPartKey = new Map<string, string>();
      for (const ei of estItems) {
        const key = groupKey(ei.partId, ei.partName);
        if (!estLaborByPartKey.has(key)) {
          estLaborByPartKey.set(key, money(ei.laborHours).toFixed(2));
        }
      }
      const currentLaborByPartKey = new Map<string, string>();
      for (const wi of currentItems) {
        const key = groupKey(wi.partId, wi.partName);
        if (!currentLaborByPartKey.has(key)) {
          currentLaborByPartKey.set(key, money(wi.laborHours).toFixed(2));
        }
      }

      const resolvedItems: Array<{
        workOrderId: number;
        partId: number | null;
        partName: string;
        partPrice: string;
        quantity: number;
        laborHours: string;
        totalPrice: string;
      }> = [];

      // Build complete audit record for ALL server-computed rows (including zeros/removals).
      // Iterate server rows (authoritative) and look up operator decisions via the map.
      const perPartFinalQty: Record<string, number> = {};
      for (const serverRow of serverActuals.rows) {
        const d = clientDecisionByKey.get(serverRow.partKey)!;
        perPartFinalQty[serverRow.partKey] = (d.keep && d.finalQty > 0) ? d.finalQty : 0;
      }

      for (const serverRow of serverActuals.rows) {
        const d = clientDecisionByKey.get(serverRow.partKey)!;
        const effectiveFinalQty = (d.keep && d.finalQty > 0) ? d.finalQty : 0;
        if (effectiveFinalQty <= 0) continue; // Removed or zeroed — skip from item list

        // Re-resolve price from authoritative source
        let resolvedPrice: number;
        if (serverRow.source === 'fieldAdd' && serverRow.partId != null) {
          // Field-add with a known partId — re-query the parts catalog
          const catalogPart = await storage.getPart(serverRow.partId);
          if (catalogPart) {
            resolvedPrice = money(catalogPart.price);
          } else {
            // Catalog part deleted — fall back to current WO item price with warning
            resolvedPrice = currentPriceByPartKey.get(serverRow.partKey) ?? serverRow.unitPrice;
            logger.warn(
              { woId, partId: serverRow.partId },
              'wo-correction apply: catalog part not found, using existing WO item price',
            );
          }
        } else {
          // pureKept, drifted, or fieldAdd with null partId — use server-computed unit price
          // (estimate snapshot for est-parts; current WO price for null-partId manual lines)
          resolvedPrice = serverRow.unitPrice;
        }

        const laborHours =
          estLaborByPartKey.get(serverRow.partKey) ??
          currentLaborByPartKey.get(serverRow.partKey) ??
          '0.00';

        resolvedItems.push({
          workOrderId: woId,
          partId: serverRow.partId,
          partName: serverRow.partName,
          partPrice: resolvedPrice.toFixed(2),
          quantity: effectiveFinalQty,
          laborHours,
          totalPrice: (resolvedPrice * effectiveFinalQty).toFixed(2),
        });
      }

      // Record before-total
      const beforeTotal = currentItems.reduce((s, wi) => s + money(wi.totalPrice), 0);

      // Apply via canonical resync path (atomic replace + total resync)
      const updated = await storage.replaceWorkOrderItemsWithResync(
        woId,
        resolvedItems as any,
        companyId,
      );
      // Compute afterTotal from items totalPrice (parts-only, consistent with beforeTotal).
      // updated.totalAmount includes labor which is not modified in a de-dup correction.
      const afterTotal = updated.items.reduce(
        (s, wi) => s + money((wi as any).totalPrice),
        0,
      );

      // Write audit row
      await db.insert(workOrderCorrections).values({
        woId,
        companyId: wo.companyId,
        beforeTotal: beforeTotal.toFixed(2),
        afterTotal: afterTotal.toFixed(2),
        perPartFinalQty,
        reason,
        byUserId: callerUserId,
      });

      logger.info(
        { woId, beforeTotal, afterTotal, reason, byUserId: callerUserId },
        'wo-correction applied successfully',
      );

      res.json({
        ok: true,
        woId,
        beforeTotal,
        afterTotal,
        itemCount: updated.items.length,
      });
    } catch (err: any) {
      if (err?.code === 'WO_LOCKED') {
        res.status(409).json({ code: 'WO_LOCKED', message: err.message });
        return;
      }
      logger.error({ woId, err }, 'POST /api/admin/wo-corrections/:woId/apply failed');
      res.status(500).json({ message: 'Failed to apply WO correction' });
    }
  });
}
