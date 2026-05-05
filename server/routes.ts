import express, { type Express } from "express";
import type { Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import type { InsertInvoice } from "@shared/schema";
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { EmailService } from "./email-service";
import { SmsService } from "./sms-service";
import twilio from "twilio";
import { ObjectStorageService } from "./objectStorage";
import { InvoicePdfService } from "./invoice-pdf-service";
import { buildWorkDescriptionPrompt, buildExpandDescriptionPrompt, TEMPLATE_VERSION, CRITICAL_FIELDS, type WorkDescriptionInputs } from "./ai-prompt-templates";
import {
  classifyQbRefreshError,
  withQbRefreshLock,
  QB_PROACTIVE_REFRESH_BUFFER_MS,
  UNRECOVERABLE_CATEGORIES,
  buildReconnectReason,
  QbRefreshError,
  runProactiveRefreshForRealm,
  startQbTokenHealthJob,
  type QbRefreshFailureCategory,
  type QbStorageAdapter,
} from "./qb-token-utils";

/// <reference path="./types/express.d.ts" />

// ============================================================================
// FIELD TECH PRICING VISIBILITY - Critical Security Feature
// Field technicians must NEVER see pricing/money values anywhere in the app
// ============================================================================

// Fields to strip from responses for field technicians
const PRICING_FIELDS_TO_STRIP = new Set([
  'laborRate', 'laborSubtotal', 'partsSubtotal', 'totalAmount', 'estimatedTotal',
  'partPrice', 'totalPrice', 'unitPrice', 'price', 'cost',
  'laborAmount', 'laborTotal', 'partsAmount', 'totalCost',
  'laborCost', 'partsCost', 'totalUnbilledAmount', 'totalPartsCost'
]);

// Recursively strip pricing fields from objects/arrays
function sanitizePricingFields(data: any): any {
  if (data === null || data === undefined) {
    return data;
  }
  
  if (Array.isArray(data)) {
    return data.map(item => sanitizePricingFields(item));
  }
  
  if (typeof data === 'object' && data !== null) {
    const sanitized: any = {};
    for (const [key, value] of Object.entries(data)) {
      if (PRICING_FIELDS_TO_STRIP.has(key)) {
        continue; // Skip this field entirely
      }
      sanitized[key] = sanitizePricingFields(value);
    }
    return sanitized;
  }
  
  return data;
}

// Helper to check if user is field tech and strip pricing if needed
function applyPricingVisibility(req: Request, data: any): any {
  const userRole = req.authenticatedUserRole || req.headers['x-user-role'];
  if (userRole === 'field_tech') {
    return sanitizePricingFields(data);
  }
  return data;
}

// ─── Authoritative server-side pricing for billing sheet line items (Task #160) ─
// Catalog parts (items with a `partId`) must always be persisted with the
// catalog unit price — never with whatever the client sent. Manual line items
// (no `partId`) are still allowed at any price (including $0) since they go
// through the manual-part review flow.
//
// Returns either { items } with rewritten line items (unitPrice + totalPrice
// recomputed from the catalog) and `auditedZeros` describing any client-side
// price drift we detected, or { error } with a 4xx-shaped message when a
// `partId` does not resolve to a real catalog row in the user's company.
type RawBillingItem = {
  partId?: number | null;
  partName?: string;
  partDescription?: string | null;
  quantity?: number | string;
  unitPrice?: number | string;
  laborHours?: number | string;
  notes?: string | null;
  [key: string]: unknown;
};

async function resolveAuthoritativePartPricing(
  rawItems: RawBillingItem[] | undefined,
  companyId: number | null | undefined,
): Promise<{
  items?: RawBillingItem[];
  error?: { status: number; message: string };
  auditedZeros: Array<{ index: number; partId: number; partName: string; clientUnitPrice: number; catalogUnitPrice: number }>;
}> {
  const auditedZeros: Array<{ index: number; partId: number; partName: string; clientUnitPrice: number; catalogUnitPrice: number }> = [];
  if (!Array.isArray(rawItems)) {
    return { items: rawItems, auditedZeros };
  }

  const out: RawBillingItem[] = [];
  for (let i = 0; i < rawItems.length; i++) {
    const item = rawItems[i] ?? {};
    const partIdRaw = item.partId as unknown;
    const partId =
      partIdRaw == null || partIdRaw === '' ? null : Number(partIdRaw);

    if (!partId || !Number.isFinite(partId)) {
      // Manual / non-catalog line item — leave the client-supplied price alone.
      out.push(item);
      continue;
    }

    const part = await storage.getPart(partId);
    const lineLabel = String(item.partName ?? `line ${i + 1}`);

    if (!part) {
      return {
        error: {
          status: 400,
          message: `Catalog part with ID ${partId} (line item "${lineLabel}") was not found. Cannot save a $0 line item for an unknown catalog part.`,
        },
        auditedZeros,
      };
    }
    if (companyId != null && part.companyId !== companyId) {
      return {
        error: {
          status: 400,
          message: `Catalog part "${part.name}" (ID ${partId}, line item "${lineLabel}") does not belong to your company. Cannot save the line item.`,
        },
        auditedZeros,
      };
    }

    const catalogUnitPrice = parseFloat(String(part.price ?? 0));
    const clientUnitPrice = parseFloat(String(item.unitPrice ?? 0));
    if (catalogUnitPrice > 0 && Math.abs(clientUnitPrice - catalogUnitPrice) > 0.005) {
      auditedZeros.push({
        index: i,
        partId,
        partName: part.name,
        clientUnitPrice,
        catalogUnitPrice,
      });
    }

    const qty = parseFloat(String(item.quantity ?? 0));
    out.push({
      ...item,
      partId,
      partName: item.partName || part.name,
      partDescription: item.partDescription ?? part.description ?? null,
      unitPrice: catalogUnitPrice,
      totalPrice: (qty * catalogUnitPrice).toFixed(2),
    } as RawBillingItem);
  }

  return { items: out, auditedZeros };
}

// Logs (and is the seam for future metrics/audit-row writes) any catalog line
// item that ended up with a final unitPrice of 0 while the catalog row reports
// a non-zero price. The authoritative-pricing helper above should make this
// impossible — this guard makes a future regression visible instead of silent.
async function regressionGuardZeroCatalogPrices(
  context: 'create' | 'update' | 'work_order_conversion',
  billingSheetId: number | null,
  items: RawBillingItem[] | undefined,
): Promise<void> {
  if (!Array.isArray(items)) return;
  for (const item of items) {
    const partIdRaw = item.partId as unknown;
    const partId =
      partIdRaw == null || partIdRaw === '' ? null : Number(partIdRaw);
    if (!partId || !Number.isFinite(partId)) continue;
    const finalPrice = parseFloat(String(item.unitPrice ?? 0));
    if (finalPrice > 0) continue;
    try {
      const part = await storage.getPart(partId);
      const catalogPrice = part ? parseFloat(String(part.price ?? 0)) : 0;
      if (catalogPrice > 0) {
        console.warn(
          `[AUDIT-ZERO-PRICE-DRIFT] context=${context} billingSheetId=${billingSheetId ?? 'pending'} ` +
          `partId=${partId} partName="${part?.name ?? item.partName ?? '?'}" ` +
          `finalUnitPrice=0 catalogUnitPrice=${catalogPrice.toFixed(2)} — catalog price was lost despite authoritative-pricing helper`
        );
      }
    } catch (err) {
      // Swallow guard errors — they must never block a save.
      console.warn(`[AUDIT-ZERO-PRICE-DRIFT] guard lookup failed for partId=${partId}:`, err);
    }
  }
}
// ─── /Authoritative server-side pricing ─────────────────────────────────────────

// Roles allowed to read billing notes
const BILLING_NOTES_READ_ROLES = new Set(['billing_manager', 'company_admin', 'super_admin']);

// Strip billingNotes from customer data for roles that should not see it
function stripBillingNotes(data: any): any {
  if (Array.isArray(data)) {
    return data.map(stripBillingNotes);
  }
  if (data && typeof data === 'object' && 'billingNotes' in data) {
    const { billingNotes, ...rest } = data;
    return rest;
  }
  return data;
}

function applyBillingNotesVisibility(req: Request, data: any): any {
  // Use only authenticated role (set by requireAuthentication middleware).
  // Raw headers are untrusted and intentionally not used here.
  const userRole = req.authenticatedUserRole;
  if (!userRole || !BILLING_NOTES_READ_ROLES.has(userRole)) {
    return stripBillingNotes(data);
  }
  return data;
}
import type { UploadedFile } from "express-fileupload";
import { 
  insertUserSchema,
  insertCustomerSchema, 
  insertPartSchema, 
  insertEstimateSchema, 
  insertEstimateItemSchema,
  insertPropertyZoneSchema,
  insertZoneSchema,
  insertFieldWorkSessionSchema,
  insertFieldWorkItemSchema,
  insertWorkOrderSchema,
  insertWorkOrderItemSchema,
  insertNotificationSchema,
  insertSiteMapSchema,
  insertCompanySchema,
  insertAssemblySchema,
  insertAssemblyPartSchema,
  type InsertEstimate,
  type InsertEstimateItem,
  type BillingSheetItem,
  type InsertBillingSheet,
  type BillingSheetStatus,
  billingSheetStatusValues,
  type InsertWetCheckFinding,
  type InsertWetCheckZoneRecord,
} from "@shared/schema";
import { z } from "zod";

const createEstimateWithItemsSchema = z.object({
  estimate: insertEstimateSchema.extend({
    // Allow date as string (will be converted)
    estimateDate: z.union([z.date(), z.string()]).optional(),
    // Allow numbers for decimal fields (will be converted to strings)
    partsSubtotal: z.union([z.string(), z.number()]).optional(),
    laborSubtotal: z.union([z.string(), z.number()]).optional(),
    totalAmount: z.union([z.string(), z.number()]).optional(),
    laborRate: z.union([z.string(), z.number()])
  }),
  items: z.array(z.object({
    description: z.string().optional().default(""),
    partId: z.number(),
    partName: z.string(),
    partPrice: z.union([z.string(), z.number()]),
    quantity: z.number(),
    laborHours: z.union([z.string(), z.number()]).optional(),
    totalPrice: z.union([z.string(), z.number()]).optional(),
    sortOrder: z.number().optional(),
  })).min(1, "An estimate must have at least one line item"),
});

// Production-ready middleware to check if user has company admin permissions for site map operations
const requireCompanyAdminAccess = async (req: any, res: any, next: any) => {
  try {
    // Production-ready authentication using session lookup
    // First try header-based auth (for development compatibility)
    let userId = req.headers['x-user-id'];
    let userRole = req.headers['x-user-role'];
    
    // If headers not available, try to get from session (production approach)
    if (!userId && req.session?.userId) {
      userId = req.session.userId;
      // Get user from database to verify role
      const user = await storage.getUser(parseInt(userId));
      if (user) {
        userRole = user.role;
        req.userCompanyId = user.companyId; // Store for later use
      }
    }
    
    if (!userId || !userRole) {
      return res.status(401).json({ 
        message: "Authentication required" 
      });
    }
    
    if (userRole !== 'company_admin') {
      return res.status(403).json({ 
        message: "Access denied. Site map operations are restricted to company administrators only." 
      });
    }
    
    next();
  } catch (error) {
    console.error('Site map authentication error:', error);
    return res.status(500).json({ 
      message: "Authentication error" 
    });
  }
};

// Middleware to allow company admins AND billing managers to edit customer records
const requireCustomerEditAccess = async (req: any, res: any, next: any) => {
  try {
    let userId = req.headers['x-user-id'];
    let userRole = req.headers['x-user-role'];

    if (!userId && req.session?.userId) {
      userId = req.session.userId;
      const user = await storage.getUser(parseInt(userId));
      if (user) {
        userRole = user.role;
        req.userCompanyId = user.companyId;
      }
    }

    if (!userId || !userRole) {
      return res.status(401).json({ message: "Authentication required" });
    }

    if (userRole !== 'company_admin' && userRole !== 'super_admin' && userRole !== 'billing_manager') {
      return res.status(403).json({ message: "Access denied. Customer editing is restricted to administrators and billing managers." });
    }

    next();
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Authentication error" });
  }
};

// Middleware to check if user can edit/delete work orders and billing sheets
const requireWorkOrderBillingAccess = (req: any, res: any, next: any) => {
  const userRole = req.authenticatedUserRole || req.headers['x-user-role'];
  
  if (userRole !== 'company_admin' && userRole !== 'billing_manager' && userRole !== 'irrigation_manager') {
    return res.status(403).json({ 
      message: "Access denied. Only company administrators, billing managers, and irrigation managers can edit or delete work orders and billing sheets." 
    });
  }
  
  next();
};

// Middleware for billing/invoice PDF access (billing_manager and company_admin only)
const requireBillingAccess = (req: any, res: any, next: any) => {
  // Use the authenticated user role set by requireAuthentication middleware
  const userRole = req.authenticatedUserRole;
  
  if (userRole !== 'company_admin' && userRole !== 'billing_manager') {
    return res.status(403).json({ 
      message: "Access denied. Only company administrators and billing managers can access invoice PDFs." 
    });
  }
  
  next();
};

// More granular middleware for work order updates that allows field techs to start their own work orders
const requireWorkOrderUpdateAccess = async (req: any, res: any, next: any) => {
  const userRole = req.authenticatedUserRole || req.headers['x-user-role'];
  const userId = req.authenticatedUserId || req.headers['x-user-id'];
  const workOrderId = parseInt(req.params.id);
  const updateData = req.body;
  
  // Company admins, super admins, billing managers, and irrigation managers have full access
  if (userRole === 'company_admin' || userRole === 'super_admin' || userRole === 'billing_manager' || userRole === 'irrigation_manager') {
    return next();
  }
  
  // Field techs can only start work orders assigned to them
  if (userRole === 'field_tech') {
    // Validate that we have user ID
    if (!userId) {
      return res.status(401).json({ 
        message: "Authentication required - user ID not found." 
      });
    }
    
    // Check if this is just starting a work order (changing status to in_progress)
    if (updateData.status === 'in_progress' && Object.keys(updateData).length <= 2) {
      try {
        // Check if the work order is assigned to this field tech
        const workOrder = await storage.getWorkOrder(workOrderId);
        const userIdNum = parseInt(userId as string);
        
        if (workOrder && workOrder.assignedTechnicianId === userIdNum) {
          return next();
        }
        
      } catch (error) {
        console.error('Error checking work order assignment:', error);
      }
    }

    // Field techs may also patch ONLY the photos array on a work order assigned to them.
    // Task #191: photos may be added even after the ticket has been moved to billing
    // (status === 'approved_passed_to_billing', 'billed', or invoiceId is set) so techs
    // can backfill missing photos after the fact. Cancelled tickets remain locked.
    const updateKeys = updateData && typeof updateData === 'object' ? Object.keys(updateData) : [];
    const isPhotosOnlyEdit = updateKeys.length === 1 && updateKeys[0] === 'photos' && Array.isArray(updateData.photos);
    if (isPhotosOnlyEdit) {
      try {
        const workOrder = await storage.getWorkOrder(workOrderId);
        const userIdNum = parseInt(userId as string);
        if (workOrder && workOrder.assignedTechnicianId === userIdNum && workOrder.status !== 'cancelled') {
          return next();
        }
      } catch (error) {
        console.error('Error checking work order photo edit access:', error);
      }
    }
  }
  
  return res.status(403).json({ 
    message: "Access denied. Field technicians can only start work orders assigned to them." 
  });
};

// More granular middleware for billing sheet updates that allows field techs to submit for approval
const requireBillingSheetUpdateAccess = async (req: any, res: any, next: any) => {
  const userRole = req.authenticatedUserRole || req.headers['x-user-role'];
  const userId = req.authenticatedUserId || req.headers['x-user-id'];
  const updateData = req.body;

  // Managers have full access
  if (userRole === 'company_admin' || userRole === 'billing_manager' || userRole === 'irrigation_manager') {
    return next();
  }

  // Field techs can only submit their own billing sheet for manager review,
  // OR add/remove photos on their own billing sheet (photos-only PATCH).
  if (userRole === 'field_tech') {
    const keys = updateData && typeof updateData === 'object' ? Object.keys(updateData) : [];
    const isSubmit = keys.length === 1 && (updateData.status === 'submitted' || updateData.status === 'pending_manager_review');
    const isPhotosOnlyEdit = keys.length === 1 && keys[0] === 'photos' && Array.isArray(updateData.photos);

    if (!isSubmit && !isPhotosOnlyEdit) {
      return res.status(403).json({
        message: "Access denied. Field technicians can only submit billing sheets for approval or update photos on their own sheets."
      });
    }

    if (!userId) {
      return res.status(401).json({ message: "Authentication required - user ID not found." });
    }

    try {
      const billingSheetId = parseInt(req.params.id);
      const billingSheet = await storage.getBillingSheetById(billingSheetId);
      const userIdNum = parseInt(userId as string);

      if (billingSheet && billingSheet.technicianId === userIdNum) {
        // Task #191: photos-only edits are allowed even when the billing sheet
        // has been moved to billing (status === 'billed' or invoiceId is set),
        // so techs can backfill missing photos. Other photos-only restrictions
        // (ownership above) and the non-photo lock paths stay in place.
        return next();
      }
    } catch (error) {
      console.error('Error checking billing sheet ownership:', error);
    }

    return res.status(403).json({
      message: "Access denied. Field technicians can only act on their own billing sheets."
    });
  }

  return res.status(403).json({
    message: "Access denied. Only company administrators, billing managers, and irrigation managers can edit billing sheets."
  });
};

// Authentication middleware for notifications - ensures users can only access their own notifications
const requireNotificationAccess = async (req: any, res: any, next: any) => {
  try {
    // Get authenticated user ID - prefer session-based auth
    let authenticatedUserId = req.authenticatedUserId || req.headers['x-user-id'];
    
    // If headers not available, try to get from session (production approach)
    if (!authenticatedUserId && req.session && req.session.userId) {
      authenticatedUserId = req.session.userId;
    }
    
    // Get requested user ID from URL params
    const requestedUserId = req.params.userId;
    
    // Validate that we have authentication data
    if (!authenticatedUserId) {
      console.log(`Authentication failed for notification access - no user ID found for request to user ${requestedUserId}`);
      return res.status(401).json({ 
        message: "Authentication required" 
      });
    }
    
    // Parse user IDs safely
    const authUserId = parseInt(authenticatedUserId);
    const reqUserId = parseInt(requestedUserId);
    
    // Validate that both IDs are valid numbers
    if (isNaN(authUserId) || isNaN(reqUserId)) {
      console.log(`Invalid user ID format - auth: ${authenticatedUserId}, requested: ${requestedUserId}`);
      return res.status(400).json({ 
        message: "Invalid user ID format" 
      });
    }
    
    // Validate that the authenticated user matches the requested user
    if (authUserId !== reqUserId) {
      console.log(`Access denied - user ${authUserId} tried to access notifications for user ${reqUserId}`);
      return res.status(403).json({ 
        message: "Access denied. You can only access your own notifications." 
      });
    }
    
    // Store authenticated user ID for use in route handler
    req.authenticatedUserId = authUserId;
    next();
  } catch (error) {
    console.error('Notification authentication error:', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      requestedUserId: req.params.userId,
      hasSession: !!req.session,
      sessionUserId: req.session?.userId,
      headers: {
        'x-user-id': req.headers['x-user-id'],
        'x-user-role': req.headers['x-user-role']
      }
    });
    return res.status(500).json({ 
      message: "Authentication error" 
    });
  }
};

// General authentication middleware that validates user identity and role
const requireAuthentication = async (req: any, res: any, next: any) => {
  try {
    // Get authenticated user ID and role from headers
    let userId = req.headers['x-user-id'];
    let userRole = req.headers['x-user-role'];
    let userCompanyId = req.headers['x-user-company-id'];
    
    // Production session-based authentication
    if (req.session && req.session.userId) {
      try {
        const user = await storage.getUser(parseInt(String(req.session.userId)));
        if (user) {
          userId = req.session.userId;
          userRole = user.role;
          userCompanyId = user.companyId;
        }
      } catch (dbError) {
        // Continue to fallback on database error
      }
    }
    
    // Query parameter fallback (for PDF viewing in new tabs)
    if (!userId && req.query['x-user-id']) {
      userId = req.query['x-user-id'];
      userRole = req.query['x-user-role'];
      userCompanyId = req.query['x-user-company-id'];
    }
    
    // Authentication required
    if (!userId) {
      return res.status(401).json({ 
        message: "Authentication required" 
      });
    }
    
    if (!userId || !userRole) {
      console.log(`Authentication failed - missing data:`, {
        hasUserId: !!userId,
        hasUserRole: !!userRole,
        hasSession: !!req.session,
        sessionUserId: req.session?.userId
      });
      return res.status(401).json({ 
        message: "Authentication required" 
      });
    }
    
    // Validate user ID is a number
    const parsedUserId = parseInt(userId);
    if (isNaN(parsedUserId)) {
      console.log(`Invalid user ID format: ${userId}`);
      return res.status(400).json({ 
        message: "Invalid user ID format" 
      });
    }
    
    // Store authenticated user data for use in route handlers
    req.authenticatedUserId = parsedUserId;
    req.authenticatedUserRole = userRole;
    req.authenticatedUserCompanyId = userCompanyId ? parseInt(userCompanyId.toString()) : null;
    
    next();
  } catch (error) {
    console.error('Authentication error:', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      hasSession: !!req.session,
      sessionUserId: req.session?.userId,
      headers: {
        'x-user-id': req.headers['x-user-id'],
        'x-user-role': req.headers['x-user-role']
      }
    });
    return res.status(500).json({ 
      message: "Authentication error" 
    });
  }
};

// Middleware to check if user has permission to view site maps (company admin and irrigation manager)
const requireSiteMapViewAccess = async (req: any, res: any, next: any) => {
  try {
    let userId: string | undefined;
    let userRole: string | undefined;
    
    console.log('Site map authentication check:', {
      hasSession: !!req.session,
      sessionUserId: req.session?.userId,
      hasHeaders: !!(req.headers['x-user-id'] && req.headers['x-user-role'])
    });
    
    // Prioritize session authentication (production-safe)
    if (req.session?.userId) {
      userId = req.session.userId.toString();
      const user = await storage.getUser(parseInt(userId!));
      if (user) {
        userRole = user.role;
        console.log('Session authentication successful:', { userId, userRole });
      }
    }
    
    // Fallback to headers for development only
    if (!userId && req.headers['x-user-id'] && req.headers['x-user-role']) {
      userId = req.headers['x-user-id'] as string;
      userRole = req.headers['x-user-role'] as string;
      console.log('Header authentication fallback:', { userId, userRole });
    }
    
    if (!userId || !userRole) {
      console.log('Authentication failed - missing user data');
      return res.status(401).json({ 
        message: "Authentication required" 
      });
    }
    
    if (userRole !== 'company_admin' && userRole !== 'irrigation_manager' && userRole !== 'field_tech') {
      console.log('Access denied for role:', userRole);
      return res.status(403).json({ 
        message: "Access denied. Site map viewing is restricted to company administrators, irrigation managers, and field technicians only." 
      });
    }
    
    console.log('Site map access granted:', { userId, userRole });
    next();
  } catch (error) {
    console.error('Site map view authentication error:', error);
    return res.status(500).json({ 
      message: "Authentication error" 
    });
  }
};

// QuickBooks access control middleware - irrigation managers and field techs cannot access QuickBooks
const requireQuickBooksAccess = (req: any, res: any, next: any) => {
  const userRole = req.authenticatedUserRole || req.headers['x-user-role'];
  
  if (userRole === 'irrigation_manager' || userRole === 'field_tech') {
    return res.status(403).json({ 
      message: "Access denied. QuickBooks integration is not available for your role." 
    });
  }
  
  next();
};

// In-memory OAuth state store (replaces session-based storage — app uses localStorage auth, not server sessions)
// Maps state token -> { expiry timestamp, companyId } (10 min TTL)
const oauthStateStore = new Map<string, { expiry: number; companyId: string | null }>();
setInterval(() => {
  const now = Date.now();
  for (const [state, entry] of Array.from(oauthStateStore.entries())) {
    if (now > entry.expiry) oauthStateStore.delete(state);
  }
}, 60_000);


import { db } from "./db";
import { 
  customers, estimates, workOrders, estimateItems, parts, billingSheets, billingSheetItems, 
  users, invoices, invoiceItems, zones, fieldWorkSessions, fieldWorkItems, notifications,
  companies, siteMaps, controllers, irrigationZones, partUsage, utilityMarkers, propertyZones, invoicePdfs
} from "@shared/schema";
import { eq, desc, and, or, gte, lte, like, isNull, asc, sql } from "drizzle-orm";

export async function registerRoutes(app: Express): Promise<Server> {

  // Serve company logo images directly (binary response)
  app.get("/api/company-logo/:logoId", async (req, res) => {
    const logoId = req.params.logoId;
    console.log(`[LOGO-SERVE] Serving logo directly: ${logoId}`);
    
    try {
      const objectStorageService = new ObjectStorageService();
      
      // Search for the file
      const file = await objectStorageService.searchPublicObject(`company-logos/${logoId}`);
      
      if (!file) {
        console.log(`[LOGO-SERVE] Logo file not found: ${logoId}`);
        return res.status(404).json({ error: "Logo not found" });
      }
      
      console.log(`[LOGO-SERVE] Logo file found, downloading...`);
      
      // Serve the image directly
      objectStorageService.downloadObject(file, res);
      
    } catch (error) {
      console.error(`[LOGO-SERVE] Error serving logo ${logoId}:`, error);
      return res.status(500).json({ error: "Failed to serve logo" });
    }
  });

  // Company routes
  app.get("/api/companies", async (req, res) => {
    try {
      const companies = await storage.getCompanies();
      res.json(companies);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch companies" });
    }
  });

  app.post("/api/companies", requireAuthentication, async (req, res) => {
    try {
      const userRole = req.authenticatedUserRole;
      if (userRole !== 'super_admin') {
        return res.status(403).json({ message: "Access denied. Super admin only." });
      }
      const company = await storage.createCompany(req.body);
      res.status(201).json(company);
    } catch (error) {
      console.error("Error creating company:", error instanceof Error ? error.message : error);
      res.status(500).json({ message: "Failed to create company" });
    }
  });

  // Super admin routes for companies
  app.put("/api/companies/:id", requireAuthentication, async (req, res) => {
    try {
      const userRole = req.authenticatedUserRole;
      if (userRole !== 'super_admin' && userRole !== 'company_admin') {
        return res.status(403).json({ message: "Access denied." });
      }
      const companyId = parseInt(req.params.id);
      const updatedCompany = await storage.updateCompany(companyId, req.body);
      if (!updatedCompany) {
        return res.status(404).json({ message: "Company not found" });
      }
      res.json(updatedCompany);
    } catch (error) {
      console.error("Error updating company:", error instanceof Error ? error.message : error);
      res.status(500).json({ message: "Failed to update company" });
    }
  });

  app.delete("/api/companies/:id", requireAuthentication, async (req, res) => {
    try {
      const userRole = req.authenticatedUserRole;
      if (userRole !== 'super_admin') {
        return res.status(403).json({ message: "Access denied. Super admin only." });
      }
      const companyId = parseInt(req.params.id);
      const success = await storage.deleteCompany(companyId);
      if (!success) {
        return res.status(404).json({ message: "Company not found" });
      }
      res.json({ message: "Company deleted successfully" });
    } catch (error) {
      console.error("Error deleting company:", error instanceof Error ? error.message : error);
      res.status(500).json({ message: "Failed to delete company" });
    }
  });

  // Company Profile Management (Company Admin only)
  app.get("/api/company/:companyId/profile", requireAuthentication, async (req, res) => {
    try {
      const companyId = parseInt(req.params.companyId);
      const userRole = req.authenticatedUserRole;
      const userCompanyId = req.authenticatedUserCompanyId;

      // Allow company admins and irrigation managers to view their own company profile
      const allowedRoles = ['company_admin', 'irrigation_manager'];
      if (!allowedRoles.includes(userRole as string) || userCompanyId !== companyId) {
        return res.status(403).json({ message: "Access denied. You can only view your own company profile." });
      }

      const company = await storage.getCompanyProfile(companyId);
      if (!company) {
        return res.status(404).json({ message: "Company profile not found", requiresSetup: true });
      }
      res.json(company);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch company profile" });
    }
  });

  // Create company profile (for first-time setup)
  app.post("/api/company/:companyId/profile", requireAuthentication, async (req, res) => {
    try {
      const companyId = parseInt(req.params.companyId);
      const userRole = req.authenticatedUserRole;
      const userCompanyId = req.authenticatedUserCompanyId;

      // Only company admins can create their own company profile
      if (userRole !== 'company_admin' || userCompanyId !== companyId) {
        return res.status(403).json({ message: "Access denied. Company admins can only manage their own company profile." });
      }

      // Check if company profile already exists
      const existingCompany = await storage.getCompanyProfile(companyId);
      if (existingCompany) {
        return res.status(409).json({ message: "Company profile already exists" });
      }

      const companyData = insertCompanySchema.parse({ ...req.body, id: companyId });
      const company = await storage.createCompanyProfile(companyData);
      res.status(201).json(company);
    } catch (error) {
      console.error(error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid company data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to create company profile" });
    }
  });

  // Check if company profile setup is required
  app.get("/api/company/:companyId/setup-status", requireAuthentication, async (req, res) => {
    try {
      const companyId = parseInt(req.params.companyId);
      const userRole = req.authenticatedUserRole;
      const userCompanyId = req.authenticatedUserCompanyId;

      // Only company admins can check their own company setup status
      if (userRole !== 'company_admin' || userCompanyId !== companyId) {
        return res.status(403).json({ message: "Access denied" });
      }

      const exists = await storage.checkCompanyProfileExists(companyId);
      res.json({ requiresSetup: !exists, companyId });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to check setup status" });
    }
  });

  app.put("/api/company/:companyId/profile", requireAuthentication, async (req, res) => {
    try {
      const companyId = parseInt(req.params.companyId);
      const userRole = req.authenticatedUserRole;
      const userCompanyId = req.authenticatedUserCompanyId;

      // Only company admins can update their own company profile
      if (userRole !== 'company_admin' || userCompanyId !== companyId) {
        return res.status(403).json({ message: "Access denied. Company admins can only manage their own company profile." });
      }

      const updates = insertCompanySchema.partial().parse(req.body);
      
      // If logo is being updated, normalize the path
      if (updates.logo) {
        const objectStorageService = new ObjectStorageService();
        updates.logo = objectStorageService.normalizeLogoPath(updates.logo);
      }
      
      const updatedCompany = await storage.updateCompanyProfile(companyId, updates);
      res.json(updatedCompany);
    } catch (error) {
      console.error(error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid company data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to update company profile" });
    }
  });

  // Company logo upload endpoint
  app.post("/api/company/logo/upload", requireAuthentication, async (req, res) => {
    try {
      const userRole = req.authenticatedUserRole;
      
      // Only company admins can upload logos
      if (userRole !== 'company_admin') {
        return res.status(403).json({ message: "Access denied. Only company admins can upload logos." });
      }

      const objectStorageService = new ObjectStorageService();
      const uploadURL = await objectStorageService.getCompanyLogoUploadURL();
      
      res.json({ 
        method: 'PUT' as const,
        url: uploadURL 
      });
    } catch (error) {
      console.error(error);
      // Production error logging would go to monitoring service
      res.status(500).json({ message: "Failed to generate upload URL" });
    }
  });

  // Reset/clear company logo
  app.put("/api/company/:companyId/logo-reset", requireAuthentication, async (req, res) => {
    try {
      const userRole = req.authenticatedUserRole;
      const companyId = parseInt(req.params.companyId);
      
      if (userRole !== 'company_admin') {
        return res.status(403).json({ message: "Access denied. Only company admins can reset logos." });
      }

      // Direct database update to ensure logo is cleared
      const result = await db
        .update(companies)
        .set({ logo: null, updatedAt: new Date() })
        .where(eq(companies.id, companyId))
        .returning();

      if (!result || result.length === 0) {
        return res.status(404).json({ message: "Company not found" });
      }

      res.json({ 
        message: "Logo cleared successfully",
        company: result[0]
      });
    } catch (error) {
      console.error('Logo reset error:', error);
      res.status(500).json({ message: "Failed to clear company logo" });
    }
  });

  // Update company logo after upload
  app.put("/api/company/:companyId/logo", requireAuthentication, async (req, res) => {
    try {
      const userRole = req.authenticatedUserRole;
      const companyId = parseInt(req.params.companyId);
      const { logoUrl } = req.body;
      
      // Production-ready logo update processing
      
      // Only company admins can update logos
      if (userRole !== 'company_admin') {
        return res.status(403).json({ message: "Access denied. Only company admins can update logos." });
      }

      if (!logoUrl) {
        return res.status(400).json({ message: "Logo URL is required" });
      }

      // Normalize the logo path and get public URL
      const objectStorageService = new ObjectStorageService();
      const logoPath = objectStorageService.normalizeLogoPath(logoUrl);
      const publicUrl = objectStorageService.getCompanyLogoPublicURL(logoPath);
      
      // Normalize logo path and generate public URL

      // Update company with logo URL
      const updatedCompany = await storage.updateCompany(companyId, { 
        logo: publicUrl 
      });

      if (!updatedCompany) {
        return res.status(404).json({ message: "Company not found" });
      }

      // Logo successfully updated in database

      res.json({ 
        message: "Logo updated successfully", 
        logoUrl: publicUrl 
      });
    } catch (error) {
      console.error(error);
      // Production error logging would go to monitoring service
      res.status(500).json({ message: "Failed to update company logo" });
    }
  });

  // Removed - moved to top of registerRoutes function

  // Middleware to check if company profile setup is complete
  const requireCompanySetup = async (req: any, res: any, next: any) => {
    try {
      let userRole = req.authenticatedUserRole || req.headers['x-user-role'];
      let userCompanyId = req.authenticatedUserCompanyId || (req.headers['x-user-company-id'] ? parseInt(req.headers['x-user-company-id'] as string) : null);

      // Production session-based fallback
      if (!userRole && req.session && req.session.userId) {
        try {
          const user = await storage.getUser(parseInt(String(req.session.userId)));
          if (user) {
            userRole = user.role;
            userCompanyId = user.companyId;
          }
        } catch (dbError) {
          // Continue
        }
      }

      if (userRole === 'company_admin' && userCompanyId) {
        const companyExists = await storage.checkCompanyProfileExists(userCompanyId);
        if (!companyExists) {
          return res.status(423).json({ 
            message: "Company profile setup required", 
            requiresSetup: true,
            companyId: userCompanyId 
          });
        }
      }
      next();
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to check company setup status" });
    }
  };

  // Super Admin: Create company admin (placeholder company + admin user)
  app.post("/api/super-admin/create-company-admin", requireAuthentication, async (req, res) => {
    try {
      const userRole = req.authenticatedUserRole;
      
      if (userRole !== 'super_admin') {
        return res.status(403).json({ message: "Access denied. Super admin only." });
      }

      const { adminEmail, adminPassword } = req.body;

      // Check if user already exists
      const existingUser = await storage.getUserByUsername(adminEmail);
      if (existingUser) {
        return res.status(400).json({ message: "A user with this email already exists" });
      }

      // Create placeholder company first (admin will complete setup)
      const companyData = {
        name: `Company for ${adminEmail} (Setup Required)`,
        address: '',
        phone: '',
        email: '',
        website: '',
        subscription: 'basic'
      };

      const company = await storage.createCompany(companyData);

      // Create admin user with minimal info
      const userData = {
        username: adminEmail,
        password: adminPassword,
        name: 'Company Admin', // Placeholder - they'll update on first login
        email: adminEmail,
        role: 'company_admin' as const,
        companyId: company.id,
        isActive: true,
        emailVerified: false // They'll need to verify on first login
      };

      const user = await storage.createUser(userData);

      res.status(201).json({ company, user });
    } catch (error) {
      console.error('Error creating company admin:', error);
      res.status(500).json({ message: "Failed to create company admin" });
    }
  });

  app.get("/api/admin/system-stats", async (req, res) => {
    try {
      const users = await storage.getUsers();
      res.json({
        totalUsers: users.length,
        activeUsers: users.filter(u => u.isActive).length,
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch system stats" });
    }
  });

  // User routes
  app.get("/api/users", async (req, res) => {
    try {
      const users = await storage.getUsers();
      // Remove passwords for security
      const usersWithoutPasswords = users.map(({ password, ...user }) => user);
      res.json(usersWithoutPasswords);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch users" });
    }
  });

  // Get field technicians and irrigation managers (for work order assignments)
  app.get("/api/users/field-techs", async (req, res) => {
    try {
      const users = await storage.getUsers();
      const assignableUsers = users
        .filter(user => (user.role === 'field_tech' || user.role === 'irrigation_manager') && user.isActive)
        .map(({ password, ...user }) => user);
      res.json(assignableUsers);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch assignable users" });
    }
  });

  // User management routes for system admin
  app.post("/api/users", requireAuthentication, async (req, res) => {
    try {
      const userData = insertUserSchema.parse(req.body);
      const user = await storage.createUser(userData);
      // Remove password from response
      const { password: _, ...userWithoutPassword } = user;
      res.status(201).json(userWithoutPassword);
    } catch (error) {
      console.error(error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid user data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to create user" });
    }
  });

  // Super admin routes for users
  app.put("/api/users/:id", requireAuthentication, async (req, res) => {
    try {
      const userId = parseInt(req.params.id);
      const userData = insertUserSchema.partial().parse(req.body);
      const user = await storage.updateUser(userId, userData);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      // Remove password from response
      const { password: _, ...userWithoutPassword } = user;
      res.json(userWithoutPassword);
    } catch (error) {
      console.error(error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid user data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to update user" });
    }
  });

  // Check user's data dependencies before deletion
  app.get("/api/users/:id/dependencies", requireAuthentication, async (req, res) => {
    try {
      const userId = parseInt(req.params.id);
      const dependencies = await storage.getUserDataDependencies(userId);
      res.json(dependencies);
    } catch (error) {
      console.error('Failed to check user dependencies:', error);
      res.status(500).json({ message: "Failed to check user dependencies" });
    }
  });

  // Soft delete user (recommended for users with completed work)
  app.post("/api/users/:id/soft-delete", requireAuthentication, async (req, res) => {
    try {
      const userId = parseInt(req.params.id);
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      
      const success = await storage.softDeleteUser(userId);
      if (!success) {
        return res.status(500).json({ message: "Failed to delete user" });
      }
      
      res.json({ 
        message: "User deleted successfully (soft delete - data preserved)",
        deletedUser: { id: user.id, name: user.name }
      });
    } catch (error) {
      console.error('Failed to soft delete user:', error);
      res.status(500).json({ message: "Failed to delete user" });
    }
  });

  // Hard delete user with cascade (use with caution)
  app.delete("/api/users/:id/hard-delete", requireAuthentication, async (req, res) => {
    try {
      const userId = parseInt(req.params.id);
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      
      const success = await storage.hardDeleteUserWithCascade(userId);
      if (!success) {
        return res.status(500).json({ message: "Failed to delete user" });
      }
      
      res.json({ 
        message: "User permanently deleted with data cleanup",
        deletedUser: { id: user.id, name: user.name }
      });
    } catch (error) {
      console.error('Failed to hard delete user:', error);
      res.status(500).json({ message: "Failed to delete user" });
    }
  });

  // Original delete endpoint (kept for compatibility but updated to use soft delete by default)
  app.delete("/api/users/:id", async (req, res) => {
    try {
      const userId = parseInt(req.params.id);
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      // Check if user has dependencies
      const dependencies = await storage.getUserDataDependencies(userId);
      const hasData = dependencies.hasWorkOrders || dependencies.hasBillingSheets;

      if (hasData) {
        // Use soft delete for users with data
        const success = await storage.softDeleteUser(userId);
        if (!success) {
          return res.status(500).json({ message: "Failed to delete user" });
        }
        res.json({ 
          message: "User deleted successfully (soft delete - data preserved)",
          type: "soft_delete",
          preservedData: {
            workOrders: dependencies.workOrderCount,
            billingSheets: dependencies.billingSheetCount
          }
        });
      } else {
        // Use hard delete for users without dependencies
        const success = await storage.deleteUser(userId);
        if (!success) {
          return res.status(500).json({ message: "Failed to delete user" });
        }
        res.json({ 
          message: "User deleted successfully (permanent deletion)",
          type: "hard_delete"
        });
      }
    } catch (error) {
      console.error('Failed to delete user:', error);
      res.status(500).json({ message: "Failed to delete user" });
    }
  });

  app.put("/api/users/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const userData = insertUserSchema.partial().parse(req.body);
      const user = await storage.updateUser(id, userData);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      // Remove password from response
      const { password: _, ...userWithoutPassword } = user;
      res.json(userWithoutPassword);
    } catch (error) {
      console.error(error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid user data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to update user" });
    }
  });

  app.patch("/api/users/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const userData = insertUserSchema.partial().parse(req.body);
      const user = await storage.updateUser(id, userData);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      // Remove password from response
      const { password: _, ...userWithoutPassword } = user;
      res.json(userWithoutPassword);
    } catch (error) {
      console.error(error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid user data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to update user" });
    }
  });

  app.delete("/api/users/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const success = await storage.deleteUser(id);
      if (!success) {
        return res.status(404).json({ message: "User not found" });
      }
      res.json({ message: "User deleted successfully" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to delete user" });
    }
  });

  // Dashboard statistics endpoint
  app.get("/api/dashboard/stats", requireAuthentication, async (req, res) => {
    try {
      const userRole = req.authenticatedUserRole;
      const userCompanyId = req.authenticatedUserCompanyId;
      
      let stats;
      
      if (userRole === 'super_admin') {
        // Super admin sees system-wide stats
        const allUsers = await storage.getUsers();
        const activeUsers = allUsers.filter(user => user.isActive).length;
        
        const allWorkOrders = await storage.getWorkOrders();
        const openWorkOrders = allWorkOrders.filter(wo => wo.status === "assigned").length;
        
        const allCustomers = await storage.getCustomers();
        const activeCustomers = allCustomers.length;
        
        stats = { activeUsers, openWorkOrders, activeCustomers };
      } else if (userRole === 'company_admin' && userCompanyId) {
        // Company admin sees only their company's stats
        const allUsers = await storage.getUsers();
        const companyUsers = allUsers.filter(user => user.companyId === userCompanyId);
        const activeUsers = companyUsers.filter(user => user.isActive).length;
        
        const allCustomers = await storage.getCustomers();
        
        const allWorkOrders = await storage.getWorkOrders();
        const companyWorkOrders = allWorkOrders.filter(wo => wo.customerId && allCustomers.find(c => c.id === wo.customerId)?.companyId === userCompanyId);
        const openWorkOrders = companyWorkOrders.filter(wo => wo.status === "assigned" || wo.status === "in_progress").length;
        
        // Include customers for this company OR customers with companyId 99 (QuickBooks sync default)
        // This handles cases where QuickBooks sync used a default company ID
        const companyCustomers = allCustomers.filter(customer => 
          customer.companyId === userCompanyId || 
          customer.companyId === 99 || // QuickBooks sync default
          customer.companyId === null || 
          customer.companyId === undefined
        );
        const activeCustomers = companyCustomers.length;
        
        stats = { activeUsers, openWorkOrders, activeCustomers };
        console.log(`Company ${userCompanyId} stats:`, stats);
      } else {
        // Other roles get limited or no stats
        stats = { activeUsers: 0, openWorkOrders: 0, activeCustomers: 0 };
      }
      
      console.log("Final stats:", stats);
      res.json(stats);
    } catch (error) {
      console.error("Error fetching dashboard stats:", error);
      res.status(500).json({ message: "Failed to fetch dashboard statistics", error: error instanceof Error ? error.message : String(error) });
    }
  });

  // Company-scoped user management routes (for company admins)
  app.get("/api/company/:companyId/users", requireCompanySetup, async (req, res) => {
    try {
      const companyId = parseInt(req.params.companyId);
      const users = await storage.getUsers(companyId);
      // Remove passwords from response
      const usersWithoutPasswords = users.map(({ password, ...user }) => user);
      res.json(usersWithoutPasswords);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch company users" });
    }
  });

  app.post("/api/company/:companyId/users", requireCompanySetup, async (req, res) => {
    try {
      const companyId = parseInt(req.params.companyId);

      // Phone is required for new users — it becomes the username
      const { phone, email, name, password, role } = req.body;
      if (!phone || !phone.trim()) {
        return res.status(400).json({ message: "Phone number is required" });
      }

      const userData = insertUserSchema.parse({
        ...req.body,
        username: phone.trim(), // phone number is the login username
        companyId
      });

      // Generate email verification token if email is provided
      let emailVerificationToken = null;
      let emailVerificationExpires = null;

      if (userData.email) {
        emailVerificationToken = crypto.randomBytes(32).toString('hex');
        emailVerificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
      }

      const user = await storage.createUser({
        ...userData,
        // If no email, mark as verified so login is not blocked
        emailVerified: userData.email ? false : true,
        emailVerificationToken,
        emailVerificationExpires
      });

      // Send verification email if email is provided
      if (userData.email && emailVerificationToken) {
        try {
          await EmailService.sendEmailVerification(userData.email, emailVerificationToken, userData.name);
        } catch (emailError) {
          console.error('Failed to send verification email:', emailError);
          // Don't fail user creation if email fails
        }
      }

      // Remove password from response
      const { password: _, ...userWithoutPassword } = user;
      res.status(201).json(userWithoutPassword);
    } catch (error) {
      console.error(error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid user data", errors: error.errors });
      }
      console.error('Full error details for user creation:', error);
      res.status(500).json({ message: "Failed to create user", error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.put("/api/company/:companyId/users/:userId", requireCompanySetup, async (req, res) => {
    try {
      const companyId = parseInt(req.params.companyId);
      const userId = parseInt(req.params.userId);
      
      // Verify user belongs to company
      const existingUser = await storage.getUser(userId);
      if (!existingUser || existingUser.companyId !== companyId) {
        return res.status(403).json({ message: "Not authorized to modify this user" });
      }

      const userData = insertUserSchema.partial().parse(req.body);

      // If phone is being updated, also update username to match (phone = username for new-style accounts)
      const updatePayload: any = { ...userData };
      if (req.body.phone && req.body.phone.trim() && req.body.phone.trim() !== existingUser.username) {
        updatePayload.username = req.body.phone.trim();
      }

      // If email is being cleared, ensure emailVerified is set to true so login isn't blocked
      if (updatePayload.email === '' || updatePayload.email === null) {
        updatePayload.email = null;
        updatePayload.emailVerified = true;
      }

      const user = await storage.updateUser(userId, updatePayload);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      // Remove password from response
      const { password: _, ...userWithoutPassword } = user;
      res.json(userWithoutPassword);
    } catch (error) {
      console.error(error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid user data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to update user" });
    }
  });

  app.post("/api/company/:companyId/users/:userId/deactivate", requireCompanySetup, async (req, res) => {
    try {
      const companyId = parseInt(req.params.companyId);
      const userId = parseInt(req.params.userId);
      
      // Verify user belongs to company
      const existingUser = await storage.getUser(userId);
      if (!existingUser || existingUser.companyId !== companyId) {
        return res.status(403).json({ message: "Not authorized to modify this user" });
      }

      const user = await storage.updateUser(userId, { isActive: false });
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      res.json({ message: "User deactivated successfully" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to deactivate user" });
    }
  });

  // Company admin password change endpoint
  app.post("/api/company/:companyId/users/:userId/change-password", requireCompanySetup, async (req, res) => {
    try {
      const companyId = parseInt(req.params.companyId);
      const userId = parseInt(req.params.userId);
      const { newPassword } = req.body;
      
      if (!newPassword || newPassword.length < 6) {
        return res.status(400).json({ message: "Password must be at least 6 characters long" });
      }
      
      // Verify user belongs to company
      const existingUser = await storage.getUser(userId);
      if (!existingUser || existingUser.companyId !== companyId) {
        return res.status(403).json({ message: "Not authorized to modify this user" });
      }

      // Hash the new password
      const hashedPassword = await bcrypt.hash(newPassword, 10);
      
      // Update the user's password
      const user = await storage.updateUser(userId, { 
        password: hashedPassword
      });
      
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      
      res.json({ message: "Password changed successfully" });
    } catch (error) {
      console.error('Password change error:', error);
      res.status(500).json({ message: "Failed to change password" });
    }
  });

  // Test endpoint to check database and users
  app.get("/api/test-auth", async (req, res) => {
    try {
      const allUsers = await storage.getUsers();
      res.json({ 
        message: "Server is running", 
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV,
        userCount: allUsers.length,
        users: allUsers.map(u => ({ id: u.id, username: u.username, role: u.role, emailVerified: u.emailVerified }))
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ 
        message: "Database connection failed", 
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString()
      });
    }
  });

  // Admin reset users endpoint
  app.post("/api/admin/reset-users", async (req, res) => {
    try {
      // Hash password123 for all users
      const password = await bcrypt.hash('password123', 10);
      
      // Reset all user passwords
      const users = await storage.getUsers();
      for (const user of users) {
        await storage.updateUser(user.id, {
          password,
          emailVerified: true,
          passwordResetToken: null,
          passwordResetExpires: null
        });
      }
      
      res.json({ 
        message: "All user passwords reset to 'password123'", 
        usersUpdated: users.length 
      });
    } catch (error) {
      console.error('Password reset error:', error);
      res.status(500).json({ message: "Failed to reset passwords" });
    }
  });

  // Emergency Randy password reset
  app.post("/api/reset-randy-password", async (req, res) => {
    try {
      const newPassword = 'admin123';
      const hashedPassword = await bcrypt.hash(newPassword, 10);
      
      // Update Randy's password
      const user = await storage.updateUserPassword('randy@highplainsprop.com', hashedPassword);
      if (!user) {
        return res.status(404).json({ message: "Randy not found" });
      }
      
      res.json({ 
        message: "Randy's password reset to 'admin123'",
        username: "randy@highplainsprop.com",
        newPassword: "admin123"
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Password reset failed", error: error instanceof Error ? error.message : String(error) });
    }
  });

  // Authentication routes
  app.post("/api/auth/login", async (req, res) => {
    try {
      const { username, password } = req.body;
      const user = await storage.getUserByUsername(username);
      
      if (!user || !user.isActive) {
        return res.status(401).json({ message: "Invalid credentials" });
      }
      
      // Use bcrypt to compare password with hash
      const passwordValid = await bcrypt.compare(password, user.password);
      if (!passwordValid) {
        return res.status(401).json({ message: "Invalid credentials" });
      }
      
      // Check if email is verified (optional enforcement)
      if (user.email && !user.emailVerified) {
        return res.status(403).json({ 
          message: "Email verification required", 
          requiresVerification: true,
          email: user.email 
        });
      }
      
      // Return user without password
      const { password: _, ...userWithoutPassword } = user;
      res.json(userWithoutPassword);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Login failed" });
    }
  });

  // Password reset request
  app.post("/api/auth/forgot-password", async (req, res) => {
    try {
      const { email } = req.body;
      const user = await storage.getUserByEmail(email);
      
      if (!user) {
        // Don't reveal if email exists or not for security
        return res.json({ message: "If this email exists, you will receive a password reset link." });
      }
      
      // Generate reset token
      const crypto = await import('crypto');
      const resetToken = crypto.randomBytes(32).toString('hex');
      const resetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now
      
      // Update user with reset token
      await storage.updateUser(user.id, {
        passwordResetToken: resetToken,
        passwordResetExpires: resetExpires
      });
      
      // Send reset email
      await EmailService.sendPasswordReset(user.email!, resetToken, user.name);
      
      res.json({ message: "If this email exists, you will receive a password reset link." });
    } catch (error) {
      console.error('Password reset error:', error);
      res.status(500).json({ message: "Password reset request failed" });
    }
  });

  // Reset password with token
  app.post("/api/auth/reset-password", async (req, res) => {
    try {
      const { token, newPassword } = req.body;
      
      if (!token || !newPassword) {
        return res.status(400).json({ message: "Token and new password are required" });
      }
      
      if (newPassword.length < 6) {
        return res.status(400).json({ message: "Password must be at least 6 characters long" });
      }
      
      const user = await storage.getUserByPasswordResetToken(token);
      
      if (!user || !user.passwordResetExpires || user.passwordResetExpires < new Date()) {
        return res.status(400).json({ message: "Invalid or expired reset token" });
      }
      
      // Hash the new password before storing
      const hashedPassword = await bcrypt.hash(newPassword, 10);
      
      // Update password and clear reset token
      await storage.updateUser(user.id, {
        password: hashedPassword,
        passwordResetToken: null,
        passwordResetExpires: null,
      });
      
      res.json({ message: "Password reset successfully" });
    } catch (error) {
      console.error('Password reset error:', error);
      res.status(500).json({ message: "Password reset failed" });
    }
  });

  // Resend email verification
  app.post("/api/auth/resend-verification", async (req, res) => {
    try {
      const { email } = req.body;
      const user = await storage.getUserByEmail(email);
      
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      
      if (user.emailVerified) {
        return res.status(400).json({ message: "Email already verified" });
      }
      
      // Generate new verification token
      const emailVerificationToken = crypto.randomBytes(32).toString('hex');
      const emailVerificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
      
      // Update user with new token
      await storage.updateUser(user.id, {
        emailVerificationToken,
        emailVerificationExpires,
      });
      
      // Send verification email
      try {
        await EmailService.sendEmailVerification(email, emailVerificationToken, user.name);
        console.log(`Verification email resent to ${email}`);
        res.json({ message: "Verification email sent" });
      } catch (emailError) {
        console.error('Failed to send verification email:', emailError);
        res.status(500).json({ message: "Failed to send verification email" });
      }
    } catch (error) {
      console.error('Error resending verification:', error);
      res.status(500).json({ message: "Failed to resend verification email" });
    }
  });

  // Admin endpoint to resend verification for company users
  app.post("/api/company/:companyId/users/:userId/resend-verification", requireWorkOrderBillingAccess, async (req, res) => {
    try {
      const { companyId, userId } = req.params;
      const user = await storage.getUser(parseInt(userId));
      
      if (!user || user.companyId !== parseInt(companyId)) {
        return res.status(404).json({ message: "User not found" });
      }
      
      if (user.emailVerified) {
        return res.status(400).json({ message: "Email already verified" });
      }
      
      if (!user.email) {
        return res.status(400).json({ message: "User has no email address" });
      }
      
      // Generate new verification token
      const emailVerificationToken = crypto.randomBytes(32).toString('hex');
      const emailVerificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
      
      // Update user with new token
      await storage.updateUser(user.id, {
        emailVerificationToken,
        emailVerificationExpires,
      });
      
      // Send verification email
      try {
        await EmailService.sendEmailVerification(user.email, emailVerificationToken, user.name);
        console.log(`Admin resent verification email to ${user.email}`);
        res.json({ message: "Verification email sent" });
      } catch (emailError) {
        console.error('Failed to send verification email:', emailError);
        res.status(500).json({ message: "Failed to send verification email" });
      }
    } catch (error) {
      console.error('Error resending verification:', error);
      res.status(500).json({ message: "Failed to resend verification email" });
    }
  });

  // Get current authenticated user from session
  app.get("/api/auth/user", async (req, res) => {
    try {
      // Check session for user ID
      if (!req.session || !req.session.userId) {
        return res.status(401).json({ 
          message: "No active session" 
        });
      }
      
      // Get user from database
      const user = await storage.getUser(parseInt(String(req.session.userId)));
      if (!user) {
        return res.status(404).json({ 
          message: "User not found" 
        });
      }
      
      // Return user data (excluding sensitive fields)
      const { 
        passwordResetToken, 
        passwordResetExpires, 
        emailVerificationToken,
        mfaSecret,
        mfaBackupCodes,
        ...safeUserData 
      } = user;
      
      res.json(safeUserData);
    } catch (error) {
      console.error('Auth user endpoint error:', error);
      res.status(500).json({ 
        message: "Failed to get user session" 
      });
    }
  });

  // Email verification endpoint
  app.get("/api/auth/verify-email/:token", async (req, res) => {
    try {
      const { token } = req.params;
      const user = await storage.getUserByEmailVerificationToken(token);
      
      if (!user || !user.emailVerificationExpires || user.emailVerificationExpires < new Date()) {
        return res.status(400).send(`
          <html><body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
            <h1 style="color: #ef4444;">Verification Failed</h1>
            <p>This verification link is invalid or has expired.</p>
            <p>Please request a new verification email.</p>
          </body></html>
        `);
      }
      
      // Mark email as verified and clear verification token
      await storage.updateUser(user.id, {
        emailVerified: true,
        emailVerificationToken: null,
        emailVerificationExpires: null,
      });
      
      res.send(`
        <html><body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
          <h1 style="color: #10b981;">Email Verified Successfully!</h1>
          <p>Your email address has been verified. You can now close this window and return to the application.</p>
          <script>setTimeout(() => { window.close(); }, 3000);</script>
        </body></html>
      `);
    } catch (error) {
      console.error('Email verification error:', error);
      res.status(500).send(`
        <html><body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
          <h1 style="color: #ef4444;">Verification Error</h1>
          <p>An error occurred during email verification. Please try again.</p>
        </body></html>
      `);
    }
  });


  // Dashboard stats
  app.get("/api/dashboard/stats", async (req, res) => {
    try {
      const stats = await storage.getDashboardStats();
      res.json(stats);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch dashboard stats" });
    }
  });

  // Admin-specific stats endpoint
  app.get("/api/admin/stats", async (req, res) => {
    try {
      const users = await storage.getUsers();
      const estimates = await storage.getEstimates();
      const workOrders = await storage.getWorkOrders();
      
      const stats = {
        totalUsers: users.length,
        activeUsers: users.filter(u => u.isActive).length,
        totalEstimates: estimates.length,
        totalWorkOrders: workOrders.length,
        totalInvoices: 0, // Will be updated when invoice endpoint is implemented
        systemHealth: "good" as const
      };
      
      res.json(stats);
    } catch (error) {
      console.error("Error fetching admin stats:", error);
      res.status(500).json({ message: "Failed to fetch admin stats" });
    }
  });

  // Customer routes
  app.get("/api/customers", requireAuthentication, async (req, res) => {
    try {
      const billingVisible = req.query.billingVisible === "true";
      let customers = await storage.getCustomers();
      if (billingVisible) {
        customers = customers.filter(c => !c.hiddenFromBilling);
      }
      res.json(applyBillingNotesVisibility(req, customers));
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch customers" });
    }
  });

  // Customer billing preview data - includes estimates, work orders, and billing sheets
  // This must come BEFORE the :id route to avoid parameter conflicts
  app.get("/api/customers/billing-preview", async (req, res) => {
    try {
      console.log("Fetching comprehensive customer billing data...");
      const allCustomers = await storage.getCustomers();
      const customers = allCustomers.filter(c => !c.hiddenFromBilling);
      console.log(`Found ${customers.length} customers (${allCustomers.length - customers.length} hidden from billing)`);
      
      // Get filter parameters from query
      const dateFilter = req.query.dateFilter as string || "last_30_days";
      const selectedMonth = req.query.selectedMonth as string;
      
      const currentDate = new Date();
      const currentMonth = currentDate.getMonth();
      const currentYear = currentDate.getFullYear();
      
      // Calculate date range based on filter
      let startDate: Date;
      let endDate: Date = currentDate;
      
      switch (dateFilter) {
        case "all":
          startDate = new Date(2020, 0, 1); // Far past date
          break;
        case "current_month":
          startDate = new Date(currentYear, currentMonth, 1);
          break;
        case "last_30_days":
          startDate = new Date(currentDate.getTime() - (30 * 24 * 60 * 60 * 1000));
          break;
        case "last_90_days":
          startDate = new Date(currentDate.getTime() - (90 * 24 * 60 * 60 * 1000));
          break;
        case "custom_month":
          if (selectedMonth) {
            const [year, month] = selectedMonth.split('-').map(Number);
            startDate = new Date(year, month - 1, 1);
            endDate = new Date(year, month, 0); // Last day of the month
          } else {
            startDate = new Date(currentDate.getTime() - (30 * 24 * 60 * 60 * 1000));
          }
          break;
        default:
          startDate = new Date(currentDate.getTime() - (30 * 24 * 60 * 60 * 1000));
      }
      
      console.log(`Filtering data from ${startDate.toISOString()} to ${endDate.toISOString()}`);
      const currentMonthStart = new Date(currentYear, currentMonth, 1);
      
      // Get billing previews for all customers including work orders, estimates, and billing sheets
      const customerPreviews = await Promise.all(customers.map(async (customer) => {
        try {
          console.log(`Processing customer: ${customer.name} (ID: ${customer.id})`);
          
          // Get all three data sources for this customer
          const workOrders = await storage.getWorkOrdersByCustomer(customer.id);
          const estimates = await storage.getEstimatesByCustomer(customer.id);
          const billingSheets = await storage.getBillingSheetsByCustomer(customer.id);
          
          const approvedEstimates = estimates.filter(est => est.status === 'approved');

          // Helper: check if a work order falls within the selected date range
          const woInRange = (wo: typeof workOrders[0]) => {
            const d = wo.completedAt ? new Date(wo.completedAt) : (wo.createdAt ? new Date(wo.createdAt) : null);
            if (!d) return true; // no date → always include
            return d >= startDate && d <= endDate;
          };
          // Helper: check if a billing sheet falls within the selected date range
          const bsInRange = (bs: typeof billingSheets[0]) => {
            const d = bs.workDate ? new Date(bs.workDate) : (bs.createdAt ? new Date(bs.createdAt) : null);
            if (!d) return true;
            return d >= startDate && d <= endDate;
          };

          // Coerce stored decimal/text totalAmount to a finite number; track
          // every non-finite raw value so we can warn per customer afterwards.
          // Dedupe by source so a single bad row doesn't multiply across the
          // approved / unapproved / independent-combined / current-month passes.
          const coercions = new Map<string, unknown>();
          const safeAmount = (raw: unknown, source: string): number => {
            if (raw === null || raw === undefined) return 0;
            const n = typeof raw === 'number' ? raw : parseFloat(String(raw));
            if (!Number.isFinite(n)) {
              if (!coercions.has(source)) coercions.set(source, raw);
              return 0;
            }
            return n;
          };

          // Calculate unbilled amounts for this customer (only approved/passed-to-billing tickets)
          const unbilledWorkOrders = workOrders.filter(wo =>
            (wo.status === 'approved_passed_to_billing') && !wo.invoiceId && woInRange(wo)
          );
          const unbilledBillingSheets = billingSheets.filter(bs =>
            (bs.status === 'approved_passed_to_billing') && !bs.invoiceId && bsInRange(bs)
          );

          // Use stored totalAmount as the authoritative total (historical backfill guardrail)
          const unbilledAmount =
            unbilledWorkOrders.reduce((sum, wo) => sum + safeAmount(wo.totalAmount, `wo:${wo.id}`), 0) +
            unbilledBillingSheets.reduce((sum, bs) => sum + safeAmount(bs.totalAmount, `bs:${bs.id}`), 0);

          // Approved total: approved_passed_to_billing with no invoiceId (same as unbilledAmount)
          const approvedTotal = unbilledAmount;

          // Unapproved total: work_completed OR pending_manager_review with no invoiceId (no date filter — these are current unbilled work)
          const unapprovedWorkOrders = workOrders.filter(wo =>
            (wo.status === 'pending_manager_review' || wo.status === 'work_completed') && !wo.invoiceId
          );
          const unapprovedBillingSheets = billingSheets.filter(bs =>
            (bs.status === 'pending_manager_review' || bs.status === 'completed' || bs.status === 'submitted') && !bs.invoiceId
          );
          const unapprovedTotal =
            unapprovedWorkOrders.reduce((sum, wo) => sum + safeAmount(wo.totalAmount, `wo:${wo.id}`), 0) +
            unapprovedBillingSheets.reduce((sum, bs) => sum + safeAmount(bs.totalAmount, `bs:${bs.id}`), 0);

          // Independent accumulation of combinedTotal — single pass over all
          // four source arrays rather than reusing the approvedTotal /
          // unapprovedTotal locals. This is what makes the drift guard below
          // a real invariant check: if any future refactor changes how one
          // of the four subtotals is computed (e.g. adds tax, swaps the
          // amount field, applies a discount), this independent sum diverges
          // and the warn fires.
          let combinedTotal = 0;
          for (const wo of unbilledWorkOrders) combinedTotal += safeAmount(wo.totalAmount, `wo:${wo.id}`);
          for (const bs of unbilledBillingSheets) combinedTotal += safeAmount(bs.totalAmount, `bs:${bs.id}`);
          for (const wo of unapprovedWorkOrders) combinedTotal += safeAmount(wo.totalAmount, `wo:${wo.id}`);
          for (const bs of unapprovedBillingSheets) combinedTotal += safeAmount(bs.totalAmount, `bs:${bs.id}`);

          // Two extra rollups (date-filter independent) exposed alongside the
          // date-filtered totals: totalUnbilled = all approved+unapproved
          // regardless of date; currentMonthUnbilled = same scope, current
          // calendar month only.
          const woAnyDate = (wo: typeof workOrders[0]) =>
            wo.completedAt ? new Date(wo.completedAt) : (wo.createdAt ? new Date(wo.createdAt) : null);
          const bsAnyDate = (bs: typeof billingSheets[0]) =>
            bs.workDate ? new Date(bs.workDate) : (bs.createdAt ? new Date(bs.createdAt) : null);
          const inCurrentMonth = (d: Date | null) => {
            if (!d) return false;
            return d >= currentMonthStart && d <= currentDate;
          };

          // All-time approved (deliberately ignore the user's date filter)
          const allTimeApprovedWOs = workOrders.filter(wo =>
            (wo.status === 'approved_passed_to_billing') && !wo.invoiceId
          );
          const allTimeApprovedBSs = billingSheets.filter(bs =>
            (bs.status === 'approved_passed_to_billing') && !bs.invoiceId
          );
          const allTimeApprovedTotal =
            allTimeApprovedWOs.reduce((s, wo) => s + safeAmount(wo.totalAmount, `wo:${wo.id}`), 0) +
            allTimeApprovedBSs.reduce((s, bs) => s + safeAmount(bs.totalAmount, `bs:${bs.id}`), 0);

          // unapprovedTotal is already unfiltered, so total unbilled is just the sum
          const totalUnbilled = allTimeApprovedTotal + unapprovedTotal;

          // Current-month slice across both buckets
          const currentMonthApprovedTotal =
            allTimeApprovedWOs.filter(wo => inCurrentMonth(woAnyDate(wo)))
              .reduce((s, wo) => s + safeAmount(wo.totalAmount, `wo:${wo.id}`), 0) +
            allTimeApprovedBSs.filter(bs => inCurrentMonth(bsAnyDate(bs)))
              .reduce((s, bs) => s + safeAmount(bs.totalAmount, `bs:${bs.id}`), 0);
          const currentMonthUnapprovedTotal =
            unapprovedWorkOrders.filter(wo => inCurrentMonth(woAnyDate(wo)))
              .reduce((s, wo) => s + safeAmount(wo.totalAmount, `wo:${wo.id}`), 0) +
            unapprovedBillingSheets.filter(bs => inCurrentMonth(bsAnyDate(bs)))
              .reduce((s, bs) => s + safeAmount(bs.totalAmount, `bs:${bs.id}`), 0);
          const currentMonthUnbilled = currentMonthApprovedTotal + currentMonthUnapprovedTotal;

          // Guard 1: warn when any raw totalAmount was non-finite and coerced to 0.
          if (coercions.size > 0) {
            const entries = Array.from(coercions.entries());
            const sample = entries.slice(0, 3).map(([src, raw]) =>
              `${src}=${typeof raw === 'string' ? JSON.stringify(raw) : String(raw)}`
            );
            console.warn(
              `[billing-preview] customer ${customer.id}: coerced non-finite totalAmount ` +
              `to 0 on ${coercions.size} distinct source record(s). ` +
              `Sample: ${sample.join(', ')}${entries.length > 3 ? ', …' : ''}`
            );
          }
          // Guard 2: combinedTotal (independent pass) must equal approvedTotal + unapprovedTotal.
          // The independent pass exists only as a drift sentinel — log if it diverges,
          // then normalize the API payload to the subtotal sum so any future surface
          // that reads combinedTotal directly cannot disagree with Approved + Unapproved.
          const expectedCombined = approvedTotal + unapprovedTotal;
          if (Math.abs(combinedTotal - expectedCombined) > 0.005) {
            console.warn(
              `[billing-preview] customer ${customer.id}: combined-vs-sum drift — ` +
              `independent combinedTotal=${combinedTotal.toFixed(2)} ` +
              `expected=${expectedCombined.toFixed(2)} ` +
              `(approvedTotal=${approvedTotal.toFixed(2)}, unapprovedTotal=${unapprovedTotal.toFixed(2)}) ` +
              `— payload normalized to expected.`
            );
          }
          const combinedTotalForPayload = expectedCombined;

          return {
            id: customer.id,
            name: customer.name,
            email: customer.email,
            phone: customer.phone,
            unbilledAmount,
            approvedTotal,
            unapprovedTotal,
            combinedTotal: combinedTotalForPayload,
            totalUnbilled,
            currentMonthUnbilled,
            currentMonthBilling: 0,
            monthlyAverage: 0,
            billingPace: 1,
            lastInvoiceDate: null,
            totalWorkOrders: workOrders.length,
            pendingWorkOrders: workOrders.filter(wo => wo.status === 'pending' || wo.status === 'assigned' || wo.status === 'in_progress').length
          };
        } catch (error) {
          console.error(`Error processing customer ${customer.id}: ${error instanceof Error ? error.message : String(error)}`);
          return {
            id: customer.id,
            name: customer.name,
            email: customer.email,
            phone: customer.phone,
            unbilledAmount: 0,
            approvedTotal: 0,
            unapprovedTotal: 0,
            combinedTotal: 0,
            totalUnbilled: 0,
            currentMonthUnbilled: 0,
            currentMonthBilling: 0,
            monthlyAverage: 0,
            billingPace: 1,
            lastInvoiceDate: null,
            totalWorkOrders: 0,
            pendingWorkOrders: 0
          };
        }
      }));
      
      res.json(customerPreviews);
    } catch (error) {
      console.error("Error fetching customer billing previews:", error);
      res.status(500).json({ message: "Failed to fetch customer billing previews" });
    }
  });

  // Get individual customer by ID
  app.get("/api/customers/:id(\\d+)", requireAuthentication, async (req, res) => {
    try {
      const customerId = parseInt(req.params.id);
      
      // Validate customer ID is a valid number
      if (isNaN(customerId) || customerId <= 0) {
        return res.status(400).json({ message: "Invalid customer ID" });
      }
      
      const customer = await storage.getCustomerById(customerId);
      
      if (!customer) {
        return res.status(404).json({ message: "Customer not found" });
      }
      
      res.json(applyBillingNotesVisibility(req, customer));
    } catch (error) {
      console.error("Error fetching customer:", error);
      res.status(500).json({ message: "Failed to fetch customer" });
    }
  });

  // Get customer billing data - all work orders, billing sheets, and estimates for a customer
  app.get("/api/customers/:id(\\d+)/billing", requireAuthentication, async (req, res) => {
    try {
      const customerId = parseInt(req.params.id);
      
      // Validate customer ID is a valid number
      if (isNaN(customerId) || customerId <= 0) {
        return res.status(400).json({ message: "Invalid customer ID" });
      }
      
      // Get customer details
      const customer = await storage.getCustomerById(customerId);
      if (!customer) {
        return res.status(404).json({ message: "Customer not found" });
      }

      // Get all work orders for the customer
      const allWorkOrders = await storage.getWorkOrders();
      const rawWorkOrders = allWorkOrders.filter(wo => wo.customerId === customerId);

      // Get all billing sheets for the customer
      const allBillingSheets = await storage.getAllBillingSheets();
      const rawBillingSheets = allBillingSheets.filter(bs => bs.customerId === customerId);

      // Get all estimates for the customer
      const allEstimates = await storage.getEstimates();
      const rawEstimates = allEstimates.filter(est => est.customerId === customerId);

      // Transform work orders to match frontend expectations.
      // Use the stored financial snapshot as the source of truth.
      // Historical backfill guardrail: if laborSubtotal is null (pre-fix record),
      // fall back to totalAmount for the total but do not fabricate breakdown detail.
      const workOrders = rawWorkOrders.map(wo => {
        const hasBreakdown = wo.laborSubtotal != null;
        const laborCost = hasBreakdown ? parseFloat(wo.laborSubtotal || '0') : null;
        const partsCost = hasBreakdown ? parseFloat(wo.partsSubtotal || '0') : null;
        const storedTotal = parseFloat(wo.totalAmount || '0');
        
        return {
          ...wo,
          // For pre-fix records without a stored breakdown, set component fields to 0.
          // UI guards on hasFinancialBreakdown and uses totalAmount as authoritative total.
          laborCost: laborCost !== null ? laborCost : 0,
          partsCost: partsCost !== null ? partsCost : 0,
          totalAmount: storedTotal.toString(),
          hasFinancialBreakdown: hasBreakdown,
          assignedTo: wo.assignedTechnicianName || 'Unassigned',
          description: wo.description || wo.workSummary || '',
          billedDate: null,
          completedDate: wo.completedAt
        };
      });

      // Transform billing sheets to match frontend expectations
      const billingSheets = rawBillingSheets.map(bs => {
        const laborAmount = parseFloat(bs.laborSubtotal || '0') || 0;
        const partsAmount = parseFloat(bs.partsSubtotal || '0') || 0;
        const storedTotal = parseFloat(bs.totalAmount || String(laborAmount + partsAmount));
        
        return {
          ...bs,
          laborCost: laborAmount,
          partsCost: partsAmount,
          totalAmount: storedTotal.toString(),
          description: bs.workDescription || '',
          billedDate: null,
          completedDate: bs.workDate
        };
      });

      // Transform estimates to match frontend expectations
      const estimates = rawEstimates.map(est => ({
        ...est,
        laborCost: 0, // Calculate if needed
        partsCost: 0, // Calculate if needed  
        description: est.projectName || '',
        billedDate: null,
        completedDate: est.updatedAt
      }));

      // Filter unbilled work: only approved_passed_to_billing tickets surface to billing intake
      const unbilledWorkOrders = workOrders.filter(wo => 
        (wo.status === 'approved_passed_to_billing') && !wo.invoiceId
      );
      // A non-null invoiceId is the authoritative signal that a billing sheet has
      // been billed — exclude it from unbilled regardless of status value.
      const unbilledBillingSheets = billingSheets.filter(bs => 
        (bs.status === 'approved_passed_to_billing') && !bs.invoiceId
      );

      // Calculate total unbilled amount
      const totalUnbilledAmount = 
        unbilledWorkOrders.reduce((sum, wo) => sum + parseFloat(wo.totalAmount || '0'), 0) +
        unbilledBillingSheets.reduce((sum, bs) => sum + parseFloat(bs.totalAmount || '0'), 0);

      const billingData = {
        customer: applyBillingNotesVisibility(req, customer),
        workOrders,
        billingSheets,
        estimates,
        unbilledWorkOrders,
        unbilledBillingSheets,
        totalUnbilledAmount
      };

      res.json(billingData);
    } catch (error) {
      console.error("Error fetching customer billing data:", error);
      res.status(500).json({ message: "Failed to fetch customer billing data" });
    }
  });

  // Customer site maps routes
  // Get all site maps (for overview display)
  app.get("/api/site-maps", requireSiteMapViewAccess, async (req, res) => {
    try {
      const siteMaps = await storage.getAllSiteMaps();
      res.json(siteMaps);
    } catch (error) {
      console.error("Error fetching all site maps:", error);
      res.status(500).json({ message: "Failed to fetch site maps" });
    }
  });

  app.get("/api/customers/:customerId(\\d+)/site-maps", requireSiteMapViewAccess, async (req, res) => {
    try {
      const customerId = parseInt(req.params.customerId);
      const siteMaps = await storage.getCustomerSiteMaps(customerId);
      res.json(siteMaps);
    } catch (error) {
      console.error("Error fetching customer site maps:", error);
      res.status(500).json({ message: "Failed to fetch customer site maps" });
    }
  });

  app.get("/api/site-maps/:siteMapId/controllers", requireSiteMapViewAccess, async (req, res) => {
    try {
      const siteMapId = parseInt(req.params.siteMapId);
      const controllers = await storage.getSiteMapControllers(siteMapId);
      res.json(controllers);
    } catch (error) {
      console.error("Error fetching site map controllers:", error);
      res.status(500).json({ message: "Failed to fetch site map controllers" });
    }
  });

  app.get("/api/site-maps/:siteMapId/zones", requireSiteMapViewAccess, async (req, res) => {
    try {
      const siteMapId = parseInt(req.params.siteMapId);
      const zones = await storage.getSiteMapZones(siteMapId);
      res.json(zones);
    } catch (error) {
      console.error("Error fetching site map zones:", error);
      res.status(500).json({ message: "Failed to fetch site map zones" });
    }
  });

  app.post("/api/customers/:customerId/site-maps", requireCompanyAdminAccess, async (req: any, res) => {
    try {
      const customerId = parseInt(req.params.customerId);
      
      // Get user's company ID - production-ready approach
      let companyId = req.userCompanyId; // Set by middleware if using session
      
      // Fallback to header-based approach for development
      if (!companyId) {
        const userCompanyId = req.headers['x-user-company-id'];
        companyId = userCompanyId ? parseInt(userCompanyId as string) : null;
      }
      
      if (!companyId) {
        return res.status(400).json({ 
          message: "User company information not available" 
        });
      }
      
      // Validate the request body
      const validatedData = insertSiteMapSchema.parse({
        ...req.body,
        customerId,
        companyId // Use the authenticated user's company ID
      });
      
      const siteMap = await storage.createSiteMap(validatedData);
      res.status(201).json(siteMap);
    } catch (error) {
      console.error("Error creating site map:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ 
          message: "Invalid site map data", 
          errors: error.errors 
        });
      }
      res.status(500).json({ message: "Failed to create site map" });
    }
  });

  app.put("/api/site-maps/:siteMapId", requireCompanyAdminAccess, async (req, res) => {
    try {
      const siteMapId = parseInt(req.params.siteMapId);
      
      // Validate the request body
      const validatedData = insertSiteMapSchema.partial().parse(req.body);
      
      const siteMap = await storage.updateSiteMap(siteMapId, validatedData);
      if (!siteMap) {
        return res.status(404).json({ message: "Site map not found" });
      }
      
      res.json(siteMap);
    } catch (error) {
      console.error("Error updating site map:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ 
          message: "Invalid site map data", 
          errors: error.errors 
        });
      }
      res.status(500).json({ message: "Failed to update site map" });
    }
  });

  app.delete("/api/site-maps/:siteMapId", requireCompanyAdminAccess, async (req, res) => {
    try {
      const siteMapId = parseInt(req.params.siteMapId);
      const success = await storage.deleteSiteMap(siteMapId);
      
      if (!success) {
        return res.status(404).json({ message: "Site map not found" });
      }
      
      res.json({ message: "Site map deleted successfully" });
    } catch (error) {
      console.error("Error deleting site map:", error);
      res.status(500).json({ message: "Failed to delete site map" });
    }
  });

  app.post("/api/site-maps/:siteMapId/controllers", requireCompanyAdminAccess, async (req: any, res) => {
    try {
      const siteMapId = parseInt(req.params.siteMapId);
      const controllers = req.body.controllers;
      
      if (!Array.isArray(controllers)) {
        return res.status(400).json({ message: "Controllers must be an array" });
      }
      
      // Get user's company ID - production-ready approach
      let companyId = req.userCompanyId; // Set by middleware if using session
      
      // Fallback to header-based approach for development
      if (!companyId) {
        const userCompanyId = req.headers['x-user-company-id'];
        companyId = userCompanyId ? parseInt(userCompanyId as string) : null;
      }
      
      if (!companyId) {
        return res.status(400).json({ 
          message: "User company information not available" 
        });
      }
      
      const savedControllers = await storage.saveControllers(siteMapId, controllers, companyId);
      res.json(savedControllers);
    } catch (error) {
      console.error("Error saving controllers:", error);
      res.status(500).json({ message: "Failed to save controllers" });
    }
  });

  app.post("/api/site-maps/:siteMapId/zones", requireCompanyAdminAccess, async (req: any, res) => {
    try {
      const siteMapId = parseInt(req.params.siteMapId);
      const zones = req.body.zones;
      
      if (!Array.isArray(zones)) {
        return res.status(400).json({ message: "Zones must be an array" });
      }
      
      // Get user's company ID - production-ready approach
      let companyId = req.userCompanyId; // Set by middleware if using session
      
      // Fallback to header-based approach for development
      if (!companyId) {
        const userCompanyId = req.headers['x-user-company-id'];
        companyId = userCompanyId ? parseInt(userCompanyId as string) : null;
      }
      
      if (!companyId) {
        return res.status(400).json({ 
          message: "User company information not available" 
        });
      }
      
      const savedZones = await storage.saveZones(siteMapId, zones, companyId);
      res.json(savedZones);
    } catch (error) {
      console.error("Error saving zones:", error);
      res.status(500).json({ message: "Failed to save zones" });
    }
  });

  // Invoice preview (no creation, just calculation)
  app.post("/api/invoices/preview", requireAuthentication, async (req, res) => {
    try {
      const { customerId, workOrderIds = [], billingSheetIds = [] } = req.body;
      
      // Get customer details
      const customer = await storage.getCustomerById(customerId);
      if (!customer) {
        return res.status(404).json({ message: "Customer not found" });
      }

      // Get all work orders for the customer
      const allWorkOrders = await storage.getWorkOrders();
      const workOrders = allWorkOrders.filter(wo => wo.customerId === customerId);

      // Get all billing sheets for the customer
      const allBillingSheets = await storage.getAllBillingSheets();
      const billingSheets = allBillingSheets.filter(bs => bs.customerId === customerId);

      // Filter to only include selected items
      let selectedWorkOrders: (typeof allWorkOrders)[number][] = [];
      let selectedBillingSheets: (typeof allBillingSheets)[number][] = [];

      if (workOrderIds.length > 0) {
        selectedWorkOrders = workOrders.filter(wo => 
          workOrderIds.includes(wo.id) && 
          (wo.status === 'approved_passed_to_billing') && 
          !wo.invoiceId
        );
      }

      if (billingSheetIds.length > 0) {
        selectedBillingSheets = billingSheets.filter(bs => 
          billingSheetIds.includes(bs.id) && 
          (bs.status === 'approved_passed_to_billing') && 
          !bs.invoiceId
        );
      }

      // If no specific items selected, fall back to all approved unbilled items
      if (workOrderIds.length === 0 && billingSheetIds.length === 0) {
        selectedWorkOrders = workOrders.filter(wo => 
          (wo.status === 'approved_passed_to_billing') && !wo.invoiceId
        );
        selectedBillingSheets = billingSheets.filter(bs => 
          (bs.status === 'approved_passed_to_billing') && !bs.invoiceId
        );
      }

      if (selectedWorkOrders.length === 0 && selectedBillingSheets.length === 0) {
        return res.status(400).json({ message: "No valid items selected for invoicing" });
      }

      // Create preview invoice data using stored financial snapshots
      const currentDate = new Date();
      const invoiceNumber = `PREVIEW-${currentDate.getFullYear()}${(currentDate.getMonth() + 1).toString().padStart(2, '0')}${currentDate.getDate().toString().padStart(2, '0')}-${customerId.toString().padStart(4, '0')}`;
      
      // Use stored totals from each work order as the source of truth.
      // Historical backfill guardrail: if laborSubtotal is null (pre-fix record),
      // use totalAmount for the total but show no breakdown detail.
      const laborSubtotal = 
        selectedWorkOrders.reduce((sum, wo) => sum + parseFloat(wo.laborSubtotal || '0'), 0) +
        selectedBillingSheets.reduce((sum, bs) => sum + parseFloat(bs.laborSubtotal || '0'), 0);
      
      const partsSubtotal = 
        selectedWorkOrders.reduce((sum, wo) => sum + parseFloat(wo.partsSubtotal || '0'), 0) +
        selectedBillingSheets.reduce((sum, bs) => sum + parseFloat(bs.partsSubtotal || '0'), 0);

      // Total is the sum of stored totalAmount per work order + stored totalAmount per billing sheet
      const totalAmount = 
        selectedWorkOrders.reduce((sum, wo) => sum + parseFloat(wo.totalAmount || '0'), 0) +
        selectedBillingSheets.reduce((sum, bs) => sum + parseFloat(bs.totalAmount || '0'), 0);

      // Create preview items
      const previewItems = [];

      // Add work order items — use stored financial breakdown
      for (const workOrder of selectedWorkOrders) {
        const woLaborAmount = parseFloat(workOrder.laborSubtotal || '0');
        const woPartsAmount = parseFloat(workOrder.partsSubtotal || '0');
        const woTotal = parseFloat(workOrder.totalAmount || '0');
        const appliedLaborRate = parseFloat(workOrder.appliedLaborRate || workOrder.laborRate || '0');
        previewItems.push({
          sourceType: 'work_order',
          sourceId: workOrder.id,
          description: `Work Order ${workOrder.workOrderNumber} - ${workOrder.projectName}`,
          workDate: workOrder.completedAt || workOrder.createdAt,
          technicianName: workOrder.assignedTechnicianName || 'Unknown',
          laborHours: parseFloat(workOrder.totalHours || '0'),
          laborRate: appliedLaborRate,
          laborAmount: woLaborAmount,
          partsAmount: woPartsAmount,
          totalAmount: woTotal,
          hasBreakdown: workOrder.laborSubtotal != null
        });
      }

      // Add billing sheet items
      for (const billingSheet of selectedBillingSheets) {
        previewItems.push({
          sourceType: 'billing_sheet',
          sourceId: billingSheet.id,
          description: `Billing Sheet ${billingSheet.billingNumber} - ${billingSheet.workDescription}`,
          workDate: billingSheet.workDate,
          technicianName: billingSheet.technicianName,
          laborHours: parseFloat(billingSheet.totalHours || '0'),
          laborRate: parseFloat(billingSheet.laborRate || '0'),
          laborAmount: parseFloat(billingSheet.laborSubtotal || '0'),
          partsAmount: parseFloat(billingSheet.partsSubtotal || '0'),
          totalAmount: parseFloat(billingSheet.laborSubtotal || '0') + parseFloat(billingSheet.partsSubtotal || '0')
        });
      }

      // Return preview data
      const previewData = {
        invoiceNumber,
        customerId,
        customerName: customer.name,
        customerEmail: customer.email,
        customerPhone: customer.phone || null,
        periodStart: new Date(currentDate.getFullYear(), currentDate.getMonth(), 1),
        periodEnd: new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0),
        partsSubtotal: partsSubtotal.toFixed(2),
        laborSubtotal: laborSubtotal.toFixed(2),
        totalAmount: totalAmount.toFixed(2),
        items: previewItems,
        itemCount: selectedWorkOrders.length + selectedBillingSheets.length
      };

      res.json(previewData);
    } catch (error) {
      console.error("Error creating invoice preview:", error);
      res.status(500).json({ message: "Failed to create invoice preview" });
    }
  });

  // Create monthly invoice for customer - consolidates selected or all unbilled work
  app.post("/api/invoices/monthly", requireAuthentication, async (req, res) => {
    try {
      const { customerId, workOrderIds = [], billingSheetIds = [], periodStart: periodStartInput, periodEnd: periodEndInput } = req.body;

      // Pre-flight: verify QuickBooks connection before doing anything
      // req.authenticatedUserCompanyId is set by requireAuthentication middleware from the x-user-company-id header
      const userCompanyId = req.authenticatedUserCompanyId ? req.authenticatedUserCompanyId.toString() : null;
      const qbLookup = userCompanyId ? await storage.getQuickBooksIntegrationByCompanyId(userCompanyId) : null;
      const integration = qbLookup?.realmId ? await storage.getQuickBooksIntegration(qbLookup.realmId) : null;
      if (!integration || !integration.accessToken) {
        return res.status(400).json({
          message: "QuickBooks is not connected. Please connect QuickBooks before creating invoices.",
          quickbooksError: "QuickBooks integration is not configured or the access token is missing. Go to the QuickBooks section to connect your account."
        });
      }

      // Abort early if connection is already marked as reconnect_required — do not attempt any refresh
      if (integration.connectionStatus === 'reconnect_required') {
        return res.status(400).json({
          message: "QuickBooks reauthorization is required. Please reconnect QuickBooks.",
          quickbooksError: integration.reconnectRequiredReason || "QuickBooks connection requires reauthorization.",
          reconnectRequired: true
        });
      }

      // Proactively refresh if token is expired or within 5-minute buffer
      if (integration.expiresAt && new Date(integration.expiresAt) <= new Date(Date.now() + 5 * 60 * 1000)) {
        const tokenActuallyExpired = new Date(integration.expiresAt) <= new Date();
        console.log(`QuickBooks access token ${tokenActuallyExpired ? 'expired' : 'expiring soon'}, attempting proactive refresh...`);
        if (!integration.refreshToken) {
          if (tokenActuallyExpired) {
            return res.status(400).json({
              message: "QuickBooks session has expired and cannot be refreshed. Please reconnect QuickBooks.",
              quickbooksError: "Your QuickBooks session has expired. Go to the QuickBooks section to reconnect your account."
            });
          }
          console.warn('QuickBooks refresh token missing during buffer window; proceeding with existing token');
        } else {
          const proactiveRealmId = integration.realmId || 'default';
          try {
            const newAccessToken = await withQbRefreshLock(proactiveRealmId, async (signal) => {
              // Re-read from storage by realmId so we get the latest rotated token
              // (another concurrent caller that held the lock may have already refreshed it)
              const fresh = await storage.getQuickBooksIntegration(proactiveRealmId);
              if (!fresh) {
                throw new Error(`[QB proactive refresh] Integration for realmId=${proactiveRealmId} not found; cannot refresh`);
              }
              // Bail out if another caller marked this as reconnect_required while we waited for the lock
              if (fresh.connectionStatus === 'reconnect_required') {
                throw new QbRefreshError(
                  `Connection already marked as reconnect_required for realmId=${proactiveRealmId}`,
                  'reconnect_required'
                );
              }
              const refreshTokenToUse = fresh.refreshToken;

              const newTokenData = await refreshQuickBooksToken(refreshTokenToUse, signal, { realmId: proactiveRealmId, calledFrom: 'monthlyInvoice/proactive' });
              const expiresInSeconds = newTokenData.expires_in && newTokenData.expires_in > 0 ? newTokenData.expires_in : 3600;
              const refreshSuccessAt = new Date();

              // Persist before releasing lock so waiters always see the rotated token
              await storage.saveQuickBooksIntegration({
                companyId: integration.companyId,
                accessToken: newTokenData.access_token,
                refreshToken: newTokenData.refresh_token,
                realmId: proactiveRealmId,
                expiresAt: new Date(Date.now() + expiresInSeconds * 1000),
                lastRefreshAttempt: refreshSuccessAt,
                lastRefreshSuccess: refreshSuccessAt,
              });

              return newTokenData.access_token;
            });

            // Re-read the fully persisted integration by realmId so downstream code sees the rotated token
            const refreshed = await storage.getQuickBooksIntegration(proactiveRealmId);
            if (refreshed) {
              integration.accessToken = refreshed.accessToken;
              integration.refreshToken = refreshed.refreshToken;
              integration.expiresAt = refreshed.expiresAt;
            } else {
              integration.accessToken = newAccessToken;
            }
            console.log('Proactive QuickBooks token refresh succeeded');
          } catch (refreshErr) {
            console.error('Proactive QuickBooks token refresh failed:', refreshErr);
            // Classify and persist reconnect_required for unrecoverable failures
            if (refreshErr instanceof QbRefreshError) {
              const unrecoverable = refreshErr.category === 'stale_refresh_token'
                || refreshErr.category === 'revoked'
                || refreshErr.category === 'reconnect_required';
              if (unrecoverable) {
                const reason = buildReconnectReason(refreshErr.category);
                await storage.markQuickBooksReconnectRequired(proactiveRealmId, reason).catch((e) => {
                  console.error('Failed to persist reconnect_required state:', e);
                });
                console.warn(`[QB] Marked realmId=${proactiveRealmId} as reconnect_required (${refreshErr.category})`);
                return res.status(400).json({
                  message: "QuickBooks authorization has expired. Please reconnect QuickBooks to continue.",
                  quickbooksError: reason,
                  reconnectRequired: true
                });
              }
            }
            if (tokenActuallyExpired) {
              return res.status(400).json({
                message: "QuickBooks session has expired and could not be refreshed. Please reconnect QuickBooks.",
                quickbooksError: "Your QuickBooks session has expired. Go to the QuickBooks section to reconnect your account."
              });
            }
            console.warn('Proactive refresh failed within buffer window; proceeding with existing token — makeQuickBooksRequest will retry on 401');
          }
        }
      }

      // Get customer details
      const customer = await storage.getCustomerById(customerId);
      if (!customer) {
        return res.status(404).json({ message: "Customer not found" });
      }

      // Get all work orders for the customer
      const allWorkOrders = await storage.getWorkOrders();
      const workOrders = allWorkOrders.filter(wo => wo.customerId === customerId);

      // Get all billing sheets for the customer
      const allBillingSheets = await storage.getAllBillingSheets();
      const billingSheets = allBillingSheets.filter(bs => bs.customerId === customerId);

      // Filter to only include selected items
      let selectedWorkOrders: (typeof allWorkOrders)[number][] = [];
      let selectedBillingSheets: (typeof allBillingSheets)[number][] = [];

      if (workOrderIds.length > 0) {
        selectedWorkOrders = workOrders.filter(wo => 
          workOrderIds.includes(wo.id) && 
          (wo.status === 'approved_passed_to_billing') && 
          !wo.invoiceId
        );
      }

      if (billingSheetIds.length > 0) {
        selectedBillingSheets = billingSheets.filter(bs => 
          billingSheetIds.includes(bs.id) && 
          (bs.status === 'approved_passed_to_billing') && 
          !bs.invoiceId
        );
      }

      // If no specific items selected, fall back to all approved unbilled items
      if (workOrderIds.length === 0 && billingSheetIds.length === 0) {
        selectedWorkOrders = workOrders.filter(wo => 
          (wo.status === 'approved_passed_to_billing') && !wo.invoiceId
        );
        selectedBillingSheets = billingSheets.filter(bs => 
          (bs.status === 'approved_passed_to_billing') && !bs.invoiceId
        );
      }

      if (selectedWorkOrders.length === 0 && selectedBillingSheets.length === 0) {
        return res.status(400).json({ message: "No valid items selected for invoicing" });
      }

      // Create the consolidated monthly invoice
      const currentDate = new Date();
      const invoiceNumber = `${Date.now().toString().slice(-5)}`;

      // Resolve billing period — use caller-supplied dates or fall back to current calendar month
      let periodStart: Date;
      let periodEnd: Date;
      if (periodStartInput && periodEndInput) {
        const parseLocalDate = (dateStr: string): Date => {
          const parts = dateStr.split("-");
          if (parts.length !== 3) return new Date(NaN);
          const year = parseInt(parts[0], 10);
          const month = parseInt(parts[1], 10);
          const day = parseInt(parts[2], 10);
          return new Date(year, month - 1, day);
        };
        const parsedStart = parseLocalDate(periodStartInput);
        const parsedEnd = parseLocalDate(periodEndInput);
        if (isNaN(parsedStart.getTime()) || isNaN(parsedEnd.getTime())) {
          return res.status(400).json({ message: "Invalid periodStart or periodEnd date value." });
        }
        if (parsedStart > parsedEnd) {
          return res.status(400).json({ message: "periodStart must not be after periodEnd." });
        }
        periodStart = parsedStart;
        periodEnd = new Date(parsedEnd.getFullYear(), parsedEnd.getMonth(), parsedEnd.getDate(), 23, 59, 59);
      } else {
        periodStart = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
        periodEnd = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0, 23, 59, 59);
      }
      
      // Use stored financial snapshots as the source of truth.
      // Historical backfill guardrail: if laborSubtotal is null (pre-fix record),
      // laborSubtotal/partsSubtotal will aggregate as 0 but totalAmount is authoritative.
      const laborSubtotal = 
        selectedWorkOrders.reduce((sum, wo) => sum + parseFloat(wo.laborSubtotal || '0'), 0) +
        selectedBillingSheets.reduce((sum, bs) => sum + parseFloat(bs.laborSubtotal || '0'), 0);
      
      const partsSubtotal = 
        selectedWorkOrders.reduce((sum, wo) => sum + parseFloat(wo.partsSubtotal || '0'), 0) +
        selectedBillingSheets.reduce((sum, bs) => sum + parseFloat(bs.partsSubtotal || '0'), 0);
      
      const totalAmount = 
        selectedWorkOrders.reduce((sum, wo) => sum + parseFloat(wo.totalAmount || '0'), 0) +
        selectedBillingSheets.reduce((sum, bs) => sum + parseFloat(bs.totalAmount || '0'), 0);

      // Create the invoice record (not yet marking items as billed)
      let invoice = await storage.createInvoice({
        invoiceNumber,
        customerId,
        customerName: customer.name,
        customerEmail: customer.email,
        customerPhone: customer.phone || null,
        invoiceMonth: periodStart.getMonth() + 1,
        invoiceYear: periodStart.getFullYear(),
        periodStart,
        periodEnd,
        laborSubtotal: laborSubtotal.toFixed(2),
        partsSubtotal: partsSubtotal.toFixed(2),
        totalAmount: totalAmount.toFixed(2),
        status: 'generated',
      });

      if (!invoice) {
        throw new Error("Failed to create invoice");
      }

      // Create invoice items for work orders (without marking as billed yet)
      for (const workOrder of selectedWorkOrders) {
        const woLaborAmount = parseFloat(workOrder.laborSubtotal || '0');
        const woPartsAmount = parseFloat(workOrder.partsSubtotal || '0');
        const woTotalAmount = parseFloat(workOrder.totalAmount || '0');
        const woAppliedLaborRate = parseFloat(workOrder.appliedLaborRate || workOrder.laborRate || '0');
        
        await storage.createInvoiceItem({
          invoiceId: invoice.id,
          sourceType: 'work_order',
          sourceId: workOrder.id,
          workOrderId: workOrder.id,
          description: `Work Order ${workOrder.workOrderNumber} - ${workOrder.projectName}`,
          workDate: workOrder.completedAt || workOrder.createdAt,
          laborHours: (parseFloat(workOrder.totalHours || '0')).toString(),
          laborRate: woAppliedLaborRate.toFixed(2),
          laborTotal: woLaborAmount.toString(),
          quantity: '1',
          unitPrice: woTotalAmount.toString(),
          totalPrice: woTotalAmount.toString()
        });
      }

      // Create invoice items for billing sheets (without marking as billed yet)
      for (const billingSheet of selectedBillingSheets) {
        await storage.createInvoiceItem({
          invoiceId: invoice.id,
          sourceType: 'billing_sheet',
          sourceId: billingSheet.id,
          billingSheetId: billingSheet.id,
          description: `Billing Sheet ${billingSheet.billingNumber} - ${billingSheet.workDescription}`,
          workDate: billingSheet.workDate,
          laborHours: (parseFloat(billingSheet.totalHours || '0')).toString(),
          laborRate: (parseFloat(billingSheet.laborRate || '0')).toString(),
          laborTotal: (parseFloat(billingSheet.laborSubtotal || '0')).toString(),
          quantity: '1',
          unitPrice: (parseFloat(billingSheet.laborSubtotal || '0') + parseFloat(billingSheet.partsSubtotal || '0')).toString(),
          totalPrice: (parseFloat(billingSheet.laborSubtotal || '0') + parseFloat(billingSheet.partsSubtotal || '0')).toString()
        });
      }

      // Send invoice to QuickBooks
      let quickbooksId = null;
      let quickbooksError = null;

      try {
        console.log("Creating invoice in QuickBooks...");
        
        const apiBase = process.env.NODE_ENV === 'production' 
          ? 'https://quickbooks.api.intuit.com' 
          : 'https://sandbox-quickbooks.api.intuit.com';
        
        // Look up the QB Service item ID dynamically (shared helper)
        const qbServiceItem = await lookupQBServiceItem(apiBase, integration.realmId, integration.accessToken);
        if (!qbServiceItem) {
          throw new Error(
            `Could not find the QuickBooks item "${QB_SERVICE_ITEM_NAME}". ` +
            `Please create an active Service-type item with that exact name in QuickBooks and try again.`
          );
        }
        const resolvedItemId = qbServiceItem.id;
        const resolvedItemName = qbServiceItem.name;
        console.log(`[QB] Resolved service item: ${resolvedItemId} (${resolvedItemName})`);

        const qbLineItems = [];
        
        for (const workOrder of selectedWorkOrders) {
          // Use the stored totalAmount as the authoritative QB line amount
          const totalLineAmount = parseFloat(workOrder.totalAmount || '0');
          const appliedLaborRate = parseFloat(workOrder.appliedLaborRate || workOrder.laborRate || '0');
          const partsAmount = parseFloat(workOrder.partsSubtotal || workOrder.totalPartsCost || '0');
          
          if (totalLineAmount > 0) {
            qbLineItems.push({
              Amount: totalLineAmount,
              DetailType: "SalesItemLineDetail",
              SalesItemLineDetail: {
                ItemRef: {
                  value: resolvedItemId,
                  name: resolvedItemName
                },
                UnitPrice: totalLineAmount,
                Qty: 1
              },
              Description: `WO-${workOrder.workOrderNumber} - ${workOrder.projectName} (${workOrder.totalHours}h labor @ $${appliedLaborRate.toFixed(2)}/h, $${partsAmount.toFixed(2)} parts)`
            });
          }
        }

        for (const billingSheet of selectedBillingSheets) {
          const lineTotal = parseFloat(billingSheet.laborSubtotal || '0') + parseFloat(billingSheet.partsSubtotal || '0');
          if (lineTotal > 0) {
            qbLineItems.push({
              Amount: lineTotal,
              DetailType: "SalesItemLineDetail", 
              SalesItemLineDetail: {
                ItemRef: {
                  value: resolvedItemId,
                  name: resolvedItemName
                },
                UnitPrice: lineTotal,
                Qty: 1
              },
              Description: `BS-${billingSheet.billingNumber} - ${parseFloat(billingSheet.totalHours || '0')}h labor @ $${parseFloat(billingSheet.laborRate || '0').toFixed(2)}/h, $${parseFloat(billingSheet.partsSubtotal || '0').toFixed(2)} parts`
            });
          }
        }

        if (!customer.quickbooksId) {
          throw new Error(
            `Customer "${customer.name}" has not been synced to QuickBooks. ` +
            'Please sync this customer in the Customers section and try again.'
          );
        }

        const invoiceData = {
          Line: qbLineItems,
          CustomerRef: {
            value: customer.quickbooksId
          },
          DocNumber: invoiceNumber,
          TxnDate: currentDate.toISOString().split('T')[0],
          DueDate: new Date(currentDate.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
        };

        console.log("Sending invoice to QuickBooks:", JSON.stringify(invoiceData, null, 2));

        const invoiceResponse = await makeQuickBooksRequest(`${apiBase}/v3/company/${integration.realmId}/invoice`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${integration.accessToken}`,
            'Accept': 'application/json',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(invoiceData)
        }, 'Monthly Invoice Creation', integration.realmId);

        if (invoiceResponse.ok) {
          const invoiceResult = await invoiceResponse.json();
          quickbooksId = invoiceResult?.QueryResponse?.Invoice?.[0]?.Id || invoiceResult?.Invoice?.Id;
          console.log("Successfully created invoice in QuickBooks with ID:", quickbooksId);

          const qbDocNumber: string | undefined = invoiceResult?.Invoice?.DocNumber;
          const qbUpdateFields: Partial<InsertInvoice> & { invoiceNumber?: string } = {};
          if (quickbooksId) qbUpdateFields.quickbooksInvoiceId = quickbooksId.toString();
          if (qbDocNumber) {
            qbUpdateFields.invoiceNumber = qbDocNumber;
            console.log(`[QB] Syncing invoice number from QB DocNumber: ${qbDocNumber}`);
          }
          if (Object.keys(qbUpdateFields).length > 0) {
            const updated = await storage.updateInvoice(invoice.id, qbUpdateFields);
            if (updated) {
              invoice = updated;
            }
          }
        } else {
          const errorText = await invoiceResponse.text();
          const intuitTid = invoiceResponse.headers.get('intuit_tid');
          console.error('[QB] Monthly invoice creation failed:', invoiceResponse.status, invoiceResponse.statusText);
          console.error('[QB] Full error body:', errorText);
          if (intuitTid) console.error('[QB] TID:', intuitTid);

          if (errorText.includes('InvalidRef') || errorText.includes('Customer')) {
            quickbooksError = `Customer not found in QuickBooks. Please sync this customer first.${intuitTid ? ` [TID: ${intuitTid}]` : ''}`;
          } else {
            quickbooksError = `QuickBooks API Error: ${invoiceResponse.status} ${invoiceResponse.statusText}${intuitTid ? ` [TID: ${intuitTid}]` : ''}`;
          }
        }
      } catch (qbError: any) {
        console.error('Error connecting to QuickBooks:', qbError);
        quickbooksError = `QuickBooks connection error: ${qbError.message}`;
      }

      // If QuickBooks failed, roll back the local invoice and items
      if (quickbooksError) {
        console.log(`Rolling back local invoice ${invoice.id} due to QuickBooks failure`);
        try {
          await storage.deleteInvoiceItemsByInvoiceId(invoice.id);
          await storage.deleteInvoice(invoice.id);
        } catch (rollbackError) {
          console.error('Error during invoice rollback:', rollbackError);
        }
        return res.status(502).json({
          message: "Failed to create invoice in QuickBooks. No items were billed. Please try again.",
          quickbooksError
        });
      }

      // QuickBooks succeeded — now mark items as billed
      for (const workOrder of selectedWorkOrders) {
        await storage.updateWorkOrder(workOrder.id, { 
          invoiceId: invoice.id,
          billedAt: currentDate,
          status: 'billed'
        });
      }

      for (const billingSheet of selectedBillingSheets) {
        await storage.updateBillingSheet(billingSheet.id, { 
          invoiceId: invoice.id,
          billedAt: currentDate,
          status: 'billed'
        });
      }

      // Reconciliation: ensure any billing sheet that is an invoice line item
      // but was missed by the status update loop is also marked as billed.
      try {
        const invoiceItemsForReconciliation = await storage.getInvoiceItems(invoice.id);
        for (const item of invoiceItemsForReconciliation) {
          if (item.sourceType === 'billing_sheet' && item.sourceId) {
            const bs = await storage.getBillingSheetById(item.sourceId);
            if (bs && !bs.invoiceId) {
              await storage.updateBillingSheet(bs.id, {
                invoiceId: invoice.id,
                billedAt: currentDate,
                status: 'billed'
              });
              console.log(`Reconciliation: marked billing sheet ${bs.id} as billed for invoice ${invoice.id}`);
            }
          }
        }
      } catch (reconcileError) {
        console.error('Error during billing sheet reconciliation:', reconcileError);
      }

      // Generate invoice detail PDF automatically in background
      const pdfService = new InvoicePdfService(storage);
      pdfService.generateAndSaveInvoicePdf(invoice.id).then(result => {
        if (result.success) {
          console.log(`Invoice PDF generated successfully for invoice ${invoice.id}`);
        } else {
          console.error(`Failed to generate PDF for invoice ${invoice.id}:`, result.error);
        }
      }).catch(error => {
        console.error(`Error generating PDF for invoice ${invoice.id}:`, error);
      });

      res.json({
        message: "Monthly invoice created successfully and synced to QuickBooks",
        invoice,
        invoiceNumber: invoice.invoiceNumber,
        totalAmount: totalAmount.toFixed(2),
        itemCount: selectedWorkOrders.length + selectedBillingSheets.length,
        quickbooksId,
        quickbooksSuccess: true,
        quickbooksError: null
      });
    } catch (error) {
      console.error("Error creating monthly invoice:", error);
      res.status(500).json({ message: "Failed to create monthly invoice" });
    }
  });


  app.get("/api/customers/:id(\\d+)", requireAuthentication, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const customer = await storage.getCustomer(id);
      if (!customer) {
        return res.status(404).json({ message: "Customer not found" });
      }
      res.json(applyBillingNotesVisibility(req, customer));
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch customer" });
    }
  });

  app.post("/api/customers", requireCompanyAdminAccess, requireAuthentication, async (req, res) => {
    try {
      let customerData = insertCustomerSchema.parse(req.body);
      // Only billing_manager may set billingNotes at creation time
      if ('billingNotes' in customerData && req.authenticatedUserRole !== 'billing_manager') {
        const { billingNotes, ...rest } = customerData;
        customerData = rest as typeof customerData;
      }
      const customer = await storage.createCustomer(customerData);
      res.status(201).json(customer);
    } catch (error) {
      console.error('Customer creation error:', error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid customer data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to create customer" });
    }
  });

  app.put("/api/customers/:id", requireCustomerEditAccess, requireAuthentication, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      let customerData = insertCustomerSchema.partial().parse(req.body);
      // Only billing_manager may write billingNotes (use authenticated role, not raw header)
      if ('billingNotes' in customerData && req.authenticatedUserRole !== 'billing_manager') {
        const { billingNotes, ...rest } = customerData;
        customerData = rest;
      }
      const customer = await storage.updateCustomer(id, customerData);
      if (!customer) {
        return res.status(404).json({ message: "Customer not found" });
      }
      res.json(applyBillingNotesVisibility(req, customer));
    } catch (error) {
      console.error(error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid customer data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to update customer" });
    }
  });

  app.patch("/api/customers/:id", requireCustomerEditAccess, requireAuthentication, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      let customerData = insertCustomerSchema.partial().parse(req.body);
      // Only billing_manager may write billingNotes (use authenticated role, not raw header)
      if ('billingNotes' in customerData && req.authenticatedUserRole !== 'billing_manager') {
        const { billingNotes, ...rest } = customerData;
        customerData = rest;
      }
      const customer = await storage.updateCustomer(id, customerData);
      if (!customer) {
        return res.status(404).json({ message: "Customer not found" });
      }
      res.json(applyBillingNotesVisibility(req, customer));
    } catch (error) {
      console.error(error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid customer data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to update customer" });
    }
  });

  app.patch("/api/customers/:id/labor-rates", requireAuthentication, async (req, res) => {
    try {
      if (req.authenticatedUserRole !== 'company_admin') {
        return res.status(403).json({ message: "Access denied. Labor rate changes are restricted to company administrators." });
      }
      const id = parseInt(req.params.id);
      const laborRateSchema = z.object({
        laborRate: z.union([z.string(), z.number()]).optional(),
        emergencyLaborRate: z.union([z.string(), z.number()]).optional(),
      });
      const parsed = laborRateSchema.parse(req.body);
      const updateData: { laborRate?: string; emergencyLaborRate?: string } = {};
      if (parsed.laborRate !== undefined) updateData.laborRate = String(parsed.laborRate);
      if (parsed.emergencyLaborRate !== undefined) updateData.emergencyLaborRate = String(parsed.emergencyLaborRate);
      const customer = await storage.updateCustomer(id, updateData);
      if (!customer) {
        return res.status(404).json({ message: "Customer not found" });
      }
      res.json(customer);
    } catch (error) {
      console.error(error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid labor rate data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to update labor rates" });
    }
  });

  app.delete("/api/customers/:id", requireCompanyAdminAccess, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const success = await storage.deleteCustomer(id);
      if (!success) {
        return res.status(404).json({ message: "Customer not found" });
      }
      res.json({ message: "Customer deleted successfully" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to delete customer" });
    }
  });

  // Customer-related data endpoints
  app.get("/api/customers/:id(\\d+)/estimates", async (req, res) => {
    try {
      const customerId = parseInt(req.params.id);
      const estimates = await storage.getEstimatesByCustomer(customerId);
      res.json(estimates);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch customer estimates" });
    }
  });

  app.get("/api/customers/:id(\\d+)/work-orders", async (req, res) => {
    try {
      const customerId = parseInt(req.params.id);
      const workOrders = await storage.getWorkOrdersByCustomer(customerId);
      res.json(workOrders);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch customer work orders" });
    }
  });

  app.get("/api/customers/:id(\\d+)/billing-sheets", async (req, res) => {
    try {
      const customerId = parseInt(req.params.id);
      const billingSheets = await storage.getBillingSheetsByCustomer(customerId);
      res.json(billingSheets);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch customer billing sheets" });
    }
  });

  app.post("/api/customers/import-csv", requireCompanyAdminAccess, async (req, res) => {
    try {
      const file = req.files?.file;
      if (!file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      const csvData = file.data.toString();
      const lines = csvData.split('\n').filter((line: string) => line.trim());
      
      if (lines.length < 2) {
        return res.status(400).json({ message: "CSV file must contain at least a header and one data row" });
      }

      const headers = lines[0].split(',').map((h: string) => h.trim().replace(/"/g, ''));
      const rows = lines.slice(1);

      let imported = 0;
      let duplicates = 0;
      const errors: string[] = [];

      for (let i = 0; i < rows.length; i++) {
        try {
          const values = rows[i].split(',').map((v: string) => v.trim().replace(/"/g, ''));
          const customerData: any = {};

          // Map CSV columns to customer fields
          headers.forEach((header: string, index: number) => {
            if (values[index]) {
              switch (header.toLowerCase()) {
                case 'name':
                  customerData.name = values[index];
                  break;
                case 'email':
                  customerData.email = values[index];
                  break;
                case 'phone':
                  customerData.phone = values[index];
                  break;
                case 'address':
                  customerData.address = values[index];
                  break;
                case 'contracttype':
                  customerData.contractType = values[index];
                  break;
                case 'laborrate':
                  customerData.laborRate = values[index];
                  break;
                case 'discountpercent':
                  customerData.discountPercent = values[index];
                  break;
                case 'paymentterms':
                  customerData.paymentTerms = values[index];
                  break;
                case 'notes':
                  customerData.notes = values[index];
                  break;
              }
            }
          });

          // Validate required fields
          if (!customerData.name || !customerData.email) {
            errors.push(`Row ${i + 2}: Missing required fields (name, email)`);
            continue;
          }

          // Check for duplicate email
          const existingCustomer = await storage.getCustomers();
          const duplicate = existingCustomer.find(c => c.email === customerData.email);
          if (duplicate) {
            duplicates++;
            continue;
          }

          // Validate and create customer
          const validatedData = insertCustomerSchema.parse(customerData);
          await storage.createCustomer(validatedData);
          imported++;

        } catch (error) {
          console.error(error);
          errors.push(`Row ${i + 2}: ${error instanceof Error ? error.message : 'Invalid data'}`);
        }
      }

      res.json({
        success: errors.length === 0,
        imported,
        duplicates,
        errors
      });

    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to import CSV" });
    }
  });

  // Parts routes
  // Get popular parts (frequently used) - this must come before /api/parts/:id
  app.get("/api/parts/popular", requireAuthentication, async (req, res) => {
    try {
      const companyId = req.authenticatedUserCompanyId || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const popularParts = await storage.getPopularParts(companyId, limit);
      res.json(popularParts);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch popular parts" });
    }
  });

  app.get("/api/parts/search", async (req, res) => {
    try {
      const query = req.query.q as string;
      if (!query) {
        return res.status(400).json({ message: "Search query is required" });
      }
      const parts = await storage.searchParts(query);
      res.json(parts);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to search parts" });
    }
  });

  // GET pending parts for approval (billing manager only) - must be before /api/parts/:id
  app.get("/api/parts/pending-approval", requireAuthentication, async (req, res) => {
    try {
      const userRole = req.authenticatedUserRole;
      if (userRole !== 'billing_manager' && userRole !== 'company_admin') {
        return res.status(403).json({ message: "Access denied." });
      }
      const companyId = req.authenticatedUserCompanyId;
      if (!companyId) return res.status(400).json({ message: "Company ID required" });
      const pendingParts = await storage.getPendingParts(companyId);
      res.json(pendingParts);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch pending parts" });
    }
  });

  app.get("/api/parts/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      
      // Validate part ID is a valid number
      if (isNaN(id) || id <= 0) {
        return res.status(400).json({ message: "Invalid part ID" });
      }
      
      const part = await storage.getPart(id);
      if (!part) {
        return res.status(404).json({ message: "Part not found" });
      }
      res.json(part);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch part" });
    }
  });

  app.post("/api/parts", requireAuthentication, async (req, res) => {
    try {
      const userRole = req.authenticatedUserRole;
      const allowedRoles = ['company_admin', 'super_admin', 'billing_manager', 'irrigation_manager'];
      if (!allowedRoles.includes(userRole as string)) {
        return res.status(403).json({ message: "Access denied. You don't have permission to create parts." });
      }

      const rawData = req.body;

      const MAX_DECIMAL = 99999999.99;
      if (rawData.price !== undefined) {
        const priceNum = Number(rawData.price);
        if (!Number.isFinite(priceNum) || priceNum < 0 || priceNum > MAX_DECIMAL) {
          return res.status(400).json({ message: "Price must be between 0 and 99,999,999.99" });
        }
      }
      if (rawData.cost !== undefined && rawData.cost !== "" && rawData.cost !== null) {
        const costNum = Number(rawData.cost);
        if (!Number.isFinite(costNum) || costNum < 0 || costNum > MAX_DECIMAL) {
          return res.status(400).json({ message: "Cost must be between 0 and 99,999,999.99" });
        }
      }

      const processedData = {
        ...rawData,
        companyId: req.authenticatedUserCompanyId || rawData.companyId,
      };

      const partData = insertPartSchema.parse({
        ...processedData,
        approvalStatus: 'pending',
      });

      const part = await storage.createPart(partData);

      // Notify billing managers for the part's company that a new part is pending approval
      // Use part.companyId directly to avoid null-companyId leaking cross-tenant (e.g. super_admin creating parts)
      if (part.companyId) {
        try {
          const companyUsers = await storage.getUsers(part.companyId);
          const billingManagers = companyUsers.filter(u => u.role === 'billing_manager');
          for (const bm of billingManagers) {
            await storage.createNotification({
              userId: bm.id,
              type: "part_pending_approval",
              title: "New Part Awaiting Approval",
              message: `Part "${part.name}" (SKU: ${part.sku}) has been added to the catalog and requires your approval.`,
              relatedEntityType: "part",
              relatedEntityId: part.id,
              isRead: false,
            });
          }
        } catch (notifError) {
          console.error('Failed to send part approval notifications:', notifError);
        }
      }

      res.status(201).json(part);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid part data", errors: error.errors });
      }
      console.error("Error creating part:", error instanceof Error ? error.message : error, { price: req.body?.price, cost: req.body?.cost });
      res.status(500).json({ message: "Failed to create part" });
    }
  });

  app.put("/api/parts/:id", requireAuthentication, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      
      // Validate part ID is a valid number
      if (isNaN(id) || id <= 0) {
        return res.status(400).json({ message: "Invalid part ID" });
      }
      
      // Check role-based access for parts editing
      const userRole = req.authenticatedUserRole;
      const allowedRoles = ['company_admin', 'super_admin', 'billing_manager', 'irrigation_manager'];
      if (!allowedRoles.includes(userRole as string)) {
        console.error(`PUT /api/parts/:id - Access denied. Role ${userRole} cannot edit parts`);
        return res.status(403).json({ message: "Access denied. You don't have permission to edit parts." });
      }
      
      // Check if part exists and belongs to user's company
      const existingPart = await storage.getPart(id);
      if (!existingPart) {
        return res.status(404).json({ message: "Part not found" });
      }
      
      const authenticatedCompanyId = req.authenticatedUserCompanyId;
      if (authenticatedCompanyId !== null && existingPart.companyId !== authenticatedCompanyId) {
        return res.status(403).json({ message: "Access denied. You can only update parts from your company." });
      }
      
      const partData = insertPartSchema.partial().parse(req.body);
      const part = await storage.updatePart(id, partData);
      if (!part) {
        return res.status(404).json({ message: "Part not found" });
      }
      res.json(part);
    } catch (error) {
      console.error("Error updating part (PUT):", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid part data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to update part" });
    }
  });

  // PATCH alias for PUT (frontend expects PATCH for partial updates)
  app.patch("/api/parts/:id", requireAuthentication, async (req, res) => {
    const partId = req.params.id;
    
    try {
      const id = parseInt(partId);
      
      // Production debugging for part 393 issue
      if (id === 393) {
        console.log(`[PART-393-DEBUG] User ${req.authenticatedUserId} (role: ${req.authenticatedUserRole}, company: ${req.authenticatedUserCompanyId}) attempting to edit part 393`);
      }
      
      // Validate part ID is a valid number
      if (isNaN(id) || id <= 0) {
        console.error(`PATCH /api/parts/${partId} - Invalid part ID`);
        return res.status(400).json({ message: "Invalid part ID" });
      }
      
      // Check role-based access for parts editing
      const userRole = req.authenticatedUserRole;
      const allowedRoles = ['company_admin', 'super_admin', 'billing_manager', 'irrigation_manager'];
      if (!allowedRoles.includes(userRole as string)) {
        console.error(`PATCH /api/parts/:id - Access denied. Role ${userRole} cannot edit parts`);
        return res.status(403).json({ message: "Access denied. You don't have permission to edit parts." });
      }
      
      // Check if part exists before updating - with explicit error handling
      let existingPart;
      try {
        existingPart = await storage.getPart(id);
      } catch (partLookupError) {
        console.error(`PATCH /api/parts/:id - Database error during part lookup:`, partLookupError);
        return res.status(500).json({ message: "Database error while checking part" });
      }
      
      if (!existingPart) {
        console.error(`PATCH /api/parts/:id - Part not found: ${id}`);
        return res.status(404).json({ message: "Part not found" });
      }
      
      // Ensure the part belongs to the user's company
      const authenticatedCompanyId = req.authenticatedUserCompanyId;
      
      // Only check company ownership if the user has a company (not null)
      if (authenticatedCompanyId !== null && existingPart.companyId !== authenticatedCompanyId) {
        console.error(`PATCH /api/parts/:id - Access denied. User company ${authenticatedCompanyId} cannot update part from company ${existingPart.companyId}`);
        return res.status(403).json({ message: "Access denied. You can only update parts from your company." });
      }
      
      // Parse and validate request data with proper type conversion for database
      let partData;
      try {
        const rawData = req.body;
        
        // Convert numeric fields to strings for decimal database fields
        const processedData = {
          ...rawData,
          price: rawData.price !== undefined ? Number(rawData.price).toFixed(2) : undefined,
          cost: rawData.cost !== undefined ? Number(rawData.cost).toFixed(2) : undefined,
        };
        
        // Use the authenticated user's company ID instead of form data
        if (authenticatedCompanyId !== null) {
          processedData.companyId = authenticatedCompanyId;
        }
        
        partData = insertPartSchema.partial().parse(processedData);
      } catch (validationError) {
        if (validationError instanceof z.ZodError) {
          console.error("PATCH /api/parts/:id - Zod validation errors:", validationError.errors);
          return res.status(400).json({ message: "Invalid part data", errors: validationError.errors });
        }
        throw validationError; // Re-throw if not a Zod error
      }
      
      // Perform the update with explicit error handling
      let part;
      try {
        part = await storage.updatePart(id, partData);
      } catch (updateError) {
        console.error(`PATCH /api/parts/:id - Database error during update for part ${id}:`, {
          error: updateError,
          partData: partData,
          userId: req.authenticatedUserId,
          companyId: req.authenticatedUserCompanyId
        });
        
        // Check if it's a constraint violation or data type error
        const errorMessage = updateError instanceof Error ? updateError.message : String(updateError);
        if (errorMessage.includes('constraint') || errorMessage.includes('violates') || errorMessage.includes('invalid input')) {
          return res.status(400).json({ 
            message: "Invalid data provided. Please check all fields and try again.",
            details: errorMessage 
          });
        }
        
        return res.status(500).json({ message: "Database error while updating part" });
      }
      
      if (!part) {
        console.error(`PATCH /api/parts/:id - Update failed for part: ${id}`);
        return res.status(404).json({ message: "Part not found after update" });
      }
      
      res.json(part);
    } catch (error) {
      console.error("Error updating part (PATCH) - Unhandled exception:", {
        error: error,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        errorStack: error instanceof Error ? error.stack : undefined,
        requestId: req.params.id,
        requestBody: req.body,
        authenticatedUserId: req.authenticatedUserId,
        authenticatedUserRole: req.authenticatedUserRole,
        authenticatedUserCompanyId: req.authenticatedUserCompanyId
      });
      
      // Fallback error response
      res.status(500).json({ message: "Internal server error while updating part" });
    }
  });

  // Bulk import parts from CSV
  app.post("/api/parts/bulk-import", requireAuthentication, async (req, res) => {
    try {
      const { csvData, columnMappings } = req.body;
      console.log('Bulk import request:', { hasCSV: !!csvData, mappingsLength: columnMappings?.length, mappings: columnMappings });
      
      if (!csvData || typeof csvData !== 'string') {
        return res.status(400).json({ message: "CSV data is required" });
      }

      // Proper CSV parsing function
      const parseCSVLine = (line: string): string[] => {
        const result: string[] = [];
        let current = '';
        let inQuotes = false;
        
        for (let i = 0; i < line.length; i++) {
          const char = line[i];
          
          if (char === '"') {
            if (inQuotes && line[i + 1] === '"') {
              // Handle escaped quotes
              current += '"';
              i++; // Skip next quote
            } else {
              // Toggle quote state
              inQuotes = !inQuotes;
            }
          } else if (char === ',' && !inQuotes) {
            // End of field
            result.push(current.trim());
            current = '';
          } else {
            current += char;
          }
        }
        
        // Add the last field
        result.push(current.trim());
        return result;
      };

      // Parse CSV data
      const lines = csvData.trim().split('\n');
      if (lines.length < 2) {
        return res.status(400).json({ message: "CSV must have header and at least one data row" });
      }

      const csvHeaders = parseCSVLine(lines[0]);
      console.log('CSV Headers detected:', csvHeaders);
      
      // Auto-detect enhanced CSV format and use intelligent processing
      const isEnhancedFormat = csvHeaders.includes('Part Type') && 
                              csvHeaders.includes('Product/Service Name') && 
                              csvHeaders.includes('Price');
      
      console.log('Enhanced format detected:', isEnhancedFormat);
      console.log('Column mappings provided:', !!columnMappings);
      console.log('Processing', lines.length - 1, 'data rows');
      
      let fieldMappings: { [key: string]: string } = {};
      
      if (isEnhancedFormat && (!columnMappings || !Array.isArray(columnMappings) || columnMappings.length === 0)) {
        // Enhanced format detected - use intelligent auto-mapping
        console.log('Enhanced CSV format detected - using intelligent processing');
        fieldMappings = {
          [csvHeaders.indexOf('Part Type')]: 'category',
          [csvHeaders.indexOf('Product/Service Name')]: 'name',
          [csvHeaders.indexOf('Price')]: 'price',
          [csvHeaders.indexOf('Sales Description')]: 'description'
        };
        
        // Add optional fields if they exist
        if (csvHeaders.includes('Cost')) {
          fieldMappings[csvHeaders.indexOf('Cost')] = 'cost';
        }
        if (csvHeaders.includes('Material')) {
          fieldMappings[csvHeaders.indexOf('Material')] = 'material';
        }
        if (csvHeaders.includes('Size')) {
          fieldMappings[csvHeaders.indexOf('Size')] = 'size';
        }
        if (csvHeaders.includes('Brand')) {
          fieldMappings[csvHeaders.indexOf('Brand')] = 'brand';
        }
        if (csvHeaders.includes('Fitting Type')) {
          fieldMappings[csvHeaders.indexOf('Fitting Type')] = 'fitting_type';
        }
        if (csvHeaders.includes('Detail')) {
          fieldMappings[csvHeaders.indexOf('Detail')] = 'detail';
        }
        if (csvHeaders.includes('SKU')) {
          fieldMappings[csvHeaders.indexOf('SKU')] = 'sku';
        }
        
      } else if (columnMappings && Array.isArray(columnMappings)) {
        // Create mapping from CSV column index to database field
        columnMappings.forEach((mapping: any) => {
          const csvIndex = csvHeaders.indexOf(mapping.csvColumn);
          if (csvIndex >= 0 && mapping.dbField !== 'skip') {
            fieldMappings[csvIndex] = mapping.dbField;
          }
        });
        
        // Check if we have required fields mapped (only name and price are truly required)
        const requiredFields = ['name', 'price'];
        const mappedFields = Object.values(fieldMappings);
        const missingFields = requiredFields.filter(field => !mappedFields.includes(field));
        
        if (missingFields.length > 0) {
          return res.status(400).json({ 
            message: `Missing required field mappings: ${missingFields.join(', ')}` 
          });
        }
      } else {
        // Old behavior - map by header names
        const headers = csvHeaders.map(h => h.toLowerCase());
        const requiredFields = ['name', 'category', 'price'];
        const missingFields = requiredFields.filter(field => !headers.includes(field));
        
        if (missingFields.length > 0) {
          return res.status(400).json({ 
            message: `Missing required fields: ${missingFields.join(', ')}` 
          });
        }
        
        // Create legacy mapping
        headers.forEach((header, index) => {
          fieldMappings[index] = header;
        });
      }

      const results = {
        success: true,
        imported: 0,
        skipped: 0,
        errors: [] as Array<{ row: number; field: string; message: string; }>
      };

      // Get existing parts to check for duplicates
      const existingParts = await storage.getParts();
      const existingNames = new Set(existingParts.map(p => p.name.toLowerCase()));

      // Process each row
      for (let i = 1; i < lines.length; i++) {
        const rowData = parseCSVLine(lines[i]);
        
        try {
          // Create part object from CSV row using field mappings
          const partData: any = {};

          
          Object.entries(fieldMappings).forEach(([csvIndex, dbField]) => {
            const value = rowData[parseInt(csvIndex)] || '';
            switch (dbField) {
              case 'name':
                partData.name = value;
                break;
              case 'category':
                partData.category = value;
                break;
              case 'price':
                // Only set price if it's not already set (handle multiple price columns)
                if (!partData.price && value) {
                  const numValue = parseFloat(value.replace(/[^0-9.-]/g, ''));
                  partData.price = isNaN(numValue) ? 0 : numValue;
                }
                break;
              case 'cost':
                if (value) {
                  const numValue = parseFloat(value.replace(/[^0-9.-]/g, ''));
                  partData.cost = isNaN(numValue) ? null : numValue;
                }
                break;
              case 'material':
                partData.material = value || null;
                break;
              case 'size':
                partData.size = value || null;
                break;
              case 'brand':
                partData.brand = value || null;
                break;
              case 'fitting_type':
                partData.fittingType = value || null;
                break;
              case 'detail':
                partData.detail = value || null;
                break;
              case 'description':
                partData.description = value || null;
                break;
              case 'sku':
                partData.sku = value || null;
                break;
            }
          });

          // Generate SKU if not provided
          if (!partData.sku) {
            const categoryPrefix = partData.category ? partData.category.substring(0, 3).toUpperCase() : 'GEN';
            const namePrefix = partData.name ? partData.name.substring(0, 3).toUpperCase() : 'ITM';
            partData.sku = `${categoryPrefix}-${namePrefix}-${Date.now().toString().slice(-6)}`;
          }

          partData.companyId = req.authenticatedUserCompanyId || 1;
          partData.price = partData.price?.toString() || "0";
          
          // Set default category if not provided
          if (!partData.category) {
            partData.category = 'General';
          }

          // Check for duplicates
          if (existingNames.has(partData.name.toLowerCase())) {
            results.skipped++;
            continue;
          }

          // Validate required fields before schema validation
          if (!partData.name || partData.name.trim() === '') {
            results.errors.push({
              row: i + 1,
              field: 'name',
              message: 'Part name is required and cannot be empty'
            });
            continue;
          }

          if (!partData.category || partData.category.trim() === '') {
            partData.category = 'General'; // Set default category
          }

          // Validate part data with better error handling
          const validatedData = insertPartSchema.parse(partData);
          
          // Create part
          await storage.createPart(validatedData);
          results.imported++;
          existingNames.add(partData.name.toLowerCase());
          
        } catch (error) {
          console.error(`Row ${i + 1} validation error:`, error);
          
          if (error instanceof z.ZodError) {
            // Provide detailed validation errors
            const errorMessages = error.errors.map(e => {
              const field = e.path.join('.');
              return `${field}: ${e.message}`;
            });
            results.errors.push({
              row: i + 1,
              field: String(error.errors[0]?.path[0] || 'general'),
              message: errorMessages.join(', ')
            });
          } else {
            results.errors.push({
              row: i + 1,
              field: 'general',
              message: `Import error: ${error instanceof Error ? error.message : 'Unknown error'}`
            });
          }
        }
      }

      // Update success status based on results
      results.success = results.errors.length === 0 || results.imported > 0;
      
      res.json(results);
    } catch (error) {
      console.error('Bulk import error:', error);
      res.status(500).json({ message: "Failed to process bulk import" });
    }
  });

  // ============================================================================
  // PARTS SETTINGS - Reference Lists (categories, brands, sizes, materials, fitting types)
  // GET is open to all authenticated users; mutations restricted to admin/manager roles
  // ============================================================================

  const requirePartsSettingsAccess = (req: any, res: any, next: any) => {
    const userRole = req.authenticatedUserRole;
    if (userRole !== 'company_admin' && userRole !== 'billing_manager' && userRole !== 'irrigation_manager') {
      return res.status(403).json({ message: "Access denied. Only company administrators, billing managers, and irrigation managers can manage parts settings." });
    }
    next();
  };

  // Part Categories
  app.get("/api/part-settings/categories", requireAuthentication, async (req, res) => {
    const companyId = req.authenticatedUserCompanyId;
    if (!companyId) return res.status(401).json({ message: "Unauthorized" });
    try {
      const categories = await storage.getPartCategories(companyId);
      res.json(categories);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch part categories" });
    }
  });

  app.post("/api/part-settings/categories", requireAuthentication, requirePartsSettingsAccess, async (req, res) => {
    const companyId = req.authenticatedUserCompanyId;
    if (!companyId) return res.status(401).json({ message: "Unauthorized" });
    const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
    if (!name) return res.status(400).json({ message: "Name is required" });
    let markupPercent = "0.00";
    if (req.body.markupPercent !== undefined) {
      const parsed = parseFloat(req.body.markupPercent);
      if (isNaN(parsed) || parsed < 0) return res.status(400).json({ message: "markupPercent must be a non-negative number" });
      markupPercent = parsed.toFixed(2);
    }
    try {
      const category = await storage.createPartCategory({ companyId, name, markupPercent });
      res.json(category);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to create part category" });
    }
  });

  app.patch("/api/part-settings/categories/:id", requireAuthentication, requirePartsSettingsAccess, async (req, res) => {
    const companyId = req.authenticatedUserCompanyId;
    if (!companyId) return res.status(401).json({ message: "Unauthorized" });
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });
    const update: { name?: string; markupPercent?: string } = {};
    if (typeof req.body.name === "string") {
      update.name = req.body.name.trim();
      if (!update.name) return res.status(400).json({ message: "Name cannot be empty" });
    }
    if (req.body.markupPercent !== undefined) {
      const parsed = parseFloat(req.body.markupPercent);
      if (isNaN(parsed) || parsed < 0) return res.status(400).json({ message: "markupPercent must be a non-negative number" });
      update.markupPercent = parsed.toFixed(2);
    }
    if (Object.keys(update).length === 0) return res.status(400).json({ message: "No valid fields to update" });
    try {
      const category = await storage.updatePartCategory(id, companyId, update);
      if (!category) return res.status(404).json({ message: "Category not found" });
      res.json(category);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to update part category" });
    }
  });

  app.delete("/api/part-settings/categories/:id", requireAuthentication, requirePartsSettingsAccess, async (req, res) => {
    const companyId = req.authenticatedUserCompanyId;
    if (!companyId) return res.status(401).json({ message: "Unauthorized" });
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });
    try {
      const deleted = await storage.deletePartCategory(id, companyId);
      if (!deleted) return res.status(404).json({ message: "Category not found" });
      res.json({ message: "Category deleted" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to delete part category" });
    }
  });

  // Part Brands
  app.get("/api/part-settings/brands", requireAuthentication, async (req, res) => {
    const companyId = req.authenticatedUserCompanyId;
    if (!companyId) return res.status(401).json({ message: "Unauthorized" });
    try {
      const brands = await storage.getPartBrands(companyId);
      res.json(brands);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch part brands" });
    }
  });

  app.post("/api/part-settings/brands", requireAuthentication, requirePartsSettingsAccess, async (req, res) => {
    const companyId = req.authenticatedUserCompanyId;
    if (!companyId) return res.status(401).json({ message: "Unauthorized" });
    const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
    if (!name) return res.status(400).json({ message: "Name is required" });
    try {
      const brand = await storage.createPartBrand({ companyId, name });
      res.json(brand);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to create part brand" });
    }
  });

  app.patch("/api/part-settings/brands/:id", requireAuthentication, requirePartsSettingsAccess, async (req, res) => {
    const companyId = req.authenticatedUserCompanyId;
    if (!companyId) return res.status(401).json({ message: "Unauthorized" });
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });
    const update: { name?: string } = {};
    if (typeof req.body.name === "string") {
      update.name = req.body.name.trim();
      if (!update.name) return res.status(400).json({ message: "Name cannot be empty" });
    }
    if (Object.keys(update).length === 0) return res.status(400).json({ message: "No valid fields to update" });
    try {
      const brand = await storage.updatePartBrand(id, companyId, update);
      if (!brand) return res.status(404).json({ message: "Brand not found" });
      res.json(brand);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to update part brand" });
    }
  });

  app.delete("/api/part-settings/brands/:id", requireAuthentication, requirePartsSettingsAccess, async (req, res) => {
    const companyId = req.authenticatedUserCompanyId;
    if (!companyId) return res.status(401).json({ message: "Unauthorized" });
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });
    try {
      const deleted = await storage.deletePartBrand(id, companyId);
      if (!deleted) return res.status(404).json({ message: "Brand not found" });
      res.json({ message: "Brand deleted" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to delete part brand" });
    }
  });

  // Part Sizes
  app.get("/api/part-settings/sizes", requireAuthentication, async (req, res) => {
    const companyId = req.authenticatedUserCompanyId;
    if (!companyId) return res.status(401).json({ message: "Unauthorized" });
    try {
      const sizes = await storage.getPartSizes(companyId);
      res.json(sizes);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch part sizes" });
    }
  });

  app.post("/api/part-settings/sizes", requireAuthentication, requirePartsSettingsAccess, async (req, res) => {
    const companyId = req.authenticatedUserCompanyId;
    if (!companyId) return res.status(401).json({ message: "Unauthorized" });
    const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
    if (!name) return res.status(400).json({ message: "Name is required" });
    try {
      const size = await storage.createPartSize({ companyId, name });
      res.json(size);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to create part size" });
    }
  });

  app.patch("/api/part-settings/sizes/:id", requireAuthentication, requirePartsSettingsAccess, async (req, res) => {
    const companyId = req.authenticatedUserCompanyId;
    if (!companyId) return res.status(401).json({ message: "Unauthorized" });
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });
    const update: { name?: string } = {};
    if (typeof req.body.name === "string") {
      update.name = req.body.name.trim();
      if (!update.name) return res.status(400).json({ message: "Name cannot be empty" });
    }
    if (Object.keys(update).length === 0) return res.status(400).json({ message: "No valid fields to update" });
    try {
      const size = await storage.updatePartSize(id, companyId, update);
      if (!size) return res.status(404).json({ message: "Size not found" });
      res.json(size);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to update part size" });
    }
  });

  app.delete("/api/part-settings/sizes/:id", requireAuthentication, requirePartsSettingsAccess, async (req, res) => {
    const companyId = req.authenticatedUserCompanyId;
    if (!companyId) return res.status(401).json({ message: "Unauthorized" });
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });
    try {
      const deleted = await storage.deletePartSize(id, companyId);
      if (!deleted) return res.status(404).json({ message: "Size not found" });
      res.json({ message: "Size deleted" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to delete part size" });
    }
  });

  // Part Materials
  app.get("/api/part-settings/materials", requireAuthentication, async (req, res) => {
    const companyId = req.authenticatedUserCompanyId;
    if (!companyId) return res.status(401).json({ message: "Unauthorized" });
    try {
      const materials = await storage.getPartMaterials(companyId);
      res.json(materials);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch part materials" });
    }
  });

  app.post("/api/part-settings/materials", requireAuthentication, requirePartsSettingsAccess, async (req, res) => {
    const companyId = req.authenticatedUserCompanyId;
    if (!companyId) return res.status(401).json({ message: "Unauthorized" });
    const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
    if (!name) return res.status(400).json({ message: "Name is required" });
    try {
      const material = await storage.createPartMaterial({ companyId, name });
      res.json(material);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to create part material" });
    }
  });

  app.patch("/api/part-settings/materials/:id", requireAuthentication, requirePartsSettingsAccess, async (req, res) => {
    const companyId = req.authenticatedUserCompanyId;
    if (!companyId) return res.status(401).json({ message: "Unauthorized" });
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });
    const update: { name?: string } = {};
    if (typeof req.body.name === "string") {
      update.name = req.body.name.trim();
      if (!update.name) return res.status(400).json({ message: "Name cannot be empty" });
    }
    if (Object.keys(update).length === 0) return res.status(400).json({ message: "No valid fields to update" });
    try {
      const material = await storage.updatePartMaterial(id, companyId, update);
      if (!material) return res.status(404).json({ message: "Material not found" });
      res.json(material);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to update part material" });
    }
  });

  app.delete("/api/part-settings/materials/:id", requireAuthentication, requirePartsSettingsAccess, async (req, res) => {
    const companyId = req.authenticatedUserCompanyId;
    if (!companyId) return res.status(401).json({ message: "Unauthorized" });
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });
    try {
      const deleted = await storage.deletePartMaterial(id, companyId);
      if (!deleted) return res.status(404).json({ message: "Material not found" });
      res.json({ message: "Material deleted" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to delete part material" });
    }
  });

  // Part Fitting Types
  app.get("/api/part-settings/fitting-types", requireAuthentication, async (req, res) => {
    const companyId = req.authenticatedUserCompanyId;
    if (!companyId) return res.status(401).json({ message: "Unauthorized" });
    try {
      const fittingTypes = await storage.getPartFittingTypes(companyId);
      res.json(fittingTypes);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch part fitting types" });
    }
  });

  app.post("/api/part-settings/fitting-types", requireAuthentication, requirePartsSettingsAccess, async (req, res) => {
    const companyId = req.authenticatedUserCompanyId;
    if (!companyId) return res.status(401).json({ message: "Unauthorized" });
    const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
    if (!name) return res.status(400).json({ message: "Name is required" });
    try {
      const fittingType = await storage.createPartFittingType({ companyId, name });
      res.json(fittingType);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to create part fitting type" });
    }
  });

  app.patch("/api/part-settings/fitting-types/:id", requireAuthentication, requirePartsSettingsAccess, async (req, res) => {
    const companyId = req.authenticatedUserCompanyId;
    if (!companyId) return res.status(401).json({ message: "Unauthorized" });
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });
    const update: { name?: string } = {};
    if (typeof req.body.name === "string") {
      update.name = req.body.name.trim();
      if (!update.name) return res.status(400).json({ message: "Name cannot be empty" });
    }
    if (Object.keys(update).length === 0) return res.status(400).json({ message: "No valid fields to update" });
    try {
      const fittingType = await storage.updatePartFittingType(id, companyId, update);
      if (!fittingType) return res.status(404).json({ message: "Fitting type not found" });
      res.json(fittingType);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to update part fitting type" });
    }
  });

  app.delete("/api/part-settings/fitting-types/:id", requireAuthentication, requirePartsSettingsAccess, async (req, res) => {
    const companyId = req.authenticatedUserCompanyId;
    if (!companyId) return res.status(401).json({ message: "Unauthorized" });
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });
    try {
      const deleted = await storage.deletePartFittingType(id, companyId);
      if (!deleted) return res.status(404).json({ message: "Fitting type not found" });
      res.json({ message: "Fitting type deleted" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to delete part fitting type" });
    }
  });

  app.get("/api/parts", async (req, res) => {
    try {
      const parts = await storage.getParts();
      // Strip pricing fields for field technicians (they see names/quantities only)
      res.json(applyPricingVisibility(req, parts));
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch parts" });
    }
  });

  // Track part usage (called when a part is used in work order or billing sheet)
  app.post("/api/parts/:id/track-usage", requireAuthentication, async (req, res) => {
    try {
      const partId = parseInt(req.params.id);
      if (isNaN(partId) || partId <= 0) {
        return res.status(400).json({ message: "Invalid part ID" });
      }
      const companyId = req.authenticatedUserCompanyId || 1;
      await storage.trackPartUsage(companyId, partId);
      res.json({ message: "Part usage tracked successfully" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to track part usage" });
    }
  });

  // POST approve a catalog part
  app.post("/api/parts/:id/approve", requireAuthentication, async (req, res) => {
    try {
      const userRole = req.authenticatedUserRole;
      if (userRole !== 'billing_manager' && userRole !== 'company_admin' && userRole !== 'super_admin') {
        return res.status(403).json({ message: "Access denied." });
      }
      const id = parseInt(req.params.id);
      if (isNaN(id) || id <= 0) return res.status(400).json({ message: "Invalid part ID" });

      // Verify company ownership (except super_admin who can approve any)
      const existingPart = await storage.getPart(id);
      if (!existingPart) return res.status(404).json({ message: "Part not found" });
      const companyId = req.authenticatedUserCompanyId;
      if (userRole !== 'super_admin' && companyId !== null && existingPart.companyId !== companyId) {
        return res.status(403).json({ message: "Access denied. You can only approve parts from your company." });
      }

      const { price, cost } = req.body;
      if (!price) return res.status(400).json({ message: "price is required" });

      const updatedPart = await storage.approvePart(id, String(price), cost ? String(cost) : undefined, existingPart.companyId);
      if (!updatedPart) return res.status(404).json({ message: "Part not found" });

      res.json(updatedPart);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to approve part" });
    }
  });

  // GET pending manual part reviews (billing manager only)
  app.get("/api/manual-part-reviews", requireAuthentication, async (req, res) => {
    try {
      const userRole = req.authenticatedUserRole;
      if (userRole !== 'billing_manager' && userRole !== 'company_admin') {
        return res.status(403).json({ message: "Access denied." });
      }
      const companyId = req.authenticatedUserCompanyId;
      if (!companyId) return res.status(400).json({ message: "Company ID required" });
      const reviews = await storage.getManualPartReviews(companyId);
      res.json(reviews);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch manual part reviews" });
    }
  });

  // POST approve a manual part review
  app.post("/api/manual-part-reviews/:id/approve", requireAuthentication, async (req, res) => {
    try {
      const userRole = req.authenticatedUserRole;
      if (userRole !== 'billing_manager' && userRole !== 'company_admin' && userRole !== 'super_admin') {
        return res.status(403).json({ message: "Access denied." });
      }
      const id = parseInt(req.params.id);
      if (isNaN(id) || id <= 0) return res.status(400).json({ message: "Invalid review ID" });

      // Verify company ownership (except super_admin who can approve any)
      const existingReview = await storage.getManualPartReview(id);
      if (!existingReview) return res.status(404).json({ message: "Review not found" });
      const companyId = req.authenticatedUserCompanyId;
      if (userRole !== 'super_admin' && companyId !== null && existingReview.companyId !== companyId) {
        return res.status(403).json({ message: "Access denied. You can only approve reviews from your company." });
      }

      const { reviewedPrice } = req.body;
      if (!reviewedPrice) return res.status(400).json({ message: "reviewedPrice is required" });

      const updated = await storage.approveManualPartReview(id, String(reviewedPrice));
      if (!updated) return res.status(404).json({ message: "Review not found" });

      res.json(updated);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to approve manual part review" });
    }
  });

  app.delete("/api/parts/:id", requireAuthentication, async (req, res) => {
    try {
      const userRole = req.authenticatedUserRole;
      const allowedRoles = ['company_admin', 'super_admin', 'billing_manager', 'irrigation_manager'];
      if (!allowedRoles.includes(userRole as string)) {
        return res.status(403).json({ message: "Access denied. You don't have permission to delete parts." });
      }

      const id = parseInt(req.params.id);
      if (isNaN(id) || id <= 0) {
        return res.status(400).json({ message: "Invalid part ID" });
      }

      const existingPart = await storage.getPart(id);
      if (!existingPart) {
        return res.status(404).json({ message: "Part not found" });
      }

      const authenticatedCompanyId = req.authenticatedUserCompanyId;
      if (authenticatedCompanyId !== null && existingPart.companyId !== authenticatedCompanyId) {
        return res.status(403).json({ message: "Access denied. You can only delete parts from your company." });
      }

      const success = await storage.deletePart(id);
      if (!success) {
        return res.status(404).json({ message: "Part not found" });
      }
      res.json({ message: "Part deleted successfully" });
    } catch (error) {
      console.error("Error deleting part:", error instanceof Error ? error.message : error);
      res.status(500).json({ message: "Failed to delete part" });
    }
  });

  // Assembly routes
  app.get("/api/assemblies", requireAuthentication, async (req, res) => {
    try {
      const companyId = req.authenticatedUserCompanyId || 1;
      const assemblies = await storage.getAssemblies(companyId);
      res.json(assemblies);
    } catch (error) {
      console.error("Error fetching assemblies:", error instanceof Error ? error.message : error);
      res.status(500).json({ message: "Failed to fetch assemblies" });
    }
  });

  app.get("/api/assemblies/:id", requireAuthentication, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id) || id <= 0) {
        return res.status(400).json({ message: "Invalid assembly ID" });
      }
      const assembly = await storage.getAssembly(id);
      if (!assembly) {
        return res.status(404).json({ message: "Assembly not found" });
      }
      res.json(assembly);
    } catch (error) {
      console.error("Error fetching assembly:", error instanceof Error ? error.message : error);
      res.status(500).json({ message: "Failed to fetch assembly" });
    }
  });

  app.post("/api/assemblies", requireAuthentication, async (req, res) => {
    try {
      const { assembly, parts } = req.body;
      const assemblyData = insertAssemblySchema.parse({
        ...assembly,
        companyId: req.authenticatedUserCompanyId || assembly.companyId || 1,
        createdBy: req.authenticatedUserId || assembly.createdBy || 1,
      });
      const partsData = parts.map((p: any) => insertAssemblyPartSchema.parse(p));
      const createdAssembly = await storage.createAssembly(assemblyData, partsData);
      res.status(201).json(createdAssembly);
    } catch (error) {
      console.error("Error creating assembly:", error instanceof Error ? error.message : error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid assembly data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to create assembly" });
    }
  });

  app.put("/api/assemblies/:id", requireAuthentication, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id) || id <= 0) {
        return res.status(400).json({ message: "Invalid assembly ID" });
      }
      const { assembly, parts } = req.body;
      const assemblyData = insertAssemblySchema.partial().parse(assembly);
      const partsData = parts ? parts.map((p: any) => insertAssemblyPartSchema.parse(p)) : undefined;
      const updatedAssembly = await storage.updateAssembly(id, assemblyData, partsData);
      if (!updatedAssembly) {
        return res.status(404).json({ message: "Assembly not found" });
      }
      res.json(updatedAssembly);
    } catch (error) {
      console.error("Error updating assembly:", error instanceof Error ? error.message : error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid assembly data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to update assembly" });
    }
  });

  app.delete("/api/assemblies/:id", requireAuthentication, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id) || id <= 0) {
        return res.status(400).json({ message: "Invalid assembly ID" });
      }
      const success = await storage.deleteAssembly(id);
      if (!success) {
        return res.status(404).json({ message: "Assembly not found" });
      }
      res.json({ message: "Assembly deleted successfully" });
    } catch (error) {
      console.error("Error deleting assembly:", error instanceof Error ? error.message : error);
      res.status(500).json({ message: "Failed to delete assembly" });
    }
  });

  app.post("/api/assemblies/:id/track-usage", requireAuthentication, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const companyId = req.authenticatedUserCompanyId || 1;
      await storage.trackAssemblyUsage(companyId, id);
      res.json({ message: "Assembly usage tracked successfully" });
    } catch (error) {
      console.error("Error tracking assembly usage:", error instanceof Error ? error.message : error);
      res.status(500).json({ message: "Failed to track assembly usage" });
    }
  });

  app.post("/api/parts/import/google-sheets", requireAuthentication, async (req, res) => {
    try {
      const { sheetsUrl } = req.body;
      if (!sheetsUrl) {
        return res.status(400).json({ message: "Google Sheets URL is required" });
      }

      // Convert Google Sheets URL to CSV export URL
      const sheetId = sheetsUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)?.[1];
      if (!sheetId) {
        return res.status(400).json({ message: "Invalid Google Sheets URL format" });
      }

      const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=0`;
      
      // Fetch CSV data
      const response = await fetch(csvUrl);
      if (!response.ok) {
        return res.status(400).json({ 
          message: "Failed to access Google Sheets. Make sure the sheet is publicly viewable (Anyone with the link can view)" 
        });
      }

      const csvData = await response.text();
      const lines = csvData.split('\n').filter(line => line.trim());
      
      if (lines.length < 2) {
        return res.status(400).json({ message: "Sheet appears to be empty or missing data" });
      }

      // Parse CSV headers
      const headers = lines[0].split(',').map(h => h.replace(/"/g, '').trim().toLowerCase());
      
      // Create header mapping - more flexible approach
      const headerMap: Record<string, string> = {};
      headers.forEach((header, index) => {
        headerMap[header] = headers[index];
      });

      // Find the actual header names in the sheet
      const nameField = headers.find(h => h.includes('name') || h.includes('product') || h.includes('item'));
      const priceField = headers.find(h => h.includes('price') || h.includes('cost') || h.includes('amount'));
      const skuField = headers.find(h => h.includes('sku') || h.includes('code') || h.includes('part'));
      const laborField = headers.find(h => h.includes('labor') || h.includes('hour') || h.includes('time'));
      const descField = headers.find(h => h.includes('desc') || h.includes('detail'));
      const categoryField = headers.find(h => h.includes('category') || h.includes('type') || h.includes('group'));

      console.log('Available headers:', headers);
      console.log('Mapped fields:', { nameField, priceField, skuField, laborField });

      if (!nameField || !priceField) {
        return res.status(400).json({ 
          message: `Could not find required columns in sheet. Available headers: ${headers.join(', ')}. Need at least: name/product and price/cost` 
        });
      }

      // Parse and import parts
      let partsAdded = 0;
      const errors = [];

      for (let i = 1; i < lines.length; i++) {
        try {
          const values = lines[i].split(',').map(v => v.replace(/"/g, '').trim());
          const rowData: any = {};
          
          headers.forEach((header, index) => {
            rowData[header] = values[index] || '';
          });

          // Use flexible field mapping
          const name = (nameField ? rowData[nameField] : rowData.name) || '';
          const price = (priceField ? rowData[priceField] : rowData.price) || '';
          const sku = (skuField ? rowData[skuField] : rowData.sku) || `AUTO-${Date.now()}-${i}`;
          const description = (descField ? rowData[descField] : rowData.description) || '';
          const category = (categoryField ? rowData[categoryField] : rowData.category) || 'General';

          // Validate required fields
          if (!name || !price) {
            errors.push(`Row ${i + 1}: Missing required fields (name: "${name}", price: "${price}")`);
            continue;
          }

          // Create part object
          const partData = {
            name: name.trim(),
            description: description.trim(),
            price: price.toString(),
            sku: sku.trim(),
            category: category.trim(),
            companyId: req.authenticatedUserCompanyId || 1,
          };

          await storage.createPart(partData);
          partsAdded++;
        } catch (error) {
          console.error(error);
          errors.push(`Row ${i + 1}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }

      res.json({ 
        partsAdded, 
        errors: errors.length > 0 ? errors : undefined,
        message: `Successfully imported ${partsAdded} parts` + (errors.length > 0 ? ` with ${errors.length} errors` : '')
      });
    } catch (error) {
      console.error("Error importing from Google Sheets:", error);
      res.status(500).json({ message: "Failed to import parts from Google Sheets" });
    }
  });

  // Google Docs sync
  app.post("/api/parts/sync-google-docs", requireAuthentication, async (req, res) => {
    try {
      const { docUrl } = req.body;
      if (!docUrl) {
        return res.status(400).json({ message: "Google Docs URL is required" });
      }
      await storage.syncPartsFromGoogleDocs(docUrl);
      res.json({ message: "Parts synced from Google Docs successfully" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to sync parts from Google Docs" });
    }
  });

  // Duplicate assembly routes removed - consolidated above in Assembly routes section

  // Estimate routes
  app.get("/api/estimates", async (req, res) => {
    try {
      const estimates = await storage.getEstimates();
      res.json(estimates);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch estimates" });
    }
  });

  app.get("/api/estimates/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const estimate = await storage.getEstimate(id);
      if (!estimate) {
        return res.status(404).json({ message: "Estimate not found" });
      }
      res.json(estimate);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch estimate" });
    }
  });

  function processEstimatePayload(parsed: z.infer<typeof createEstimateWithItemsSchema>) {
    const items = parsed.items.map((item, idx) => {
      const quantity = item.quantity || 1;
      const partPrice = parseFloat(String(item.partPrice ?? 0));
      const laborHours = parseFloat(String(item.laborHours ?? 0));
      const totalPrice = item.totalPrice !== undefined
        ? parseFloat(String(item.totalPrice))
        : partPrice * quantity;
      return {
        description: item.description ?? "",
        partId: item.partId,
        partName: item.partName,
        partPrice: String(partPrice),
        quantity,
        laborHours: String(laborHours),
        totalPrice: totalPrice.toFixed(2),
        sortOrder: item.sortOrder ?? idx,
      };
    });

    // laborHours on every line item is the per-line total (already multiplied
    // by quantity on the client). Storage recompute, the email renderer, and
    // the displayed totals all share this convention.
    let partsSubtotal = 0;
    let totalLaborHours = 0;
    items.forEach(item => {
      partsSubtotal += parseFloat(item.totalPrice);
      totalLaborHours += parseFloat(item.laborHours);
    });

    const laborRate = parseFloat(String(parsed.estimate.laborRate));
    const laborSubtotal = totalLaborHours * laborRate;
    const totalAmount = partsSubtotal + laborSubtotal;

    const estimate: InsertEstimate = {
      ...parsed.estimate,
      estimateDate: parsed.estimate.estimateDate ? new Date(parsed.estimate.estimateDate) : new Date(),
      partsSubtotal: partsSubtotal.toFixed(2),
      laborSubtotal: laborSubtotal.toFixed(2),
      totalAmount: totalAmount.toFixed(2),
      laborRate: String(parsed.estimate.laborRate),
    };

    return { estimate, items: items as InsertEstimateItem[] };
  }

  app.post("/api/estimates", requireAuthentication, async (req, res) => {
    try {
      const parsed = createEstimateWithItemsSchema.parse(req.body);
      const { estimate, items } = processEstimatePayload(parsed);
      const newEstimate = await storage.createEstimate(estimate, items);
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



  app.delete("/api/estimates/:id", requireAuthentication, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const success = await storage.deleteEstimate(id);
      if (!success) {
        return res.status(404).json({ message: "Estimate not found" });
      }
      res.json({ message: "Estimate deleted successfully" });
    } catch (error) {
      console.error("Error deleting estimate:", error instanceof Error ? error.message : error);
      res.status(500).json({ message: "Failed to delete estimate" });
    }
  });

  // Email estimate
  app.post("/api/estimates/:id/email", requireAuthentication, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const estimate = await storage.getEstimate(id);
      if (!estimate) {
        return res.status(404).json({ message: "Estimate not found" });
      }
      
      // For now, just simulate sending email
      // In a real implementation, you would integrate with an email service
      res.json({ message: "Estimate email sent successfully" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to send estimate email" });
    }
  });

  // Property Zones routes
  app.get("/api/property-zones", async (req, res) => {
    try {
      const propertyZones = await storage.getPropertyZones();
      res.json(propertyZones);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch property zones" });
    }
  });

  app.get("/api/property-zones/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const propertyZone = await storage.getPropertyZone(id);
      if (!propertyZone) {
        return res.status(404).json({ message: "Property zone not found" });
      }
      res.json(propertyZone);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch property zone" });
    }
  });

  app.post("/api/property-zones", requireAuthentication, async (req, res) => {
    try {
      const propertyZoneData = insertPropertyZoneSchema.parse(req.body);
      const propertyZone = await storage.createPropertyZone(propertyZoneData);
      res.status(201).json(propertyZone);
    } catch (error) {
      console.error(error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid property zone data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to create property zone" });
    }
  });

  app.post("/api/property-zones/sync-google-sheets", requireAuthentication, async (req, res) => {
    try {
      const { sheetsUrl } = req.body;
      if (!sheetsUrl) {
        return res.status(400).json({ message: "Google Sheets URL is required" });
      }
      await storage.syncPropertyZonesFromGoogleSheets(sheetsUrl);
      res.json({ message: "Property zones synced from Google Sheets successfully" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to sync property zones from Google Sheets" });
    }
  });

  // Field Work Sessions routes
  app.get("/api/field-work-sessions", async (req, res) => {
    try {
      const sessions = await storage.getFieldWorkSessions();
      res.json(sessions);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch field work sessions" });
    }
  });

  app.get("/api/field-work-sessions/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const session = await storage.getFieldWorkSession(id);
      if (!session) {
        return res.status(404).json({ message: "Field work session not found" });
      }
      res.json(session);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch field work session" });
    }
  });

  app.post("/api/field-work-sessions", requireAuthentication, async (req, res) => {
    try {
      const sessionData = insertFieldWorkSessionSchema.parse(req.body);
      const session = await storage.createFieldWorkSession(sessionData);
      res.status(201).json(session);
    } catch (error) {
      console.error(error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid field work session data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to create field work session" });
    }
  });

  app.post("/api/field-work-sessions/:id/complete", requireAuthentication, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const session = await storage.completeFieldWorkSession(id);
      if (!session) {
        return res.status(404).json({ message: "Field work session not found" });
      }
      res.json(session);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to complete field work session" });
    }
  });

  app.post("/api/field-work-sessions/:sessionId/items", requireAuthentication, async (req, res) => {
    try {
      const sessionId = parseInt(req.params.sessionId);
      const itemData = insertFieldWorkItemSchema.parse(req.body);
      const item = await storage.addFieldWorkItem({ ...itemData, sessionId });
      res.status(201).json(item);
    } catch (error) {
      console.error(error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid field work item data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to add field work item" });
    }
  });

  // Field Tech Parts route (without pricing)
  app.get("/api/parts/field-tech", async (req, res) => {
    try {
      const parts = await storage.getParts();
      // Remove pricing information for field techs
      const fieldTechParts = parts.map(part => ({
        id: part.id,
        name: part.name,
        description: part.description,
        sku: part.sku,
        category: part.category
        // price is intentionally excluded
      }));
      res.json(fieldTechParts);
    } catch (error) {
      console.error("Error in /api/parts/field-tech:", error);
      res.status(500).json({ message: "Failed to fetch parts" });
    }
  });

  // Serve the QuickBooks debug script
  app.get("/quickbooks-temp-fix.js", (req, res) => {
    res.type('application/javascript');
    res.send(`
// QuickBooks Debug Script
console.log("QuickBooks debug script loaded successfully");
console.log("Current domain:", window.location.host);
console.log("Required redirect URI:", window.location.protocol + "//" + window.location.host + "/api/quickbooks/callback");
    `);
  });

  // Serve QuickBooks debug page
  app.get("/quickbooks-debug", (req, res) => {
    res.sendFile('quickbooks-debug.html', { root: '.' });
  });

  // Serve simple QuickBooks test page
  app.get("/quickbooks-test", (req, res) => {
    res.sendFile('simple-quickbooks-test.html', { root: '.' });
  });

  // Serve QuickBooks debug test page
  app.get("/quickbooks-debug-test", (req, res) => {
    res.sendFile('quickbooks-debug-test.html', { root: '.' });
  });

  // Serve domain check page
  app.get("/check-domain", (req, res) => {
    res.sendFile('check-domain.html', { root: '.' });
  });

  // Function to refresh QuickBooks token
  async function refreshQuickBooksToken(refreshToken: string, signal?: AbortSignal, context?: { realmId?: string; calledFrom?: string }) {
    const tokenEndpoint = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
    const authHeader = Buffer.from(`${process.env.QUICKBOOKS_CLIENT_ID}:${process.env.QUICKBOOKS_CLIENT_SECRET}`).toString('base64');
    const startedAt = Date.now();
    const realmId = context?.realmId ?? 'unknown';
    const calledFrom = context?.calledFrom ?? 'unknown';

    console.log(`[QB token-refresh] START realmId=${realmId} calledFrom=${calledFrom} startedAt=${new Date(startedAt).toISOString()}`);
    
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken
    });

    let response: globalThis.Response;
    try {
      response = await fetch(tokenEndpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${authHeader}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json'
        },
        body: body.toString(),
        signal
      });
    } catch (fetchErr: any) {
      const durationMs = Date.now() - startedAt;
      console.error(`[QB token-refresh] FAILURE realmId=${realmId} calledFrom=${calledFrom} durationMs=${durationMs} failureCode=FETCH_ERROR failureMessage=${fetchErr?.message}`);
      throw fetchErr;
    }

    if (!response.ok) {
      const errorText = await response.text();
      const durationMs = Date.now() - startedAt;
      const category = classifyQbRefreshError(errorText, response.status);
      console.error(`[QB token-refresh] FAILURE realmId=${realmId} calledFrom=${calledFrom} durationMs=${durationMs} failureCode=${response.status} category=${category} failureMessage=${errorText}`);
      throw new QbRefreshError(`Token refresh failed: ${response.status} ${errorText}`, category);
    }

    const tokenData = await response.json();
    if (!tokenData.access_token) {
      const durationMs = Date.now() - startedAt;
      console.error(`[QB token-refresh] FAILURE realmId=${realmId} calledFrom=${calledFrom} durationMs=${durationMs} failureCode=MISSING_ACCESS_TOKEN failureMessage=Token refresh response missing access_token`);
      throw new QbRefreshError('Token refresh response missing access_token', 'reconnect_required');
    }
    if (!tokenData.refresh_token) {
      const durationMs = Date.now() - startedAt;
      console.error(`[QB token-refresh] FAILURE realmId=${realmId} calledFrom=${calledFrom} durationMs=${durationMs} failureCode=MISSING_REFRESH_TOKEN failureMessage=Token refresh response missing refresh_token`);
      throw new QbRefreshError('Token refresh response missing refresh_token — cannot commit partial token state', 'reconnect_required');
    }

    const durationMs = Date.now() - startedAt;
    const tokenRotated = true;
    const expiresInSeconds = tokenData.expires_in && tokenData.expires_in > 0 ? tokenData.expires_in : 3600;
    console.log(`[QB token-refresh] SUCCESS realmId=${realmId} calledFrom=${calledFrom} durationMs=${durationMs} tokenRotated=${tokenRotated} newExpiresInSeconds=${expiresInSeconds}`);
    return tokenData;
  }

  // Shared helper: persist reconnect_required for unrecoverable QbRefreshError
  async function handleUnrecoverableRefreshError(err: unknown, realmId: string): Promise<boolean> {
    if (!(err instanceof QbRefreshError)) return false;
    const unrecoverable = UNRECOVERABLE_CATEGORIES.has(err.category);
    if (!unrecoverable) return false;
    const reason = buildReconnectReason(err.category);
    await storage.markQuickBooksReconnectRequired(realmId, reason).catch((e) => {
      console.error('[QB] Failed to persist reconnect_required state:', e);
    });
    console.warn(`[QB] Marked realmId=${realmId} as reconnect_required (${err.category})`);
    return true;
  }

  // Helper function to make QuickBooks API requests with intuit_tid capture and automatic token refresh
  async function makeQuickBooksRequest(url: string, options: RequestInit = {}, operation: string = '', realmId?: string): Promise<globalThis.Response> {
    // Proactive refresh: if the token is within the buffer window of expiry, refresh before sending
    if (realmId) {
      try {
        const integration = await storage.getQuickBooksIntegration(realmId);
        // Skip proactive refresh entirely if connection is already marked as reconnect_required
        if (integration?.connectionStatus === 'reconnect_required') {
          console.warn(`[QB] Skipping proactive refresh for realmId=${realmId}: connection is marked as reconnect_required`);
        } else if (integration && integration.expiresAt && integration.refreshToken) {
          const msUntilExpiry = new Date(integration.expiresAt).getTime() - Date.now();
          if (msUntilExpiry <= QB_PROACTIVE_REFRESH_BUFFER_MS) {
            console.log(`[QB proactive refresh] Token for realmId=${realmId} expires in ${Math.round(msUntilExpiry / 1000)}s — refreshing before request`);
            try {
              const newAccessToken = await withQbRefreshLock(realmId, async (signal) => {
                // Re-read from storage in case another concurrent caller already refreshed
                const fresh = await storage.getQuickBooksIntegration(realmId);
                if (!fresh) {
                  throw new Error(`[QB proactive refresh] Integration for realmId=${realmId} not found`);
                }
                // Bail out if another caller marked this as reconnect_required while we waited for the lock
                if (fresh.connectionStatus === 'reconnect_required') {
                  throw new QbRefreshError(
                    `Connection already marked as reconnect_required for realmId=${realmId}`,
                    'reconnect_required'
                  );
                }
                const newTokenData = await refreshQuickBooksToken(fresh.refreshToken, signal, { realmId, calledFrom: 'makeQuickBooksRequest/proactive' });
                const expiresInSeconds = newTokenData.expires_in && newTokenData.expires_in > 0 ? newTokenData.expires_in : 3600;
                if (!newTokenData.refresh_token) {
                  console.warn('[QB proactive refresh] Intuit did not return a new refresh_token; keeping the existing one');
                }
                const nowTs = new Date();
                await storage.saveQuickBooksIntegration({
                  companyId: integration.companyId,
                  accessToken: newTokenData.access_token,
                  refreshToken: newTokenData.refresh_token || fresh.refreshToken,
                  realmId,
                  expiresAt: new Date(Date.now() + expiresInSeconds * 1000),
                  lastRefreshAttempt: nowTs,
                  lastRefreshSuccess: nowTs,
                });
                return newTokenData.access_token;
              });

              // Swap the Authorization header so the actual request uses the fresh token
              if (options.headers) {
                (options.headers as Record<string, string>)['Authorization'] = `Bearer ${newAccessToken}`;
              }
              console.log(`[QB proactive refresh] Token refreshed successfully for realmId=${realmId}`);
            } catch (proactiveErr) {
              // Classify error: persist reconnect_required for unrecoverable failures
              await handleUnrecoverableRefreshError(proactiveErr, realmId);
              // Non-fatal for transient errors: log and continue — 401 fallback below will handle it
              console.warn(`[QB proactive refresh] Failed for realmId=${realmId}; proceeding with existing token:`, proactiveErr);
            }
          }
        }
      } catch (lookupErr) {
        // Non-fatal: if we can't look up the integration, just proceed and let the 401 fallback handle it
        console.warn(`[QB proactive refresh] Integration lookup failed for realmId=${realmId}:`, lookupErr);
      }
    }

    let response = await fetch(url, options);
    
    // Always capture intuit_tid from response headers
    const intuitTid = response.headers.get('intuit_tid');
    if (intuitTid) {
      console.log(`QuickBooks API Transaction ID (${operation || 'Request'}):`, intuitTid);
      // Enhanced logging: also log to our centralized logger if available
      console.log(`[QUICKBOOKS_TID] ${operation}: ${intuitTid}`);
    }
    
    // If we get a 401 (token expired), try to refresh the token and retry
    if (response.status === 401) {
      console.log('QuickBooks token expired, attempting to refresh...');
      try {
        const integration = realmId ? await storage.getQuickBooksIntegration(realmId) : null;
        // Do not attempt refresh if connection is already marked as reconnect_required
        if (integration?.connectionStatus === 'reconnect_required') {
          console.warn(`[QB] Skipping token refresh for realmId=${realmId}: connection is marked as reconnect_required`);
          return response;
        }
        if (integration && integration.refreshToken) {
          const realmIdForLock = integration.realmId || realmId || 'default';

          const newAccessToken = await withQbRefreshLock(realmIdForLock, async (signal) => {
            // Re-read from storage by realmId so we get the latest rotated token
            // (another concurrent caller that held the lock may have already refreshed it)
            const fresh = await storage.getQuickBooksIntegration(realmIdForLock);
            if (!fresh) {
              throw new Error(`[QB refresh] Integration for realmId=${realmIdForLock} not found; cannot refresh`);
            }
            // Bail out if another caller marked this as reconnect_required while we waited for the lock
            if (fresh.connectionStatus === 'reconnect_required') {
              throw new QbRefreshError(
                `Connection already marked as reconnect_required for realmId=${realmIdForLock}`,
                'reconnect_required'
              );
            }
            const refreshTokenToUse = fresh.refreshToken;

            const newTokenData = await refreshQuickBooksToken(refreshTokenToUse, signal, { realmId: realmIdForLock, calledFrom: 'makeQuickBooksRequest/401-retry' });

            // Guard against NaN when expires_in is missing or zero
            const expiresInSeconds = newTokenData.expires_in && newTokenData.expires_in > 0
              ? newTokenData.expires_in
              : 3600;
            if (!newTokenData.expires_in || newTokenData.expires_in <= 0) {
              console.warn('QuickBooks token refresh: expires_in missing or zero, defaulting to 3600 seconds');
            }

            // Persist new tokens atomically before releasing the lock so all waiters see the updated token
            const nowTs = new Date();
            await storage.saveQuickBooksIntegration({
              companyId: integration.companyId,
              accessToken: newTokenData.access_token,
              refreshToken: newTokenData.refresh_token,
              realmId: realmIdForLock,
              expiresAt: new Date(Date.now() + (expiresInSeconds * 1000)),
              lastRefreshAttempt: nowTs,
              lastRefreshSuccess: nowTs,
            });

            return newTokenData.access_token;
          });

          // Retry the original request with the new token
          const updatedOptions = { ...options };
          if (updatedOptions.headers) {
            (updatedOptions.headers as Record<string, string>)['Authorization'] = `Bearer ${newAccessToken}`;
          }

          console.log('Retrying request with refreshed token...');
          response = await fetch(url, updatedOptions);

          // Update intuit_tid from retry
          const retryIntuitTid = response.headers.get('intuit_tid');
          if (retryIntuitTid) {
            console.log(`QuickBooks API Transaction ID (${operation} - Retry):`, retryIntuitTid);
            console.log(`[QUICKBOOKS_TID] ${operation} - Retry: ${retryIntuitTid}`);
          }
        }
      } catch (refreshError: any) {
        const failureReason = refreshError?.message ?? String(refreshError);
        console.error(`[QB token-refresh] CATCH realmId=${realmId ?? 'unknown'} failureMessage=${failureReason}`);
        if (realmId) {
          // Persist reconnect_required for unrecoverable failures (stale/revoked token)
          const marked = await handleUnrecoverableRefreshError(refreshError, realmId);
          if (!marked) {
            // Transient failure — still persist lastRefreshFailure for observability
            try {
              const integ = await storage.getQuickBooksIntegration(realmId);
              if (integ) {
                await storage.saveQuickBooksIntegration({
                  companyId: integ.companyId,
                  accessToken: integ.accessToken,
                  refreshToken: integ.refreshToken,
                  realmId: integ.realmId,
                  expiresAt: integ.expiresAt,
                  lastRefreshAttempt: new Date(),
                  lastRefreshFailure: new Date(),
                  connectionStatus: integ.connectionStatus,
                  reconnectRequiredReason: failureReason,
                });
              }
            } catch (persistErr) {
              console.warn('[QB token-refresh] Failed to persist lastRefreshFailure:', persistErr);
            }
          }
        }
        // Return the original 401 response if refresh fails
      }
    }
    
    // Enhanced error logging with transaction ID
    if (!response.ok) {
      const errorMessage = `QuickBooks API Error (${operation}): ${response.status} ${response.statusText}`;
      if (intuitTid) {
        console.error(`${errorMessage} [TID: ${intuitTid}]`);
      } else {
        console.error(errorMessage);
      }
    }
    
    return response;
  }

  const QB_SERVICE_ITEM_NAME = 'Irrigation Services - IrrigoPro';

  // Shared helper: look up the "Irrigation Services - IrrigoPro" item in a QB account.
  // Returns { id, name } on success, or null if the lookup fails.
  async function lookupQBServiceItem(
    apiBase: string,
    realmId: string,
    accessToken: string
  ): Promise<{ id: string; name: string } | null> {
    try {
      const itemQuery = encodeURIComponent(
        `SELECT * FROM Item WHERE Name = '${QB_SERVICE_ITEM_NAME}' AND Active = true MAXRESULTS 1`
      );
      const res = await makeQuickBooksRequest(
        `${apiBase}/v3/company/${realmId}/query?query=${itemQuery}`,
        { method: 'GET', headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } },
        'QB Service Item Lookup',
        realmId
      );
      if (res.ok) {
        const data = await res.json();
        const items = data?.QueryResponse?.Item;
        if (items && items.length > 0) {
          return { id: String(items[0].Id), name: items[0].Name || QB_SERVICE_ITEM_NAME };
        }
      } else {
        const txt = await res.text();
        console.warn('[QB] Service item lookup failed:', res.status, txt);
      }
    } catch (err: any) {
      console.warn('[QB] Service item lookup threw:', err.message);
    }
    return null;
  }

  // Function to exchange authorization code for access tokens
  async function exchangeCodeForTokens(code: string, realmId: string, req: any) {
    const redirectUri = process.env.QUICKBOOKS_REDIRECT_URI;
    if (!redirectUri) {
      throw new Error('QUICKBOOKS_REDIRECT_URI environment variable is not set');
    }
    
    const tokenEndpoint = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
    const authHeader = Buffer.from(`${process.env.QUICKBOOKS_CLIENT_ID}:${process.env.QUICKBOOKS_CLIENT_SECRET}`).toString('base64');
    
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: redirectUri
    });

    // Use a plain fetch (not the auto-refresh wrapper) to avoid cascading refresh errors
    // during the initial handshake when there is no stored token yet.
    const response = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${authHeader}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json'
      },
      body: body.toString()
    });

    if (!response.ok) {
      const errorText = await response.text();
      const intuitTid = response.headers.get('intuit_tid');
      console.error('Token exchange failed:', response.status, errorText);
      throw new Error(`Token exchange failed: ${response.status} ${errorText}${intuitTid ? ` [TID: ${intuitTid}]` : ''}`);
    }

    const tokenData = await response.json();
    console.log('Successfully exchanged code for tokens');
    
    // Get company info from QuickBooks API
    try {
      // Use production QuickBooks API for deployment, sandbox for development
      const apiBase = process.env.NODE_ENV === 'production' 
        ? 'https://quickbooks.api.intuit.com' 
        : 'https://sandbox-quickbooks.api.intuit.com';
      const companyInfoResponse = await makeQuickBooksRequest(`${apiBase}/v3/company/${realmId}/companyinfo/${realmId}`, {
        headers: {
          'Authorization': `Bearer ${tokenData.access_token}`,
          'Accept': 'application/json'
        }
      }, 'Company Info', realmId);
      
      if (companyInfoResponse.ok) {
        const companyData = await companyInfoResponse.json();
        tokenData.companyName = companyData?.QueryResponse?.CompanyInfo?.[0]?.CompanyName || `Company ${realmId}`;
        console.log('Company info fetched successfully');
      } else {
        console.error('Failed to fetch company info:', companyInfoResponse.status);
      }
    } catch (companyError) {
      console.error('Failed to fetch company info:', companyError);
      tokenData.companyName = `Company ${realmId}`;
    }

    return tokenData;
  }

  // QuickBooks integration routes
  app.get("/api/quickbooks/auth", requireQuickBooksAccess, async (req, res) => {
    try {
      // Check if QuickBooks credentials are available
      if (!process.env.QUICKBOOKS_CLIENT_ID || !process.env.QUICKBOOKS_CLIENT_SECRET) {
        return res.status(400).json({ 
          message: "QuickBooks integration is not configured. Please contact your administrator to set up the QuickBooks credentials." 
        });
      }

      const redirectUri = process.env.QUICKBOOKS_REDIRECT_URI;
      if (!redirectUri) {
        console.warn('WARNING: QUICKBOOKS_REDIRECT_URI environment variable is not set');
        return res.status(400).json({
          message: "QuickBooks redirect URI is not configured. Please set the QUICKBOOKS_REDIRECT_URI environment variable."
        });
      }

      const state = crypto.randomBytes(16).toString('hex');
      // Store state + company ID in memory store for CSRF verification in the callback (10 min TTL)
      const authCompanyId = (req.headers['x-user-company-id'] as string) || null;
      oauthStateStore.set(state, { expiry: Date.now() + 10 * 60 * 1000, companyId: authCompanyId });
      
      // QuickBooks OAuth URL
      const authUrl = `https://appcenter.intuit.com/app/connect/oauth2?` +
        `client_id=${process.env.QUICKBOOKS_CLIENT_ID}&` +
        `scope=com.intuit.quickbooks.accounting&` +
        `redirect_uri=${encodeURIComponent(redirectUri)}&` +
        `response_type=code&` +
        `access_type=offline&` +
        `state=${state}`;
      
      res.json({ authUrl, state });
    } catch (error) {
      console.error("QuickBooks auth error:", error);
      res.status(500).json({ message: "Failed to generate QuickBooks auth URL" });
    }
  });

  app.get("/api/quickbooks/callback", async (req, res) => {
    try {
      const { code, state, realmId } = req.query;
      
      if (!code || !realmId) {
        return res.status(400).send(`
          <html>
            <body>
              <h2>QuickBooks Connection Failed</h2>
              <p>Missing authorization code or company ID.</p>
              <script>window.close();</script>
            </body>
          </html>
        `);
      }

      // Verify CSRF state parameter against in-memory store
      const stateEntry = state ? oauthStateStore.get(state as string) : undefined;
      if (!state || !stateEntry || Date.now() > stateEntry.expiry) {
        console.error('QuickBooks OAuth state mismatch or expired. Possible CSRF attack.', { received: state });
        return res.status(400).send(`
          <html>
            <head><title>Connection Failed</title></head>
            <body>
              <h2>QuickBooks Connection Failed</h2>
              <p>Security verification failed. Please try connecting again.</p>
              <button onclick="window.location.href='/billing'">Return to IrrigoPro</button>
            </body>
          </html>
        `);
      }
      // Retrieve company ID that was stored when the OAuth flow was initiated
      const oauthCompanyId = stateEntry.companyId;
      // Clear the state from store after verification
      oauthStateStore.delete(state as string);

      // Exchange the authorization code for access tokens
      console.log("QuickBooks OAuth callback received:", { code, state, realmId });
      
      try {
        // Exchange authorization code for real access tokens
        const tokenResponse = await exchangeCodeForTokens(code as string, realmId as string, req);
        
        const qbData = {
          accessToken: tokenResponse.access_token,
          refreshToken: tokenResponse.refresh_token,
          companyId: realmId as string,
          companyName: tokenResponse.companyName || `QuickBooks Company ${realmId}`,
          expiresAt: new Date(Date.now() + (tokenResponse.expires_in * 1000)),
          lastSync: new Date()
        };

        // Save to database — use the company ID that was stored when OAuth flow began
        console.log("Saving QuickBooks integration with realmId:", realmId, "companyId:", oauthCompanyId);
        
        await storage.saveQuickBooksIntegration({
          companyId: oauthCompanyId || realmId as string, // Prefer IrrigoPro company ID; fall back to QB realm ID
          accessToken: qbData.accessToken,
          refreshToken: qbData.refreshToken,
          realmId: realmId as string, // Keep QB realm ID for API calls
          expiresAt: qbData.expiresAt,
          connectionStatus: 'connected',        // Explicitly clear any previous reconnect_required state
          reconnectRequiredReason: null
        });

        console.log(`QuickBooks connection established for company: ${realmId}`);
        
        res.send(`
          <html>
            <head>
              <title>QuickBooks Connected Successfully</title>
              <style>
                body { 
                  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                  margin: 0; padding: 0; min-height: 100vh;
                  display: flex; align-items: center; justify-content: center;
                }
                .container { 
                  background: white; padding: 40px; border-radius: 12px; 
                  box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1);
                  max-width: 500px; text-align: center;
                }
                .success { color: #059669; font-size: 24px; margin-bottom: 20px; }
                .info { color: #6b7280; margin: 20px 0; line-height: 1.6; }
                .company-id { 
                  background: #f3f4f6; padding: 15px; border-radius: 8px; 
                  font-family: 'Monaco', 'Menlo', monospace; font-size: 14px;
                  border-left: 4px solid #059669;
                }
                .redirect-info { 
                  background: #eff6ff; color: #1d4ed8; padding: 15px; 
                  border-radius: 8px; margin-top: 20px; font-size: 14px;
                }
              </style>
            </head>
            <body>
              <div class="container">
                <div class="success">✅ QuickBooks Connected Successfully!</div>
                <p class="info">Your IrrigoPro account is now integrated with QuickBooks Online.</p>
                <div class="company-id">Company ID: <strong>${realmId}</strong></div>
                <div class="redirect-info">
                  Redirecting you back to IrrigoPro in <span id="countdown">3</span> seconds...
                </div>
              </div>
              <script>
                let count = 3;
                const countdown = document.getElementById('countdown');
                const timer = setInterval(() => {
                  count--;
                  countdown.textContent = count;
                  if (count <= 0) {
                    clearInterval(timer);
                    window.location.href = '${req.protocol}://${req.get('host')}/billing';
                  }
                }, 1000);
              </script>
            </body>
          </html>
        `);
      } catch (error) {
        console.error("QuickBooks callback error:", error);
        res.status(500).send(`
          <html>
            <head>
              <title>Connection Failed</title>
              <style>
                body { 
                  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                  background: #fee2e2; margin: 0; padding: 50px; text-align: center;
                }
                .container { 
                  background: white; padding: 40px; border-radius: 8px; 
                  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); max-width: 500px; margin: 0 auto;
                }
                .error { color: #dc2626; font-size: 20px; margin-bottom: 15px; }
              </style>
            </head>
            <body>
              <div class="container">
                <div class="error">❌ Connection Failed</div>
                <p>There was an error connecting to QuickBooks.</p>
                <p>Please try again or contact support if the problem persists.</p>
                <button onclick="window.location.href='${req.protocol}://${req.get('host')}/billing'">
                  Return to IrrigoPro
                </button>
              </div>
            </body>
          </html>
        `);
      }
    } catch (error) {
      console.error("QuickBooks callback error:", error);
      res.status(500).send(`
        <html>
          <body>
            <h2>QuickBooks Connection Error</h2>
            <p>An error occurred while connecting to QuickBooks.</p>
            <script>window.close();</script>
          </body>
        </html>
      `);
    }
  });

  // Clear QuickBooks connection (for reconnecting)
  app.post("/api/quickbooks/disconnect", requireQuickBooksAccess, async (req, res) => {
    try {
      const userCompanyId = (req.headers['x-user-company-id'] as string) || null;
      if (!userCompanyId) {
        return res.status(400).json({ success: false, message: "Company context is required to disconnect QuickBooks." });
      }
      
      // Remove QuickBooks integration for this company only
      await storage.disconnectQuickBooks(userCompanyId);
      
      res.json({ 
        success: true, 
        message: "QuickBooks connection cleared successfully. You can now reconnect." 
      });
    } catch (error) {
      console.error("Error clearing QuickBooks connection:", error);
      res.status(500).json({ 
        success: false, 
        message: "Failed to clear QuickBooks connection" 
      });
    }
  });

  // Add alias for status endpoint
  app.get("/api/quickbooks/status", requireQuickBooksAccess, async (req, res) => {
    try {
      // Get user's company ID from header (app uses localStorage/header auth, not server sessions)
      const userCompanyId = (req.headers['x-user-company-id'] as string) || null;
      
      // Get from database for this user's company
      const qbStatus = await storage.getQuickBooksCustomerStatus(userCompanyId);
      console.log("QuickBooks status for company", userCompanyId, ":", qbStatus);
      
      res.json(qbStatus);
    } catch (error) {
      console.error("Error getting QuickBooks status:", error);
      res.status(500).json({ 
        companyId: null,
        companyName: null,
        isConnected: false,
        lastSync: null,
        error: "Failed to check QuickBooks status"
      });
    }
  });

  app.get("/api/quickbooks/customers", requireQuickBooksAccess, async (req, res) => {
    try {
      // Get user's company ID from header (app uses localStorage/header auth, not server sessions)
      const userCompanyId = (req.headers['x-user-company-id'] as string) || null;
      
      const qbStatus = await storage.getQuickBooksCustomerStatus(userCompanyId);
      
      if (!qbStatus.isConnected) {
        return res.json([]);
      }

      // Get actual QuickBooks integration data - resolve realmId from companyId then fetch canonically
      const qbLookup = userCompanyId ? await storage.getQuickBooksIntegrationByCompanyId(userCompanyId) : null;
      const integration = qbLookup?.realmId ? await storage.getQuickBooksIntegration(qbLookup.realmId) : null;
      
      if (!integration || !integration.accessToken) {
        return res.json([]);
      }

      // Use production QuickBooks API for deployment, sandbox for development
      const apiBase = process.env.NODE_ENV === 'production' 
        ? 'https://quickbooks.api.intuit.com' 
        : 'https://sandbox-quickbooks.api.intuit.com';
      
      const customersResponse = await makeQuickBooksRequest(`${apiBase}/v3/company/${integration.realmId}/query?query=SELECT * FROM Customer WHERE Active = true`, {
        headers: {
          'Authorization': `Bearer ${integration.accessToken}`,
          'Accept': 'application/json'
        }
      }, 'Customers Query', integration.realmId);

      if (!customersResponse.ok) {
        const errorText = await customersResponse.text();
        const customersTid = customersResponse.headers.get('intuit_tid');
        console.error('Failed to fetch customers from QuickBooks:', customersResponse.status, errorText);
        
        // Handle 403 authorization errors
        if (customersResponse.status === 403) {
          console.error('QuickBooks authorization failed - connection needs to be re-established');
        }
        
        return res.json([]);
      }

      const qbData = await customersResponse.json();
      const qbCustomers = qbData?.QueryResponse?.Customer || [];
      
      res.json(qbCustomers);
    } catch (error) {
      console.error("Error fetching QuickBooks customers:", error);
      res.json([]);
    }
  });

  app.get("/api/quickbooks/connection", requireQuickBooksAccess, async (req, res) => {
    try {
      // In a real implementation, you would check stored tokens and validate them
      // For now, check if we have the required environment variables
      const hasCredentials = process.env.QUICKBOOKS_CLIENT_ID && process.env.QUICKBOOKS_CLIENT_SECRET;
      
      if (!hasCredentials) {
        return res.json({ 
          companyId: null,
          companyName: null,
          isConnected: false,
          lastSync: null,
          connectionStatus: 'disconnected',
          reconnectRequiredReason: null,
          error: "QuickBooks credentials not configured"
        });
      }
      
      // Get user's company ID from header (app uses localStorage/header auth, not server sessions)
      const userCompanyId = (req.headers['x-user-company-id'] as string) || null;
      
      // Get from database for this user's company
      const qbStatus = await storage.getQuickBooksCustomerStatus(userCompanyId);
      console.log("QuickBooks status for company", userCompanyId, ":", qbStatus);
      
      res.json(qbStatus);
    } catch (error) {
      console.error("Error getting QuickBooks connection status:", error);
      res.status(500).json({ 
        companyId: null,
        companyName: null,
        isConnected: false,
        lastSync: null,
        connectionStatus: 'error',
        reconnectRequiredReason: null,
        error: "Failed to check QuickBooks connection status"
      });
    }
  });

  app.get("/api/quickbooks/health", requireAuthentication, async (req, res) => {
    try {
      const integrations = await storage.getQuickBooksAllIntegrations();
      const now = new Date();

      const health = integrations.map((integ) => {
        const isTokenValid = integ.expiresAt ? new Date(integ.expiresAt) > now : false;
        const tokenAgeMs = integ.expiresAt
          ? new Date(integ.expiresAt).getTime() - now.getTime()
          : null;

        return {
          realmId: integ.realmId,
          companyId: integ.companyId,
          connectionStatus: integ.connectionStatus,
          isTokenValid,
          tokenExpiresAt: integ.expiresAt,
          tokenExpiresInMs: tokenAgeMs,
          lastRefreshAttempt: integ.lastRefreshAttempt,
          lastRefreshSuccess: integ.lastRefreshSuccess,
          lastRefreshFailure: integ.lastRefreshFailure,
          lastFailureReason: integ.reconnectRequiredReason ?? null,
          reconnectRequired: integ.connectionStatus === 'reconnect_required',
          tokenEnvironment: integ.tokenEnvironment,
          updatedAt: integ.updatedAt,
        };
      });

      res.json({ connections: health, count: health.length, checkedAt: now });
    } catch (error) {
      console.error("[QB health] Error fetching health data:", error);
      res.status(500).json({ message: "Failed to fetch QuickBooks connection health" });
    }
  });

  app.post("/api/quickbooks/sync-customers", requireQuickBooksAccess, async (req, res) => {
    try {
      
      // Get user's company ID from header (app uses localStorage/header auth, not server sessions)
      const userCompanyId = (req.headers['x-user-company-id'] as string) || null;
      
      // Get actual QuickBooks integration data - resolve realmId from companyId then fetch canonically
      const qbLookup = userCompanyId ? await storage.getQuickBooksIntegrationByCompanyId(userCompanyId) : null;
      const integration = qbLookup?.realmId ? await storage.getQuickBooksIntegration(qbLookup.realmId) : null;
      console.log("QuickBooks integration data available:", !!integration);
      
      if (!integration || !integration.accessToken) {
        console.log("Missing integration or access token");
        return res.status(400).json({ 
          success: false, 
          message: "QuickBooks not connected. Please connect to QuickBooks first." 
        });
      }

      // Use production QuickBooks API for deployment, sandbox for development
      const apiBase = process.env.NODE_ENV === 'production' 
        ? 'https://quickbooks.api.intuit.com' 
        : 'https://sandbox-quickbooks.api.intuit.com';
      
      const qbCustomers: Record<string, unknown>[] = [];
      let startPosition = 1;
      const maxResults = 1000;
      let fetchMore = true;

      while (fetchMore) {
        const query = `SELECT * FROM Customer WHERE Active = true STARTPOSITION ${startPosition} MAXRESULTS ${maxResults}`;
        const customersResponse = await makeQuickBooksRequest(`${apiBase}/v3/company/${integration.realmId}/query?query=${encodeURIComponent(query)}`, {
          headers: {
            'Authorization': `Bearer ${integration.accessToken}`,
            'Accept': 'application/json'
          }
        }, 'Customers Query', integration.realmId);

        if (!customersResponse.ok) {
          const errorText = await customersResponse.text();
          const customersTid = customersResponse.headers.get('intuit_tid');
          console.error('Failed to fetch customers from QuickBooks:', customersResponse.status, errorText);
          
          if (customersResponse.status === 403) {
            return res.status(403).json({ 
              success: false, 
              message: "QuickBooks authorization expired or invalid. Please reconnect to QuickBooks.",
              errorCode: "AUTHORIZATION_FAILED",
              needsReconnection: true
            });
          }
          
          return res.status(500).json({ 
            success: false, 
            message: `Failed to fetch customers from QuickBooks: ${customersResponse.status}${customersTid ? ` [TID: ${customersTid}]` : ''}` 
          });
        }

        const qbData = await customersResponse.json();
        const page: Record<string, unknown>[] = qbData?.QueryResponse?.Customer || [];
        qbCustomers.push(...page);

        console.log(`Fetched page starting at ${startPosition}: ${page.length} customers (total so far: ${qbCustomers.length})`);

        if (page.length < maxResults) {
          fetchMore = false;
        } else {
          startPosition += maxResults;
        }
      }

      console.log(`Found ${qbCustomers.length} active customers in QuickBooks`);
      
      const quickBooksCustomers = (qbCustomers as Record<string, unknown>[]).map((customer: Record<string, unknown>) => ({
        qb_id: customer.Id as string,
        name: (String(customer.DisplayName || '').trim() || String(customer.CompanyName || '').trim() || String(customer.Name || '').trim()),
        email: ((customer.PrimaryEmailAddr as Record<string, string> | undefined)?.Address || ''),
        phone: ((customer.PrimaryPhone as Record<string, string> | undefined)?.FreeFormNumber || ''),
        address: customer.BillAddr ? 
          `${(customer.BillAddr as Record<string, string>).Line1 || ''} ${(customer.BillAddr as Record<string, string>).City || ''} ${(customer.BillAddr as Record<string, string>).CountrySubDivisionCode || ''} ${(customer.BillAddr as Record<string, string>).PostalCode || ''}`.trim() 
          : ''
      }));
      
      console.log(`After mapping: ${quickBooksCustomers.length} customers to process`);
      console.log('Sample customer data:', quickBooksCustomers[0]);
      
      const validCustomers = quickBooksCustomers.filter(customer => customer.name && customer.name.trim() !== '');

      let customersAdded = 0;
      let customersAlreadySynced = 0;
      const results = [];

      console.log(`Processing ${validCustomers.length} valid customers`);
      
      for (const qbCustomer of validCustomers) {
        try {
          // Check if customer already exists
          const existingCustomer = await storage.getCustomerByQuickBooksId(qbCustomer.qb_id);
          
          if (!existingCustomer) {
            // Use company ID from header (set earlier in this route)
            const companyId = parseInt(userCompanyId || '1') || 1;
            
            // Create new customer from QuickBooks data with QuickBooks ID mapping
            const newCustomer = await storage.createCustomer({
              name: qbCustomer.name,
              email: qbCustomer.email,
              phone: qbCustomer.phone || '',
              address: qbCustomer.address || '',
              quickbooksId: qbCustomer.qb_id,
              companyId: companyId
            });
            
            customersAdded++;
            results.push({ action: 'created', customer: newCustomer });
          } else {
            customersAlreadySynced++;
            results.push({ action: 'exists', customer: existingCustomer });
          }
        } catch (error) {
          console.error(`Error syncing customer ${qbCustomer.name}:`, error);
          results.push({ action: 'error', customer: qbCustomer, error: error instanceof Error ? error.message : String(error) });
        }
      }

      res.json({
        success: true,
        customersAdded,
        customersAlreadySynced,
        totalCustomers: quickBooksCustomers.length,
        results,
        message: `${customersAdded} added, ${customersAlreadySynced} already synced`
      });

    } catch (error) {
      console.error("QuickBooks customer sync error:", error);
      res.status(500).json({ message: "Failed to sync customers from QuickBooks" });
    }
  });

  // QuickBooks Parts Sync - Only irrigation-related items
  app.post('/api/quickbooks/sync-parts', requireAuthentication, async (req, res) => {
    try {
      const userCompanyId = (req.headers['x-user-company-id'] as string) || null;
      const qbLookup = userCompanyId ? await storage.getQuickBooksIntegrationByCompanyId(userCompanyId) : null;
      const integration = qbLookup?.realmId ? await storage.getQuickBooksIntegration(qbLookup.realmId) : null;
      if (!integration || !integration.accessToken) {
        return res.status(400).json({ 
          success: false, 
          message: "QuickBooks not connected. Please connect QuickBooks first." 
        });
      }

      // Use production QuickBooks API for deployment, sandbox for development
      const apiBase = process.env.NODE_ENV === 'production' 
        ? 'https://quickbooks.api.intuit.com' 
        : 'https://sandbox-quickbooks.api.intuit.com';
      
      const itemsResponse = await makeQuickBooksRequest(`${apiBase}/v3/company/${integration.realmId}/query?query=SELECT * FROM Item WHERE Type = 'Inventory' AND Active = true`, {
        headers: {
          'Authorization': `Bearer ${integration.accessToken}`,
          'Accept': 'application/json'
        }
      }, 'Items Query', integration.realmId);

      if (!itemsResponse.ok) {
        const errorText = await itemsResponse.text();
        const itemsTid = itemsResponse.headers.get('intuit_tid');
        console.error('Failed to fetch items from QuickBooks:', itemsResponse.status, errorText);
        return res.status(500).json({ 
          success: false, 
          message: `Failed to fetch items from QuickBooks: ${itemsResponse.status}${itemsTid ? ` [TID: ${itemsTid}]` : ''}` 
        });
      }

      const qbData = await itemsResponse.json();
      const qbItems = qbData?.QueryResponse?.Item || [];
      
      console.log(`Found ${qbItems.length} inventory items in QuickBooks`);
      
      // Filter for irrigation-related parts only
      const irrigationKeywords = ['sprinkler', 'irrigation', 'valve', 'controller', 'nozzle', 'pipe', 'fitting', 'timer', 'drip', 'emitter', 'backflow', 'decoder', 'filter', 'bushing'];
      
      const irrigationParts = qbItems.filter((item: any) => {
        const name = (item.Name || '').toLowerCase();
        const description = (item.Description || '').toLowerCase();
        return irrigationKeywords.some(keyword => 
          name.includes(keyword) || description.includes(keyword)
        );
      });

      console.log(`Found ${irrigationParts.length} irrigation-related parts`);

      let syncedCount = 0;
      const results = [];

      for (const item of irrigationParts) {
        try {
          const partData = {
            name: item.Name || `Item ${item.Id}`,
            sku: item.Sku || item.Name || `QB-${item.Id}`,
            description: item.Description || '',
            price: (item.UnitPrice || 0).toString(),
            companyId: req.authenticatedUserCompanyId || 1,
            quickbooksId: item.Id,
            category: 'General'
          };

          // Check if part already exists by QuickBooks ID
          const existingPart = await storage.getPartByQuickBooksId(item.Id);
          
          if (!existingPart) {
            // Actually create the part in the database
            const newPart = await storage.createPart(partData);
            syncedCount++;
            results.push({ action: 'created', part: newPart });
          } else {
            results.push({ action: 'exists', part: existingPart });
          }
        } catch (error: any) {
          console.error(`Error processing part ${item.Id}:`, error);
          results.push({ 
            action: 'error', 
            part: { qb_id: item.Id, name: item.Name }, 
            error: error.message 
          });
        }
      }

      res.json({ 
        success: true, 
        syncedCount, 
        totalParts: irrigationParts.length, 
        filteredFrom: qbItems.length,
        results,
        message: `Found ${irrigationParts.length} irrigation parts out of ${qbItems.length} total inventory items`
      });
    } catch (error) {
      console.error('Error syncing parts from QuickBooks:', error);
      res.status(500).json({ success: false, message: "Failed to sync parts from QuickBooks" });
    }
  });

  app.post("/api/quickbooks/sync-estimate/:id", requireQuickBooksAccess, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      
      // Validate estimate ID is a valid number
      if (isNaN(id) || id <= 0) {
        return res.status(400).json({ message: "Invalid estimate ID" });
      }
      const estimate = await storage.getEstimate(id);
      if (!estimate) {
        return res.status(404).json({ message: "Estimate not found" });
      }
      
      // Get QuickBooks integration data - resolve realmId from companyId then fetch canonically
      const userCompanyId = (req.headers['x-user-company-id'] as string) || null;
      const qbLookup = userCompanyId ? await storage.getQuickBooksIntegrationByCompanyId(userCompanyId) : null;
      const integration = qbLookup?.realmId ? await storage.getQuickBooksIntegration(qbLookup.realmId) : null;
      if (!integration || !integration.accessToken) {
        return res.status(400).json({ 
          success: false, 
          message: "QuickBooks not connected. Please connect to QuickBooks first." 
        });
      }

      // Create invoice in QuickBooks using actual API
      const apiBase = process.env.NODE_ENV === 'production'
        ? 'https://quickbooks.api.intuit.com'
        : 'https://sandbox-quickbooks.api.intuit.com';

      // Look up the real QB customer ID from the estimate's linked customer
      let qbCustomerId: string | null = null;
      if (estimate.customerId) {
        const customer = await storage.getCustomer(estimate.customerId);
        if (!customer || !customer.quickbooksId) {
          return res.status(400).json({
            success: false,
            message: "Sync this customer to QuickBooks first before creating an invoice."
          });
        }
        qbCustomerId = customer.quickbooksId;
      }

      if (!qbCustomerId) {
        return res.status(400).json({
          success: false,
          message: "This estimate has no linked customer. Please assign a customer and sync them to QuickBooks first."
        });
      }

      // Look up service item dynamically (shared helper — no hardcoded IDs)
      const qbServiceItem = await lookupQBServiceItem(apiBase, integration.realmId, integration.accessToken);
      if (!qbServiceItem) {
        return res.status(502).json({
          success: false,
          message: `Could not find the QuickBooks item "${QB_SERVICE_ITEM_NAME}". Please create an active Service-type item with that exact name in QuickBooks and try again.`
        });
      }

      const lineAmount = parseFloat(estimate.totalAmount);

      // Prepare invoice data for QuickBooks
      const invoiceData = {
        Line: [{
          Amount: lineAmount,
          DetailType: "SalesItemLineDetail",
          SalesItemLineDetail: {
            ItemRef: {
              value: qbServiceItem.id,
              name: qbServiceItem.name
            },
            UnitPrice: lineAmount,
            Qty: 1
          },
          Description: estimate.title || 'Estimate'
        }],
        CustomerRef: {
          value: qbCustomerId
        }
      };

      console.log('[QB] Sending estimate invoice:', JSON.stringify(invoiceData, null, 2));

      const invoiceResponse = await makeQuickBooksRequest(`${apiBase}/v3/company/${integration.realmId}/invoice`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${integration.accessToken}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(invoiceData)
      }, 'Estimate Invoice Creation', integration.realmId);

      if (invoiceResponse.ok) {
        const invoiceResult = await invoiceResponse.json();
        const qbInvoiceId = invoiceResult?.Invoice?.Id;
        if (!qbInvoiceId) {
          console.error('[QB] Invoice created but no ID returned:', invoiceResult);
        }
        res.json({ 
          success: true,
          quickbooksId: qbInvoiceId,
          message: "Estimate synced to QuickBooks successfully" 
        });
      } else {
        const errorText = await invoiceResponse.text();
        const intuitTid = invoiceResponse.headers.get('intuit_tid');
        console.error('[QB] Estimate invoice creation failed:', invoiceResponse.status, invoiceResponse.statusText);
        console.error('[QB] Full error body:', errorText);
        if (intuitTid) console.error('[QB] TID:', intuitTid);
        res.status(502).json({ 
          success: false,
          message: `Failed to create QuickBooks invoice: ${invoiceResponse.status}${intuitTid ? ` [TID: ${intuitTid}]` : ''}`
        });
      }
    } catch (error) {
      console.error('Error syncing estimate to QuickBooks:', error);
      res.status(500).json({ message: "Failed to sync estimate to QuickBooks" });
    }
  });

  // Estimate approval workflow
  app.post("/api/estimates/:id/approve", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      
      // Validate estimate ID is a valid number
      if (isNaN(id) || id <= 0) {
        return res.status(400).json({ message: "Invalid estimate ID" });
      }
      const estimate = await storage.updateEstimate(id, { 
        status: "approved", 
        approvedAt: new Date() 
      });
      if (!estimate) {
        return res.status(404).json({ message: "Estimate not found" });
      }
      res.json({ message: "Estimate approved successfully", estimate });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to approve estimate" });
    }
  });

  app.post("/api/estimates/:id/reject", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      
      // Validate estimate ID is a valid number
      if (isNaN(id) || id <= 0) {
        return res.status(400).json({ message: "Invalid estimate ID" });
      }
      const estimate = await storage.updateEstimate(id, { 
        status: "rejected", 
        rejectedAt: new Date() 
      });
      if (!estimate) {
        return res.status(404).json({ message: "Estimate not found" });
      }
      res.json({ message: "Estimate rejected successfully", estimate });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to reject estimate" });
    }
  });

  // Approve estimate
  app.patch("/api/estimates/:id/approve", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      
      // Validate estimate ID is a valid number
      if (isNaN(id) || id <= 0) {
        return res.status(400).json({ message: "Invalid estimate ID" });
      }
      const estimate = await storage.getEstimate(id);
      if (!estimate) {
        return res.status(404).json({ message: "Estimate not found" });
      }
      if (estimate.status !== "pending") {
        return res.status(400).json({ message: "Only pending estimates can be approved" });
      }
      
      const updatedEstimate = await storage.updateEstimate(id, { 
        status: "approved", 
        approvalSource: "manual",
        approvedAt: new Date() 
      });
      
      // Auto-convert to work order (per business rule: estimates auto-create work orders when approved)
      let workOrder = null;
      try {
        workOrder = await storage.createWorkOrderFromEstimate(id);
        
        // Auto-assign to the company's irrigation manager
        const irrigationManager = await storage.getIrrigationManagerForCompany(estimate.companyId!);
        if (irrigationManager && workOrder) {
          await storage.assignWorkOrder(workOrder.id, irrigationManager.id, irrigationManager.name);
          
          // Create notification for the assigned manager
          await storage.createNotification({
            userId: irrigationManager.id,
            type: 'work_order_assigned',
            title: 'New Work Order Assigned',
            message: `Work order ${workOrder.workOrderNumber} for ${estimate.customerName} has been auto-assigned to you from approved estimate.`,
            isRead: false,
          });
        }
      } catch (workOrderError) {
        console.error('Auto work order creation failed:', workOrderError);
        // Continue even if work order creation fails - estimate is still approved
      }
      
      res.json({ 
        message: "Estimate approved successfully", 
        estimate: updatedEstimate,
        workOrderCreated: !!workOrder,
        workOrderNumber: workOrder?.workOrderNumber
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to approve estimate" });
    }
  });

  // Reject estimate
  app.patch("/api/estimates/:id/reject", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      
      // Validate estimate ID is a valid number
      if (isNaN(id) || id <= 0) {
        return res.status(400).json({ message: "Invalid estimate ID" });
      }
      const estimate = await storage.getEstimate(id);
      if (!estimate) {
        return res.status(404).json({ message: "Estimate not found" });
      }
      if (estimate.status !== "pending") {
        return res.status(400).json({ message: "Only pending estimates can be rejected" });
      }
      
      const updatedEstimate = await storage.updateEstimate(id, { status: "rejected" });
      
      res.json({ 
        message: "Estimate rejected successfully", 
        estimate: updatedEstimate
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to reject estimate" });
    }
  });

  // Send approval email to customer
  app.post("/api/estimates/:id/send-approval-email", requireAuthentication, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const estimate = await storage.getEstimate(id);
      if (!estimate) {
        return res.status(404).json({ message: "Estimate not found" });
      }
      if (estimate.status !== "pending") {
        return res.status(400).json({ message: "Only pending estimates can have approval emails sent" });
      }

      // Generate secure approval token with 30-day expiration
      const crypto = await import('crypto');
      const approvalToken = crypto.randomBytes(32).toString('hex');
      const tokenExpiresAt = new Date();
      tokenExpiresAt.setDate(tokenExpiresAt.getDate() + 30); // Token expires in 30 days
      
      // Update estimate with approval token, expiration, and sent timestamp
      await storage.updateEstimate(id, {
        approvalToken,
        tokenExpiresAt,
        approvalSentAt: new Date()
      });

      // Get estimate with items for email
      const estimateWithItems = await storage.getEstimate(id);
      const items = estimateWithItems?.items ?? [];
      const laborRate = parseFloat(estimate.laborRate);

      const { EmailService } = await import('./email-service');

      await EmailService.sendEstimateApprovalEmail({
        estimateId: estimate.id,
        estimateNumber: estimate.estimateNumber,
        customerName: estimate.customerName,
        customerEmail: estimate.customerEmail,
        projectName: estimate.projectName,
        projectAddress: estimate.projectAddress || undefined,
        totalAmount: `$${parseFloat(estimate.totalAmount).toFixed(2)}`,
        approvalToken,
        estimateDate: new Date(estimate.estimateDate).toLocaleDateString(),
        createdBy: estimate.createdBy,
        companyId: estimate.companyId!,
        items: items.map(item => ({
          description: item.description || item.partName,
          partName: item.partName,
          quantity: item.quantity,
          partPrice: parseFloat(item.partPrice),
          laborHours: parseFloat(item.laborHours),
          partsCost: parseFloat(item.totalPrice),
          laborCost: parseFloat(item.laborHours) * laborRate,
          lineTotal: parseFloat(item.totalPrice) + parseFloat(item.laborHours) * laborRate,
        })),
      });

      res.json({ 
        message: "Approval email sent successfully",
        sentAt: new Date()
      });
    } catch (error) {
      console.error('Error sending approval email:', error);
      res.status(500).json({ message: "Failed to send approval email" });
    }
  });

  // Approve estimate via token (customer clicks link)
  app.get("/api/estimates/approve-via-token/:token", async (req, res) => {
    try {
      const token = req.params.token;
      const estimates = await storage.getEstimates();
      const estimate = estimates.find(e => e.approvalToken === token);
      
      if (!estimate) {
        return res.status(404).send(`
          <html><body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
            <h2 style="color: #ef4444;">Invalid or Expired Link</h2>
            <p>This approval link is no longer valid. Please contact us directly.</p>
          </body></html>
        `);
      }

      // Check if token has expired
      if (estimate.tokenExpiresAt && new Date() > new Date(estimate.tokenExpiresAt)) {
        // Mark estimate as expired
        await storage.updateEstimate(estimate.id, { status: 'expired' });
        return res.status(400).send(`
          <html><body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
            <h2 style="color: #ef4444;">Link Expired</h2>
            <p>This approval link has expired. Please contact us to request a new estimate.</p>
          </body></html>
        `);
      }

      if (estimate.status !== "pending") {
        return res.status(400).send(`
          <html><body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
            <h2 style="color: #f59e0b;">Already Responded</h2>
            <p>You have already responded to this estimate. Thank you!</p>
          </body></html>
        `);
      }

      // Approve the estimate with approval source tracking
      await storage.updateEstimate(estimate.id, {
        status: "approved",
        approvalSource: 'email_link',
        approvalRespondedAt: new Date(),
        approvedAt: new Date()
      });

      // Auto-convert to work order (per business rule: estimates auto-create work orders when approved)
      let workOrder = null;
      try {
        workOrder = await storage.createWorkOrderFromEstimate(estimate.id);
        
        // Auto-assign to the company's irrigation manager
        const irrigationManager = await storage.getIrrigationManagerForCompany(estimate.companyId!);
        if (irrigationManager && workOrder) {
          await storage.assignWorkOrder(workOrder.id, irrigationManager.id, irrigationManager.name);
          
          // Create notification for the assigned manager
          await storage.createNotification({
            userId: irrigationManager.id,
            type: 'work_order_assigned',
            title: 'New Work Order Assigned',
            message: `Work order ${workOrder.workOrderNumber} for ${estimate.customerName} has been auto-assigned to you from approved estimate.`,
            isRead: false,
          });
        }
      } catch (workOrderError) {
        console.error('Auto work order creation failed:', workOrderError);
        // Continue even if work order creation fails - estimate is still approved
      }

      // Notify company admins that the customer approved the estimate
      try {
        const allUsers = await storage.getUsers();
        const adminUsers = allUsers.filter(u =>
          u.role === "company_admin" &&
          u.companyId === estimate.companyId
        );
        for (const admin of adminUsers) {
          await storage.createNotification({
            userId: admin.id,
            type: "estimate_approved",
            title: "Estimate Approved by Customer",
            message: `Customer approved estimate ${estimate.estimateNumber} for ${estimate.customerName}.${workOrder ? ` Work order ${workOrder.workOrderNumber} has been created.` : ''}`,
            relatedEntityType: "estimate",
            relatedEntityId: estimate.id,
            isRead: false,
          });
        }
      } catch (notifError) {
        console.error('Failed to send approval notifications:', notifError);
      }

      // Send confirmation email
      const { EmailService } = await import('./email-service');
      await EmailService.sendApprovalConfirmation(
        estimate.customerEmail,
        estimate.estimateNumber,
        true
      );

      // Return JSON response for the approval page
      res.json({
        success: true,
        message: "Estimate approved successfully",
        estimateNumber: estimate.estimateNumber,
        customerEmail: estimate.customerEmail,
        workOrderCreated: !!workOrder,
        workOrderNumber: workOrder?.workOrderNumber
      });
    } catch (error) {
      console.error('Error approving estimate via token:', error);
      res.status(500).send(`
        <html><body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
          <h2 style="color: #ef4444;">Error</h2>
          <p>Something went wrong. Please contact us directly.</p>
        </body></html>
      `);
    }
  });

  // Reject estimate via token (customer clicks link)
  app.get("/api/estimates/reject-via-token/:token", async (req, res) => {
    try {
      const token = req.params.token;
      const estimates = await storage.getEstimates();
      const estimate = estimates.find(e => e.approvalToken === token);
      
      if (!estimate) {
        return res.status(404).send(`
          <html><body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
            <h2 style="color: #ef4444;">Invalid or Expired Link</h2>
            <p>This approval link is no longer valid. Please contact us directly.</p>
          </body></html>
        `);
      }

      if (estimate.status !== "pending") {
        return res.status(400).send(`
          <html><body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
            <h2 style="color: #f59e0b;">Already Responded</h2>
            <p>You have already responded to this estimate. Thank you!</p>
          </body></html>
        `);
      }

      // Reject the estimate with approval source tracking
      await storage.updateEstimate(estimate.id, {
        status: "rejected",
        approvalSource: 'email_link',
        approvalRespondedAt: new Date(),
        rejectedAt: new Date()
      });

      // Notify company admins and managers that customer rejected the estimate
      try {
        const allUsers = await storage.getUsers();
        const notifyUsers = allUsers.filter(u =>
          (u.role === "company_admin" || u.role === "irrigation_manager") &&
          u.companyId === estimate.companyId
        );
        for (const user of notifyUsers) {
          await storage.createNotification({
            userId: user.id,
            type: "estimate_rejected",
            title: "Estimate Rejected by Customer",
            message: `Customer declined estimate ${estimate.estimateNumber} for ${estimate.customerName}.`,
            relatedEntityType: "estimate",
            relatedEntityId: estimate.id,
            isRead: false,
          });
        }
      } catch (notifError) {
        console.error('Failed to send rejection notifications:', notifError);
      }

      // Send confirmation email
      const { EmailService } = await import('./email-service');
      await EmailService.sendApprovalConfirmation(
        estimate.customerEmail,
        estimate.estimateNumber,
        false
      );

      res.send(`
        <html><body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
          <div style="max-width: 600px; margin: 0 auto; background: #fef2f2; border: 1px solid #dc2626; border-radius: 12px; padding: 40px;">
            <h1 style="color: #dc2626; margin-bottom: 20px;">Estimate Declined</h1>
            <p style="font-size: 18px; color: #374151; margin-bottom: 20px;">
              Thank you for your response regarding estimate ${estimate.estimateNumber}.
            </p>
            <p style="color: #6b7280;">
              We understand this estimate doesn't meet your needs at this time. Please feel free to contact us if you'd like to discuss alternatives or have any questions.
            </p>
            <p style="color: #6b7280; margin-top: 30px;">
              A confirmation email has been sent to ${estimate.customerEmail}.
            </p>
          </div>
        </body></html>
      `);
    } catch (error) {
      console.error('Error rejecting estimate via token:', error);
      res.status(500).send(`
        <html><body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
          <h2 style="color: #ef4444;">Error</h2>
          <p>Something went wrong. Please contact us directly.</p>
        </body></html>
      `);
    }
  });

  // Convert estimate to work order
  app.post("/api/estimates/:id/convert-to-work-order", requireAuthentication, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      
      // Use the new storage function that handles all validation and conversion
      const workOrder = await storage.createWorkOrderFromEstimate(id);
      
      // Optionally assign to a technician if provided in request
      if (req.body.assignedTechnicianId) {
        const assignedUser = await storage.getUser(req.body.assignedTechnicianId);
        if (assignedUser) {
          await storage.assignWorkOrder(workOrder.id, assignedUser.id, assignedUser.name);
        }
      }
      
      // Update scheduled date if provided
      if (req.body.scheduledDate) {
        await storage.updateWorkOrder(workOrder.id, {
          scheduledDate: new Date(req.body.scheduledDate)
        });
      }
      
      // Add notes if provided
      if (req.body.notes) {
        await storage.updateWorkOrder(workOrder.id, {
          notes: req.body.notes
        });
      }
      
      res.json({ 
        message: "Work order created successfully", 
        workOrder,
        estimateId: id
      });
    } catch (error) {
      console.error("Error converting estimate to work order:", error);
      if (error instanceof Error) {
        if (error.message.includes('not found')) {
          return res.status(404).json({ message: error.message });
        }
        if (error.message.includes('must be approved') || error.message.includes('already exists')) {
          return res.status(400).json({ message: error.message });
        }
      }
      res.status(500).json({ message: "Failed to create work order" });
    }
  });

  // Customer Integration API Routes
  
  // Google Sheets Customer Integration
  app.get("/api/integrations/google-sheets/customers/status", async (req, res) => {
    try {
      const status = await storage.getGoogleSheetsCustomerStatus();
      res.json(status);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to get Google Sheets status" });
    }
  });

  app.post("/api/integrations/google-sheets/customers/connect", async (req, res) => {
    try {
      const { sheetUrl } = req.body;
      if (!sheetUrl) {
        return res.status(400).json({ message: "Sheet URL is required" });
      }
      await storage.connectGoogleSheetsCustomers(sheetUrl);
      res.json({ message: "Connected to Google Sheets successfully" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to connect to Google Sheets" });
    }
  });

  app.post("/api/integrations/google-sheets/customers/sync", async (req, res) => {
    try {
      const result = await storage.syncCustomersFromGoogleSheets("placeholder-url");
      res.json(result);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to sync customers from Google Sheets" });
    }
  });

  app.post("/api/integrations/google-sheets/customers/disconnect", async (req, res) => {
    try {
      await storage.disconnectGoogleSheetsCustomers();
      res.json({ message: "Disconnected from Google Sheets successfully" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to disconnect from Google Sheets" });
    }
  });

  // QuickBooks Customer Integration
  app.get("/api/integrations/quickbooks/customers/status", async (req, res) => {
    try {
      const status = await storage.getQuickBooksCustomerStatus();
      res.json(status);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to get QuickBooks status" });
    }
  });

  app.get("/api/integrations/quickbooks/customers/auth-url", async (req, res) => {
    try {
      const authData = await storage.getQuickBooksAuthUrl();
      res.json(authData);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to get QuickBooks auth URL" });
    }
  });

  app.post("/api/integrations/quickbooks/customers/connect", async (req, res) => {
    try {
      // In a real implementation, this would handle OAuth callback
      // For demo purposes, we'll simulate a successful connection
      await storage.connectQuickBooks("demo_access_token", "demo_refresh_token", "demo_realm_id", "Demo Company");
      res.json({ message: "Connected to QuickBooks successfully" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to connect to QuickBooks" });
    }
  });

  app.post("/api/integrations/quickbooks/customers/sync", async (req, res) => {
    try {
      const result = await storage.syncQuickBooksCustomers();
      res.json(result);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: error instanceof Error ? error.message : "Failed to sync customers from QuickBooks" });
    }
  });

  app.post("/api/integrations/quickbooks/customers/disconnect", requireAuthentication, async (req, res) => {
    try {
      // req.authenticatedUserCompanyId is set by requireAuthentication from x-user-company-id header
      const userCompanyId = req.authenticatedUserCompanyId ? req.authenticatedUserCompanyId.toString() : null;
      if (!userCompanyId) {
        return res.status(400).json({ message: "Company context is required to disconnect QuickBooks." });
      }
      await storage.disconnectQuickBooks(userCompanyId);
      res.json({ message: "Disconnected from QuickBooks successfully" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to disconnect from QuickBooks" });
    }
  });

  // Work order completion route
  app.post("/api/work-orders/complete", requireAuthentication, async (req, res) => {
    try {
      const {
        workOrderId,
        workSummary,
        customerNotes,
        completedAt,
        totalHours,
        usedParts,
        photos,
        totalPartsCost,
        branchName: incomingBranchName,
        aiInputs: reqAiInputs,
        aiShortDescription,
        aiDetailedDescription,
      } = req.body;

      // Billing lock: prevent completing an already-billed work order
      const existingWoForComplete = await storage.getWorkOrder(workOrderId);
      if (existingWoForComplete && (existingWoForComplete.invoiceId || existingWoForComplete.status === 'billed')) {
        return res.status(409).json({ message: "This record has been billed and cannot be edited." });
      }

      const completedByUserId = req.authenticatedUserId;
      const completedByUser = completedByUserId ? await storage.getUser(completedByUserId) : undefined;
      const completedByUserName = completedByUser?.name || req.headers['x-user-name'];

      // Merge creation photos with completion photos (don't overwrite)
      const existingWorkOrder = await storage.getWorkOrder(workOrderId);

      // Branch enforcement: if the customer has branches configured, branchName must be present
      if (existingWorkOrder?.customerId) {
        const customer = await storage.getCustomer(existingWorkOrder.customerId);
        if (customer && Array.isArray(customer.branches) && customer.branches.length > 0) {
          const effectiveBranch = incomingBranchName || existingWorkOrder.branchName;
          if (!effectiveBranch || String(effectiveBranch).trim() === '') {
            return res.status(400).json({ message: "Branch is required for this customer. Please select a branch before completing the work order." });
          }
        }
      }

      // Load customer to snapshot their labor rate
      const customerForRates = existingWorkOrder?.customerId
        ? await storage.getCustomerById(existingWorkOrder.customerId)
        : undefined;

      // Snapshot the customer's configured labor rate at the time of completion.
      const appliedLaborRate = parseFloat(customerForRates?.laborRate || '0');

      // Calculate totals
      const laborHours = parseFloat(totalHours || '0');
      const partsCost = parseFloat(totalPartsCost || '0');

      const laborSubtotal = laborHours * appliedLaborRate;
      const partsSubtotal = partsCost;
      const totalAmount = laborSubtotal + partsSubtotal;

      const creationPhotos: string[] = existingWorkOrder?.photos || [];
      const completionPhotos: string[] = photos || [];
      const mergedPhotos = [...creationPhotos, ...completionPhotos];

      // Update work order with completion details and calculated totals
      // Field completion routes into pending_manager_review for manager approval
      const workOrder = await storage.updateWorkOrder(workOrderId, {
        status: 'pending_manager_review',
        completedAt: new Date(completedAt),
        completedByUserId: completedByUserId || undefined,
        completedByUserName: completedByUserName as string,
        workSummary,
        customerNotes,
        totalHours: laborHours.toString(),
        photos: mergedPhotos,
        totalPartsCost: partsCost.toString(),
        laborSubtotal: laborSubtotal.toFixed(2),
        partsSubtotal: partsSubtotal.toFixed(2),
        totalAmount: totalAmount.toFixed(2),
        laborRate: appliedLaborRate.toFixed(2),
        appliedLaborRate: appliedLaborRate.toFixed(2),
        ...(incomingBranchName ? { branchName: incomingBranchName } : {}),
        ...(reqAiInputs ? { aiInputs: reqAiInputs } : {}),
        ...(aiShortDescription ? { aiShortDescription } : {}),
        ...(aiDetailedDescription ? { aiDetailedDescription } : {}),
      });

      if (!workOrder) {
        return res.status(404).json({ message: "Work order not found" });
      }

      // Save used parts information
      for (const part of usedParts || []) {
        // Get part details from database
        const partDetails = await storage.getPart(part.partId);
        if (partDetails) {
          await storage.addWorkOrderItem({
            workOrderId,
            partId: part.partId,
            partName: partDetails.name,
            partPrice: partDetails.price,
            quantity: part.quantity,
            totalPrice: part.totalCost,
            laborHours: "0"
          });
        }
      }

      // Log AI generation data if provided
      if (reqAiInputs) {
        try {
          await storage.createAiGenerationLog({
            userId: completedByUserId || null,
            entityType: "work_order",
            entityId: workOrderId,
            inputs: reqAiInputs,
            rawOutput: JSON.stringify({ aiShortDescription, aiDetailedDescription }),
            templateVersion: "v1",
          });
        } catch (logErr) {
          console.error("[AI] Failed to write audit log for work order completion:", logErr);
        }
      }

      // Notify managers about work order completion
      const managers = await storage.getUsers();
      const managerUsers = managers.filter(u => u.role === "irrigation_manager" || u.role === "admin");
      
      for (const manager of managerUsers) {
        await storage.createNotification({
          userId: manager.id,
          type: "work_order_completed",
          title: "Work Order Completed",
          message: `Work order ${workOrder.workOrderNumber} has been completed by ${completedByUserName || workOrder.assignedTechnicianName}.`,
          relatedEntityType: "work_order",
          relatedEntityId: workOrderId
        });
      }

      res.json({ message: "Work order completed successfully", workOrder });
    } catch (error) {
      console.error("Error completing work order:", error);
      res.status(500).json({ message: "Failed to complete work order" });
    }
  });

  app.post("/api/work-orders/:id/complete", requireAuthentication, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      
      const completedByUserId = req.authenticatedUserId;
      const completedByUser = completedByUserId ? await storage.getUser(completedByUserId) : undefined;
      const completedByUserName = completedByUser?.name || req.headers['x-user-name'];

      // Read existing work order to snapshot rates from customer
      const existingWorkOrder = await storage.getWorkOrder(id);
      if (!existingWorkOrder) {
        return res.status(404).json({ message: "Work order not found" });
      }

      // Snapshot the customer's configured labor rate at the time of completion.
      const customerForRates = existingWorkOrder.customerId
        ? await storage.getCustomerById(existingWorkOrder.customerId)
        : undefined;
      const appliedLaborRate = parseFloat(customerForRates?.laborRate || '0');

      // Calculate totals
      const laborHours = parseFloat(existingWorkOrder.totalHours || '0');
      const partsCost = parseFloat(existingWorkOrder.totalPartsCost || '0');
      const laborSubtotal = laborHours * appliedLaborRate;
      const partsSubtotal = partsCost;
      const totalAmount = laborSubtotal + partsSubtotal;

      // Field completion routes into pending_manager_review for manager approval
      const workOrder = await storage.updateWorkOrder(id, {
        status: "pending_manager_review",
        completedAt: new Date(),
        completedByUserId: completedByUserId || undefined,
        completedByUserName: completedByUserName as string,
        laborSubtotal: laborSubtotal.toFixed(2),
        partsSubtotal: partsSubtotal.toFixed(2),
        totalAmount: totalAmount.toFixed(2),
        laborRate: appliedLaborRate.toFixed(2),
        appliedLaborRate: appliedLaborRate.toFixed(2),
      });
      if (!workOrder) {
        return res.status(404).json({ message: "Work order not found" });
      }

      // Notify managers about work order completion / pending review
      const managers = await storage.getUsers();
      const managerUsers = managers.filter(u => u.role === "irrigation_manager" || u.role === "admin");
      
      for (const manager of managerUsers) {
        await storage.createNotification({
          userId: manager.id,
          type: "work_order_completed",
          title: "Work Order Pending Review",
          message: `Work order ${workOrder.workOrderNumber} has been completed and is awaiting your review.`,
          relatedEntityType: "work_order",
          relatedEntityId: id
        });
      }
      
      res.json(workOrder);
    } catch (error) {
      console.error("Error completing work order:", error);
      res.status(500).json({ message: "Failed to complete work order" });
    }
  });

  // Manager approval gate endpoints
  // Approve a work order — transitions pending_manager_review -> approved_passed_to_billing
  app.post("/api/work-orders/:id/approve", requireAuthentication, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const userRole = req.authenticatedUserRole;
      const userId = req.authenticatedUserId;

      if (userRole !== 'irrigation_manager' && userRole !== 'company_admin' && userRole !== 'super_admin') {
        return res.status(403).json({ message: "Only irrigation managers and company admins can approve work orders." });
      }

      const workOrder = await storage.getWorkOrder(id);
      if (!workOrder) {
        return res.status(404).json({ message: "Work order not found" });
      }
      if (workOrder.status !== 'pending_manager_review') {
        return res.status(400).json({ message: "Work order must be in Pending Manager Review to approve." });
      }

      const approverUser = userId ? await storage.getUser(userId) : undefined;
      const approverName = approverUser?.name || 'Manager';

      const partsSnapshot = JSON.stringify({
        partsSubtotal: workOrder.partsSubtotal,
      });
      const laborSnapshot = JSON.stringify({
        totalHours: workOrder.totalHours,
        laborRate: workOrder.appliedLaborRate || workOrder.laborRate,
        laborSubtotal: workOrder.laborSubtotal,
      });

      const updated = await storage.updateWorkOrder(id, {
        status: 'approved_passed_to_billing',
        approvedBy: approverName,
        approvedByUserId: userId || undefined,
        approvedAt: new Date(),
        approvedTotal: workOrder.totalAmount,
        approvedPartsSnapshot: partsSnapshot,
        approvedLaborSnapshot: laborSnapshot,
      } as any);

      res.json({ message: "Work order approved and passed to billing", workOrder: updated });
    } catch (error) {
      console.error("Error approving work order:", error);
      res.status(500).json({ message: "Failed to approve work order" });
    }
  });

  // Return a work order for correction — transitions pending_manager_review -> in_progress (editable)
  app.post("/api/work-orders/:id/return-for-correction", requireAuthentication, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const userRole = req.authenticatedUserRole;

      if (userRole !== 'irrigation_manager' && userRole !== 'company_admin' && userRole !== 'super_admin') {
        return res.status(403).json({ message: "Only irrigation managers and company admins can return work orders for correction." });
      }

      const workOrder = await storage.getWorkOrder(id);
      if (!workOrder) {
        return res.status(404).json({ message: "Work order not found" });
      }
      if (workOrder.status !== 'pending_manager_review') {
        return res.status(400).json({ message: "Work order must be in Pending Manager Review to return for correction." });
      }

      const { notes } = req.body;

      const updated = await storage.updateWorkOrder(id, {
        status: 'in_progress',
        ...(notes ? { notes: `${workOrder.notes ? workOrder.notes + '\n' : ''}[Returned for correction: ${notes}]` } : {}),
      } as any);

      res.json({ message: "Work order returned for correction", workOrder: updated });
    } catch (error) {
      console.error("Error returning work order for correction:", error);
      res.status(500).json({ message: "Failed to return work order for correction" });
    }
  });

  // Approve a billing sheet — transitions pending_manager_review -> approved_passed_to_billing
  app.post("/api/billing-sheets/:id/approve", requireAuthentication, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const userRole = req.authenticatedUserRole;
      const userId = req.authenticatedUserId;

      if (userRole !== 'irrigation_manager' && userRole !== 'company_admin' && userRole !== 'super_admin') {
        return res.status(403).json({ message: "Only irrigation managers and company admins can approve billing sheets." });
      }

      const billingSheet = await storage.getBillingSheetById(id);
      if (!billingSheet) {
        return res.status(404).json({ message: "Billing sheet not found" });
      }
      if (billingSheet.status !== 'pending_manager_review') {
        return res.status(400).json({ message: "Billing sheet must be in Pending Manager Review to approve." });
      }

      const approverUser = userId ? await storage.getUser(userId) : undefined;
      const approverName = approverUser?.name || 'Manager';

      const partsSnapshot = JSON.stringify({
        partsSubtotal: billingSheet.partsSubtotal,
      });
      const laborSnapshot = JSON.stringify({
        totalHours: billingSheet.totalHours,
        laborRate: billingSheet.laborRate,
        laborSubtotal: billingSheet.laborSubtotal,
      });

      const updated = await storage.updateBillingSheet(id, {
        status: 'approved_passed_to_billing',
        approvedBy: approverName,
        approvedByUserId: userId || undefined,
        approvedAt: new Date(),
        approvedTotal: billingSheet.totalAmount,
        approvedPartsSnapshot: partsSnapshot,
        approvedLaborSnapshot: laborSnapshot,
      } as any);

      res.json({ message: "Billing sheet approved and passed to billing", billingSheet: updated });
    } catch (error) {
      console.error("Error approving billing sheet:", error);
      res.status(500).json({ message: "Failed to approve billing sheet" });
    }
  });

  // Return a billing sheet for correction — transitions pending_manager_review -> submitted (or draft)
  app.post("/api/billing-sheets/:id/return-for-correction", requireAuthentication, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const userRole = req.authenticatedUserRole;

      if (userRole !== 'irrigation_manager' && userRole !== 'company_admin' && userRole !== 'super_admin') {
        return res.status(403).json({ message: "Only irrigation managers and company admins can return billing sheets for correction." });
      }

      const billingSheet = await storage.getBillingSheetById(id);
      if (!billingSheet) {
        return res.status(404).json({ message: "Billing sheet not found" });
      }
      if (billingSheet.status !== 'pending_manager_review') {
        return res.status(400).json({ message: "Billing sheet must be in Pending Manager Review to return for correction." });
      }

      const { notes } = req.body;

      const updated = await storage.updateBillingSheet(id, {
        status: 'draft',
        ...(notes ? { notes: `${billingSheet.notes ? billingSheet.notes + '\n' : ''}[Returned for correction: ${notes}]` } : {}),
      } as any);

      res.json({ message: "Billing sheet returned for correction", billingSheet: updated });
    } catch (error) {
      console.error("Error returning billing sheet for correction:", error);
      res.status(500).json({ message: "Failed to return billing sheet for correction" });
    }
  });

  // Invoice routes (placeholder endpoints)
  app.get("/api/invoices", async (req, res) => {
    try {
      const customerId = req.query.customerId ? parseInt(req.query.customerId as string) : undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
      
      const allInvoices = await storage.getInvoices();
      
      // Filter by customer if provided
      let invoices = customerId 
        ? allInvoices.filter(inv => inv.customerId === customerId)
        : allInvoices;
      
      // Limit results
      invoices = invoices.slice(0, limit);
      
      // Sort by creation date, newest first
      invoices.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      
      res.json(invoices);
    } catch (error) {
      console.error('Error fetching invoices:', error);
      res.status(500).json({ message: "Failed to fetch invoices" });
    }
  });

  app.post("/api/work-orders/:id/create-invoice", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      // This would need to be implemented in storage
      res.json({ message: "Invoice creation endpoint ready for implementation" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to create invoice from work order" });
    }
  });

  app.post("/api/work-orders/:id/sync-quickbooks", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      // This would need to be implemented for QuickBooks sync
      res.json({ message: "QuickBooks sync endpoint ready for implementation" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to sync to QuickBooks" });
    }
  });

  // Billing Sheets API - for work done without work orders
  // Note: Pricing fields are stripped for field_tech role via applyPricingVisibility
  app.get("/api/billing-sheets", async (req, res) => {
    try {
      const { technician } = req.query;
      
      let billingSheets;
      if (technician) {
        billingSheets = await storage.getBillingSheetsByTechnician(parseInt(technician as string));
      } else {
        billingSheets = await storage.getAllBillingSheets();
      }
      
      // Strip pricing fields for field technicians
      res.json(applyPricingVisibility(req, billingSheets));
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch billing sheets" });
    }
  });

  // Report: billing sheets created before the photo-save fix (Task #143) that
  // currently have zero photos. Used by managers to chase up techs to re-attach
  // photos via the post-creation "Add Photos" UI.
  // Cutoff = commit time of the fix (2026-04-22 14:22:39 UTC).
  const PHOTO_FIX_CUTOFF = new Date("2026-04-22T14:22:39Z");
  app.get("/api/billing-sheets/missing-photos", requireAuthentication, async (req: any, res) => {
    try {
      const role = req.authenticatedUserRole;
      if (role !== 'company_admin' && role !== 'super_admin' && role !== 'irrigation_manager' && role !== 'billing_manager') {
        return res.status(403).json({ message: "Access denied." });
      }

      // Tenant scoping: non-super_admin requesters only see techs/sheets within
      // their own company. We resolve company ownership through the assigned
      // technician's companyId since billing_sheets has no direct companyId column.
      const requesterCompanyId: number | null = req.authenticatedUserCompanyId ?? null;
      const isSuperAdmin = role === 'super_admin';

      const all = await storage.getAllBillingSheets();
      const techCompanyCache = new Map<number, number | null>();
      const techCompanyId = async (techId: number | null | undefined): Promise<number | null> => {
        if (!techId) return null;
        if (techCompanyCache.has(techId)) return techCompanyCache.get(techId) ?? null;
        const u = await storage.getUser(techId);
        const cid = u?.companyId ?? null;
        techCompanyCache.set(techId, cid);
        return cid;
      };

      const candidates = all.filter(s => {
        const created = s.createdAt ? new Date(s.createdAt) : null;
        if (!created || created >= PHOTO_FIX_CUTOFF) return false;
        // Task #197 — admins/managers can mark a billing sheet as not
        // needing photos; once flagged it should disappear from the report
        // (JSON and CSV) and stay off the list permanently.
        if (s.noPhotosNeeded) return false;
        // Task #192 — once a billing sheet has been billed, chasing photos
        // for it is pointless. Hide anything that's been billed (status,
        // invoice link, or billed timestamp).
        if (s.status === 'billed' || s.invoiceId != null || s.billedAt != null) return false;
        const photos = Array.isArray(s.photos) ? s.photos : [];
        return photos.length === 0;
      });

      const missing = [] as typeof candidates;
      for (const s of candidates) {
        if (isSuperAdmin) {
          missing.push(s);
          continue;
        }
        if (requesterCompanyId == null) continue;
        const cid = await techCompanyId(s.technicianId);
        if (cid === requesterCompanyId) missing.push(s);
      }

      // Sort newest first
      missing.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      const format = (req.query.format as string | undefined)?.toLowerCase();
      if (format === 'csv') {
        const escape = (v: any) => {
          const s = v == null ? '' : String(v);
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        };
        const header = ['Billing Number','Technician','Customer','Branch','Property Address','Work Date','Created At','Status','Work Description'];
        const rows = missing.map(s => [
          s.billingNumber,
          s.technicianName,
          s.customerName,
          s.branchName ?? '',
          s.propertyAddress ?? '',
          s.workDate ? new Date(s.workDate).toISOString().slice(0,10) : '',
          new Date(s.createdAt).toISOString(),
          s.status,
          (s.workDescription ?? '').replace(/\s+/g, ' ').trim(),
        ].map(escape).join(','));
        const csv = [header.join(','), ...rows].join('\n');
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="missing-photos-${new Date().toISOString().slice(0,10)}.csv"`);
        return res.send(csv);
      }

      // Tenant-scoped notifications: only expose rows for technicians visible
      // to this requester (i.e. those who appear in the already-scoped `missing`
      // dataset). This prevents cross-company metadata leakage.
      const visibleTechIds = new Set<number>();
      for (const s of missing) {
        if (s.technicianId != null) visibleTechIds.add(s.technicianId);
      }
      const notifyRows = await storage.getMissingPhotosNotifications();
      const notifications: Record<string, {
        lastSentAt: string;
        sheetCount: number;
        lastEmailAt: string | null;
        lastSmsAt: string | null;
        emailSheetCount: number | null;
        smsSheetCount: number | null;
        lastSmsStatus: string | null;
        lastSmsStatusAt: string | null;
        lastSmsErrorCode: string | null;
      }> = {};
      for (const n of notifyRows) {
        if (n.technicianId != null && visibleTechIds.has(n.technicianId)) {
          notifications[String(n.technicianId)] = {
            lastSentAt: new Date(n.lastSentAt).toISOString(),
            sheetCount: n.sheetCount,
            lastEmailAt: n.lastSentEmailAt ? new Date(n.lastSentEmailAt).toISOString() : null,
            lastSmsAt: n.lastSentSmsAt ? new Date(n.lastSentSmsAt).toISOString() : null,
            emailSheetCount: n.lastEmailSheetCount ?? null,
            smsSheetCount: n.lastSmsSheetCount ?? null,
            lastSmsStatus: n.lastSmsStatus ?? null,
            lastSmsStatusAt: n.lastSmsStatusAt ? new Date(n.lastSmsStatusAt).toISOString() : null,
            lastSmsErrorCode: n.lastSmsErrorCode ?? null,
          };
        }
      }

      res.json({
        cutoff: PHOTO_FIX_CUTOFF.toISOString(),
        count: missing.length,
        sheets: applyPricingVisibility(req, missing),
        notifications,
      });
    } catch (error) {
      console.error('Error fetching missing-photos report:', error);
      res.status(500).json({ message: "Failed to fetch missing-photos report" });
    }
  });

  // One-shot manager-triggered outreach: emails each technician a list of
  // their own billing sheets that are missing photos, with deep links to the
  // sheet view (which exposes the Add Photos affordance).
  // Idempotency: a technician is notified at most once. Subsequent calls skip
  // technicians who already have a recorded notification, unless `force: true`
  // is passed in the body (intended for explicit manager re-send).
  app.post("/api/billing-sheets/missing-photos/notify", requireAuthentication, async (req: any, res) => {
    try {
      const role = req.authenticatedUserRole;
      if (role !== 'company_admin' && role !== 'super_admin' && role !== 'irrigation_manager' && role !== 'billing_manager') {
        return res.status(403).json({ message: "Access denied." });
      }

      const force = req.body?.force === true;
      const channelInput = (req.body?.channel as string | undefined)?.toLowerCase();
      const channelChoice: 'email' | 'sms' | 'both' =
        channelInput === 'sms' || channelInput === 'both' ? channelInput : 'email';
      const channels: Array<'email' | 'sms'> =
        channelChoice === 'both' ? ['email', 'sms'] : [channelChoice];
      const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000;

      // Tenant scoping: non-super_admin requesters may only notify technicians
      // belonging to their own company. Without this guard, a manager from one
      // company could trigger emails to technicians in another company.
      const requesterCompanyId: number | null = req.authenticatedUserCompanyId ?? null;
      const isSuperAdmin = role === 'super_admin';
      if (!isSuperAdmin && requesterCompanyId == null) {
        return res.status(403).json({ message: "Access denied: no company context." });
      }

      const all = await storage.getAllBillingSheets();
      const candidates = all.filter(s => {
        const created = s.createdAt ? new Date(s.createdAt) : null;
        if (!created || created >= PHOTO_FIX_CUTOFF) return false;
        // Task #197 — billing sheets explicitly flagged as not needing
        // photos must be excluded from technician outreach.
        if (s.noPhotosNeeded) return false;
        const photos = Array.isArray(s.photos) ? s.photos : [];
        return photos.length === 0;
      });

      // Tenant scope BEFORE grouping/processing: out-of-company technicians
      // and their sheets must never enter the result set or be exposed in the
      // response. We resolve company ownership through the assigned technician.
      type MissingSheet = (typeof candidates)[number];
      const techCompanyCache = new Map<number, number | null>();
      const techCompanyId = async (techId: number): Promise<number | null> => {
        if (techCompanyCache.has(techId)) return techCompanyCache.get(techId) ?? null;
        const u = await storage.getUser(techId);
        const cid = u?.companyId ?? null;
        techCompanyCache.set(techId, cid);
        return cid;
      };

      const missing: MissingSheet[] = [];
      for (const s of candidates) {
        if (!s.technicianId) continue;
        if (isSuperAdmin) {
          missing.push(s);
          continue;
        }
        const cid = await techCompanyId(s.technicianId);
        if (cid === requesterCompanyId) missing.push(s);
      }

      // Group by technicianId (already tenant-scoped)
      const byTech = new Map<number, MissingSheet[]>();
      for (const s of missing) {
        if (!s.technicianId) continue;
        const arr = byTech.get(s.technicianId) ?? [];
        arr.push(s);
        byTech.set(s.technicianId, arr);
      }

      const existingRows = await storage.getMissingPhotosNotifications();
      const lastByTech = new Map<number, { email: Date | null; sms: Date | null }>();
      for (const n of existingRows) {
        if (n.technicianId != null) {
          lastByTech.set(n.technicianId, {
            email: n.lastSentEmailAt ? new Date(n.lastSentEmailAt) : null,
            sms: n.lastSentSmsAt ? new Date(n.lastSentSmsAt) : null,
          });
        }
      }

      type ChannelOutcome =
        | { channel: 'email' | 'sms'; status: 'sent'; lastSentAt: string }
        | { channel: 'email' | 'sms'; status: 'skipped_already_notified'; lastSentAt: string }
        | { channel: 'email'; status: 'skipped_no_email' }
        | { channel: 'sms'; status: 'skipped_no_phone' }
        | { channel: 'email' | 'sms'; status: 'failed'; error?: string };

      const results: Array<{
        technicianId: number;
        technicianName: string;
        sheetCount: number;
        skippedNoUser?: boolean;
        channels: ChannelOutcome[];
      }> = [];

      const now = Date.now();

      for (const [techId, sheets] of Array.from(byTech.entries())) {
        const technicianName = sheets[0].technicianName || `User #${techId}`;
        const tech = await storage.getUser(techId);
        if (!tech) {
          results.push({ technicianId: techId, technicianName, sheetCount: sheets.length, skippedNoUser: true, channels: [] });
          continue;
        }

        let companyName: string | undefined;
        if (tech.companyId) {
          try {
            const company = await storage.getCompanyProfile(tech.companyId);
            companyName = company?.name || undefined;
          } catch {}
        }

        const channelOutcomes: ChannelOutcome[] = [];
        const last = lastByTech.get(techId) ?? { email: null, sms: null };

        for (const channel of channels) {
          const lastForChannel = channel === 'email' ? last.email : last.sms;
          if (!force && lastForChannel && now - lastForChannel.getTime() < RECENT_WINDOW_MS) {
            channelOutcomes.push({
              channel,
              status: 'skipped_already_notified',
              lastSentAt: lastForChannel.toISOString(),
            });
            continue;
          }

          if (channel === 'email') {
            if (!tech.email) {
              channelOutcomes.push({ channel: 'email', status: 'skipped_no_email' });
              continue;
            }
            const sendResult = await EmailService.sendMissingPhotosTechnicianEmail({
              to: tech.email,
              technicianName: tech.name || technicianName,
              companyName,
              sheets: sheets.map((s: MissingSheet) => ({
                id: s.id,
                billingNumber: s.billingNumber,
                customerName: s.customerName,
                branchName: s.branchName,
                propertyAddress: s.propertyAddress,
                workDate: s.workDate,
              })),
            });
            if (!sendResult.success) {
              channelOutcomes.push({ channel, status: 'failed', error: sendResult.error });
              continue;
            }
            const saved = await storage.upsertMissingPhotosNotification(
              techId,
              sheets.map((s: MissingSheet) => s.id),
              req.authenticatedUserId ?? null,
              'email',
            );
            channelOutcomes.push({
              channel,
              status: 'sent',
              lastSentAt: new Date(saved.lastSentEmailAt ?? saved.lastSentAt).toISOString(),
            });
          } else {
            if (!tech.phone) {
              channelOutcomes.push({ channel: 'sms', status: 'skipped_no_phone' });
              continue;
            }
            const sendResult = await SmsService.sendMissingPhotosTechnicianSms({
              to: tech.phone,
              technicianName: tech.name || technicianName,
              companyName,
              sheets: sheets.map((s: MissingSheet) => ({ id: s.id, billingNumber: s.billingNumber })),
            });
            if (!sendResult.success) {
              channelOutcomes.push({ channel, status: 'failed', error: sendResult.error });
              continue;
            }
            const saved = await storage.upsertMissingPhotosNotification(
              techId,
              sheets.map((s: MissingSheet) => s.id),
              req.authenticatedUserId ?? null,
              'sms',
              sendResult.messageSid ?? null,
            );
            channelOutcomes.push({
              channel,
              status: 'sent',
              lastSentAt: new Date(saved.lastSentSmsAt ?? saved.lastSentAt).toISOString(),
            });
          }
        }

        results.push({
          technicianId: techId,
          technicianName: tech.name || technicianName,
          sheetCount: sheets.length,
          channels: channelOutcomes,
        });
      }

      const flatOutcomes = results.flatMap(r => r.channels);
      const summary = {
        sent: flatOutcomes.filter(c => c.status === 'sent').length,
        skippedAlreadyNotified: flatOutcomes.filter(c => c.status === 'skipped_already_notified').length,
        skippedNoEmail: flatOutcomes.filter(c => c.status === 'skipped_no_email').length,
        skippedNoPhone: flatOutcomes.filter(c => c.status === 'skipped_no_phone').length,
        skippedNoUser: results.filter(r => r.skippedNoUser).length,
        failed: flatOutcomes.filter(c => c.status === 'failed').length,
      };

      res.json({ summary, results, channel: channelChoice });
    } catch (error) {
      console.error('Error sending missing-photos notifications:', error);
      res.status(500).json({ message: "Failed to send notifications" });
    }
  });

  // Task #197 — flag a billing sheet as not requiring photos so it disappears
  // from the missing-photos report. Restricted to the same four roles that
  // can view the report. Captures the acting user + timestamp on the row.
  // Tenant-scoped: non-super-admin users may only mark sheets whose
  // technician belongs to their own company.
  app.post("/api/billing-sheets/:id/no-photos-needed", requireAuthentication, async (req: any, res) => {
    try {
      const role = req.authenticatedUserRole;
      if (role !== 'company_admin' && role !== 'super_admin' && role !== 'irrigation_manager' && role !== 'billing_manager') {
        return res.status(403).json({ message: "Access denied." });
      }

      const id = parseInt(req.params.id);
      if (isNaN(id) || id <= 0) {
        return res.status(400).json({ message: "Invalid billing sheet ID" });
      }

      const existing = await storage.getBillingSheetById(id);
      if (!existing) {
        return res.status(404).json({ message: "Billing sheet not found" });
      }

      // Tenant scoping: non-super_admin users can only mark sheets whose
      // assigned technician belongs to the same company. Without this guard,
      // a manager from one company could clear another company's sheets.
      const isSuperAdmin = role === 'super_admin';
      if (!isSuperAdmin) {
        const requesterCompanyId: number | null = req.authenticatedUserCompanyId ?? null;
        if (requesterCompanyId == null) {
          return res.status(403).json({ message: "Access denied: no company context." });
        }
        const tech = existing.technicianId ? await storage.getUser(existing.technicianId) : null;
        if (!tech || tech.companyId !== requesterCompanyId) {
          return res.status(403).json({ message: "Access denied." });
        }
      }

      const userId = parseInt(String(req.authenticatedUserId ?? req.headers['x-user-id']));
      if (!userId || isNaN(userId)) {
        return res.status(401).json({ message: "Authentication required - user ID not found." });
      }

      const updated = await storage.markBillingSheetNoPhotosNeeded(id, userId);
      if (!updated) {
        return res.status(404).json({ message: "Billing sheet not found" });
      }
      res.json(updated);
    } catch (error) {
      console.error('Error marking billing sheet as no-photos-needed:', error);
      res.status(500).json({ message: "Failed to mark billing sheet" });
    }
  });

  // Twilio status callback webhook for SMS delivery tracking.
  // Twilio POSTs application/x-www-form-urlencoded with fields including
  // MessageSid, MessageStatus (queued|sent|delivered|failed|undelivered),
  // ErrorCode (when failed/undelivered). We update the missing-photos
  // notification row whose lastSmsMessageSid matches so managers can see
  // real delivery outcomes instead of just "sent".
  //
  // The endpoint must be unauthenticated (Twilio cannot present a session
  // cookie), so we authenticate the request via Twilio's request signature.
  app.post("/api/twilio/sms-status", async (req: any, res) => {
    try {
      const params = (req.body ?? {}) as Record<string, string>;
      const messageSid = params.MessageSid;
      const status = params.MessageStatus || params.SmsStatus;
      const errorCode = params.ErrorCode || null;

      if (!messageSid || !status) {
        return res.status(400).send('Missing MessageSid or MessageStatus');
      }

      // Signature validation:
      //  - Production: ALWAYS validate. If TWILIO_AUTH_TOKEN is missing the
      //    webhook refuses every request (secure-by-default).
      //  - Dev/test: validate when a token is configured; otherwise accept
      //    so the endpoint can be exercised without external Twilio creds.
      const token = SmsService.authToken;
      const isProd = process.env.NODE_ENV === 'production';
      if (isProd && !token) {
        console.warn('Twilio status callback rejected: no TWILIO_AUTH_TOKEN configured in production');
        return res.status(403).send('Webhook not configured');
      }
      if (token) {
        const signature = req.header('X-Twilio-Signature') || '';
        // Reconstruct the full URL Twilio used to sign the request. Twilio
        // signs against the public URL, so prefer the configured baseUrl
        // over req.protocol/host (which may be the internal Replit address).
        const url = `${SmsService.baseUrl}/api/twilio/sms-status`;
        const valid = twilio.validateRequest(token, signature, url, params);
        if (!valid) {
          console.warn('Twilio status callback: invalid signature', { messageSid, url });
          return res.status(403).send('Invalid signature');
        }
      }

      const updated = await storage.updateMissingPhotosSmsStatus(messageSid, status, errorCode);
      if (!updated) {
        // Not all SMS messages are tracked here (e.g. future SMS senders).
        // Acknowledge so Twilio doesn't retry, but log for visibility.
        console.log(`Twilio status callback: no matching SMS row for sid=${messageSid} status=${status}`);
      }
      // Twilio expects a 2xx with empty body (or TwiML). Empty 204 works.
      return res.status(204).end();
    } catch (error) {
      console.error('Twilio status callback error:', error);
      // Return 200 anyway so Twilio doesn't retry indefinitely on our bug.
      return res.status(200).send('OK');
    }
  });

  app.get("/api/billing-sheets/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const billingSheet = await storage.getBillingSheetById(id);
      if (!billingSheet) {
        return res.status(404).json({ message: "Billing sheet not found" });
      }
      // Strip pricing fields for field technicians
      res.json(applyPricingVisibility(req, billingSheet));
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch billing sheet" });
    }
  });

  app.post("/api/billing-sheets", async (req, res) => {
    try {
      console.log('Received billing sheet data:', req.body);
      const billingSheetData = req.body;

      // Branch enforcement: if the customer has branches configured, branchName is required
      if (billingSheetData.customerId) {
        const customer = await storage.getCustomer(Number(billingSheetData.customerId));
        if (customer && Array.isArray(customer.branches) && customer.branches.length > 0) {
          if (!billingSheetData.branchName || String(billingSheetData.branchName).trim() === '') {
            return res.status(400).json({ message: "Branch is required for this customer. Please select a branch before submitting." });
          }
        }
      }
      
      // Determine the correct status based on creator's role.
      // Manager-class roles (irrigation_manager, billing_manager, company_admin,
      // super_admin) self-approve at creation time and route directly to
      // 'approved_passed_to_billing' so the sheet immediately surfaces in the
      // customer's Ready-to-Invoice list (Task #206 fixed the previous
      // dead-end 'approved' status; Task #207 removed it from the schema).
      // field_tech => 'submitted' (goes to manager for review).
      const creatorRole = req.authenticatedUserRole || req.headers['x-user-role'];
      let resolvedStatus: BillingSheetStatus;
      if (
        creatorRole === 'irrigation_manager' ||
        creatorRole === 'billing_manager' ||
        creatorRole === 'company_admin' ||
        creatorRole === 'super_admin'
      ) {
        resolvedStatus = 'approved_passed_to_billing';
      } else if (creatorRole === 'field_tech') {
        resolvedStatus = 'submitted';
      } else {
        // Task #207 — runtime-validate the fallback so the legacy 'approved'
        // (or any other unknown value) cannot sneak in via an unexpected role.
        const parsed = z.enum(billingSheetStatusValues).safeParse(billingSheetData.status);
        resolvedStatus = parsed.success ? parsed.data : 'draft';
      }

      // Always look up the customer's authoritative labor rate — ignore any client-supplied value.
      // Fail fast if the customer does not exist or has no labor rate configured.
      if (!billingSheetData.customerId) {
        return res.status(400).json({ message: "Customer ID is required to determine the correct labor rate." });
      }
      const customerForRate = await storage.getCustomer(Number(billingSheetData.customerId));
      if (!customerForRate) {
        return res.status(400).json({ message: "Customer not found. Cannot determine labor rate." });
      }
      if (!customerForRate.laborRate || parseFloat(customerForRate.laborRate) <= 0) {
        return res.status(400).json({ message: `Customer "${customerForRate.name}" does not have a labor rate configured. Please set a labor rate on the customer record before creating a billing sheet.` });
      }
      const bsAuthorizedLaborRate = parseFloat(customerForRate.laborRate);

      // Recalculate totals using the authoritative rate from the customer record
      const bsTotalHours = parseFloat(billingSheetData.totalHours || '0');
      const bsLaborSubtotal = bsTotalHours * bsAuthorizedLaborRate;

      // Server-side authoritative pricing (Task #160): for every catalog line item
      // (those with a `partId`), overwrite the client-supplied `unitPrice` with the
      // current catalog price. Manual line items (no `partId`) are left alone — they
      // continue through the manual-part review flow.
      const rawClientItems: RawBillingItem[] = Array.isArray(billingSheetData.items)
        ? billingSheetData.items
        : [];
      const postCompanyId = req.authenticatedUserCompanyId
        ?? (req.headers['x-user-company-id']
          ? parseInt(req.headers['x-user-company-id'] as string)
          : (customerForRate.companyId ?? null));
      const pricingResult = await resolveAuthoritativePartPricing(rawClientItems, postCompanyId);
      if (pricingResult.error) {
        return res.status(pricingResult.error.status).json({ message: pricingResult.error.message });
      }
      const resolvedClientItems = (pricingResult.items as RawBillingItem[]) ?? [];
      if (pricingResult.auditedZeros.length > 0) {
        for (const drift of pricingResult.auditedZeros) {
          console.log(
            `[AUDIT] billing_sheet_create_price_corrected partId=${drift.partId} ` +
            `partName="${drift.partName}" clientUnitPrice=${drift.clientUnitPrice.toFixed(2)} ` +
            `catalogUnitPrice=${drift.catalogUnitPrice.toFixed(2)}`
          );
        }
      }
      // Always derive partsSubtotal from the items the server will write — discard any client-supplied value
      const bsPartsSubtotal = resolvedClientItems.reduce(
        (sum, item) => sum + parseFloat(String(item.quantity || 0)) * parseFloat(String(item.unitPrice || 0)),
        0
      );
      const bsTotalAmount = bsLaborSubtotal + bsPartsSubtotal;

      // Clean the data - remove any fields that might interfere with timestamps
      // Ensure every item we hand to storage matches the createBillingSheet
      // shape (string-typed numerics, totalPrice always present) using the
      // (possibly server-corrected) quantity * unitPrice.
      type BillingSheetItemInput = {
        partName: string;
        quantity: string;
        unitPrice: string;
        totalPrice: string;
        laborHours: string;
        notes?: string | null;
        billingSheetId?: number | null;
        partId?: number | null;
        partDescription?: string | null;
      };
      const itemsForStorage: BillingSheetItemInput[] = resolvedClientItems.map((it) => {
        const qty = parseFloat(String(it.quantity ?? 0));
        const unit = parseFloat(String(it.unitPrice ?? 0));
        const computedTotal = (qty * unit).toFixed(2);
        const rawTotal = (it as { totalPrice?: number | string }).totalPrice;
        return {
          partId: it.partId ?? null,
          partName: String(it.partName ?? ''),
          partDescription: it.partDescription ?? null,
          quantity: String(it.quantity ?? '0'),
          unitPrice: String(it.unitPrice ?? '0'),
          totalPrice: rawTotal != null ? String(rawTotal) : computedTotal,
          laborHours: String(it.laborHours ?? '0'),
          notes: it.notes ?? null,
        };
      });

      const cleanData = {
        customerId: billingSheetData.customerId,
        customerName: billingSheetData.customerName,
        customerEmail: billingSheetData.customerEmail,
        propertyAddress: billingSheetData.propertyAddress || '',
        workDate: billingSheetData.workDate, // Let storage handle the conversion
        technicianName: billingSheetData.technicianName,
        technicianId: billingSheetData.technicianId || null,
        workDescription: billingSheetData.workDescription,
        status: resolvedStatus,
        totalHours: billingSheetData.totalHours || '0',
        laborRate: bsAuthorizedLaborRate.toFixed(2),
        laborSubtotal: bsLaborSubtotal.toFixed(2),
        partsSubtotal: bsPartsSubtotal.toFixed(2),
        totalAmount: bsTotalAmount.toFixed(2),
        photos: billingSheetData.photos || [],
        notes: billingSheetData.notes || '',
        branchName: billingSheetData.branchName || null,
        items: itemsForStorage.length > 0 ? itemsForStorage : undefined,
      };
      
      const billingSheet = await storage.createBillingSheet({
        ...cleanData,
      });

      // Task #206 — when a manager-class user creates a billing sheet, it's
      // self-approved at creation time (status='approved_passed_to_billing').
      // Stamp the same approval audit fields the manual /approve endpoint uses
      // so the record is fully traceable in Ready-to-Invoice listings.
      if (resolvedStatus === 'approved_passed_to_billing') {
        const approverUser = req.authenticatedUserId
          ? await storage.getUser(req.authenticatedUserId)
          : undefined;
        const approverName = approverUser?.name || 'Manager';
        const partsSnapshot = JSON.stringify({ partsSubtotal: billingSheet.partsSubtotal });
        const laborSnapshot = JSON.stringify({
          totalHours: billingSheet.totalHours,
          laborRate: billingSheet.laborRate,
          laborSubtotal: billingSheet.laborSubtotal,
        });
        const approvalPatch: Partial<InsertBillingSheet> = {
          approvedBy: approverName,
          approvedByUserId: req.authenticatedUserId || undefined,
          approvedAt: new Date(),
          approvedTotal: billingSheet.totalAmount,
          approvedPartsSnapshot: partsSnapshot,
          approvedLaborSnapshot: laborSnapshot,
        };
        await storage.updateBillingSheet(billingSheet.id, approvalPatch);
      }

      const createdItemCount = Array.isArray(cleanData.items) ? cleanData.items.length : 0;
      console.log(`[AUDIT] billing_sheet_created billingSheetId=${billingSheet.id} billingNumber=${billingSheet.billingNumber} itemCount=${createdItemCount} status=${resolvedStatus}`);

      // Regression guard: surface any catalog line item that ended up at $0 despite the
      // authoritative-pricing helper above. Should never trigger; logged loudly if it does.
      await regressionGuardZeroCatalogPrices('create', billingSheet.id, cleanData.items);

      // Notify irrigation managers and admins that a billing sheet was submitted
      try {
        const allUsers = await storage.getUsers();
        const notifyUsers = allUsers.filter(u =>
          u.role === "company_admin" || u.role === "irrigation_manager"
        );
        for (const user of notifyUsers) {
          await storage.createNotification({
            userId: user.id,
            type: "billing_sheet_submitted",
            title: "Billing Sheet Submitted",
            message: `Billing sheet ${billingSheet.billingNumber} for ${cleanData.customerName || 'a customer'} has been submitted${cleanData.technicianName ? ` by ${cleanData.technicianName}` : ''}.`,
            relatedEntityType: "billing_sheet",
            relatedEntityId: billingSheet.id,
            isRead: false,
          });
        }
      } catch (notifError) {
        console.error('Failed to send billing sheet notifications:', notifError);
      }

      // If the billing sheet was submitted (by a field tech), check for manual parts (no partId)
      // and create manualPartReview records + notify billing managers
      if (resolvedStatus === 'submitted' && Array.isArray(cleanData.items)) {
        try {
          const companyId = req.authenticatedUserCompanyId;
          // Collect only items without a catalog partId (manually typed by tech)
          const manualItemIndices: number[] = [];
          (cleanData.items as Array<{ partId?: number | null }>).forEach((item, idx) => {
            if (!item.partId) manualItemIndices.push(idx);
          });
          if (manualItemIndices.length > 0 && companyId) {
            // Fetch the saved items to get their IDs; match by insertion order (same order as cleanData.items)
            const savedSheet = await storage.getBillingSheetById(billingSheet.id);
            const savedItems: BillingSheetItem[] = savedSheet?.items || [];
            // Build an index of saved manual items (no partId) in order
            const savedManualItems = savedItems.filter(si => !si.partId);

            for (let i = 0; i < manualItemIndices.length; i++) {
              const manualItem = cleanData.items[manualItemIndices[i]] as { partName?: string; unitPrice?: string | number };
              const savedItem = savedManualItems[i]; // Positional match — same order as submitted
              await storage.createManualPartReview({
                billingSheetId: billingSheet.id,
                billingSheetItemId: savedItem?.id ?? null,
                companyId,
                partName: manualItem.partName || 'Unknown Part',
                proposedPrice: String(manualItem.unitPrice || '0'),
                approvalStatus: 'pending',
              });

              // Notify billing managers only (company-scoped)
              const allUsers = await storage.getUsers(companyId);
              const billingManagers = allUsers.filter(u => u.role === 'billing_manager');
              for (const bm of billingManagers) {
                await storage.createNotification({
                  userId: bm.id,
                  type: "manual_part_pending_review",
                  title: "Manual Part Needs Pricing Review",
                  message: `A manually entered part "${manualItem.partName}" on billing sheet ${billingSheet.billingNumber} needs your price review.`,
                  relatedEntityType: "billing_sheet",
                  relatedEntityId: billingSheet.id,
                  isRead: false,
                });
              }
            }
          }
        } catch (manualPartError) {
          console.error('Failed to create manual part reviews:', manualPartError);
        }
      }

      res.json(billingSheet);
    } catch (error) {
      console.error('Error creating billing sheet:', error);
      res.status(500).json({ message: "Failed to create billing sheet", error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.patch("/api/billing-sheets/:id", requireBillingSheetUpdateAccess, async (req, res) => {
    try {
      const id = parseInt(req.params.id);

      // Task #191: photos-only patches (single key 'photos' with an array value)
      // bypass the billed and approved-passed-to-billing locks below so that
      // techs (and admins) can backfill photos onto already-billed sheets.
      // Every other field on a billed/approved sheet stays locked.
      const bsPatchKeys = req.body && typeof req.body === 'object' ? Object.keys(req.body) : [];
      const isBsPhotosOnlyPatch =
        bsPatchKeys.length === 1 && bsPatchKeys[0] === 'photos' && Array.isArray(req.body.photos);

      // Billing lock: reject updates to billing sheets that have been invoiced or approved for billing
      const existingBsForLockCheck = await storage.getBillingSheetById(id);
      if (!isBsPhotosOnlyPatch && existingBsForLockCheck && (existingBsForLockCheck.invoiceId || existingBsForLockCheck.status === 'billed')) {
        return res.status(409).json({ message: "This record has been billed and cannot be edited." });
      }
      // Lock after manager approval — only admins and billing managers can proceed
      const patchUserRole = req.authenticatedUserRole || req.headers['x-user-role'];
      if (!isBsPhotosOnlyPatch && existingBsForLockCheck?.status === 'approved_passed_to_billing' &&
          patchUserRole !== 'company_admin' && patchUserRole !== 'super_admin' && patchUserRole !== 'billing_manager') {
        return res.status(409).json({ message: "This record has been approved and passed to billing — it cannot be edited." });
      }

      const { items, workLocationLat, workLocationLng, workLocationAddress, companyId, ...billingSheetData } = req.body;

      // Task #207: enforce billing-sheet status enum on PATCH so the legacy
      // 'approved' value (and any other unknown status) cannot be persisted
      // by the API. The DB column is plain text with no check constraint, so
      // this is the authoritative validation point.
      if (billingSheetData.status !== undefined) {
        const patchStatusParse = z.enum(billingSheetStatusValues).safeParse(billingSheetData.status);
        if (!patchStatusParse.success) {
          return res.status(400).json({
            message: `Invalid billing sheet status '${billingSheetData.status}'. Allowed values: ${billingSheetStatusValues.join(', ')}.`,
          });
        }
        billingSheetData.status = patchStatusParse.data;
      }

      console.log('Updating billing sheet:', id, 'with data:', billingSheetData);
      
      // Convert date string to Date object if present
      if (billingSheetData.workDate && typeof billingSheetData.workDate === 'string') {
        billingSheetData.workDate = new Date(billingSheetData.workDate + 'T00:00:00.000Z');
      }

      // Recalculate totalAmount whenever subtotals are provided
      if (billingSheetData.laborSubtotal !== undefined || billingSheetData.partsSubtotal !== undefined) {
        const patchLaborSubtotal = parseFloat(billingSheetData.laborSubtotal || '0');
        const patchPartsSubtotal = parseFloat(billingSheetData.partsSubtotal || '0');
        billingSheetData.totalAmount = (patchLaborSubtotal + patchPartsSubtotal).toFixed(2);
      }
      
      // Update the billing sheet
      const billingSheet = await storage.updateBillingSheet(id, billingSheetData);
      if (!billingSheet) {
        return res.status(404).json({ message: "Billing sheet not found" });
      }
      
      // Handle items if provided — atomically replace items AND resync partsSubtotal/totalAmount in one transaction
      if (items && Array.isArray(items)) {
        const countBefore = (await storage.getBillingSheetById(id))?.items?.length ?? 0;

        // Server-side authoritative pricing (Task #160): rewrite catalog line items
        // with the catalog price before persisting. Manual line items pass through.
        const patchCompanyIdForPricing = req.authenticatedUserCompanyId
          ?? (req.headers['x-user-company-id']
            ? parseInt(req.headers['x-user-company-id'] as string)
            : null);
        const patchPricingResult = await resolveAuthoritativePartPricing(items as RawBillingItem[], patchCompanyIdForPricing);
        if (patchPricingResult.error) {
          return res.status(patchPricingResult.error.status).json({ message: patchPricingResult.error.message });
        }
        const resolvedPatchItems = (patchPricingResult.items as RawBillingItem[]) ?? [];
        if (patchPricingResult.auditedZeros.length > 0) {
          for (const drift of patchPricingResult.auditedZeros) {
            console.log(
              `[AUDIT] billing_sheet_update_price_corrected billingSheetId=${id} partId=${drift.partId} ` +
              `partName="${drift.partName}" clientUnitPrice=${drift.clientUnitPrice.toFixed(2)} ` +
              `catalogUnitPrice=${drift.catalogUnitPrice.toFixed(2)}`
            );
          }
        }

        const itemsToInsert = resolvedPatchItems.map((item: any) => ({
          billingSheetId: id,
          partId: item.partId || null,
          partName: item.partName,
          partDescription: item.partDescription || "",
          quantity: item.quantity,
          unitPrice: item.unitPrice.toString(),
          laborHours: (item.laborHours ?? 0).toString(),
          totalPrice: (Number(item.quantity) * Number(item.unitPrice)).toString(),
          notes: item.notes || "",
        }));
        const resyncResult = await storage.replaceBillingSheetItemsAndResync(id, itemsToInsert);
        billingSheetData.partsSubtotal = resyncResult.partsSubtotal;
        billingSheetData.totalAmount = resyncResult.totalAmount;
        // Overwrite billingSheet reference so res.json() returns post-resync values
        Object.assign(billingSheet, { partsSubtotal: resyncResult.partsSubtotal, totalAmount: resyncResult.totalAmount });
        console.log(`[AUDIT] billing_sheet_items_replaced billingSheetId=${id} countBefore=${countBefore} countAfter=${resolvedPatchItems.length}`);
        console.log(`[AUDIT] billing_sheet_partsSubtotal_recomputed billingSheetId=${id} partsSubtotal=${resyncResult.partsSubtotal} totalAmount=${resyncResult.totalAmount}`);

        // Regression guard: surface any catalog $0 leak that slipped through.
        await regressionGuardZeroCatalogPrices('update', id, resolvedPatchItems);
      }

      // Submission guard: if status transitions to submitted, check items vs partsSubtotal
      if (billingSheetData.status === 'submitted') {
        const partsSubtotal = parseFloat(String(billingSheetData.partsSubtotal ?? billingSheet.partsSubtotal ?? '0'));
        const currentSheet = await storage.getBillingSheetById(id);
        const currentItems = currentSheet?.items ?? [];
        if (partsSubtotal > 0 && currentItems.length === 0) {
          return res.status(400).json({ message: "Parts were recorded but no line items were saved — submission blocked to prevent billing data loss" });
        }
        // Inverse check: items have prices summing to > 0 but partsSubtotal is 0 (or diverged by >1%)
        const itemsTotal = currentItems.reduce(
          (sum: number, item: { totalPrice?: string | null }) => sum + parseFloat(String(item.totalPrice || 0)),
          0
        );
        if (itemsTotal > 0 && partsSubtotal === 0) {
          return res.status(400).json({ message: "Parts line item total does not match partsSubtotal — resubmit after saving to sync" });
        }
        if (itemsTotal > 0 && partsSubtotal > 0) {
          const divergencePct = Math.abs(itemsTotal - partsSubtotal) / itemsTotal;
          if (divergencePct > 0.01) {
            return res.status(400).json({ message: "Parts line item total does not match partsSubtotal — resubmit after saving to sync" });
          }
        }
        console.log(`[AUDIT] billing_sheet_status_change billingSheetId=${id} status=${billingSheetData.status} itemCount=${currentItems.length}`);

        // When status transitions to submitted, create manualPartReview records for manual items
        if (billingSheetData.status === 'submitted') {
          try {
            const patchCompanyId = req.authenticatedUserCompanyId;
            const manualItems = currentItems.filter((item: { partId?: number | null }) => !item.partId);
            if (manualItems.length > 0 && patchCompanyId) {
              const billingNumber = currentSheet?.billingNumber || `#${id}`;
              for (const manualItem of manualItems as Array<{ id?: number; partId?: number | null; partName?: string; unitPrice?: string }>) {
                // Only create review if one doesn't already exist for this item
                const existingReviews = await storage.getManualPartReviews(patchCompanyId);
                const alreadyExists = existingReviews.some(r => r.billingSheetItemId === (manualItem.id ?? null) && r.billingSheetId === id);
                if (!alreadyExists) {
                  await storage.createManualPartReview({
                    billingSheetId: id,
                    billingSheetItemId: manualItem.id ?? null,
                    companyId: patchCompanyId,
                    partName: manualItem.partName || 'Unknown Part',
                    proposedPrice: String(manualItem.unitPrice || '0'),
                    approvalStatus: 'pending',
                  });
                  const companyUsers = await storage.getUsers(patchCompanyId);
                  const billingManagers = companyUsers.filter(u => u.role === 'billing_manager');
                  for (const bm of billingManagers) {
                    await storage.createNotification({
                      userId: bm.id,
                      type: "manual_part_pending_review",
                      title: "Manual Part Needs Pricing Review",
                      message: `A manually entered part "${manualItem.partName || 'Unknown Part'}" on billing sheet ${billingNumber} needs your price review.`,
                      relatedEntityType: "billing_sheet",
                      relatedEntityId: id,
                      isRead: false,
                    });
                  }
                }
              }
            }
          } catch (manualPartError) {
            console.error('Failed to create manual part reviews from PATCH:', manualPartError);
          }
        }
      }

      res.json(billingSheet);
    } catch (error) {
      console.error('Error updating billing sheet:', error);
      res.status(500).json({ message: "Failed to update billing sheet", error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.delete("/api/billing-sheets/bulk", requireWorkOrderBillingAccess, async (req, res) => {
    try {
      const { ids } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ message: "ids must be a non-empty array of numbers" });
      }
      const validIds = ids.filter((id: any) => typeof id === 'number' && id > 0);
      if (validIds.length === 0) {
        return res.status(400).json({ message: "No valid IDs provided" });
      }
      for (const id of validIds) {
        await storage.deleteBillingSheet(id);
      }
      res.json({ deleted: validIds.length });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to bulk delete billing sheets" });
    }
  });

  app.delete("/api/billing-sheets/:id", requireWorkOrderBillingAccess, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteBillingSheet(id);
      res.json({ message: "Billing sheet deleted successfully" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to delete billing sheet" });
    }
  });

  app.get("/api/invoices/:invoiceId/audit", requireAuthentication, requireBillingAccess, async (req, res) => {
    try {
      const invoiceId = parseInt(req.params.invoiceId);
      const invoice = await storage.getInvoiceById(invoiceId);
      if (!invoice) {
        return res.status(404).json({ message: "Invoice not found" });
      }

      // Enforce tenant scoping: verify the invoice belongs to the authenticated user's company.
      // Super admins (companyId === null) are allowed to access any invoice.
      const userCompanyId = req.authenticatedUserCompanyId;
      if (userCompanyId !== null && userCompanyId !== undefined) {
        const invoiceCustomer = await storage.getCustomerById(invoice.customerId);
        if (!invoiceCustomer || invoiceCustomer.companyId !== userCompanyId) {
          return res.status(403).json({ message: "Access denied. You do not have permission to audit this invoice." });
        }
      }

      // Deduplicate by (sourceType, sourceId) — one audit card per ticket regardless of
      // how many invoice item rows exist for that ticket (legacy invoice paths may vary).
      const seenTickets = new Map<string, boolean>();
      const uniqueItems = invoice.items.filter((item) => {
        const key = `${item.sourceType}:${item.sourceId}`;
        if (seenTickets.has(key)) return false;
        seenTickets.set(key, true);
        return true;
      });

      const enrichedItems = await Promise.all(
        uniqueItems.map(async (item) => {
          let status = "billed";
          let description = item.description;
          let workDate = item.workDate;

          // Derive financial amounts from source entities (authoritative totals)
          // invoiceItem.totalPrice = full ticket total (labor + parts)
          // invoiceItem.laborTotal = labor portion only
          // so partsTotal = totalPrice - laborTotal (avoids double-counting)
          let ticketTotal = parseFloat(item.totalPrice || "0");
          let laborTotal = parseFloat(item.laborTotal || "0");
          let partsTotal = ticketTotal - laborTotal;
          if (partsTotal < 0) partsTotal = 0;

          let createdAt: string | null = null;
          let approvedAt: string | null = null;
          let billedAt: string | null = null;
          let approvedLaborSnapshot: number | null = null;
          let approvedPartsSnapshot: number | null = null;

          if (item.sourceType === "work_order" && item.workOrderId) {
            const wo = await storage.getWorkOrder(item.workOrderId);
            if (wo) {
              status = wo.status || "billed";
              description = wo.projectName || item.description;
              workDate = wo.completedAt || wo.updatedAt || item.workDate;
              createdAt = wo.createdAt ? wo.createdAt.toISOString() : null;
              approvedAt = wo.approvedAt ? wo.approvedAt.toISOString() : null;
              billedAt = wo.billedAt ? wo.billedAt.toISOString() : null;
              // Parse approval snapshots
              if (wo.approvedLaborSnapshot) {
                try {
                  const snap = JSON.parse(wo.approvedLaborSnapshot);
                  const parsed = typeof snap === "number" ? snap : parseFloat(snap?.laborSubtotal ?? snap?.total ?? "");
                  approvedLaborSnapshot = isNaN(parsed) ? null : parsed;
                } catch { approvedLaborSnapshot = null; }
              }
              if (wo.approvedPartsSnapshot) {
                try {
                  const snap = JSON.parse(wo.approvedPartsSnapshot);
                  const parsed = typeof snap === "number" ? snap : parseFloat(snap?.partsSubtotal ?? snap?.total ?? "");
                  approvedPartsSnapshot = isNaN(parsed) ? null : parsed;
                } catch { approvedPartsSnapshot = null; }
              }
              // Use authoritative source totals when available
              const woTotal = parseFloat(wo.totalAmount || "0");
              const woLabor = parseFloat(wo.laborSubtotal || "0");
              if (woTotal > 0) {
                ticketTotal = woTotal;
                laborTotal = woLabor;
                partsTotal = Math.max(0, woTotal - woLabor);
              }
            }
          } else if (item.sourceType === "billing_sheet" && item.billingSheetId) {
            const bs = await storage.getBillingSheetById(item.billingSheetId);
            if (bs) {
              status = bs.status || "billed";
              description = bs.workDescription || item.description;
              workDate = bs.workDate || item.workDate;
              createdAt = bs.createdAt ? bs.createdAt.toISOString() : null;
              approvedAt = bs.approvedAt ? bs.approvedAt.toISOString() : null;
              billedAt = bs.billedAt ? bs.billedAt.toISOString() : null;
              // Parse approval snapshots
              if (bs.approvedLaborSnapshot) {
                try {
                  const snap = JSON.parse(bs.approvedLaborSnapshot);
                  const parsed = typeof snap === "number" ? snap : parseFloat(snap?.laborSubtotal ?? snap?.total ?? "");
                  approvedLaborSnapshot = isNaN(parsed) ? null : parsed;
                } catch { approvedLaborSnapshot = null; }
              }
              if (bs.approvedPartsSnapshot) {
                try {
                  const snap = JSON.parse(bs.approvedPartsSnapshot);
                  const parsed = typeof snap === "number" ? snap : parseFloat(snap?.partsSubtotal ?? snap?.total ?? "");
                  approvedPartsSnapshot = isNaN(parsed) ? null : parsed;
                } catch { approvedPartsSnapshot = null; }
              }
              // Use authoritative source totals when available
              const bsLabor = parseFloat(bs.laborSubtotal || "0");
              const bsParts = parseFloat(bs.partsSubtotal || "0");
              const bsTotal = parseFloat(bs.totalAmount || "0");
              if (bsTotal > 0) {
                ticketTotal = bsTotal;
                laborTotal = bsLabor;
                partsTotal = bsParts;
              }
            }
          }

          return {
            id: item.id,
            sourceType: item.sourceType,
            sourceId: item.sourceId,
            workOrderId: item.workOrderId,
            billingSheetId: item.billingSheetId,
            description,
            status,
            laborTotal,
            partsTotal,
            ticketTotal,
            workDate,
            createdAt,
            approvedAt,
            billedAt,
            approvedLaborSnapshot,
            approvedPartsSnapshot,
          };
        })
      );

      res.json({ invoiceId, items: enrichedItems });
    } catch (error) {
      console.error("Error fetching invoice audit data:", error);
      res.status(500).json({ message: "Failed to fetch invoice audit data" });
    }
  });

  app.post("/api/invoices/:id/sync-quickbooks", requireAuthentication, requireBillingAccess, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const quickbooksId = `QB-INV-${id}`;
      await storage.updateInvoice(id, { quickbooksInvoiceId: quickbooksId });
      res.json({ 
        success: true,
        quickbooksId,
        message: "Invoice synced to QuickBooks successfully" 
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to sync invoice to QuickBooks" });
    }
  });

  app.get("/api/invoices/:invoiceId/pdf", requireAuthentication, requireBillingAccess, async (req, res) => {
    try {
      const invoiceId = parseInt(req.params.invoiceId);
      const invoice = await storage.getInvoiceById(invoiceId);
      if (!invoice) {
        return res.status(404).json({ message: "Invoice not found" });
      }

      const customer = await storage.getCustomerById(invoice.customerId);
      const periodStart = new Date(invoice.periodStart);
      const periodEnd = new Date(invoice.periodEnd);
      const fmtDateShort = (d: Date) => `${d.getMonth()+1}-${d.getDate()}-${String(d.getFullYear()).slice(-2)}`;
      const propertyName = customer?.irrigoName ?? customer?.name ?? 'Unknown';
      const newFilename = `${propertyName} - Irrigation Billing Detail - (${fmtDateShort(periodStart)}_${fmtDateShort(periodEnd)}).pdf`;

      let pdf = await storage.getInvoicePdfByInvoiceId(invoiceId);
      if (!pdf) {
        const companyId = customer?.companyId ?? 1;

        const pdfService = new InvoicePdfService(storage);
        const result = await pdfService.generatePdfBuffer(invoiceId);

        if (!result.success) {
          return res.status(500).json({ message: "PDF generation failed", error: result.error });
        }

        pdf = await storage.createInvoicePdf({
          invoiceId: invoice.id,
          customerId: invoice.customerId,
          companyId,
          pdfUrl: 'generated-on-demand',
          filename: newFilename,
          status: 'generated',
        });
      }
      
      res.json({ ...pdf, filename: newFilename });
    } catch (error) {
      console.error('Error fetching invoice PDF:', error);
      res.status(500).json({ message: "Failed to fetch invoice PDF" });
    }
  });

  app.get("/api/invoices/:invoiceId/pdf/download", requireAuthentication, requireBillingAccess, async (req, res) => {
    try {
      const invoiceId = parseInt(req.params.invoiceId);

      const pdfService = new InvoicePdfService(storage);
      const result = await pdfService.generatePdfBuffer(invoiceId);

      if (!result.success || !result.pdfBuffer) {
        if (result.validationFailure) {
          return res.status(422).json({
            message: result.error || "Invoice totals validation failed",
            validationFailure: result.validationFailure,
          });
        }
        return res.status(500).json({ message: result.error || "Failed to generate PDF" });
      }

      const invoice = await storage.getInvoiceById(invoiceId);
      const customer = invoice ? await storage.getCustomerById(invoice.customerId) : null;
      const periodStart = invoice ? new Date(invoice.periodStart) : new Date();
      const periodEnd = invoice ? new Date(invoice.periodEnd) : new Date();
      const fmtDateShort = (d: Date) => `${d.getMonth()+1}-${d.getDate()}-${String(d.getFullYear()).slice(-2)}`;
      const propertyName = customer?.irrigoName ?? customer?.name ?? 'Unknown';
      const filename = invoice
        ? `${propertyName} - Irrigation Billing Detail - (${fmtDateShort(periodStart)}_${fmtDateShort(periodEnd)}).pdf`
        : `Irrigation Billing Detail - ${invoiceId}.pdf`;

      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${filename}"`,
        'Content-Length': result.pdfBuffer.length.toString(),
      });

      res.end(result.pdfBuffer);
    } catch (error) {
      console.error('Error downloading invoice PDF:', error);
      res.status(500).json({ message: "Failed to download invoice PDF" });
    }
  });

  app.post("/api/invoices/:invoiceId/pdf/send", requireAuthentication, requireBillingAccess, async (req, res) => {
    try {
      const invoiceId = parseInt(req.params.invoiceId);
      const invoice = await storage.getInvoiceById(invoiceId);
      
      if (!invoice) {
        return res.status(404).json({ message: "Invoice not found" });
      }

      const pdfService = new InvoicePdfService(storage);
      const validationResult = await pdfService.generatePdfBuffer(invoiceId);
      if (!validationResult.success) {
        if (validationResult.validationFailure) {
          return res.status(422).json({
            message: validationResult.error || "Invoice totals validation failed",
            validationFailure: validationResult.validationFailure,
          });
        }
        return res.status(500).json({ message: validationResult.error || "Failed to validate invoice PDF" });
      }

      const pdf = await storage.getInvoicePdfByInvoiceId(invoiceId);
      if (!pdf) {
        return res.status(404).json({ message: "PDF not found for this invoice" });
      }

      // Send email to customer with PDF attachment
      const emailResult = await EmailService.sendInvoiceDetailPdf(
        invoice.customerEmail,
        invoice.customerName,
        invoice.invoiceNumber,
        pdf.pdfUrl
      );

      if (emailResult.success) {
        // Update PDF status to mark it as sent
        await storage.updateInvoicePdf(pdf.id, {
          status: 'sent',
          sentAt: new Date(),
        });
        
        res.json({ 
          message: "PDF sent successfully to customer",
          email: invoice.customerEmail 
        });
      } else {
        res.status(500).json({ 
          message: "Failed to send PDF",
          error: emailResult.error 
        });
      }
    } catch (error) {
      console.error('Error sending invoice PDF:', error);
      res.status(500).json({ message: "Failed to send invoice PDF" });
    }
  });

  app.post("/api/invoices/:invoiceId/pdf/regenerate", requireAuthentication, requireBillingAccess, async (req, res) => {
    try {
      const invoiceId = parseInt(req.params.invoiceId);
      const invoice = await storage.getInvoiceById(invoiceId);
      
      if (!invoice) {
        return res.status(404).json({ message: "Invoice not found" });
      }

      const existingPdf = await storage.getInvoicePdfByInvoiceId(invoiceId);
      if (existingPdf) {
        await db.delete(invoicePdfs).where(eq(invoicePdfs.id, existingPdf.id));
      }

      const pdfService = new InvoicePdfService(storage);
      const result = await pdfService.generateAndSaveInvoicePdf(invoiceId);

      if (result.success) {
        res.json({ message: "PDF regenerated successfully" });
      } else {
        res.status(500).json({ 
          message: "Failed to regenerate PDF",
          error: result.error 
        });
      }
    } catch (error) {
      console.error('Error regenerating invoice PDF:', error);
      res.status(500).json({ message: "Failed to regenerate invoice PDF" });
    }
  });

  // Generate PDF
  app.post("/api/estimates/:id/pdf", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const estimate = await storage.getEstimate(id);
      if (!estimate) {
        return res.status(404).json({ message: "Estimate not found" });
      }
      
      // For now, just simulate PDF generation
      // In a real implementation, you would use a PDF generation library
      res.json({ message: "PDF generated successfully", downloadUrl: `/api/estimates/${id}/pdf/download` });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to generate PDF" });
    }
  });

  // Work Order routes - Enhanced
  // Note: Pricing fields are stripped for field_tech role via applyPricingVisibility
  app.get("/api/work-orders", async (req, res) => {
    try {
      const { technician, customer, status } = req.query;
      
      let workOrders;
      if (technician) {
        workOrders = await storage.getWorkOrdersByTechnician(parseInt(technician as string));
      } else if (customer) {
        workOrders = await storage.getWorkOrdersByCustomer(parseInt(customer as string));
      } else if (status) {
        workOrders = await storage.getWorkOrdersByStatus(status as string);
      } else {
        workOrders = await storage.getWorkOrders();
      }
      
      // Strip pricing fields for field technicians
      res.json(applyPricingVisibility(req, workOrders));
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch work orders" });
    }
  });

  // Report: work orders created before the photo-save fix (Task #143) that
  // currently have zero photos. Mirrors /api/billing-sheets/missing-photos —
  // same cutoff, same role gate, same CSV option.
  app.get("/api/work-orders/missing-photos", requireAuthentication, async (req: any, res) => {
    try {
      const role = req.authenticatedUserRole;
      if (role !== 'company_admin' && role !== 'super_admin' && role !== 'irrigation_manager' && role !== 'billing_manager') {
        return res.status(403).json({ message: "Access denied." });
      }

      const all = await storage.getWorkOrders();
      const missing = all.filter(wo => {
        const created = wo.createdAt ? new Date(wo.createdAt) : null;
        if (!created || created >= PHOTO_FIX_CUTOFF) return false;
        // Task #185 — admins can mark a ticket as not needing photos; once
        // flagged it should no longer appear on this report (JSON or CSV).
        if (wo.noPhotosNeeded) return false;
        // Task #192 — once a work order has been billed, chasing photos for
        // it is pointless. Hide anything that's been billed (status, invoice
        // link, or billed timestamp).
        if (wo.status === 'billed' || wo.invoiceId != null || wo.billedAt != null) return false;
        const photos = Array.isArray(wo.photos) ? wo.photos : [];
        return photos.length === 0;
      });

      // Sort newest first
      missing.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      const format = (req.query.format as string | undefined)?.toLowerCase();
      if (format === 'csv') {
        const escape = (v: any) => {
          const s = v == null ? '' : String(v);
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        };
        const header = ['Work Order Number','Technician','Customer','Branch','Project Address','Scheduled Date','Created At','Status','Project Name'];
        const rows = missing.map(wo => [
          wo.workOrderNumber,
          wo.assignedTechnicianName ?? '',
          wo.customerName,
          wo.branchName ?? '',
          wo.projectAddress ?? '',
          wo.scheduledDate ? new Date(wo.scheduledDate).toISOString().slice(0,10) : '',
          new Date(wo.createdAt).toISOString(),
          wo.status,
          (wo.projectName ?? '').replace(/\s+/g, ' ').trim(),
        ].map(escape).join(','));
        const csv = [header.join(','), ...rows].join('\n');
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="work-orders-missing-photos-${new Date().toISOString().slice(0,10)}.csv"`);
        return res.send(csv);
      }

      res.json({
        cutoff: PHOTO_FIX_CUTOFF.toISOString(),
        count: missing.length,
        workOrders: applyPricingVisibility(req, missing),
      });
    } catch (error) {
      console.error('Error fetching work-orders missing-photos report:', error);
      res.status(500).json({ message: "Failed to fetch missing-photos report" });
    }
  });

  // Task #185 — flag a work order as not requiring photos so it disappears
  // from the missing-photos report. Restricted to the same four roles that
  // can view the report. Captures the acting user + timestamp on the row.
  app.post("/api/work-orders/:id/no-photos-needed", requireAuthentication, async (req: any, res) => {
    try {
      const role = req.authenticatedUserRole;
      if (role !== 'company_admin' && role !== 'super_admin' && role !== 'irrigation_manager' && role !== 'billing_manager') {
        return res.status(403).json({ message: "Access denied." });
      }

      const id = parseInt(req.params.id);
      if (isNaN(id) || id <= 0) {
        return res.status(400).json({ message: "Invalid work order ID" });
      }

      const existing = await storage.getWorkOrder(id);
      if (!existing) {
        return res.status(404).json({ message: "Work order not found" });
      }

      const userId = parseInt(String(req.authenticatedUserId ?? req.headers['x-user-id']));
      if (!userId || isNaN(userId)) {
        return res.status(401).json({ message: "Authentication required - user ID not found." });
      }

      const updated = await storage.markWorkOrderNoPhotosNeeded(id, userId);
      if (!updated) {
        return res.status(404).json({ message: "Work order not found" });
      }
      res.json(updated);
    } catch (error) {
      console.error('Error marking work order as no-photos-needed:', error);
      res.status(500).json({ message: "Failed to mark work order" });
    }
  });

  app.get("/api/work-orders/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const workOrder = await storage.getWorkOrder(id);
      if (!workOrder) {
        return res.status(404).json({ message: "Work order not found" });
      }
      // Strip pricing fields for field technicians
      res.json(applyPricingVisibility(req, workOrder));
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch work order" });
    }
  });

  app.post("/api/work-orders", async (req, res) => {
    try {
      const { items, ...workOrderBody } = req.body;

      // Lifecycle guard: force new work orders to the canonical start state.
      // Callers cannot create a work order already in a downstream status.
      const downstreamStatuses = [
        'in_progress', 'work_completed', 'pending_manager_review',
        'approved_passed_to_billing', 'billed', 'cancelled'
      ];
      if (workOrderBody.status && downstreamStatuses.includes(workOrderBody.status)) {
        workOrderBody.status = 'pending';
      }

      const workOrderData = insertWorkOrderSchema.parse(workOrderBody);

      // Branch enforcement: if the customer has branches configured, branchName is required
      if (workOrderData.customerId) {
        const customer = await storage.getCustomer(workOrderData.customerId);
        if (customer && Array.isArray(customer.branches) && customer.branches.length > 0) {
          if (!workOrderData.branchName || workOrderData.branchName.trim() === '') {
            return res.status(400).json({ message: "Branch is required for this customer. Please select a branch before submitting." });
          }
        }
      }

      // Server-side authoritative pricing (Task #160): rewrite catalog line items
      // with the catalog price BEFORE we create the work order, so that if a
      // partId is invalid we 4xx-reject without leaving an orphan work order.
      let resolvedWoCreateItems: RawBillingItem[] = [];
      let auditedZerosForLog: Array<{ partId: number; partName: string; clientUnitPrice: number; catalogUnitPrice: number }> = [];
      if (items !== undefined && Array.isArray(items) && items.length > 0) {
        const woCreateCompanyId = req.authenticatedUserCompanyId
          ?? (req.headers['x-user-company-id']
            ? parseInt(req.headers['x-user-company-id'] as string)
            : null);
        const woCreatePricing = await resolveAuthoritativePartPricing(items as RawBillingItem[], woCreateCompanyId);
        if (woCreatePricing.error) {
          return res.status(woCreatePricing.error.status).json({ message: woCreatePricing.error.message });
        }
        resolvedWoCreateItems = (woCreatePricing.items as RawBillingItem[]) ?? [];
        auditedZerosForLog = woCreatePricing.auditedZeros.map((d) => ({
          partId: d.partId,
          partName: d.partName,
          clientUnitPrice: d.clientUnitPrice,
          catalogUnitPrice: d.catalogUnitPrice,
        }));
      }

      const workOrder = await storage.createWorkOrder(workOrderData);

      // Save items if provided at creation time (now that the work order exists).
      if (resolvedWoCreateItems.length > 0) {
        for (const drift of auditedZerosForLog) {
          console.log(
            `[AUDIT] work_order_create_price_corrected workOrderId=${workOrder.id} partId=${drift.partId} ` +
            `partName="${drift.partName}" clientUnitPrice=${drift.clientUnitPrice.toFixed(2)} ` +
            `catalogUnitPrice=${drift.catalogUnitPrice.toFixed(2)}`
          );
        }

        type WoCreateLine = RawBillingItem & { partPrice?: number | string };
        let computedPartsCost = 0;
        for (const raw of resolvedWoCreateItems as WoCreateLine[]) {
          const qty = Number(raw.quantity) || 0;
          const price = Number(raw.unitPrice) || Number(raw.partPrice) || 0;
          const lineTotal = qty * price;
          computedPartsCost += lineTotal;
          await storage.addWorkOrderItem({
            workOrderId: workOrder.id,
            partId: raw.partId || null,
            partName: raw.partName ?? "",
            partPrice: price.toString(),
            quantity: qty,
            laborHours: (Number(raw.laborHours) || 0).toString(),
            totalPrice: lineTotal.toString(),
            notes: raw.notes || null,
          });
        }
        await storage.updateWorkOrder(workOrder.id, { totalPartsCost: computedPartsCost.toFixed(2) });

        await regressionGuardZeroCatalogPrices('work_order_conversion', workOrder.id, resolvedWoCreateItems);
      }

      const woItemCount = (await storage.getWorkOrderItems(workOrder.id)).length;
      console.log(`[AUDIT] work_order_created workOrderId=${workOrder.id} workOrderNumber=${workOrder.workOrderNumber} itemCount=${woItemCount}`);


      // Send notification if technician is assigned during creation
      if (workOrder.assignedTechnicianId) {
        await storage.createNotification({
          userId: workOrder.assignedTechnicianId,
          type: "work_order_assigned",
          title: "New Work Order Assigned",
          message: `You have been assigned work order ${workOrder.workOrderNumber} for ${workOrder.projectName || 'irrigation project'}.`,
          relatedEntityType: "work_order",
          relatedEntityId: workOrder.id
        });
      }
      
      res.status(201).json(workOrder);
    } catch (error) {
      console.error(error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid work order data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to create work order" });
    }
  });

  app.patch("/api/work-orders/:id", requireWorkOrderUpdateAccess, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      
      // Validate work order ID is a valid number
      if (isNaN(id) || id <= 0) {
        return res.status(400).json({ message: "Invalid work order ID" });
      }

      // Task #191: photos-only patches (single key 'photos' with an array value)
      // bypass the billed and approved-passed-to-billing locks below so that
      // techs (and admins) can backfill photos onto already-billed tickets.
      // Every other field on a billed/approved ticket stays locked.
      const woPatchKeys = req.body && typeof req.body === 'object' ? Object.keys(req.body) : [];
      const isWoPhotosOnlyPatch =
        woPatchKeys.length === 1 && woPatchKeys[0] === 'photos' && Array.isArray(req.body.photos);

      // Billing lock: reject updates to work orders that have been invoiced
      const existingForLockCheck = await storage.getWorkOrder(id);
      if (!isWoPhotosOnlyPatch && existingForLockCheck && (existingForLockCheck.invoiceId || existingForLockCheck.status === 'billed')) {
        return res.status(409).json({ message: "This record has been billed and cannot be edited." });
      }
      // Lock after manager approval — only admins and billing managers can proceed
      const woUpdateUserRole = req.authenticatedUserRole || req.headers['x-user-role'];
      if (!isWoPhotosOnlyPatch && existingForLockCheck?.status === 'approved_passed_to_billing' &&
          woUpdateUserRole !== 'company_admin' && woUpdateUserRole !== 'super_admin' && woUpdateUserRole !== 'billing_manager') {
        return res.status(409).json({ message: "This record has been approved and passed to billing — it cannot be edited." });
      }

      const { items, ...workOrderBody } = req.body;

      // Canonical status transition guard.
      // Defines the only valid next-states from each status; enforces lifecycle order
      // and prevents skipping steps or bypassing dedicated endpoints.
      if (workOrderBody.status !== undefined) {
        const requestedStatus = workOrderBody.status as string;
        const currentStatus = existingForLockCheck?.status ?? 'pending';

        // 'work_completed' is a legacy terminal state — use /complete endpoint.
        if (requestedStatus === 'work_completed') {
          return res.status(400).json({
            message: "Cannot set status to 'work_completed' directly. Use POST /api/work-orders/complete or POST /api/work-orders/:id/complete."
          });
        }

        // Only the /approve endpoint may transition to approved_passed_to_billing.
        if (requestedStatus === 'approved_passed_to_billing') {
          return res.status(400).json({
            message: "Cannot approve a work order via PATCH. Use the POST /api/work-orders/:id/approve endpoint."
          });
        }

        // Only the invoicing flow may mark a work order as billed.
        if (requestedStatus === 'billed') {
          return res.status(400).json({
            message: "Cannot set status to 'billed' directly. Billing status is set automatically when an invoice is created."
          });
        }

        // Allowed next-state map for all lifecycle-transition writes via PATCH
        const allowedTransitions: Record<string, string[]> = {
          pending: ['assigned', 'in_progress', 'cancelled'],
          assigned: ['pending', 'in_progress', 'cancelled'],
          in_progress: ['assigned', 'pending', 'cancelled'],
          pending_manager_review: ['in_progress', 'cancelled'], // manager can send back for rework
          // Terminal / post-approval states cannot be changed via PATCH
          work_completed: [],
          approved_passed_to_billing: [],
          billed: [],
          cancelled: [],
        };

        const validNextStates = allowedTransitions[currentStatus] ?? [];
        if (!validNextStates.includes(requestedStatus)) {
          return res.status(400).json({
            message: `Invalid status transition from '${currentStatus}' to '${requestedStatus}'. Valid transitions: [${validNextStates.join(', ') || 'none'}].`
          });
        }
      }

      // Strip immutable financial snapshot fields so manager edits cannot alter
      // the rates/breakdown that were locked in at completion time.
      const {
        appliedLaborRate: _aLR,
        laborSubtotal: _lS,
        partsSubtotal: _pS,
        totalAmount: _totA,
        ...mutableWorkOrderBody
      } = workOrderBody;
      const workOrderData = insertWorkOrderSchema.partial().parse(mutableWorkOrderBody);
      let workOrder;
      if (Object.keys(workOrderData).length > 0) {
        workOrder = await storage.updateWorkOrder(id, workOrderData);
        if (!workOrder) {
          return res.status(404).json({ message: "Work order not found" });
        }
      } else {
        workOrder = await storage.getWorkOrder(id);
        if (!workOrder) {
          return res.status(404).json({ message: "Work order not found" });
        }
      }

      // Handle items if provided (delete-and-recreate pattern wrapped in a transaction)
      if (items !== undefined && Array.isArray(items)) {
        const countBefore = (await storage.getWorkOrderItems(id)).length;

        // Server-side authoritative pricing (Task #160): rewrite catalog line items
        // with the catalog price. Reject 4xx if a partId points at no part / wrong company.
        const woUpdateCompanyId = req.authenticatedUserCompanyId
          ?? (req.headers['x-user-company-id']
            ? parseInt(req.headers['x-user-company-id'] as string)
            : null);
        const woUpdatePricing = await resolveAuthoritativePartPricing(items as RawBillingItem[], woUpdateCompanyId);
        if (woUpdatePricing.error) {
          return res.status(woUpdatePricing.error.status).json({ message: woUpdatePricing.error.message });
        }
        const resolvedWoUpdateItems = (woUpdatePricing.items as RawBillingItem[]) ?? [];
        if (woUpdatePricing.auditedZeros.length > 0) {
          for (const drift of woUpdatePricing.auditedZeros) {
            console.log(
              `[AUDIT] work_order_update_price_corrected workOrderId=${id} partId=${drift.partId} ` +
              `partName="${drift.partName}" clientUnitPrice=${drift.clientUnitPrice.toFixed(2)} ` +
              `catalogUnitPrice=${drift.catalogUnitPrice.toFixed(2)}`
            );
          }
        }

        const itemsToInsert = resolvedWoUpdateItems.map((item: any) => {
          const qty = Number(item.quantity) || 0;
          const price = Number(item.unitPrice) || 0;
          const lineTotal = qty * price;
          return {
            workOrderId: id,
            partId: item.partId || null,
            partName: item.partName,
            partPrice: price.toString(),
            quantity: qty,
            laborHours: (Number(item.laborHours) || 0).toString(),
            totalPrice: lineTotal.toString(),
            notes: item.notes || null,
          };
        });
        await storage.replaceWorkOrderItemsInTransaction(id, itemsToInsert);
        const computedPartsCost = itemsToInsert.reduce((sum: number, i: any) => sum + Number(i.totalPrice), 0);
        await storage.updateWorkOrder(id, { totalPartsCost: computedPartsCost.toFixed(2) });
        console.log(`[AUDIT] work_order_items_replaced workOrderId=${id} countBefore=${countBefore} countAfter=${resolvedWoUpdateItems.length}`);

        await regressionGuardZeroCatalogPrices('work_order_conversion', id, resolvedWoUpdateItems);
      }

      // Recompute financial totals if financial inputs were touched (totalHours, totalPartsCost, items)
      const financialFieldsTouched = 'totalHours' in workOrderData || 'totalPartsCost' in workOrderData || (items !== undefined && Array.isArray(items));
      if (financialFieldsTouched) {
        const freshWo = await storage.getWorkOrder(id);
        if (freshWo && freshWo.appliedLaborRate) {
          // Use the work order's own snapshotted labor rate — never the live customer record.
          const snappedLaborRate = parseFloat(freshWo.appliedLaborRate);
          const hrs = parseFloat(freshWo.totalHours || '0');
          const parts = parseFloat(freshWo.totalPartsCost || '0');
          const recomputedLaborSubtotal = hrs * snappedLaborRate;
          const recomputedPartsSubtotal = parts;
          const recomputedTotal = recomputedLaborSubtotal + recomputedPartsSubtotal;
          workOrder = await storage.updateWorkOrder(id, {
            laborSubtotal: recomputedLaborSubtotal.toFixed(2),
            partsSubtotal: recomputedPartsSubtotal.toFixed(2),
            totalAmount: recomputedTotal.toFixed(2),
          }) || workOrder;
        }
      }

      // Task #207 — removed dead submission guard that checked for legacy
      // 'submitted'/'approved' work-order statuses. Neither value is valid
      // under workOrderStatusValues, so the branch was unreachable.

      res.json(workOrder);
    } catch (error) {
      console.error(error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid work order data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to update work order" });
    }
  });

  app.delete("/api/work-orders/bulk", requireWorkOrderBillingAccess, async (req, res) => {
    try {
      const { ids } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ message: "ids must be a non-empty array of numbers" });
      }
      const validIds = ids.filter((id: any) => typeof id === 'number' && id > 0);
      if (validIds.length === 0) {
        return res.status(400).json({ message: "No valid IDs provided" });
      }
      let deleted = 0;
      const skipped: number[] = [];
      for (const id of validIds) {
        const invoiced = await storage.hasInvoiceItems(id);
        if (invoiced) {
          skipped.push(id);
          continue;
        }
        await storage.deleteWorkOrderItems(id);
        const success = await storage.deleteWorkOrder(id);
        if (success) deleted++;
      }
      if (skipped.length > 0 && deleted === 0) {
        return res.status(409).json({ message: "These work orders are linked to invoices and cannot be deleted. Remove them from their invoices first." });
      }
      const skipMessage = skipped.length > 0
        ? `${skipped.length} work order(s) could not be deleted because they are linked to invoices. Remove them from their invoices first.`
        : undefined;
      res.json({ deleted, skipped, skipMessage });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to bulk delete work orders" });
    }
  });

  app.delete("/api/work-orders/:id", requireWorkOrderBillingAccess, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      
      // Validate work order ID is a valid number
      if (isNaN(id) || id <= 0) {
        return res.status(400).json({ message: "Invalid work order ID" });
      }
      const invoiced = await storage.hasInvoiceItems(id);
      if (invoiced) {
        return res.status(409).json({ message: "This work order is linked to an invoice and cannot be deleted. Remove it from the invoice first." });
      }
      await storage.deleteWorkOrderItems(id);
      const success = await storage.deleteWorkOrder(id);
      if (!success) {
        return res.status(404).json({ message: "Work order not found" });
      }
      res.json({ message: "Work order deleted successfully" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to delete work order" });
    }
  });

  // Work Order Items routes
  // Note: Pricing fields are stripped for field_tech role via applyPricingVisibility
  app.get("/api/work-orders/:id/items", async (req, res) => {
    try {
      const workOrderId = parseInt(req.params.id);
      
      // Validate work order ID is a valid number
      if (isNaN(workOrderId) || workOrderId <= 0) {
        return res.status(400).json({ message: "Invalid work order ID" });
      }
      const items = await storage.getWorkOrderItems(workOrderId);
      // Strip pricing fields for field technicians
      res.json(applyPricingVisibility(req, items));
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch work order items" });
    }
  });

  app.post("/api/work-orders/:id/items", async (req, res) => {
    try {
      const workOrderId = parseInt(req.params.id);
      
      // Validate work order ID is a valid number
      if (isNaN(workOrderId) || workOrderId <= 0) {
        return res.status(400).json({ message: "Invalid work order ID" });
      }

      // Server-side authoritative pricing (Task #160): if the body references a
      // catalog partId, overwrite partPrice from the catalog (and 4xx if invalid).
      const woItemCompanyId = req.authenticatedUserCompanyId
        ?? (req.headers['x-user-company-id']
          ? parseInt(req.headers['x-user-company-id'] as string)
          : null);
      // The work-order-item shape uses `partPrice` not `unitPrice`; map both ways.
      const probeItem: RawBillingItem = {
        partId: req.body.partId ?? null,
        partName: req.body.partName,
        quantity: req.body.quantity,
        unitPrice: req.body.unitPrice ?? req.body.partPrice ?? 0,
      };
      const itemPricing = await resolveAuthoritativePartPricing([probeItem], woItemCompanyId);
      if (itemPricing.error) {
        return res.status(itemPricing.error.status).json({ message: itemPricing.error.message });
      }
      const resolvedSingle = (itemPricing.items as RawBillingItem[] | undefined)?.[0] ?? probeItem;
      if (itemPricing.auditedZeros.length > 0) {
        const drift = itemPricing.auditedZeros[0];
        console.log(
          `[AUDIT] work_order_item_add_price_corrected workOrderId=${workOrderId} partId=${drift.partId} ` +
          `partName="${drift.partName}" clientUnitPrice=${drift.clientUnitPrice.toFixed(2)} ` +
          `catalogUnitPrice=${drift.catalogUnitPrice.toFixed(2)}`
        );
      }
      // Apply the resolved pricing back into the request body before parsing.
      const resolvedPrice = Number(resolvedSingle.unitPrice ?? 0);
      const resolvedBody = {
        ...req.body,
        partPrice: resolvedPrice.toString(),
        totalPrice: ((Number(req.body.quantity) || 0) * resolvedPrice).toString(),
      };

      const itemData = insertWorkOrderItemSchema.parse({
        ...resolvedBody,
        workOrderId
      });
      const item = await storage.addWorkOrderItem(itemData);
      await regressionGuardZeroCatalogPrices('work_order_conversion', workOrderId, [resolvedSingle]);

      // Recompute financial totals using stored applied rates (if available).
      // This ensures parts additions after completion keep the snapshot consistent.
      const wo = await storage.getWorkOrder(workOrderId);
      if (wo && wo.appliedLaborRate) {
        const snappedLaborRate = parseFloat(wo.appliedLaborRate);
        // Recompute totalPartsCost from all items, then derive full breakdown
        const allItems = await storage.getWorkOrderItems(workOrderId);
        const newPartsCost = allItems.reduce(
          (sum, i) => sum + (Number(i.quantity) || 0) * (Number(i.partPrice) || 0),
          0,
        );
        const hrs = parseFloat(wo.totalHours || '0');
        const recomputedLaborSubtotal = hrs * snappedLaborRate;
        const recomputedPartsSubtotal = newPartsCost;
        const recomputedTotal = recomputedLaborSubtotal + recomputedPartsSubtotal;
        await storage.updateWorkOrder(workOrderId, {
          totalPartsCost: newPartsCost.toFixed(2),
          laborSubtotal: recomputedLaborSubtotal.toFixed(2),
          partsSubtotal: recomputedPartsSubtotal.toFixed(2),
          totalAmount: recomputedTotal.toFixed(2),
        });
      }

      res.status(201).json(item);
    } catch (error) {
      console.error(error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid work order item data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to add work order item" });
    }
  });

  // Work Order Assignment with Notification
  app.post("/api/work-orders/:id/assign", async (req, res) => {
    try {
      const workOrderId = parseInt(req.params.id);
      
      // Validate work order ID is a valid number
      if (isNaN(workOrderId) || workOrderId <= 0) {
        return res.status(400).json({ message: "Invalid work order ID" });
      }
      const { technicianId, technicianName } = req.body;
      
      const success = await storage.assignWorkOrder(workOrderId, technicianId, technicianName);
      if (!success) {
        return res.status(404).json({ message: "Work order not found or assignment failed" });
      }
      
      // Get work order details for notification
      const workOrder = await storage.getWorkOrder(workOrderId);
      if (workOrder && technicianId) {
        // Notify field technician about work order assignment
        await storage.createNotification({
          userId: technicianId,
          type: "work_order_assigned",
          title: "New Work Order Assigned",
          message: `You have been assigned work order ${workOrder.workOrderNumber} for ${workOrder.projectName || 'irrigation project'}.`,
          relatedEntityType: "work_order",
          relatedEntityId: workOrderId
        });
      }
      
      res.json({ message: "Work order assigned successfully" });
    } catch (error) {
      console.error("Error assigning work order:", error);
      res.status(500).json({ message: "Failed to assign work order" });
    }
  });

  // Get billing sheet items
  app.get("/api/billing-sheets/:id/items", async (req, res) => {
    try {
      const billingSheetId = parseInt(req.params.id);
      
      // Validate billing sheet ID is a valid number
      if (isNaN(billingSheetId) || billingSheetId <= 0) {
        return res.status(400).json({ message: "Invalid billing sheet ID" });
      }
      const items = await storage.getBillingSheetItems(billingSheetId);
      res.json(items);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch billing sheet items" });
    }
  });

  // ─── Catalog $0-price audit / backfill (Task #160) ────────────────────────
  // Authorization: only company_admin / billing_manager / super_admin can
  // see or repair these rows. We trust ONLY the fields populated by the
  // `requireAuthentication` middleware — never raw `x-user-*` headers — so a
  // caller cannot spoof admin access by setting headers themselves.
  async function getAuditActor(req: any): Promise<{ userId: number | null; role: string | null; companyId: number | null; name: string | null }> {
    const userId: number | null = typeof req.authenticatedUserId === 'number' ? req.authenticatedUserId : null;
    const role: string | null = (req.authenticatedUserRole as string) ?? null;
    const companyId: number | null = typeof req.authenticatedUserCompanyId === 'number' ? req.authenticatedUserCompanyId : null;
    let name: string | null = null;
    if (userId != null) {
      try {
        const u = await storage.getUser(userId);
        name = u?.name ?? u?.username ?? null;
      } catch {
        name = null;
      }
    }
    return { userId, role, companyId, name };
  }
  function isAuditAdmin(role: string | null): boolean {
    return role === 'company_admin' || role === 'billing_manager' || role === 'super_admin';
  }

  app.get("/api/admin/billing-sheets/zero-price-audit", requireAuthentication, async (req: any, res) => {
    try {
      const actor = await getAuditActor(req);
      if (!isAuditAdmin(actor.role)) {
        return res.status(403).json({ message: "Access denied. Admin or billing manager role required." });
      }
      // super_admin can scope to a specific company via ?companyId=, or pass companyId=all to see everything
      let scopeCompanyId: number | null = actor.companyId;
      if (actor.role === 'super_admin') {
        const q = req.query.companyId;
        if (q === 'all') {
          scopeCompanyId = null;
        } else if (q) {
          scopeCompanyId = parseInt(q as string);
        }
      }
      const rows = await storage.getZeroPriceCatalogItems(scopeCompanyId);
      res.json({ companyId: scopeCompanyId, count: rows.length, rows });
    } catch (error) {
      console.error("[zero-price-audit] failed:", error);
      res.status(500).json({ message: "Failed to load zero-price audit" });
    }
  });

  app.post("/api/admin/billing-sheets/zero-price-audit/repair", requireAuthentication, async (req: any, res) => {
    try {
      const actor = await getAuditActor(req);
      if (!isAuditAdmin(actor.role)) {
        return res.status(403).json({ message: "Access denied. Admin or billing manager role required." });
      }
      const body = req.body || {};
      // Accept either:
      //   - body.selection: [{ source: 'billing_sheet'|'work_order'|'invoice', itemId: number }, ...]
      //   - body.itemIds: [number, ...] (legacy shape, treated as billing_sheet)
      // An empty selection means "repair every bad row in scope" — dry-run defaults
      // to true for safety.
      let selection: Array<{ source: 'billing_sheet' | 'work_order' | 'invoice'; itemId: number }> = [];
      if (Array.isArray(body.selection)) {
        selection = body.selection
          .map((s: any) => {
            const raw = s?.source;
            const source: 'billing_sheet' | 'work_order' | 'invoice' =
              raw === 'work_order' ? 'work_order'
              : raw === 'invoice' ? 'invoice'
              : 'billing_sheet';
            return { source, itemId: Number(s?.itemId) };
          })
          .filter((s: { source: string; itemId: number }) => Number.isFinite(s.itemId));
      } else if (Array.isArray(body.itemIds)) {
        selection = body.itemIds
          .map((n: unknown) => ({ source: 'billing_sheet' as const, itemId: Number(n) }))
          .filter((s: { itemId: number }) => Number.isFinite(s.itemId));
      }
      const dryRun = body.dryRun !== false; // default to dry-run for safety

      // super_admin may target a specific company (or "all")
      let scopeCompanyId: number | null = actor.companyId;
      if (actor.role === 'super_admin' && body.companyId !== undefined) {
        scopeCompanyId = body.companyId === 'all' ? null : Number(body.companyId);
      }

      const result = await storage.repriceBillingSheetItems(selection, scopeCompanyId, {
        dryRun,
        performedByUserId: actor.userId,
        performedByName: actor.name,
      });

      console.log(
        `[AUDIT] zero_price_audit_repair_invoked actor=${actor.userId ?? '?'} role=${actor.role} ` +
        `companyId=${scopeCompanyId ?? 'all'} dryRun=${dryRun} parentCount=${result.parentCount} ` +
        `itemCount=${result.itemCount} totalDifference=${result.totalDifference}`
      );

      res.json(result);
    } catch (error) {
      console.error("[zero-price-audit/repair] failed:", error);
      res.status(500).json({ message: "Failed to repair zero-price items" });
    }
  });
  // ─── /Catalog $0-price audit / backfill ───────────────────────────────────

  // ─── Labor Rate Mismatch audit (Task #200) ────────────────────────────────
  // Lists every un-invoiced WO + BS whose stored labor rate no longer
  // matches the customer's current standard or emergency rate, and lets an
  // admin re-price selected tickets in place. Mirrors the auth, scoping and
  // request/response conventions of the catalog $0-price audit above.
  app.get("/api/admin/labor-rate-audit", requireAuthentication, async (req: any, res) => {
    try {
      const actor = await getAuditActor(req);
      if (!isAuditAdmin(actor.role)) {
        return res.status(403).json({ message: "Access denied. Admin or billing manager role required." });
      }
      let scopeCompanyId: number | null = actor.companyId;
      if (actor.role === 'super_admin') {
        const q = req.query.companyId;
        if (q === 'all') {
          scopeCompanyId = null;
        } else if (q) {
          scopeCompanyId = parseInt(q as string);
        }
      }
      const rows = await storage.getLaborRateMismatchTickets(scopeCompanyId);
      res.json({ companyId: scopeCompanyId, count: rows.length, rows });
    } catch (error) {
      console.error("[labor-rate-audit] failed:", error);
      res.status(500).json({ message: "Failed to load labor rate audit" });
    }
  });

  app.post("/api/admin/labor-rate-audit/repair", requireAuthentication, async (req: any, res) => {
    try {
      const actor = await getAuditActor(req);
      if (!isAuditAdmin(actor.role)) {
        return res.status(403).json({ message: "Access denied. Admin or billing manager role required." });
      }
      const body = req.body || {};
      let selection: Array<{ source: 'work_order' | 'billing_sheet'; parentId: number; classification: 'standard' | 'emergency' }> = [];
      if (Array.isArray(body.selection)) {
        selection = body.selection
          .map((s: any) => {
            const rawSource = s?.source;
            const source: 'work_order' | 'billing_sheet' =
              rawSource === 'work_order' ? 'work_order' : 'billing_sheet';
            const rawClass = s?.classification;
            const classification: 'standard' | 'emergency' =
              rawClass === 'emergency' ? 'emergency' : 'standard';
            return { source, parentId: Number(s?.parentId), classification };
          })
          .filter((s: { parentId: number }) => Number.isFinite(s.parentId));
      }
      const dryRun = body.dryRun !== false; // default to dry-run for safety

      let scopeCompanyId: number | null = actor.companyId;
      if (actor.role === 'super_admin' && body.companyId !== undefined) {
        scopeCompanyId = body.companyId === 'all' ? null : Number(body.companyId);
      }

      const result = await storage.repriceLaborRateMismatches(selection, scopeCompanyId, {
        dryRun,
        performedByUserId: actor.userId,
        performedByName: actor.name,
      });

      console.log(
        `[AUDIT] labor_rate_audit_repair_invoked actor=${actor.userId ?? '?'} role=${actor.role} ` +
        `companyId=${scopeCompanyId ?? 'all'} dryRun=${dryRun} parentCount=${result.parentCount} ` +
        `totalDifference=${result.totalDifference} skipped=${result.skipped.length}`
      );

      res.json(result);
    } catch (error) {
      console.error("[labor-rate-audit/repair] failed:", error);
      res.status(500).json({ message: "Failed to repair labor rate mismatches" });
    }
  });
  // ─── /Labor Rate Mismatch audit ───────────────────────────────────────────

  // ─── Pricing audit event history (Task #212) ─────────────────────────────
  // Read-only endpoint that returns the structured history of automatic
  // reprice events for a given billing sheet or work order. Visible to
  // managers and admins only — field techs cannot see pricing data anywhere
  // in the app and so are explicitly blocked here too. Mirrors the auth
  // shape used by the /admin/* audit endpoints above.
  function isPricingHistoryViewer(role: string | null): boolean {
    return role === 'company_admin'
      || role === 'super_admin'
      || role === 'billing_manager'
      || role === 'irrigation_manager';
  }

  async function pricingHistoryHandler(
    req: any,
    res: any,
    source: 'billing_sheet' | 'work_order',
  ) {
    try {
      const role: string | null = (req.authenticatedUserRole as string) ?? null;
      if (!isPricingHistoryViewer(role)) {
        return res.status(403).json({
          message: "Access denied. Manager or admin role required to view pricing history.",
        });
      }
      const parentId = parseInt(req.params.id);
      if (!Number.isFinite(parentId)) {
        return res.status(400).json({ message: "Invalid id" });
      }

      // Scope the lookup to the user's company so a manager from company A
      // cannot read events for a parent owned by company B.
      const scopeCompanyId: number | null = typeof req.authenticatedUserCompanyId === 'number'
        ? req.authenticatedUserCompanyId
        : null;
      if (role !== 'super_admin') {
        // Non-super-admin callers MUST have a company on their session.
        if (scopeCompanyId == null) {
          return res.status(403).json({ message: "Access denied" });
        }
        if (source === 'billing_sheet') {
          const sheet = await storage.getBillingSheetById(parentId);
          if (!sheet) return res.status(404).json({ message: "Billing sheet not found" });
          // If the sheet has no customer linkage, ownership cannot be proven —
          // deny rather than fall through to an unscoped read.
          if (!sheet.customerId) {
            return res.status(403).json({ message: "Access denied" });
          }
          const cust = await storage.getCustomer(sheet.customerId);
          if (!cust || cust.companyId !== scopeCompanyId) {
            return res.status(403).json({ message: "Access denied" });
          }
        } else {
          const wo = await storage.getWorkOrder(parentId);
          if (!wo) return res.status(404).json({ message: "Work order not found" });
          if (!wo.customerId) {
            return res.status(403).json({ message: "Access denied" });
          }
          const cust = await storage.getCustomer(wo.customerId);
          if (!cust || cust.companyId !== scopeCompanyId) {
            return res.status(403).json({ message: "Access denied" });
          }
        }
      }

      // Defense-in-depth: also pass the company filter into the data layer so
      // a missed route guard can never leak cross-company events.
      const events = await storage.getPricingAuditEvents(
        source,
        parentId,
        role === 'super_admin' ? null : scopeCompanyId,
      );
      res.json({ source, parentId, count: events.length, events });
    } catch (error) {
      console.error(`[pricing-audit-history:${source}] failed:`, error);
      res.status(500).json({ message: "Failed to load pricing audit history" });
    }
  }

  app.get(
    "/api/billing-sheets/:id/pricing-audit-events",
    requireAuthentication,
    async (req: any, res) => pricingHistoryHandler(req, res, 'billing_sheet'),
  );
  app.get(
    "/api/work-orders/:id/pricing-audit-events",
    requireAuthentication,
    async (req: any, res) => pricingHistoryHandler(req, res, 'work_order'),
  );
  // ─── /Pricing audit event history ────────────────────────────────────────

  // Billing Sheet routes
  app.post("/api/work-orders/:id/billing-sheet", async (req, res) => {
    try {
      const workOrderId = parseInt(req.params.id);
      
      // Validate work order ID is a valid number
      if (isNaN(workOrderId) || workOrderId <= 0) {
        return res.status(400).json({ message: "Invalid work order ID" });
      }

      // Fetch the work order to enrich billing sheet with required fields
      const workOrder = await storage.getWorkOrder(workOrderId);
      if (!workOrder) {
        return res.status(404).json({ message: "Work order not found" });
      }

      // Branch enforcement: the work order must have a branchName if its customer has branches
      if (workOrder.customerId) {
        const customer = await storage.getCustomer(workOrder.customerId);
        if (customer && Array.isArray(customer.branches) && customer.branches.length > 0) {
          // Accept branchName from the request body (tech may be selecting it now) or already set on the work order
          const effectiveBranch = req.body.branchName || workOrder.branchName;
          if (!effectiveBranch || String(effectiveBranch).trim() === '') {
            return res.status(400).json({ message: "Branch is required for this customer. Please select a branch before submitting." });
          }
        }
      }

      const { techName, workPerformed, additionalNotes, totalPartsCost, arrivalPhoto, finishedPhoto, actualStartTime, actualEndTime, materialItems, laborItems, additionalCharges, technicianNotes, laborRate: formLaborRate, aiInputs: reqAiInputs, aiShortDescription, aiDetailedDescription, ...rest } = req.body;

      // Manager-class roles (irrigation_manager, billing_manager, company_admin,
      // super_admin) self-approve at conversion time and route directly to
      // 'approved_passed_to_billing' so the resulting billing sheet immediately
      // surfaces in the customer's Ready-to-Invoice list (Task #206).
      const creatorRole = req.authenticatedUserRole || req.headers['x-user-role'];
      let resolvedStatus: BillingSheetStatus;
      if (
        creatorRole === 'irrigation_manager' ||
        creatorRole === 'billing_manager' ||
        creatorRole === 'company_admin' ||
        creatorRole === 'super_admin'
      ) {
        resolvedStatus = 'approved_passed_to_billing';
      } else if (creatorRole === 'field_tech') {
        resolvedStatus = 'submitted';
      } else {
        resolvedStatus = 'draft';
      }

      const totalHoursVal = workOrder.totalHours ?? "0";
      // Always look up the customer's authoritative labor rate — fail fast if unavailable.
      if (!workOrder.customerId) {
        return res.status(400).json({ message: "Work order has no associated customer. Cannot determine labor rate." });
      }
      const woCustomerForRate = await storage.getCustomer(workOrder.customerId);
      if (!woCustomerForRate) {
        return res.status(400).json({ message: "Customer not found. Cannot determine labor rate." });
      }
      if (!woCustomerForRate.laborRate || parseFloat(woCustomerForRate.laborRate) <= 0) {
        return res.status(400).json({ message: `Customer "${woCustomerForRate.name}" does not have a labor rate configured. Please set a labor rate on the customer record before converting to a billing sheet.` });
      }
      const laborRateVal = parseFloat(woCustomerForRate.laborRate).toFixed(2);
      const laborSubtotalVal = (parseFloat(String(totalHoursVal)) * parseFloat(String(laborRateVal))).toFixed(2);
      const partsSubtotalVal = parseFloat(String(totalPartsCost || "0")).toFixed(2);
      const totalAmount = (parseFloat(laborSubtotalVal) + parseFloat(partsSubtotalVal)).toFixed(2);

      type RawLineItem = {
        partId?: number | null;
        partName?: string;
        partDescription?: string | null;
        description?: string;
        quantity?: number | string;
        unitPrice?: number | string;
        partPrice?: number | string;
        laborHours?: number | string;
        notes?: string | null;
      };

      type ResolvedBillingItem = {
        partId?: number | null;
        partName: string;
        partDescription?: string | null;
        quantity: string;
        unitPrice: string;
        totalPrice: string;
        laborHours: string;
        notes?: string | null;
      };

      const mapRawLineItem = (item: RawLineItem): ResolvedBillingItem => {
        const qty = Number(item.quantity) || 0;
        const price = Number(item.unitPrice) || Number(item.partPrice) || 0;
        return {
          partId: item.partId ?? null,
          partName: item.partName || item.description || "Part",
          partDescription: item.partDescription || item.description || null,
          quantity: qty.toString(),
          unitPrice: price.toString(),
          totalPrice: (qty * price).toFixed(2),
          laborHours: (Number(item.laborHours) || 0).toString(),
          notes: item.notes ?? null,
        };
      };

      // Build billing sheet items from materialItems and laborItems in the request body.
      // Fall back to work_order_items if no items were provided in this request.
      let resolvedItems: ResolvedBillingItem[] = [];

      const rawMaterialItems: RawLineItem[] = Array.isArray(materialItems) ? materialItems : [];
      const rawLaborItems: RawLineItem[] = Array.isArray(laborItems) ? laborItems : [];
      const rawRequestItems = [...rawMaterialItems, ...rawLaborItems];

      // Server-side authoritative pricing (Task #160): rewrite catalog line item
      // unit prices from the catalog before persisting. 4xx-reject if a partId
      // points at no part / wrong company.
      const woCompanyIdForPricing = req.authenticatedUserCompanyId
        ?? (req.headers['x-user-company-id']
          ? parseInt(req.headers['x-user-company-id'] as string)
          : (woCustomerForRate.companyId ?? null));
      const woPricingResult = await resolveAuthoritativePartPricing(rawRequestItems as RawBillingItem[], woCompanyIdForPricing);
      if (woPricingResult.error) {
        return res.status(woPricingResult.error.status).json({ message: woPricingResult.error.message });
      }
      const resolvedRequestItems = (woPricingResult.items as RawLineItem[] | undefined) ?? rawRequestItems;
      if (woPricingResult.auditedZeros.length > 0) {
        for (const drift of woPricingResult.auditedZeros) {
          console.log(
            `[AUDIT] work_order_conversion_price_corrected workOrderId=${workOrderId} partId=${drift.partId} ` +
            `partName="${drift.partName}" clientUnitPrice=${drift.clientUnitPrice.toFixed(2)} ` +
            `catalogUnitPrice=${drift.catalogUnitPrice.toFixed(2)}`
          );
        }
      }

      if (resolvedRequestItems.length > 0) {
        resolvedItems = resolvedRequestItems.map(mapRawLineItem);
      } else {
        // Fall back to items already saved on the work order
        const workOrderItemsList = await storage.getWorkOrderItems(workOrderId);
        if (workOrderItemsList.length > 0) {
          resolvedItems = await Promise.all(workOrderItemsList.map(async (item) => {
            let unitPrice = parseFloat(item.partPrice ?? '0');
            // If the work order item has a $0 price but a valid partId, look up the current catalog price
            if (unitPrice === 0 && item.partId) {
              const catalogPart = await storage.getPart(item.partId);
              if (catalogPart && parseFloat(catalogPart.price) > 0) {
                unitPrice = parseFloat(catalogPart.price);
              }
            }
            const qty = parseFloat(String(item.quantity) ?? '0');
            return {
              partId: item.partId || null,
              partName: item.partName,
              partDescription: null,
              quantity: String(item.quantity),
              unitPrice: unitPrice.toString(),
              totalPrice: (qty * unitPrice).toFixed(2),
              laborHours: item.laborHours,
              notes: item.notes || null,
            };
          }));
        }
      }

      const workOrderSourceItemCount = (await storage.getWorkOrderItems(workOrderId)).length;
      // Use branchName from request body (tech may have selected it) or fall back to the work order's stored branch
      const effectiveBranchName = req.body.branchName || workOrder.branchName || null;
      const newBillingSheet = await storage.createBillingSheet({
        technicianName: techName || workOrder.assignedTechnicianName || "",
        workDescription: workPerformed || "",
        customerName: workOrder.customerName,
        propertyAddress: workOrder.projectAddress || "",
        customerId: workOrder.customerId,
        totalHours: totalHoursVal,
        laborRate: laborRateVal,
        laborSubtotal: laborSubtotalVal,
        partsSubtotal: partsSubtotalVal,
        totalAmount,
        status: resolvedStatus,
        notes: additionalNotes || technicianNotes || "",
        photos: [arrivalPhoto, finishedPhoto].filter((p): p is string => typeof p === 'string' && p.trim().length > 0),
        workDate: new Date(),
        aiInputs: reqAiInputs || null,
        aiShortDescription: aiShortDescription || null,
        aiDetailedDescription: aiDetailedDescription || null,
        branchName: effectiveBranchName,
        items: resolvedItems.length > 0 ? resolvedItems : undefined,
      });
      console.log(`[AUDIT] work_order_converted_to_billing_sheet workOrderId=${workOrderId} billingSheetId=${newBillingSheet.id} sourceItemCount=${workOrderSourceItemCount} billingSheetItemsWritten=${resolvedItems.length}`);

      // Task #206 — manager-class self-approval: stamp the same approval audit
      // fields the manual /approve endpoint uses so the resulting billing
      // sheet is fully traceable in Ready-to-Invoice listings.
      if (resolvedStatus === 'approved_passed_to_billing') {
        const approverUser = req.authenticatedUserId
          ? await storage.getUser(req.authenticatedUserId)
          : undefined;
        const approverName = approverUser?.name || 'Manager';
        const partsSnapshot = JSON.stringify({ partsSubtotal: newBillingSheet.partsSubtotal });
        const laborSnapshot = JSON.stringify({
          totalHours: newBillingSheet.totalHours,
          laborRate: newBillingSheet.laborRate,
          laborSubtotal: newBillingSheet.laborSubtotal,
        });
        const approvalPatch: Partial<InsertBillingSheet> = {
          approvedBy: approverName,
          approvedByUserId: req.authenticatedUserId || undefined,
          approvedAt: new Date(),
          approvedTotal: newBillingSheet.totalAmount,
          approvedPartsSnapshot: partsSnapshot,
          approvedLaborSnapshot: laborSnapshot,
        };
        await storage.updateBillingSheet(newBillingSheet.id, approvalPatch);
      }
      // Regression guard: surface any catalog $0 leak that slipped through.
      await regressionGuardZeroCatalogPrices('work_order_conversion', newBillingSheet.id, resolvedItems as RawBillingItem[]);
      res.json({ message: "Billing sheet saved successfully" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to save billing sheet" });
    }
  });

  app.get("/api/work-orders/:id/billing-sheet", async (req, res) => {
    try {
      const workOrderId = parseInt(req.params.id);
      
      // Validate work order ID is a valid number
      if (isNaN(workOrderId) || workOrderId <= 0) {
        return res.status(400).json({ message: "Invalid work order ID" });
      }
      const billingSheet = await storage.getBillingSheetById(workOrderId);
      if (!billingSheet) {
        return res.status(404).json({ message: "Billing sheet not found" });
      }
      res.json(billingSheet);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch billing sheet" });
    }
  });

  // ── Photo pipeline ────────────────────────────────────────────────────
  // Variants: thumb (~400px), medium (~1200px), original (preserved).
  // Stored DB photoId is the canonical baseId (e.g. "photos/<uuid>").

  // Returns a signed GCS PUT URL and canonical photo path; client PUTs directly to GCS.
  app.post("/api/upload/photo", requireAuthentication, async (req, res) => {
    try {
      const originalName = (req.query.originalName as string) || "photo";
      const ext = originalName.split('.').pop()?.toLowerCase() || '';
      const allowedExtensions = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'bmp', 'tiff', 'tif', 'avif'];
      if (ext && !allowedExtensions.includes(ext)) {
        return res.status(400).json({ message: "Only image files are allowed for photo uploads" });
      }

      const photoService = new ObjectStorageService();
      const { signedUrl, photoId } = await photoService.getPhotoUploadURL();
      res.json({
        signedUrl,
        url: photoId,
        fileName: photoId,
        originalName,
      });
    } catch (error) {
      console.error("Photo upload URL generation error:", error);
      res.status(500).json({ message: "Failed to generate photo upload URL" });
    }
  });

  // Called by the client after a successful PUT to GCS. Generates display
  // variants (thumb + medium) from the uploaded display copy. New uploads
  // intentionally have no preserved original under `originals/<uuid>` —
  // legacy photos that already have one continue to serve via
  // `?variant=original`. Errors are logged but never fail the request —
  // the next-best variant (or the base path) will still serve in galleries.
  app.post("/api/upload/photo/finalize", requireAuthentication, async (req, res) => {
    try {
      const photoId = (req.body?.photoId as string)?.trim();
      if (!photoId || !photoId.startsWith("photos/")) {
        return res.status(400).json({ message: "Invalid photoId" });
      }
      const photoService = new ObjectStorageService();
      // Run variant generation in the background — don't block the upload UX.
      photoService.ensurePhotoVariants(photoId)
        .then((r) => {
          if (r.error) console.warn(`[PHOTO-FINALIZE] ${photoId} partial:`, r);
        })
        .catch((e) => console.error(`[PHOTO-FINALIZE] ${photoId} failed:`, e));
      res.json({ ok: true });
    } catch (error) {
      console.error("Photo finalize error:", error);
      res.status(500).json({ message: "Failed to finalize photo" });
    }
  });

  // Batch signed-URL endpoint. Accepts { photoIds: string[], variant?: "thumb"|"medium"|"original" }
  // Returns a parallel array { results: [{ photoId, url }] } so a gallery
  // with N photos costs one round-trip instead of N.
  app.post("/api/photos/signed-urls", requireAuthentication, async (req, res) => {
    try {
      const { photoIds, variant } = req.body || {};
      if (!Array.isArray(photoIds)) {
        return res.status(400).json({ message: "photoIds must be an array" });
      }
      if (photoIds.length > 200) {
        return res.status(400).json({ message: "Too many photoIds (max 200)" });
      }
      const requested = (variant === "thumb" || variant === "medium" || variant === "original")
        ? variant : "medium";
      const photoService = new ObjectStorageService();

      const results = await Promise.all(photoIds.map(async (raw: string) => {
        const photoId = String(raw || "");
        if (!photoId) return { photoId, url: null };

        // Legacy /uploads paths: try object-storage first (post-backfill
        // they live there), then fall through to the proxy which still has
        // the on-disk fallback for un-backfilled installs. We KEEP the
        // `uploads/` prefix on the proxy URL so a future cleanup of the
        // disk fallback does not break historical photo URLs.
        if (photoId.startsWith("uploads/") || photoId.startsWith("/uploads/")) {
          const normalized = photoId.replace(/^\//, "");
          const signed = await photoService.getPhotoDownloadURL(normalized, 900, requested);
          if (signed) return { photoId, url: signed };
          return { photoId, url: `/api/photos/${normalized}?variant=${requested}` };
        }

        const signed = await photoService.getPhotoDownloadURL(photoId, 900, requested);
        if (signed) return { photoId, url: signed };
        return { photoId, url: `/api/photos/${photoId}?variant=${requested}` };
      }));

      res.json({ variant: requested, results });
    } catch (error) {
      console.error("[PHOTO-BATCH-SIGN] error:", error);
      res.status(500).json({ message: "Failed to batch sign URLs" });
    }
  });

  // Single signed-URL endpoint (kept for compatibility). `?variant=` selects
  // a specific variant; defaults to medium.
  app.get("/api/photos/:photoId(*)/signed-url", requireAuthentication, async (req, res) => {
    const photoId = req.params.photoId;
    const variantQ = String(req.query.variant || "medium");
    const variant = (variantQ === "thumb" || variantQ === "medium" || variantQ === "original")
      ? variantQ : "medium";
    try {
      const photoService = new ObjectStorageService();
      const normalized = photoId.startsWith("/") ? photoId.slice(1) : photoId;
      const signedUrl = await photoService.getPhotoDownloadURL(normalized, 900, variant);
      if (signedUrl) return res.json({ url: signedUrl });

      return res.json({ url: `/api/photos/${normalized}?variant=${variant}` });
    } catch (error) {
      console.error(`[PHOTO-SIGNED-URL] Error generating signed URL for ${photoId}:`, error);
      return res.status(500).json({ error: "Failed to generate signed URL" });
    }
  });

  // Authenticated photo-serving route — supports `?variant=` for display
  // variants. Display variants get long-lived public cache headers
  // (content-addressed by an unguessable UUID, so safe to cache).
  app.get("/api/photos/:photoId(*)", requireAuthentication, async (req, res) => {
    const photoId = req.params.photoId;
    const variantQ = String(req.query.variant || "");
    const variant = (variantQ === "thumb" || variantQ === "medium" || variantQ === "original")
      ? variantQ : null;
    try {
      const photoService = new ObjectStorageService();

      const file = variant
        ? await photoService.findVariant(photoId, variant)
        : await photoService.searchPhotoObject(photoId);

      if (file) {
        const isDisplay = variant === "thumb" || variant === "medium";
        return photoService.downloadObject(file, res, 3600, { displayVariant: isDisplay });
      }

      // Legacy fallback: serve from local ./uploads directory
      const path = await import("path");
      const fs = await import("fs");
      const safeName = path.basename(photoId.replace(/^\/uploads\//, ""));
      const localPath = path.join("./uploads", safeName);
      if (fs.existsSync(localPath)) {
        return res.sendFile(path.resolve(localPath));
      }

      return res.status(404).json({ error: "Photo not found" });
    } catch (error) {
      console.error(`[PHOTO-SERVE] Error serving photo ${photoId}:`, error);
      if (!res.headersSent) {
        return res.status(500).json({ error: "Failed to serve photo" });
      }
    }
  });

  app.post("/api/upload/attachment", requireAuthentication, async (req, res) => {
    try {
      if (!req.files || !req.files.attachment) {
        return res.status(400).json({ message: "No attachment file provided" });
      }

      const attachment = Array.isArray(req.files.attachment) ? req.files.attachment[0] : req.files.attachment;
      const fileName = `attachment_${Date.now()}_${attachment.name.replace(/\s+/g, '_')}`;
      const uploadPath = `./uploads/${fileName}`;

      await attachment.mv(uploadPath);
      res.json({ url: `/api/attachments/${fileName}`, fileName, originalName: attachment.name });
    } catch (error) {
      console.error("Attachment upload error:", error);
      res.status(500).json({ message: "Failed to upload attachment" });
    }
  });

  // Authenticated attachment serving route — serves attachments from local disk
  // Also handles legacy /uploads/ URLs stored in DB before migration
  app.get("/api/attachments/:fileName(*)", requireAuthentication, async (req, res) => {
    try {
      const pathMod = await import("path");
      const fs = await import("fs");
      const safeName = pathMod.basename(req.params.fileName);
      const localPath = pathMod.join("./uploads", safeName);
      if (fs.existsSync(localPath)) {
        return res.sendFile(pathMod.resolve(localPath));
      }
      return res.status(404).json({ error: "Attachment not found" });
    } catch (error) {
      console.error(`[ATTACHMENT-SERVE] Error serving attachment ${req.params.fileName}:`, error);
      if (!res.headersSent) {
        return res.status(500).json({ error: "Failed to serve attachment" });
      }
    }
  });

  const httpServer = createServer(app);
  // Notification routes
  app.get("/api/notifications/:userId", requireNotificationAccess, async (req, res) => {
    try {
      const userId = req.authenticatedUserId!;
      
      const notifications = await storage.getNotifications(userId);
      res.json(notifications);
    } catch (error) {
      console.error("Error fetching notifications:", {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        userId: req.authenticatedUserId,
        timestamp: new Date().toISOString()
      });
      res.status(500).json({ message: "Failed to fetch notifications" });
    }
  });

  app.get("/api/notifications/:userId/count", requireNotificationAccess, async (req, res) => {
    try {
      const userId = req.authenticatedUserId!;
      
      const count = await storage.getUnreadNotificationCount(userId);
      res.json({ count });
    } catch (error) {
      console.error("Error fetching notification count:", {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        userId: req.authenticatedUserId,
        timestamp: new Date().toISOString()
      });
      res.status(500).json({ message: "Failed to fetch notification count" });
    }
  });

  app.post("/api/notifications", async (req, res) => {
    try {
      const validatedData = insertNotificationSchema.parse(req.body);
      const notification = await storage.createNotification(validatedData);
      res.status(201).json(notification);
    } catch (error) {
      console.error("Error creating notification:", error);
      res.status(500).json({ message: "Failed to create notification" });
    }
  });

  app.put("/api/notifications/:id/read", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const success = await storage.markNotificationAsRead(id);
      if (success) {
        res.json({ message: "Notification marked as read" });
      } else {
        res.status(404).json({ message: "Notification not found" });
      }
    } catch (error) {
      console.error("Error marking notification as read:", error);
      res.status(500).json({ message: "Failed to mark notification as read" });
    }
  });

  app.put("/api/notifications/:userId/read-all", async (req, res) => {
    try {
      const userId = parseInt(req.params.userId);
      const success = await storage.markAllNotificationsAsRead(userId);
      res.json({ message: "All notifications marked as read" });
    } catch (error) {
      console.error("Error marking all notifications as read:", error);
      res.status(500).json({ message: "Failed to mark all notifications as read" });
    }
  });



  // PDF Generation Route for Sample Invoice
  app.get("/api/sample-invoice-pdf", async (req, res) => {
    try {
      const { PDFGenerator } = await import('./pdf-generator');
      const invoiceUrl = `http://localhost:5000/invoice-preview.html`;
      
      const pdfBuffer = await PDFGenerator.generateInvoicePDFFromUrl(invoiceUrl);
      
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="Sample-Invoice-INV-202508-0014.pdf"');
      res.send(pdfBuffer);
    } catch (error) {
      console.error('PDF generation error:', error);
      res.status(500).json({ message: "Failed to generate PDF" });
    }
  });

  // QuickBooks Developer Portal Required URLs
  
  // Multi-Factor Authentication API endpoints
  app.post("/api/mfa/setup", async (req, res) => {
    try {
      const userId = req.user?.id;
      const userEmail = req.user?.email;
      
      if (!userId || !userEmail) {
        return res.status(401).json({ message: "Authentication required" });
      }

      const { mfaManager } = await import('./mfa');
      const mfaSecret = await mfaManager.setupMFA(userId, userEmail);
      
      // Don't store in database yet - wait for verification
      res.json({
        qrCodeUrl: mfaSecret.qrCodeUrl,
        backupCodes: mfaSecret.backupCodes,
        secret: mfaSecret.secret, // Temporary - remove after setup
        message: "Scan QR code with authenticator app and verify to complete setup"
      });
    } catch (error) {
      console.error("Error setting up MFA:", error);
      res.status(500).json({ message: "Failed to setup multi-factor authentication" });
    }
  });

  app.post("/api/mfa/verify-setup", async (req, res) => {
    try {
      const userId = req.user?.id;
      const { secret, code, backupCodes } = req.body;
      
      if (!userId) {
        return res.status(401).json({ message: "Authentication required" });
      }

      const { mfaManager } = await import('./mfa');
      const isValid = await mfaManager.verifyTOTP(secret, code, userId);
      
      if (isValid) {
        // Save MFA settings to database
        await storage.updateUser(userId, {
          mfaEnabled: true,
          mfaSecret: secret,
          mfaBackupCodes: JSON.stringify(backupCodes),
          mfaLastUsed: new Date()
        });
        
        res.json({ 
          success: true, 
          message: "Multi-factor authentication enabled successfully" 
        });
      } else {
        res.status(400).json({ 
          success: false, 
          message: "Invalid verification code" 
        });
      }
    } catch (error) {
      console.error("Error verifying MFA setup:", error);
      res.status(500).json({ message: "Failed to verify MFA setup" });
    }
  });

  app.post("/api/mfa/verify", async (req, res) => {
    try {
      const userId = req.user?.id;
      const { code } = req.body;
      
      if (!userId) {
        return res.status(401).json({ message: "Authentication required" });
      }

      const user = await storage.getUser(userId);
      if (!user || !user.mfaEnabled || !user.mfaSecret) {
        return res.status(400).json({ message: "MFA not enabled for this user" });
      }

      const { mfaManager } = await import('./mfa');
      const backupCodes = user.mfaBackupCodes ? JSON.parse(user.mfaBackupCodes) : [];
      const verification = await mfaManager.verifyMFA(user.mfaSecret, backupCodes, code, userId);
      
      if (verification.isValid) {
        // Update last used timestamp
        await storage.updateUser(userId, { mfaLastUsed: new Date() });
        
        // If backup code was used, update the codes
        if (verification.usedBackupCode) {
          const updatedCodes = backupCodes.filter((c: string) => c !== verification.usedBackupCode);
          await storage.updateUser(userId, { 
            mfaBackupCodes: JSON.stringify(updatedCodes) 
          });
        }
        
        res.json({ 
          success: true, 
          message: "MFA verification successful",
          usedBackupCode: !!verification.usedBackupCode
        });
      } else {
        res.status(400).json({ 
          success: false, 
          message: "Invalid verification code" 
        });
      }
    } catch (error) {
      console.error("Error verifying MFA:", error);
      res.status(500).json({ message: "Failed to verify MFA" });
    }
  });

  app.post("/api/mfa/disable", async (req, res) => {
    try {
      const userId = req.user?.id;
      const { password } = req.body;
      
      if (!userId) {
        return res.status(401).json({ message: "Authentication required" });
      }

      // Verify password before disabling MFA
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      const bcrypt = await import('bcrypt');
      const passwordValid = await bcrypt.compare(password, user.password);
      if (!passwordValid) {
        return res.status(400).json({ message: "Invalid password" });
      }

      const { mfaManager } = await import('./mfa');
      await mfaManager.disableMFA(userId);
      
      // Remove MFA from database
      await storage.updateUser(userId, {
        mfaEnabled: false,
        mfaSecret: null,
        mfaBackupCodes: null,
        mfaLastUsed: null
      });
      
      res.json({ 
        success: true, 
        message: "Multi-factor authentication disabled" 
      });
    } catch (error) {
      console.error("Error disabling MFA:", error);
      res.status(500).json({ message: "Failed to disable MFA" });
    }
  });

  app.post("/api/mfa/backup-codes/regenerate", async (req, res) => {
    try {
      const userId = req.user?.id;
      
      if (!userId) {
        return res.status(401).json({ message: "Authentication required" });
      }

      const user = await storage.getUser(userId);
      if (!user || !user.mfaEnabled) {
        return res.status(400).json({ message: "MFA not enabled for this user" });
      }

      const { mfaManager } = await import('./mfa');
      const newBackupCodes = await mfaManager.regenerateBackupCodes(userId);
      
      // Update database with new backup codes
      await storage.updateUser(userId, {
        mfaBackupCodes: JSON.stringify(newBackupCodes)
      });
      
      res.json({ 
        success: true, 
        backupCodes: newBackupCodes,
        message: "New backup codes generated" 
      });
    } catch (error) {
      console.error("Error regenerating backup codes:", error);
      res.status(500).json({ message: "Failed to regenerate backup codes" });
    }
  });

  app.get("/api/mfa/status", async (req, res) => {
    try {
      const userId = req.user?.id;
      
      if (!userId) {
        return res.status(401).json({ message: "Authentication required" });
      }

      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      const backupCodes = user.mfaBackupCodes ? JSON.parse(user.mfaBackupCodes) : [];
      
      res.json({
        mfaEnabled: user.mfaEnabled || false,
        lastUsed: user.mfaLastUsed,
        backupCodesRemaining: backupCodes.length
      });
    } catch (error) {
      console.error("Error getting MFA status:", error);
      res.status(500).json({ message: "Failed to get MFA status" });
    }
  });

  // Security Assessment API endpoints
  app.get("/api/security/assessment", async (req, res) => {
    try {
      const { securityManager } = await import('./security');
      const assessment = await securityManager.performSecurityAssessment();
      res.json(assessment);
    } catch (error) {
      console.error("Error performing security assessment:", error);
      res.status(500).json({ message: "Failed to perform security assessment" });
    }
  });

  app.get("/api/security/status", async (req, res) => {
    try {
      const { securityManager } = await import('./security');
      const status = securityManager.getSecurityStatus();
      res.json(status);
    } catch (error) {
      console.error("Error getting security status:", error);
      res.status(500).json({ message: "Failed to get security status" });
    }
  });

  app.post("/api/security/incident", async (req, res) => {
    try {
      const { securityManager } = await import('./security');
      const { type, severity, description, affectedSystems, userId } = req.body;
      
      securityManager.reportSecurityIncident({
        type,
        severity,
        description,
        affectedSystems,
        userId
      });
      
      res.json({ message: "Security incident reported successfully" });
    } catch (error) {
      console.error("Error reporting security incident:", error);
      res.status(500).json({ message: "Failed to report security incident" });
    }
  });

  // Logging and troubleshooting API endpoints
  app.get("/api/logs", async (req, res) => {
    try {
      const { level, context, userId, since, limit } = req.query;
      
      const filters: any = {};
      if (level) filters.level = level as string;
      if (context) filters.context = context as string;
      if (userId) filters.userId = parseInt(userId as string);
      if (since) filters.since = new Date(since as string);
      if (limit) filters.limit = parseInt(limit as string) || 100;

      // For now, return empty logs as the logger integration is being set up
      const logs: any[] = [];
      res.json({ logs, total: logs.length, message: "Enhanced logging system available" });
    } catch (error) {
      console.error("Error fetching logs:", error);
      res.status(500).json({ message: "Failed to fetch logs" });
    }
  });

  app.get("/api/logs/export", async (req, res) => {
    try {
      const exportData = {
        exportedAt: new Date().toISOString(),
        logs: [],
        message: "Enhanced logging system ready for troubleshooting"
      };
      
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="irrigopro-logs-${new Date().toISOString().split('T')[0]}.json"`);
      res.send(JSON.stringify(exportData, null, 2));
    } catch (error) {
      console.error("Error exporting logs:", error);
      res.status(500).json({ message: "Failed to export logs" });
    }
  });

  app.get("/api/logs/summary", async (req, res) => {
    try {
      const summary = {
        totalErrors: 0,
        quickbooksErrors: 0,
        recentErrors: [],
        errorsByContext: {},
        loggingSystemStatus: "Enhanced logging system operational"
      };
      
      res.json(summary);
    } catch (error) {
      console.error("Error getting log summary:", error);
      res.status(500).json({ message: "Failed to get log summary" });
    }
  });

  // Launch URL - Called when user clicks "Launch" button in QuickBooks App Menu
  app.get("/api/quickbooks/launch", requireQuickBooksAccess, async (req, res) => {
    try {
      // Log the launch request with enhanced logging
      console.log('QuickBooks Launch URL accessed:', req.query);
      
      // Redirect to the main application with QuickBooks context
      // The realmId (company ID) will be provided by QuickBooks
      const realmId = req.query.realmId;
      
      // Redirect to customer billing page where QuickBooks integration is located
      res.redirect('/customer-billing?source=quickbooks_launch');
    } catch (error) {
      console.error('QuickBooks Launch URL error:', error);
      res.status(500).json({ message: "QuickBooks launch failed" });
    }
  });
  
  // Disconnect URL - Called when user disconnects the app from QuickBooks
  app.post("/api/quickbooks/disconnect", async (req, res) => {
    try {
      console.log('QuickBooks Disconnect URL accessed:', req.body);
      
      // Handle the disconnection
      // This would typically:
      // 1. Remove stored QuickBooks tokens for this company
      // 2. Update company settings to reflect disconnection
      // 3. Log the disconnection event
      
      const realmId = req.body.realmId;
      
      // For now, just acknowledge the disconnection
      // In a full implementation, you'd clean up stored tokens and company associations
      
      res.json({ 
        message: "QuickBooks disconnection processed successfully",
        status: "disconnected",
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('QuickBooks Disconnect URL error:', error);
      res.status(500).json({ message: "QuickBooks disconnect processing failed" });
    }
  });

  // ============================================
  // External API Key Management Routes
  // ============================================
  
  // Get all API keys for the company (admin only)
  app.get("/api/company/:companyId/api-keys", requireCompanyAdminAccess, async (req, res) => {
    try {
      const companyId = parseInt(req.params.companyId);
      const apiKeys = await storage.getApiKeys(companyId);
      
      // Return keys without the actual key value (only prefix for identification)
      const safeKeys = apiKeys.map(key => ({
        id: key.id,
        name: key.name,
        keyPrefix: key.keyPrefix,
        isActive: key.isActive,
        lastUsedAt: key.lastUsedAt,
        createdAt: key.createdAt,
        expiresAt: key.expiresAt
      }));
      
      res.json(safeKeys);
    } catch (error) {
      console.error("Error fetching API keys:", error);
      res.status(500).json({ message: "Failed to fetch API keys" });
    }
  });

  // Create a new API key (admin only)
  app.post("/api/company/:companyId/api-keys", requireCompanyAdminAccess, async (req, res) => {
    try {
      const companyId = parseInt(req.params.companyId);
      const userId = parseInt(req.headers['x-user-id'] as string) || Number(req.session?.userId) || 0;
      const { name, expiresAt } = req.body;

      if (!name || name.trim().length === 0) {
        return res.status(400).json({ message: "API key name is required" });
      }

      // Generate a secure API key
      const rawKey = `irpk_${crypto.randomBytes(32).toString('hex')}`;
      const keyPrefix = rawKey.substring(0, 12); // Store first 12 chars for identification

      const apiKey = await storage.createApiKey({
        companyId,
        name: name.trim(),
        apiKey: rawKey,
        keyPrefix,
        createdBy: userId,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        isActive: true,
        lastUsedAt: null
      });

      // Return the full key ONLY on creation (user must save it now)
      res.status(201).json({
        id: apiKey.id,
        name: apiKey.name,
        apiKey: rawKey, // Full key shown only once
        keyPrefix: apiKey.keyPrefix,
        isActive: apiKey.isActive,
        createdAt: apiKey.createdAt,
        expiresAt: apiKey.expiresAt,
        message: "IMPORTANT: Save this API key now. It will not be shown again."
      });
    } catch (error) {
      console.error("Error creating API key:", error);
      res.status(500).json({ message: "Failed to create API key" });
    }
  });

  // Delete an API key (admin only)
  app.delete("/api/company/:companyId/api-keys/:keyId", requireCompanyAdminAccess, async (req, res) => {
    try {
      const keyId = parseInt(req.params.keyId);
      const deleted = await storage.deleteApiKey(keyId);
      
      if (deleted) {
        res.json({ message: "API key deleted successfully" });
      } else {
        res.status(404).json({ message: "API key not found" });
      }
    } catch (error) {
      console.error("Error deleting API key:", error);
      res.status(500).json({ message: "Failed to delete API key" });
    }
  });

  // ============================================
  // External Work Order API (for CRM Integration)
  // ============================================
  
  // Create work order via external API with API key authentication
  app.post("/api/external/work-orders", async (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ 
          error: "UNAUTHORIZED",
          message: "API key required. Use Authorization: Bearer <your-api-key>" 
        });
      }

      const apiKeyValue = authHeader.substring(7); // Remove 'Bearer ' prefix
      
      // Validate the API key
      const apiKey = await storage.getApiKeyByKey(apiKeyValue);
      
      if (!apiKey) {
        return res.status(401).json({ 
          error: "INVALID_API_KEY",
          message: "Invalid or inactive API key" 
        });
      }

      // Check if key has expired
      if (apiKey.expiresAt && new Date(apiKey.expiresAt) < new Date()) {
        return res.status(401).json({ 
          error: "API_KEY_EXPIRED",
          message: "API key has expired" 
        });
      }

      // Update last used timestamp
      await storage.updateApiKeyLastUsed(apiKey.id);

      // Parse and validate the request body
      const externalWorkOrderSchema = z.object({
        customer: z.object({
          name: z.string().min(1, "Customer name is required"),
          email: z.string().email().optional(),
          phone: z.string().optional(),
          address: z.string().optional(),
          city: z.string().optional(),
          state: z.string().optional(),
          zip: z.string().optional()
        }),
        workOrder: z.object({
          title: z.string().min(1, "Work order title is required"),
          description: z.string().optional(),
          priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
          scheduledDate: z.string().optional(), // ISO date string
          estimatedHours: z.number().nullable().optional(),
          location: z.string().optional(),
          notes: z.string().optional(),
          externalReferenceId: z.string().optional() // ID from the external CRM
        })
      });

      const validationResult = externalWorkOrderSchema.safeParse(req.body);
      
      if (!validationResult.success) {
        return res.status(400).json({
          error: "VALIDATION_ERROR",
          message: "Invalid request data",
          details: validationResult.error.flatten()
        });
      }

      const { customer, workOrder } = validationResult.data;
      const companyId = apiKey.companyId;

      // Find or create the customer
      let existingCustomer = null;
      const allCustomers = await storage.getCustomers(companyId);
      
      // Try to match by email or name
      if (customer.email) {
        existingCustomer = allCustomers.find(c => 
          c.email?.toLowerCase() === customer.email?.toLowerCase()
        );
      }
      if (!existingCustomer) {
        existingCustomer = allCustomers.find(c => 
          c.name.toLowerCase() === customer.name.toLowerCase()
        );
      }

      let customerId: number;
      
      if (existingCustomer) {
        customerId = existingCustomer.id;
      } else {
        // Create new customer
        const newCustomer = await storage.createCustomer({
          companyId,
          name: customer.name,
          email: customer.email || '',
          phone: customer.phone || undefined,
          address: customer.address || undefined,
          notes: `Created via API integration on ${new Date().toISOString()}`
        });
        customerId = newCustomer.id;
      }

      // Find the irrigation manager for auto-assignment
      const irrigationManager = await storage.getIrrigationManagerForCompany(companyId);
      
      // Get full customer data (either existing or newly created)
      const customerData = existingCustomer || await storage.getCustomer(customerId);

      // Create the work order with all required fields
      const newWorkOrder = await storage.createWorkOrder({
        customerId,
        customerName: customerData?.name || customer.name,
        customerEmail: customerData?.email || customer.email || '',
        customerPhone: customer.phone || customerData?.phone || null,
        projectName: workOrder.title, // Use title as project name
        projectAddress: workOrder.location || customer.address || null,
        workType: 'direct_billing', // API-created work orders are direct billing
        status: 'pending',
        priority: workOrder.priority,
        scheduledDate: workOrder.scheduledDate ? new Date(workOrder.scheduledDate) : null,
        assignedTechnicianId: irrigationManager?.id || null, // Auto-assign to irrigation manager
        assignedTechnicianName: irrigationManager?.name || null,
        description: workOrder.description || null,
        notes: workOrder.notes ? 
          `${workOrder.notes}\n\n---\nExternal Reference: ${workOrder.externalReferenceId || 'N/A'}` : 
          workOrder.externalReferenceId ? `External Reference: ${workOrder.externalReferenceId}` : null,
        estimateId: null
      });

      // Create notification for the assigned manager
      if (irrigationManager) {
        await storage.createNotification({
          userId: irrigationManager.id,
          type: 'work_order_assigned',
          title: 'New Work Order Assigned via API',
          message: `A new work order "${workOrder.title}" has been assigned to you for customer ${customer.name}`,
          relatedEntityType: 'work_order',
          relatedEntityId: newWorkOrder.id,
          isRead: false
        });
      }

      res.status(201).json({
        success: true,
        data: {
          workOrderId: newWorkOrder.id,
          workOrderNumber: newWorkOrder.workOrderNumber,
          customerId,
          customerName: existingCustomer ? existingCustomer.name : customer.name,
          customerCreated: !existingCustomer,
          assignedTo: irrigationManager ? {
            id: irrigationManager.id,
            name: irrigationManager.name
          } : null,
          status: newWorkOrder.status,
          createdAt: newWorkOrder.createdAt
        },
        message: "Work order created successfully"
      });

    } catch (error) {
      console.error("External API - Error creating work order:", error);
      res.status(500).json({ 
        error: "SERVER_ERROR",
        message: "Failed to create work order" 
      });
    }
  });

  // Get work order status via external API
  app.get("/api/external/work-orders/:workOrderId", async (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ 
          error: "UNAUTHORIZED",
          message: "API key required" 
        });
      }

      const apiKeyValue = authHeader.substring(7);
      const apiKey = await storage.getApiKeyByKey(apiKeyValue);
      
      if (!apiKey) {
        return res.status(401).json({ 
          error: "INVALID_API_KEY",
          message: "Invalid or inactive API key" 
        });
      }

      // Update last used timestamp
      await storage.updateApiKeyLastUsed(apiKey.id);

      const workOrderId = parseInt(req.params.workOrderId);
      const workOrder = await storage.getWorkOrder(workOrderId);

      if (!workOrder) {
        return res.status(404).json({ 
          error: "NOT_FOUND",
          message: "Work order not found" 
        });
      }

      // Verify the work order belongs to the API key's company through customer
      const customer = await storage.getCustomer(workOrder.customerId);
      if (!customer || customer.companyId !== apiKey.companyId) {
        return res.status(403).json({ 
          error: "FORBIDDEN",
          message: "Access denied to this work order" 
        });
      }

      res.json({
        success: true,
        data: {
          id: workOrder.id,
          workOrderNumber: workOrder.workOrderNumber,
          projectName: workOrder.projectName,
          status: workOrder.status,
          priority: workOrder.priority,
          scheduledDate: workOrder.scheduledDate,
          startedAt: workOrder.startedAt,
          completedAt: workOrder.completedAt,
          totalHours: workOrder.totalHours,
          totalPartsCost: workOrder.totalPartsCost,
          createdAt: workOrder.createdAt,
          updatedAt: workOrder.updatedAt
        }
      });

    } catch (error) {
      console.error("External API - Error fetching work order:", error);
      res.status(500).json({ 
        error: "SERVER_ERROR",
        message: "Failed to fetch work order" 
      });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    app.post("/api/dev/seed-billing-month", async (req, res) => {
      try {
        const { seedBillingMonth } = await import("./seed");
        await seedBillingMonth();
        res.json({ message: "Billing month seed data created successfully" });
      } catch (error) {
        console.error("Error seeding billing month:", error);
        res.status(500).json({ message: "Failed to seed billing month data" });
      }
    });
  }

  // ============================================================================
  // AI Work Description Generator
  // ============================================================================
  app.post("/api/ai/generate-work-description", requireAuthentication, async (req: any, res) => {
    try {
      const {
        locationZone,
        issueFound,
        workPerformed,
        partsUsed,
        laborTime,
        outcomeStatus,
        followUpNeeded,
        technicianNotes,
        entityType,
        entityId,
      } = req.body;

      // Validate entityType and entityId for clean audit logs
      const validEntityTypes = ["billing_sheet", "work_order"];
      const safeEntityType: string = validEntityTypes.includes(entityType) ? entityType : "unknown";
      const safeEntityId: number | null = entityId && Number.isInteger(Number(entityId)) && Number(entityId) > 0
        ? Number(entityId)
        : null;

      const inputs: WorkDescriptionInputs = {
        locationZone: locationZone?.trim() || undefined,
        issueFound: issueFound?.trim() || undefined,
        workPerformed: workPerformed?.trim() || undefined,
        partsUsed: partsUsed?.trim() || undefined,
        laborTime: laborTime?.trim() || undefined,
        outcomeStatus: outcomeStatus?.trim() || undefined,
        followUpNeeded: followUpNeeded?.trim() || undefined,
        technicianNotes: technicianNotes?.trim() || undefined,
      };

      // Check for missing critical fields
      const missingCritical: string[] = [];
      for (const field of CRITICAL_FIELDS) {
        if (!inputs[field]) {
          const labels: Record<string, string> = {
            workPerformed: "Work Performed",
            outcomeStatus: "Outcome/Current Status",
          };
          missingCritical.push(`Missing critical field: "${labels[field] || field}"`);
        }
      }

      if (missingCritical.length > 0) {
        // Log the failed/blocked generation attempt for auditability
        try {
          await storage.createAiGenerationLog({
            userId: req.authenticatedUserId || null,
            entityType: safeEntityType,
            entityId: safeEntityId,
            inputs: JSON.stringify(inputs),
            rawOutput: JSON.stringify({ warnings: missingCritical, blocked: true }),
            templateVersion: TEMPLATE_VERSION,
          });
        } catch (logErr) {
          console.error("[AI] Failed to write audit log for blocked request:", logErr);
        }
        return res.json({
          short_work_completed_description: "",
          detailed_work_completed_description: "",
          missing_info_warnings: missingCritical,
        });
      }

      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        console.error("[AI] OPENAI_API_KEY environment secret not configured");
        return res.status(503).json({ 
          message: "AI generation is not configured. Please set the OPENAI_API_KEY environment secret." 
        });
      }

      const prompt = buildWorkDescriptionPrompt(inputs);

      // Call OpenAI API using native fetch
      const openaiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "gpt-4o",
          messages: [
            {
              role: "user",
              content: prompt,
            },
          ],
          max_tokens: 600,
          temperature: 0.3,
        }),
      });

      if (!openaiResponse.ok) {
        const errText = await openaiResponse.text();
        console.error("[AI] OpenAI API error:", openaiResponse.status, errText);
        return res.status(502).json({ message: "AI service returned an error. Please try again." });
      }

      const openaiData: any = await openaiResponse.json();
      const rawOutput = openaiData?.choices?.[0]?.message?.content || "";

      // Parse the JSON response from GPT
      let parsed: any = {};
      try {
        // Remove any markdown fences in case model adds them
        const cleaned = rawOutput.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
        parsed = JSON.parse(cleaned);
      } catch (parseError) {
        console.error("[AI] Failed to parse GPT JSON response:", rawOutput);
        return res.status(502).json({ message: "AI returned an unexpected response format. Please try again." });
      }

      // Log the generation for audit
      try {
        await storage.createAiGenerationLog({
          userId: req.authenticatedUserId || null,
          entityType: safeEntityType,
          entityId: safeEntityId,
          inputs: JSON.stringify(inputs),
          rawOutput,
          templateVersion: TEMPLATE_VERSION,
        });
      } catch (logError) {
        console.error("[AI] Failed to write audit log:", logError);
        // Non-fatal — don't block the response
      }

      const warnings: string[] = [
        ...(missingCritical),
        ...(Array.isArray(parsed.missing_info_warnings) ? parsed.missing_info_warnings : []),
      ].filter(Boolean);

      console.log(`[AUDIT] ai_description_generated entityType=${entityType || "unknown"} entityId=${entityId || "none"} userId=${req.authenticatedUserId} templateVersion=${TEMPLATE_VERSION}`);

      return res.json({
        short_work_completed_description: parsed.short_work_completed_description || "",
        detailed_work_completed_description: parsed.detailed_work_completed_description || "",
        missing_info_warnings: warnings,
      });

    } catch (error) {
      console.error("[AI] Unexpected error in generate-work-description:", error);
      return res.status(500).json({ message: "Failed to generate description. Please try again." });
    }
  });

  app.post("/api/ai/expand-description", requireAuthentication, async (req: any, res) => {
    try {
      const { rawDescription } = req.body;
      const raw = typeof rawDescription === "string" ? rawDescription.trim() : "";
      if (!raw) {
        return res.status(400).json({ message: "rawDescription is required" });
      }

      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        return res.status(503).json({ message: "AI generation is not configured. Please set the OPENAI_API_KEY environment secret." });
      }

      const prompt = buildExpandDescriptionPrompt(raw);

      const openaiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "gpt-4o",
          messages: [{ role: "user", content: prompt }],
          max_tokens: 300,
          temperature: 0.3,
        }),
      });

      if (!openaiResponse.ok) {
        const errText = await openaiResponse.text();
        console.error("[AI expand] OpenAI API error:", openaiResponse.status, errText);
        return res.status(502).json({ message: "AI service returned an error. Please try again." });
      }

      const openaiData: any = await openaiResponse.json();
      const rawOutput = openaiData?.choices?.[0]?.message?.content || "";

      let parsed: any = {};
      try {
        const cleaned = rawOutput.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
        parsed = JSON.parse(cleaned);
      } catch {
        console.error("[AI expand] Failed to parse GPT JSON response:", rawOutput);
        return res.status(502).json({ message: "AI returned an unexpected response format. Please try again." });
      }

      const expanded = typeof parsed.expanded === "string" ? parsed.expanded.trim() : "";
      if (!expanded) {
        return res.status(502).json({ message: "AI returned an empty result. Please try again." });
      }

      return res.json({ expanded });

    } catch (error) {
      console.error("[AI expand] Unexpected error:", error);
      return res.status(500).json({ message: "Failed to expand description. Please try again." });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // QB7 / T8 — Background health-check / keep-alive job
  //
  // Runs once at startup and then every 24 hours thereafter.
  // Proactively refreshes any connected realm whose token is within the
  // 5-minute expiry buffer or that is approaching the 100-day idle threshold.
  // Uses runProactiveRefreshForRealm from qb-token-utils.ts (testable).
  // ─────────────────────────────────────────────────────────────────────────

  // Storage adapter bridge for qb-token-utils (decouples logic from DatabaseStorage)
  const qbStorageAdapter: QbStorageAdapter = {
    getIntegration: (realmId) => storage.getQuickBooksIntegration(realmId),
    saveIntegration: (data) => storage.saveQuickBooksIntegration(data),
    markReconnectRequired: (realmId, reason) => storage.markQuickBooksReconnectRequired(realmId, reason),
  };

  // Injected Intuit refresh function (uses real token endpoint)
  const realRefreshFn = (refreshToken: string, signal: AbortSignal) =>
    refreshQuickBooksToken(refreshToken, signal, { calledFrom: 'health-job' });

  startQbTokenHealthJob(
    () => storage.getAllActiveQuickBooksIntegrations(),
    realRefreshFn,
    qbStorageAdapter,
    24 * 60 * 60 * 1000
  );

  // One-time data fix: correct the 7 pending billing sheets with wrong labor rates.
  // These were created with a hardcoded $45 default instead of the customer's actual rate.
  // Uses the app_settings table as a completion marker so it only runs once.
  (async () => {
    const DATA_FIX_KEY = 'fix-pending-billing-sheet-labor-rates-v1';
    try {
      // Check if this fix has already run successfully
      const existingMarker = await db.execute(
        sql`SELECT value FROM app_settings WHERE key = ${DATA_FIX_KEY}`
      );
      if (existingMarker.rows.length > 0 && existingMarker.rows[0].value === 'completed') {
        console.log(`[DATA FIX] '${DATA_FIX_KEY}': already completed, skipping`);
        return;
      }

      const sheetsToFix = [
        { billingNumber: 'BS-2026-0020', correctRate: '85.00', correctHours: '5', correctLaborSubtotal: '425.00' },
        { billingNumber: 'BS-2026-0021', correctRate: '85.00', correctHours: '1', correctLaborSubtotal: '85.00' },
        { billingNumber: 'BS-2026-0016', correctRate: '80.00', correctHours: '5', correctLaborSubtotal: '400.00' },
        { billingNumber: 'BS-2026-0015', correctRate: '80.00', correctHours: '6', correctLaborSubtotal: '480.00' },
        { billingNumber: 'BS-2026-0011', correctRate: '80.00', correctHours: '5', correctLaborSubtotal: '400.00' },
        { billingNumber: 'BS-2026-0014', correctRate: '80.00', correctHours: '6', correctLaborSubtotal: '480.00' },
        { billingNumber: 'BS-2026-0006', correctRate: '80.00', correctHours: '1', correctLaborSubtotal: '80.00' },
      ];

      let correctedCount = 0;
      const allSheets = await storage.getAllBillingSheets();
      for (const fix of sheetsToFix) {
        const sheet = allSheets.find(s => s.billingNumber === fix.billingNumber);
        if (!sheet) continue;
        // Only fix sheets that are still pending manager review (not yet billed or approved)
        if (sheet.status !== 'pending_manager_review' && sheet.status !== 'submitted') continue;
        // Skip if the rate is already correct
        if (parseFloat(sheet.laborRate || '0').toFixed(2) === fix.correctRate) continue;

        const partsSubtotal = parseFloat(sheet.partsSubtotal || '0');
        const laborSubtotal = parseFloat(fix.correctLaborSubtotal);
        const totalAmount = (laborSubtotal + partsSubtotal).toFixed(2);

        await storage.updateBillingSheet(sheet.id, {
          laborRate: fix.correctRate,
          laborSubtotal: fix.correctLaborSubtotal,
          totalAmount,
        });
        console.log(`[DATA FIX] Corrected billing sheet ${fix.billingNumber}: laborRate=${fix.correctRate}, laborSubtotal=${fix.correctLaborSubtotal}, totalAmount=${totalAmount}`);
        correctedCount++;
      }

      // Mark as completed so it does not re-run on subsequent startups
      await db.execute(
        sql`INSERT INTO app_settings (key, value, updated_at) VALUES (${DATA_FIX_KEY}, 'completed', NOW())
            ON CONFLICT (key) DO UPDATE SET value = 'completed', updated_at = NOW()`
      );
      console.log(`[DATA FIX] '${DATA_FIX_KEY}': completed (${correctedCount} sheet(s) corrected)`);
    } catch (err) {
      console.error('[DATA FIX] Failed to run billing sheet labor rate correction:', err);
    }
  })();

  // ─────────────────────────────────────────────────────────────────────────
  // Slice 2A — Wet Check capture endpoints (Task #229)
  // All scoped by req.authenticatedUserCompanyId, all idempotent on clientId.
  // ─────────────────────────────────────────────────────────────────────────
  const requireCompanyId = (req: any, res: any): number | null => {
    const cid = req.authenticatedUserCompanyId;
    if (!cid) { res.status(403).json({ message: "Company scope required" }); return null; }
    return cid;
  };
  const isFieldRole = (role: string | undefined) =>
    role === "field_tech" || role === "irrigation_manager" || role === "company_admin" || role === "super_admin" || role === "billing_manager";

  app.get("/api/wet-checks/issue-types", requireAuthentication, async (req, res) => {
    const cid = requireCompanyId(req, res); if (!cid) return;
    try {
      const rows = await storage.listIssueTypeConfigs(cid);
      res.json(rows);
    } catch (e: any) { res.status(500).json({ message: e?.message ?? "Failed" }); }
  });

  app.get("/api/wet-checks/parts/by-issue", requireAuthentication, async (req, res) => {
    const cid = requireCompanyId(req, res); if (!cid) return;
    const issueType = String(req.query.issueType ?? "");
    if (!issueType) return res.status(400).json({ message: "issueType required" });
    const customerId = req.query.customerId ? parseInt(String(req.query.customerId)) : null;
    try {
      const result = await storage.getPartsByIssueType(cid, issueType, customerId);
      res.json(result);
    } catch (e: any) { res.status(500).json({ message: e?.message ?? "Failed" }); }
  });

  app.get("/api/properties/:customerId/controllers", requireAuthentication, async (req, res) => {
    const cid = requireCompanyId(req, res); if (!cid) return;
    const customerId = parseInt(req.params.customerId);
    try {
      const rows = await storage.listPropertyControllers(cid, customerId);
      res.json(rows);
    } catch (e: any) { res.status(500).json({ message: e?.message ?? "Failed" }); }
  });

  // PATCH /api/properties/:customerId/controllers — body identifies the
  // controller by letter, matching the spec's "get + patch at the same
  // collection path" contract.
  const propertyControllerPatchBody = z.object({
    controllerLetter: z.string().min(1).transform(s => s.toUpperCase()),
    zoneCount: z.coerce.number().int().min(1).max(100).optional(),
    notes: z.string().nullish(),
  });
  app.patch("/api/properties/:customerId/controllers", requireAuthentication, async (req, res) => {
    const cid = requireCompanyId(req, res); if (!cid) return;
    if (!isFieldRole(req.authenticatedUserRole)) return res.status(403).json({ message: "Forbidden" });
    const customerId = parseInt(req.params.customerId);
    const parsed = propertyControllerPatchBody.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ message: "Invalid body", issues: parsed.error.issues });
    const { controllerLetter, zoneCount, notes } = parsed.data;
    try {
      const updated = await storage.updatePropertyController(cid, customerId, controllerLetter, {
        zoneCount,
        notes: notes ?? undefined,
      });
      if (!updated) return res.status(404).json({ message: "Not found" });
      res.json(updated);
    } catch (e: any) { res.status(500).json({ message: e?.message ?? "Failed" }); }
  });

  app.get("/api/wet-checks", requireAuthentication, async (req, res) => {
    const cid = requireCompanyId(req, res); if (!cid) return;
    try {
      const opts: { status?: string; technicianId?: number } = {};
      if (req.query.status) opts.status = String(req.query.status);
      if (req.query.mine === "1" && req.authenticatedUserId) opts.technicianId = req.authenticatedUserId;
      const rows = await storage.listWetChecks(cid, opts);
      res.json(rows);
    } catch (e: any) { res.status(500).json({ message: e?.message ?? "Failed" }); }
  });

  app.get("/api/wet-checks/:id", requireAuthentication, async (req, res) => {
    const cid = requireCompanyId(req, res); if (!cid) return;
    try {
      const wc = await storage.getWetCheck(parseInt(req.params.id), cid);
      if (!wc) return res.status(404).json({ message: "Not found" });
      res.json(wc);
    } catch (e: any) { res.status(500).json({ message: e?.message ?? "Failed" }); }
  });

  // numControllers is intentionally NOT accepted from the client — the
  // server is authoritative and always derives it from the customer record
  // (customer.totalControllers) so a manipulated client cannot under- or
  // over-scope a wet check.
  const wetCheckCreateBody = z.object({
    customerId: z.coerce.number().int().positive(),
    weather: z.string().nullish(),
    notes: z.string().nullish(),
    clientId: z.string().uuid().nullish(),
  }).strict();

  app.post("/api/wet-checks", requireAuthentication, async (req, res) => {
    const cid = requireCompanyId(req, res); if (!cid) return;
    if (!isFieldRole(req.authenticatedUserRole)) return res.status(403).json({ message: "Forbidden" });
    const parsed = wetCheckCreateBody.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ message: "Invalid body", issues: parsed.error.issues });
    const body = parsed.data;
    try {
      const customer = await storage.getCustomer(body.customerId);
      if (!customer || customer.companyId !== cid) return res.status(404).json({ message: "Customer not found" });
      const techId = req.authenticatedUserId;
      if (!techId) return res.status(401).json({ message: "Authentication required" });
      const tech = await storage.getUser(techId);
      if (!tech) return res.status(401).json({ message: "User not found" });

      // Resume an existing in-progress wet check at this property for this tech
      // before creating a new one. Idempotent for the common "tap New again" case.
      const existing = await storage.findActiveWetCheck(cid, body.customerId, tech.id);
      if (existing) {
        return res.status(200).json(existing);
      }

      const numControllers = Math.max(1, Math.min(10, Number(customer.totalControllers ?? 1)));
      await storage.ensurePropertyControllers(cid, body.customerId, numControllers);

      const wc = await storage.createWetCheck({
        companyId: cid,
        customerId: body.customerId,
        technicianId: tech.id,
        technicianName: tech.name,
        customerName: customer.name,
        propertyAddress: customer.address ?? null,
        numControllers,
        status: "in_progress",
        weather: body.weather ?? null,
        notes: body.notes ?? null,
        clientId: body.clientId ?? null,
      });
      res.status(201).json(wc);
    } catch (e: any) { res.status(500).json({ message: e?.message ?? "Failed" }); }
  });

  const wetCheckPatchBody = z.object({
    weather: z.string().nullish(),
    notes: z.string().nullish(),
    numControllers: z.coerce.number().int().min(1).max(10).optional(),
  }).partial();

  app.patch("/api/wet-checks/:id", requireAuthentication, async (req, res) => {
    const cid = requireCompanyId(req, res); if (!cid) return;
    if (!isFieldRole(req.authenticatedUserRole)) return res.status(403).json({ message: "Forbidden" });
    const parsed = wetCheckPatchBody.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ message: "Invalid body", issues: parsed.error.issues });
    try {
      const updated = await storage.updateWetCheck(parseInt(req.params.id), cid, parsed.data);
      if (!updated) return res.status(404).json({ message: "Not found" });
      res.json(updated);
    } catch (e: any) { res.status(500).json({ message: e?.message ?? "Failed" }); }
  });

  const submitBody = z.object({ clientId: z.string().uuid().nullish() }).partial();
  app.post("/api/wet-checks/:id/submit", requireAuthentication, async (req, res) => {
    const cid = requireCompanyId(req, res); if (!cid) return;
    if (!isFieldRole(req.authenticatedUserRole)) return res.status(403).json({ message: "Forbidden" });
    // Body is optional; if provided, validate clientId shape only.
    if (req.body && Object.keys(req.body).length > 0) {
      const parsed = submitBody.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "Invalid body", errors: parsed.error.flatten() });
    }
    try {
      const updated = await storage.submitWetCheck(parseInt(req.params.id), cid);
      if (!updated) return res.status(404).json({ message: "Not found" });
      res.json(updated);
    } catch (e: any) {
      const msg = e?.message ?? "Failed";
      const status = /zero zones checked/.test(msg) ? 400 : 500;
      res.status(status).json({ message: msg });
    }
  });

  const zoneRecordBody = z.object({
    controllerLetter: z.string().min(1).transform(s => s.toUpperCase()),
    zoneNumber: z.coerce.number().int().min(1).max(100),
    status: z.enum(["not_checked", "checked_ok", "checked_with_issues", "not_applicable"]).default("checked_ok"),
    ranSuccessfully: z.boolean().nullish(),
    observedPressure: z.union([z.string(), z.number()]).nullish(),
    observedFlow: z.union([z.string(), z.number()]).nullish(),
    notes: z.string().nullish(),
    // Client-supplied capture timestamp (ms or ISO). Server falls back to now()
    // when status moves out of not_checked and the client didn't send one.
    checkedAt: z.union([z.string().datetime(), z.number(), z.date()]).nullish(),
    clientId: z.string().uuid().nullish(),
  });

  app.post("/api/wet-checks/:id/zone-records", requireAuthentication, async (req, res) => {
    const cid = requireCompanyId(req, res); if (!cid) return;
    if (!isFieldRole(req.authenticatedUserRole)) return res.status(403).json({ message: "Forbidden" });
    const parsed = zoneRecordBody.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ message: "Invalid body", issues: parsed.error.issues });
    const body = parsed.data;
    try {
      const wetCheckId = parseInt(req.params.id);
      const checkedAt =
        body.checkedAt != null
          ? new Date(body.checkedAt as string | number | Date)
          : (body.status !== "not_checked" ? new Date() : null);
      const created = await storage.upsertWetCheckZoneRecord(wetCheckId, cid, {
        wetCheckId,
        controllerLetter: body.controllerLetter,
        zoneNumber: body.zoneNumber,
        status: body.status,
        ranSuccessfully: body.ranSuccessfully ?? null,
        observedPressure: body.observedPressure != null ? String(body.observedPressure) : null,
        observedFlow: body.observedFlow != null ? String(body.observedFlow) : null,
        notes: body.notes ?? null,
        checkedAt,
        checkedBy: req.authenticatedUserId ?? null,
        clientId: body.clientId ?? null,
      });
      res.status(201).json(created);
    } catch (e: any) { res.status(400).json({ message: e?.message ?? "Failed" }); }
  });

  // PATCH zone-record: strict allow-list — protected linkage fields
  // (wetCheckId, controllerLetter, zoneNumber, clientId) are NOT mutable
  // post-creation; only field-tech-editable observation fields are.
  const zoneRecordPatchBody = z.object({
    status: z.enum(["not_checked", "checked_ok", "checked_with_issues", "not_applicable"]).optional(),
    ranSuccessfully: z.boolean().nullish(),
    observedPressure: z.union([z.string(), z.number()]).nullish(),
    observedFlow: z.union([z.string(), z.number()]).nullish(),
    notes: z.string().nullish(),
  }).strict();

  app.patch("/api/wet-checks/zone-records/:id", requireAuthentication, async (req, res) => {
    const cid = requireCompanyId(req, res); if (!cid) return;
    if (!isFieldRole(req.authenticatedUserRole)) return res.status(403).json({ message: "Forbidden" });
    const parsed = zoneRecordPatchBody.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ message: "Invalid body", issues: parsed.error.issues });
    const body = parsed.data;
    const patch: Partial<InsertWetCheckZoneRecord> = {};
    if (body.status !== undefined) patch.status = body.status;
    if (body.ranSuccessfully !== undefined) patch.ranSuccessfully = body.ranSuccessfully ?? null;
    if (body.observedPressure !== undefined) patch.observedPressure = body.observedPressure != null ? String(body.observedPressure) : null;
    if (body.observedFlow !== undefined) patch.observedFlow = body.observedFlow != null ? String(body.observedFlow) : null;
    if (body.notes !== undefined) patch.notes = body.notes ?? null;
    // Stamp checkedAt / checkedBy whenever an active status is set.
    if (body.status === "checked_ok" || body.status === "checked_with_issues" || body.status === "not_applicable") {
      patch.checkedAt = new Date();
      patch.checkedBy = req.authenticatedUserId ?? null;
    }
    try {
      const updated = await storage.updateWetCheckZoneRecord(parseInt(req.params.id), cid, patch);
      if (!updated) return res.status(404).json({ message: "Not found" });
      res.json(updated);
    } catch (e: any) { res.status(400).json({ message: e?.message ?? "Failed" }); }
  });

  const findingCreateBody = z.object({
    issueType: z.string().min(1),
    severity: z.string().nullish(),
    partId: z.coerce.number().int().nullish(),
    partName: z.string().nullish(),
    partPrice: z.union([z.string(), z.number()]).nullish(),
    quantity: z.coerce.number().int().min(1).default(1),
    laborHours: z.union([z.string(), z.number()]).default("0.00"),
    notes: z.string().nullish(),
    repairedInField: z.boolean().optional(),
    clientId: z.string().uuid().nullish(),
  });

  app.post("/api/wet-checks/zone-records/:id/findings", requireAuthentication, async (req, res) => {
    const cid = requireCompanyId(req, res); if (!cid) return;
    if (!isFieldRole(req.authenticatedUserRole)) return res.status(403).json({ message: "Forbidden" });
    const parsed = findingCreateBody.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ message: "Invalid body", issues: parsed.error.issues });
    const body = parsed.data;
    try {
      const userId = req.authenticatedUserId ?? null;
      const created = await storage.createWetCheckFinding(parseInt(req.params.id), cid, {
        issueType: body.issueType,
        severity: body.severity ?? null,
        partId: body.partId ?? null,
        partName: body.partName ?? null,
        partPrice: body.partPrice != null ? String(body.partPrice) : null,
        quantity: body.quantity,
        laborHours: String(body.laborHours),
        notes: body.notes ?? null,
        // Tech can mark "fixed it on the spot" — finding is documented but
        // already resolved (no manager routing required).
        resolution: body.repairedInField ? "repaired_in_field" : "pending",
        resolutionDecidedAt: body.repairedInField ? new Date() : null,
        resolutionDecidedBy: body.repairedInField ? userId : null,
        clientId: body.clientId ?? null,
      });
      res.status(201).json(created);
    } catch (e: any) { res.status(400).json({ message: e?.message ?? "Failed" }); }
  });

  const findingPatchBody = z.object({
    issueType: z.string().min(1).optional(),
    severity: z.string().nullish(),
    partId: z.coerce.number().int().nullish(),
    partName: z.string().nullish(),
    partPrice: z.union([z.string(), z.number()]).nullish(),
    quantity: z.coerce.number().int().min(1).optional(),
    laborHours: z.union([z.string(), z.number()]).optional(),
    notes: z.string().nullish(),
    repairedInField: z.boolean().optional(),
  }).partial();

  app.patch("/api/wet-checks/findings/:id", requireAuthentication, async (req, res) => {
    const cid = requireCompanyId(req, res); if (!cid) return;
    if (!isFieldRole(req.authenticatedUserRole)) return res.status(403).json({ message: "Forbidden" });
    const parsed = findingPatchBody.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ message: "Invalid body", issues: parsed.error.issues });
    const body = parsed.data;
    const userId = req.authenticatedUserId ?? null;
    const patch: Partial<InsertWetCheckFinding> = {};
    if (body.issueType !== undefined) patch.issueType = body.issueType;
    if (body.severity !== undefined) patch.severity = body.severity ?? null;
    if (body.partId !== undefined) patch.partId = body.partId ?? null;
    if (body.partName !== undefined) patch.partName = body.partName ?? null;
    if (body.partPrice !== undefined) patch.partPrice = body.partPrice != null ? String(body.partPrice) : null;
    if (body.quantity !== undefined) patch.quantity = body.quantity;
    if (body.laborHours !== undefined) patch.laborHours = String(body.laborHours);
    if (body.notes !== undefined) patch.notes = body.notes ?? null;
    if (body.repairedInField !== undefined) {
      patch.resolution = body.repairedInField ? "repaired_in_field" : "pending";
      patch.resolutionDecidedAt = body.repairedInField ? new Date() : null;
      patch.resolutionDecidedBy = body.repairedInField ? userId : null;
    }
    try {
      const updated = await storage.updateWetCheckFinding(parseInt(req.params.id), cid, patch);
      if (!updated) return res.status(404).json({ message: "Not found" });
      res.json(updated);
    } catch (e: any) { res.status(400).json({ message: e?.message ?? "Failed" }); }
  });

  app.delete("/api/wet-checks/findings/:id", requireAuthentication, async (req, res) => {
    const cid = requireCompanyId(req, res); if (!cid) return;
    if (!isFieldRole(req.authenticatedUserRole)) return res.status(403).json({ message: "Forbidden" });
    try {
      const ok = await storage.deleteWetCheckFinding(parseInt(req.params.id), cid);
      res.json({ ok });
    } catch (e: any) { res.status(400).json({ message: e?.message ?? "Failed" }); }
  });

  const photoBody = z.object({
    zoneRecordId: z.coerce.number().int().nullish(),
    findingId: z.coerce.number().int().nullish(),
    // Canonical photoId from /api/upload/photo (e.g. "photos/<uuid>"), or
    // a fully-qualified URL. Accepted as a non-empty string and validated at
    // the storage layer.
    url: z.string().min(1),
    caption: z.string().nullish(),
    // Client-supplied capture timestamp (ms or ISO). Falls back to NOW() in
    // the schema default if absent — preserves true camera time on offline sync.
    takenAt: z.union([z.string().datetime(), z.number(), z.date()]).nullish(),
    clientId: z.string().uuid().nullish(),
  });

  app.post("/api/wet-checks/:id/photos", requireAuthentication, async (req, res) => {
    const cid = requireCompanyId(req, res); if (!cid) return;
    if (!isFieldRole(req.authenticatedUserRole)) return res.status(403).json({ message: "Forbidden" });
    const parsed = photoBody.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ message: "Invalid body", issues: parsed.error.issues });
    const body = parsed.data;
    const takenBy = req.authenticatedUserId;
    if (!takenBy) return res.status(401).json({ message: "Authentication required" });
    try {
      const wetCheckId = parseInt(req.params.id);
      const takenAt = body.takenAt != null ? new Date(body.takenAt as string | number | Date) : new Date();
      const created = await storage.attachWetCheckPhoto(wetCheckId, cid, {
        zoneRecordId: body.zoneRecordId ?? null,
        findingId: body.findingId ?? null,
        url: body.url,
        caption: body.caption ?? null,
        takenAt,
        takenBy,
        clientId: body.clientId ?? null,
      });
      res.status(201).json(created);
    } catch (e: any) { res.status(400).json({ message: e?.message ?? "Failed" }); }
  });

  app.delete("/api/wet-checks/photos/:id", requireAuthentication, async (req, res) => {
    const cid = requireCompanyId(req, res); if (!cid) return;
    if (!isFieldRole(req.authenticatedUserRole)) return res.status(403).json({ message: "Forbidden" });
    try {
      const ok = await storage.deleteWetCheckPhoto(parseInt(req.params.id), cid);
      res.json({ ok });
    } catch (e: any) { res.status(400).json({ message: e?.message ?? "Failed" }); }
  });

  return httpServer;
}
