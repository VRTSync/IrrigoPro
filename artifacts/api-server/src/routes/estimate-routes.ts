// Extracted POST/PUT /api/estimates handlers so the labor-rate enforcement
// (Task #397) can be exercised by automated tests without spinning up the
// 12k-line registerRoutes() — which has top-level setInterval, QB token-
// health timers, and a self-running data-fix IIFE that all assume a real
// DB connection. See artifacts/api-server/src/routes/estimate-routes.test.ts
// for the regression suite.
//
// `routes.ts` calls `registerEstimateRoutes(app, storage, requireAuthentication)`
// at startup; tests call it with an in-memory storage stub and a noop auth
// middleware. The handler bodies are byte-for-byte the same logic that
// previously lived inline in routes.ts.

import type { Express, RequestHandler } from "express";
import { z } from "zod/v4";
import {
  insertEstimateSchema,
  type Customer,
  type EstimateWithItems,
  type InsertEstimate,
  type InsertEstimateItem,
  type User,
} from "@workspace/db";

import {
  processEstimatePayload,
  resolveCreateLaborRate,
  resolvePutLaborRate,
  type EstimatePayloadInput,
} from "../estimate-payload";

// Minimal storage surface used by the estimate routes. Mirroring just the
// methods we depend on lets the test suite supply a tiny in-memory stub.
export interface EstimateRoutesStorage {
  getCustomer(id: number): Promise<Customer | undefined>;
  getEstimate(id: number): Promise<EstimateWithItems | undefined>;
  // Optional — when present, POST /api/estimates uses the authenticated
  // user's `name` to stamp `createdBy` so the review queue and audit log
  // show who actually drafted the estimate. Tests can omit this.
  getUser?(id: number): Promise<User | undefined>;
  createEstimateFromPayload(payload: EstimatePayloadInput): Promise<EstimateWithItems>;
  updateEstimateWithItems(
    id: number,
    estimate: InsertEstimate,
    items: InsertEstimateItem[],
  ): Promise<EstimateWithItems>;
}

export const createEstimateWithItemsSchema = z.object({
  estimate: insertEstimateSchema.extend({
    estimateDate: z.union([z.date(), z.string()]).optional(),
    partsSubtotal: z.union([z.string(), z.number()]).optional(),
    laborSubtotal: z.union([z.string(), z.number()]).optional(),
    totalAmount: z.union([z.string(), z.number()]).optional(),
    laborRate: z.union([z.string(), z.number()]),
    // Task #396 — labor entry mode + flat-mode aggregate hours.
    laborMode: z.enum(["flat", "per_part"]).optional(),
    totalLaborHours: z.union([z.string(), z.number()]).optional(),
    workLocationLat: z
      .union([z.string(), z.number()])
      .nullish()
      .transform((v) => (v === null || v === undefined || v === "" ? null : String(v))),
    workLocationLng: z
      .union([z.string(), z.number()])
      .nullish()
      .transform((v) => (v === null || v === undefined || v === "" ? null : String(v))),
    workLocationAddress: z.string().nullish(),
    controllerLetter: z
      .string()
      .nullish()
      .transform((v) => (v ? v.toUpperCase() : null))
      .refine((v) => v === null || (v.length === 1 && v >= "A" && v <= "Z"), {
        message: "controllerLetter must be A-Z",
      }),
    zoneNumber: z.coerce.number().int().min(1).max(100).nullish(),
  }),
  items: z
    .array(
      z.object({
        description: z.string().optional().default(""),
        partId: z.number(),
        partName: z.string(),
        partPrice: z.union([z.string(), z.number()]),
        quantity: z.number(),
        laborHours: z.union([z.string(), z.number()]).optional(),
        totalPrice: z.union([z.string(), z.number()]).optional(),
        sortOrder: z.number().optional(),
      }),
    )
    .min(1, "An estimate must have at least one line item"),
});

export function registerEstimateRoutes(
  app: Express,
  storage: EstimateRoutesStorage,
  requireAuthentication: RequestHandler,
): void {
  // processEstimatePayload is shared with the Wet Check conversion engine
  // (server/storage.ts → convertWetCheck) so both code paths compute prices
  // and totals identically. See server/estimate-payload.ts for details.

  app.post("/api/estimates", requireAuthentication, async (req: any, res) => {
    try {
      const parsed = createEstimateWithItemsSchema.parse(req.body);
      // Defence-in-depth: only `draft` and `pending_approval` may be set on
      // create. Anything else (including the customer-facing `sent_to_customer`)
      // is coerced to the manager review queue so a malicious or buggy client
      // cannot bypass review. Slice 10a allows `draft` so wizard "Save as draft"
      // can land here without an extra transition call.
      {
        const estimateBody = parsed.estimate as { internalStatus?: string };
        const requested = estimateBody.internalStatus;
        estimateBody.internalStatus = requested === "draft" ? "draft" : "pending_approval";
      }
      // Stamp company + creator from the authenticated user. The wizard
      // payload doesn't carry these, and trusting client-supplied values
      // would let one company's user create estimates against another's
      // queue. Without this stamp, `companyId` lands as NULL and the
      // billing-manager review queue (filtered `WHERE company_id = ?`)
      // silently excludes the row — which is the reported bug where
      // submitted estimates never reach the reviewer.
      {
        const estimateBody = parsed.estimate as {
          companyId?: number | null;
          createdBy?: string;
          createdByUserId?: number | null;
        };
        const authUserId: number | null =
          typeof req.authenticatedUserId === "number" ? req.authenticatedUserId : null;
        const authCompanyId: number | null =
          typeof req.authenticatedUserCompanyId === "number"
            ? req.authenticatedUserCompanyId
            : null;
        if (authCompanyId != null) {
          estimateBody.companyId = authCompanyId;
        }
        if (authUserId != null) {
          estimateBody.createdByUserId = authUserId;
          if (storage.getUser) {
            try {
              const user = await storage.getUser(authUserId);
              if (user?.name) estimateBody.createdBy = user.name;
            } catch {
              // Non-fatal — fall back to whatever the client/default supplies.
            }
          }
        }
      }
      // Authoritative labor rate: the customer record is the master.
      // Override whatever the client sent on create so a tampered/stale
      // payload can never bypass the customer's master rate. Falls back
      // to the schema default (45.00) only if the customer truly has no
      // rate on file.
      const customerId = (parsed.estimate as { customerId?: number | null }).customerId ?? null;
      if (customerId != null) {
        const customer = await storage.getCustomer(customerId);
        if (!customer) {
          return res.status(400).json({ message: `Customer ${customerId} not found` });
        }
        const masterRate = resolveCreateLaborRate(customer.laborRate);
        (parsed.estimate as { laborRate: string }).laborRate = masterRate;
        (parsed.estimate as { appliedLaborRate?: string | null }).appliedLaborRate = masterRate;
      }
      // Single sanctioned entry point — same service the wet-check
      // conversion engine calls — so the two flows can never drift in
      // pricing semantics or downstream side effects.
      const newEstimate = await storage.createEstimateFromPayload(parsed);
      res.status(201).json(newEstimate);
    } catch (error) {
      console.error("Estimate creation error:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          message: "Invalid estimate data",
          errors: error.errors,
        });
      }
      res.status(500).json({ message: "Failed to create estimate" });
    }
  });

  app.put("/api/estimates/:id", requireAuthentication, async (req, res) => {
    try {
      const estimateId = parseInt(req.params.id);
      if (isNaN(estimateId)) {
        return res.status(400).json({ message: "Invalid estimate ID" });
      }
      const parsed = createEstimateWithItemsSchema.parse(req.body);
      // Strip ownership/audit fields from the update payload — these are
      // stamped at create time from the authenticated user and must never
      // be reassignable by the client. Without this, an edit could orphan
      // an estimate (companyId → null) or rewrite the audit trail.
      {
        const estimateBody = parsed.estimate as {
          companyId?: number | null;
          createdBy?: string;
          createdByUserId?: number | null;
        };
        delete estimateBody.companyId;
        delete estimateBody.createdBy;
        delete estimateBody.createdByUserId;
      }
      // Authoritative labor rate on update: the customer record is the
      // master, but we only override the stored rate when the customer
      // actually changed. Editing an estimate without swapping the
      // customer preserves the rate that was stamped at creation so
      // historical totals do not silently shift.
      const existing = await storage.getEstimate(estimateId);
      if (!existing) {
        return res.status(404).json({ message: "Estimate not found" });
      }
      const newCustomerId = (parsed.estimate as { customerId?: number | null }).customerId ?? null;
      const customerChanged = newCustomerId != null && newCustomerId !== existing.customerId;
      let resolvedRate: string;
      if (customerChanged) {
        const customer = await storage.getCustomer(newCustomerId!);
        if (!customer) {
          return res.status(400).json({ message: `Customer ${newCustomerId} not found` });
        }
        resolvedRate = resolvePutLaborRate({
          customerChanged: true,
          newCustomerLaborRate: customer.laborRate,
          existingAppliedLaborRate: existing.appliedLaborRate,
          existingLaborRate: existing.laborRate,
        });
      } else {
        // Customer unchanged — preserve the originally stamped rate
        // regardless of what the client sent so a stale/tampered payload
        // cannot reprice the estimate behind the user's back. Use the
        // snapshot (appliedLaborRate ?? laborRate) consistently for both
        // fields so legacy records where the two diverged stay in sync
        // with the read-time totals computed by storage.getEstimate.
        resolvedRate = resolvePutLaborRate({
          customerChanged: false,
          existingAppliedLaborRate: existing.appliedLaborRate,
          existingLaborRate: existing.laborRate,
        });
      }
      (parsed.estimate as { laborRate: string }).laborRate = resolvedRate;
      (parsed.estimate as { appliedLaborRate?: string | null }).appliedLaborRate = resolvedRate;
      // Task #396 — preserve persisted laborMode when the client omits it.
      // processEstimatePayload defaults to 'flat' when laborMode is missing,
      // which would silently flip a legacy per_part estimate to flat (and
      // zero its per-line labor) on any update from a caller that doesn't
      // explicitly send the mode.
      const incomingLaborMode = (parsed.estimate as { laborMode?: "flat" | "per_part" | null })
        .laborMode;
      if (incomingLaborMode !== "flat" && incomingLaborMode !== "per_part") {
        const persistedMode: "flat" | "per_part" =
          (existing as { laborMode?: "flat" | "per_part" | null }).laborMode === "per_part"
            ? "per_part"
            : "flat";
        (parsed.estimate as { laborMode?: "flat" | "per_part" | null }).laborMode = persistedMode;
      }
      const { estimate, items } = processEstimatePayload(parsed);
      const updatedEstimate = await storage.updateEstimateWithItems(estimateId, estimate, items);
      res.json(updatedEstimate);
    } catch (error) {
      console.error("Estimate update error:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          message: "Invalid estimate data",
          errors: error.errors,
        });
      }
      res.status(500).json({ message: "Failed to update estimate" });
    }
  });
}
