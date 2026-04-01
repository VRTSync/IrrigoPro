import express, { type Express } from "express";
import type { Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import type { InsertInvoice } from "@shared/schema";
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { EmailService } from "./email-service";
import { ObjectStorageService } from "./objectStorage";
import { InvoicePdfService } from "./invoice-pdf-service";
import { buildWorkDescriptionPrompt, buildExpandDescriptionPrompt, TEMPLATE_VERSION, CRITICAL_FIELDS, type WorkDescriptionInputs } from "./ai-prompt-templates";

/// <reference path="./types/express.d.ts" />

// ============================================================================
// FIELD TECH PRICING VISIBILITY - Critical Security Feature
// Field technicians must NEVER see pricing/money values anywhere in the app
// ============================================================================

// Fields to strip from responses for field technicians
const PRICING_FIELDS_TO_STRIP = new Set([
  'laborRate', 'laborSubtotal', 'partsSubtotal', 'totalAmount', 'estimatedTotal',
  'partPrice', 'totalPrice', 'unitPrice', 'price', 'cost',
  'markupAmount', 'markupPercent', 'taxAmount', 'taxPercent',
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
  insertEstimateZoneSchema, 
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
  type InsertEstimateZone,
  type InsertEstimateItem
} from "@shared/schema";
import { z } from "zod";

const createEstimateWithZonesSchema = z.object({
  estimate: insertEstimateSchema.extend({
    // Allow date as string (will be converted)
    estimateDate: z.union([z.date(), z.string()]).optional(),
    // Allow numbers for decimal fields (will be converted to strings)
    partsSubtotal: z.union([z.string(), z.number()]).optional(),
    laborSubtotal: z.union([z.string(), z.number()]).optional(), 
    markupAmount: z.union([z.string(), z.number()]).optional(),
    taxAmount: z.union([z.string(), z.number()]).optional(),
    totalAmount: z.union([z.string(), z.number()]).optional(),
    laborRate: z.union([z.string(), z.number()]),
    markupPercent: z.union([z.string(), z.number()]),
    taxPercent: z.union([z.string(), z.number()])
  }),
  zones: z.array(insertEstimateZoneSchema.omit({ estimateId: true }).extend({
    items: z.array(z.object({
      part: z.object({
        id: z.number(),
        name: z.string(),
        price: z.union([z.string(), z.number()]),
        laborHours: z.union([z.string(), z.number()]).optional()
      }).optional(),
      partId: z.number().nullable().optional(),
      partName: z.string().optional(),
      partPrice: z.union([z.string(), z.number()]).optional(),
      quantity: z.number(),
      laborHours: z.union([z.string(), z.number()]).optional(),
      totalPrice: z.union([z.string(), z.number()]),
      totalLaborHours: z.number().nullable().optional()
    }))
  }))
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

  // Field techs can only submit their own billing sheet for approval
  if (userRole === 'field_tech') {
    // Payload must be exactly { status: 'submitted' }
    const keys = updateData && typeof updateData === 'object' ? Object.keys(updateData) : [];
    if (keys.length !== 1 || updateData.status !== 'submitted') {
      return res.status(403).json({
        message: "Access denied. Field technicians can only submit billing sheets for approval."
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
        return next();
      }
    } catch (error) {
      console.error('Error checking billing sheet ownership:', error);
    }

    return res.status(403).json({
      message: "Access denied. Field technicians can only submit their own billing sheets for approval."
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
  customers, estimates, workOrders, estimateItems, estimateZones, parts, billingSheets, billingSheetItems, 
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
          
          const completedWorkOrders = workOrders.filter(wo => wo.status === 'completed');
          const approvedEstimates = estimates.filter(est => est.status === 'approved');
          const completedBillingSheets = billingSheets.filter(bs => bs.status === 'completed' || bs.status === 'approved');
          
          // Calculate unbilled amounts for this customer
          const unbilledWorkOrders = completedWorkOrders.filter(wo => 
            !wo.invoiceId && wo.status === 'completed'
          );
          const unbilledBillingSheets = completedBillingSheets.filter(bs => 
            !bs.invoiceId && (bs.status === 'completed' || bs.status === 'approved')
          );
          
          const unbilledAmount = 
            unbilledWorkOrders.reduce((sum, wo) => {
              const laborAmount = parseFloat(wo.totalHours || '0') * 45;
              const partsAmount = parseFloat(wo.totalPartsCost || '0') || 0;
              return sum + laborAmount + partsAmount;
            }, 0) +
            unbilledBillingSheets.reduce((sum, bs) => {
              const laborAmount = parseFloat(bs.laborSubtotal || '0') || 0;
              const partsAmount = parseFloat(bs.partsSubtotal || '0') || 0;
              return sum + laborAmount + partsAmount;
            }, 0);

          return {
            id: customer.id,
            name: customer.name,
            email: customer.email,
            phone: customer.phone,
            unbilledAmount,
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

      // Transform work orders to match frontend expectations
      // Use the same dynamic calculation logic as the invoice system
      const workOrders = rawWorkOrders.map(wo => {
        const laborAmount = parseFloat(wo.totalHours || '0') * 45;
        const partsAmount = parseFloat(wo.totalPartsCost || '0') || 0;
        const dynamicTotalAmount = laborAmount + partsAmount;
        
        return {
          ...wo,
          laborCost: laborAmount,
          partsCost: partsAmount,
          totalAmount: dynamicTotalAmount.toString(), // Use dynamic calculation instead of stored value
          assignedTo: wo.assignedTechnicianName || 'Unassigned',
          description: wo.description || wo.workSummary || '',
          billedDate: null, // No billing tracking yet
          completedDate: wo.completedAt
        };
      });

      // Transform billing sheets to match frontend expectations
      // Use the same dynamic calculation logic as the invoice system
      const billingSheets = rawBillingSheets.map(bs => {
        const laborAmount = parseFloat(bs.laborSubtotal || '0') || 0;
        const partsAmount = parseFloat(bs.partsSubtotal || '0') || 0;
        const dynamicTotalAmount = laborAmount + partsAmount;
        
        return {
          ...bs,
          laborCost: laborAmount,
          partsCost: partsAmount,
          totalAmount: dynamicTotalAmount.toString(), // Use dynamic calculation instead of stored value
          description: bs.workDescription || '',
          billedDate: null, // No billing tracking yet
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

      // Filter unbilled work (completed work orders and billing sheets without invoice linkage)
      const unbilledWorkOrders = workOrders.filter(wo => 
        wo.status === 'completed' && !wo.invoiceId
      );
      // A non-null invoiceId is the authoritative signal that a billing sheet has
      // been billed — exclude it from unbilled regardless of status value.
      const unbilledBillingSheets = billingSheets.filter(bs => 
        (bs.status === 'completed' || bs.status === 'approved') && !bs.invoiceId
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
          wo.status === 'completed' && 
          !wo.invoiceId
        );
      }

      if (billingSheetIds.length > 0) {
        selectedBillingSheets = billingSheets.filter(bs => 
          billingSheetIds.includes(bs.id) && 
          (bs.status === 'completed' || bs.status === 'approved') && 
          !bs.invoiceId
        );
      }

      // If no specific items selected, fall back to all unbilled items
      if (workOrderIds.length === 0 && billingSheetIds.length === 0) {
        selectedWorkOrders = workOrders.filter(wo => 
          wo.status === 'completed' && !wo.invoiceId
        );
        selectedBillingSheets = billingSheets.filter(bs => 
          (bs.status === 'completed' || bs.status === 'approved') && !bs.invoiceId
        );
      }

      if (selectedWorkOrders.length === 0 && selectedBillingSheets.length === 0) {
        return res.status(400).json({ message: "No valid items selected for invoicing" });
      }

      // Create preview invoice data (same calculations as actual invoice)
      const currentDate = new Date();
      const invoiceNumber = `PREVIEW-${currentDate.getFullYear()}${(currentDate.getMonth() + 1).toString().padStart(2, '0')}${currentDate.getDate().toString().padStart(2, '0')}-${customerId.toString().padStart(4, '0')}`;
      
      // Calculate totals
      const laborSubtotal = 
        selectedWorkOrders.reduce((sum, wo) => sum + (parseFloat(wo.totalHours || '0') * 45), 0) +
        selectedBillingSheets.reduce((sum, bs) => sum + parseFloat(bs.laborSubtotal || '0'), 0);
      
      const partsSubtotal = 
        selectedWorkOrders.reduce((sum, wo) => sum + parseFloat(wo.totalPartsCost || '0'), 0) +
        selectedBillingSheets.reduce((sum, bs) => sum + parseFloat(bs.partsSubtotal || '0'), 0);
      
      const markupAmount = 0;
      const taxAmount = 0;
      const totalAmount = laborSubtotal + partsSubtotal;

      // Create preview items
      const previewItems = [];

      // Add work order items
      for (const workOrder of selectedWorkOrders) {
        previewItems.push({
          sourceType: 'work_order',
          sourceId: workOrder.id,
          description: `Work Order ${workOrder.workOrderNumber} - ${workOrder.projectName}`,
          workDate: workOrder.completedAt || workOrder.createdAt,
          technicianName: workOrder.assignedTechnicianName || 'Unknown',
          laborHours: parseFloat(workOrder.totalHours || '0'),
          laborRate: 45,
          laborAmount: parseFloat(workOrder.totalHours || '0') * 45,
          partsAmount: parseFloat(workOrder.totalPartsCost || '0'),
          totalAmount: (parseFloat(workOrder.totalHours || '0') * 45) + parseFloat(workOrder.totalPartsCost || '0')
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
          laborRate: parseFloat(billingSheet.laborRate || '45'),
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
        markupAmount: markupAmount.toFixed(2),
        taxAmount: taxAmount.toFixed(2),
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
      const integration = await storage.getQuickBooksIntegration(userCompanyId);
      if (!integration || !integration.accessToken) {
        return res.status(400).json({
          message: "QuickBooks is not connected. Please connect QuickBooks before creating invoices.",
          quickbooksError: "QuickBooks integration is not configured or the access token is missing. Go to the QuickBooks section to connect your account."
        });
      }

      if (integration.expiresAt && new Date(integration.expiresAt) <= new Date()) {
        return res.status(400).json({
          message: "QuickBooks access token has expired. Please reconnect QuickBooks before creating invoices.",
          quickbooksError: "Your QuickBooks session has expired. Go to the QuickBooks section to reconnect your account."
        });
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
          wo.status === 'completed' && 
          !wo.invoiceId
        );
      }

      if (billingSheetIds.length > 0) {
        selectedBillingSheets = billingSheets.filter(bs => 
          billingSheetIds.includes(bs.id) && 
          (bs.status === 'completed' || bs.status === 'approved') && 
          !bs.invoiceId
        );
      }

      // If no specific items selected, fall back to all unbilled items
      if (workOrderIds.length === 0 && billingSheetIds.length === 0) {
        selectedWorkOrders = workOrders.filter(wo => 
          wo.status === 'completed' && !wo.invoiceId
        );
        selectedBillingSheets = billingSheets.filter(bs => 
          (bs.status === 'completed' || bs.status === 'approved') && !bs.invoiceId
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
        const parsedStart = new Date(periodStartInput);
        const parsedEnd = new Date(periodEndInput);
        if (isNaN(parsedStart.getTime()) || isNaN(parsedEnd.getTime())) {
          return res.status(400).json({ message: "Invalid periodStart or periodEnd date value." });
        }
        if (parsedStart > parsedEnd) {
          return res.status(400).json({ message: "periodStart must not be after periodEnd." });
        }
        periodStart = parsedStart;
        periodEnd = parsedEnd;
      } else {
        periodStart = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
        periodEnd = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);
      }
      
      const laborSubtotal = 
        selectedWorkOrders.reduce((sum, wo) => sum + (parseFloat(wo.totalHours || '0') * 45), 0) +
        selectedBillingSheets.reduce((sum, bs) => sum + parseFloat(bs.laborSubtotal || '0'), 0);
      
      const partsSubtotal = 
        selectedWorkOrders.reduce((sum, wo) => sum + parseFloat(wo.totalPartsCost || '0'), 0) +
        selectedBillingSheets.reduce((sum, bs) => sum + parseFloat(bs.partsSubtotal || '0'), 0);
      
      const markupAmount = 0;
      const taxAmount = 0;
      const totalAmount = laborSubtotal + partsSubtotal;

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
        markupAmount: markupAmount.toFixed(2),
        taxAmount: taxAmount.toFixed(2),
        totalAmount: totalAmount.toFixed(2),
        status: 'generated',
      });

      if (!invoice) {
        throw new Error("Failed to create invoice");
      }

      // Create invoice items for work orders (without marking as billed yet)
      for (const workOrder of selectedWorkOrders) {
        const woLaborAmount = parseFloat(workOrder.totalHours || '0') * 45;
        const woPartsAmount = parseFloat(workOrder.totalPartsCost || '0');
        const woTotalAmount = woLaborAmount + woPartsAmount;
        
        await storage.createInvoiceItem({
          invoiceId: invoice.id,
          sourceType: 'work_order',
          sourceId: workOrder.id,
          workOrderId: workOrder.id,
          description: `Work Order ${workOrder.workOrderNumber} - ${workOrder.projectName}`,
          workDate: workOrder.completedAt || workOrder.createdAt,
          laborHours: (parseFloat(workOrder.totalHours || '0')).toString(),
          laborRate: '45.00',
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
          laborRate: (parseFloat(billingSheet.laborRate || '45')).toString(),
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
          const laborAmount = parseFloat(workOrder.totalHours || '0') * 45;
          const partsAmount = parseFloat(workOrder.totalPartsCost || '0');
          const totalLineAmount = laborAmount + partsAmount;
          
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
              Description: `WO-${workOrder.workOrderNumber} - ${workOrder.projectName} (${workOrder.totalHours}h labor @ $45/h, $${partsAmount.toFixed(2)} parts)`
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
              Description: `BS-${billingSheet.billingNumber} - ${parseFloat(billingSheet.totalHours || '0')}h labor @ $${parseFloat(billingSheet.laborRate || '45').toFixed(2)}/h, $${parseFloat(billingSheet.partsSubtotal || '0').toFixed(2)} parts`
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
        }, 'Monthly Invoice Creation');

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
          billedAt: currentDate
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
      res.status(500).json({ message: "Failed to fetch customer estimates" });
    }
  });

  app.get("/api/customers/:id(\\d+)/work-orders", async (req, res) => {
    try {
      const customerId = parseInt(req.params.id);
      const workOrders = await storage.getWorkOrdersByCustomer(customerId);
      res.json(workOrders);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch customer work orders" });
    }
  });

  app.get("/api/customers/:id(\\d+)/billing-sheets", async (req, res) => {
    try {
      const customerId = parseInt(req.params.id);
      const billingSheets = await storage.getBillingSheetsByCustomer(customerId);
      res.json(billingSheets);
    } catch (error) {
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
                case 'taxpercent':
                  customerData.taxPercent = values[index];
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
      res.status(500).json({ message: "Failed to search parts" });
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
      const processedData = {
        ...rawData,
        price: rawData.price !== undefined ? Number(rawData.price).toFixed(2) : undefined,
        cost: rawData.cost !== undefined && rawData.cost !== "" ? Number(rawData.cost).toFixed(2) : undefined,
        companyId: req.authenticatedUserCompanyId || rawData.companyId,
      };

      const partData = insertPartSchema.parse(processedData);
      const part = await storage.createPart(partData);
      res.status(201).json(part);
    } catch (error) {
      console.error("Error creating part:", error instanceof Error ? error.message : error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid part data", errors: error.errors });
      }
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
      res.status(500).json({ message: "Failed to delete part fitting type" });
    }
  });

  app.get("/api/parts", async (req, res) => {
    try {
      const parts = await storage.getParts();
      // Strip pricing fields for field technicians (they see names/quantities only)
      res.json(applyPricingVisibility(req, parts));
    } catch (error) {
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
      res.status(500).json({ message: "Failed to track part usage" });
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
      res.status(500).json({ message: "Failed to fetch estimate" });
    }
  });

  app.get("/api/estimates/:id/zones", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const zones = await storage.getEstimateZones(id);
      res.json(zones);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch estimate zones" });
    }
  });

  app.post("/api/estimates", requireAuthentication, async (req, res) => {
    try {
      const parsed = createEstimateWithZonesSchema.parse(req.body);
      
      // Process zones and items first to calculate totals
      const zones = parsed.zones.map(zone => ({
        ...zone,
        items: zone.items.map(item => {
          // Handle nested part data structure from frontend
          const partData = item.part;
          const quantity = item.quantity || 1;
          const partPrice = parseFloat(String(partData?.price || item.partPrice || 0));
          const laborHours = parseFloat(String(item.laborHours || 0));
          return {
            partId: partData?.id || item.partId,
            partName: partData?.name || item.partName || '',
            partPrice: String(partPrice),
            quantity: quantity,
            laborHours: String(laborHours),
            totalPrice: String((partPrice * quantity).toFixed(2))
          };
        })
      }));

      // Calculate totals from processed zones
      let partsSubtotal = 0;
      let totalLaborHours = 0;

      zones.forEach(zone => {
        zone.items.forEach(item => {
          const itemTotal = parseFloat(item.totalPrice);
          const itemLaborHours = parseFloat(item.laborHours);
          partsSubtotal += itemTotal;
          totalLaborHours += itemLaborHours;
        });
      });

      const laborRate = parseFloat(String(parsed.estimate.laborRate));
      const markupPercent = parseFloat(String(parsed.estimate.markupPercent));
      const taxPercent = parseFloat(String(parsed.estimate.taxPercent));

      const laborSubtotal = totalLaborHours * laborRate;
      const markupAmount = partsSubtotal * (markupPercent / 100);
      const subtotalWithMarkup = partsSubtotal + laborSubtotal + markupAmount;
      const taxAmount = subtotalWithMarkup * (taxPercent / 100);
      const totalAmount = subtotalWithMarkup + taxAmount;

      const estimate = {
        ...parsed.estimate,
        estimateDate: parsed.estimate.estimateDate ? new Date(parsed.estimate.estimateDate) : new Date(),
        partsSubtotal: String(partsSubtotal.toFixed(2)),
        laborSubtotal: String(laborSubtotal.toFixed(2)),
        markupAmount: String(markupAmount.toFixed(2)),
        taxAmount: String(taxAmount.toFixed(2)),
        totalAmount: String(totalAmount.toFixed(2)),
        laborRate: String(parsed.estimate.laborRate),
        markupPercent: String(parsed.estimate.markupPercent),
        taxPercent: String(parsed.estimate.taxPercent)
      };
      
      const newEstimate = await storage.createEstimate(estimate, zones as (InsertEstimateZone & { items: InsertEstimateItem[] })[]);
      res.status(201).json(newEstimate);
    } catch (error) {
      console.error("Estimate creation error:", error);
      if (error instanceof z.ZodError) {
        console.error("Validation errors:", error.errors);
        return res.status(400).json({ 
          message: "Invalid estimate data", 
          errors: error.errors,
          details: error.errors.map(err => ({
            path: err.path.join('.'),
            message: err.message,
            received: 'received' in err ? (err as z.ZodIssue & { received?: unknown }).received : undefined
          }))
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
      const parsed = createEstimateWithZonesSchema.parse(req.body);
      
      // Process zones and items first to calculate totals
      const zones = parsed.zones.map(zone => ({
        ...zone,
        items: zone.items.map(item => {
          // Handle nested part data structure from frontend
          const partData = item.part;
          const quantity = item.quantity || 1;
          const partPrice = parseFloat(String(partData?.price || item.partPrice || 0));
          const laborHours = parseFloat(String(item.laborHours || 0));
          return {
            partId: partData?.id || item.partId,
            partName: partData?.name || item.partName || '',
            partPrice: String(partPrice),
            quantity: quantity,
            laborHours: String(laborHours),
            totalPrice: String((partPrice * quantity).toFixed(2))
          };
        })
      }));

      // Calculate totals from processed zones
      let partsSubtotal = 0;
      let totalLaborHours = 0;

      zones.forEach(zone => {
        zone.items.forEach(item => {
          const itemTotal = parseFloat(item.totalPrice);
          const itemLaborHours = parseFloat(item.laborHours);
          partsSubtotal += itemTotal;
          totalLaborHours += itemLaborHours;
        });
      });

      const laborRate = parseFloat(String(parsed.estimate.laborRate));
      const markupPercent = parseFloat(String(parsed.estimate.markupPercent));
      const taxPercent = parseFloat(String(parsed.estimate.taxPercent));

      const laborSubtotal = totalLaborHours * laborRate;
      const markupAmount = partsSubtotal * (markupPercent / 100);
      const subtotalWithMarkup = partsSubtotal + laborSubtotal + markupAmount;
      const taxAmount = subtotalWithMarkup * (taxPercent / 100);
      const totalAmount = subtotalWithMarkup + taxAmount;

      const estimate = {
        ...parsed.estimate,
        estimateDate: parsed.estimate.estimateDate ? new Date(parsed.estimate.estimateDate) : new Date(),
        partsSubtotal: String(partsSubtotal.toFixed(2)),
        laborSubtotal: String(laborSubtotal.toFixed(2)),
        markupAmount: String(markupAmount.toFixed(2)),
        taxAmount: String(taxAmount.toFixed(2)),
        totalAmount: String(totalAmount.toFixed(2)),
        laborRate: String(parsed.estimate.laborRate),
        markupPercent: String(parsed.estimate.markupPercent),
        taxPercent: String(parsed.estimate.taxPercent)
      };
      
      const updatedEstimate = await storage.updateEstimateWithZones(estimateId, estimate, zones as (InsertEstimateZone & { items: InsertEstimateItem[] })[]);
      res.json(updatedEstimate);
    } catch (error) {
      console.error("Estimate update error:", error);
      if (error instanceof z.ZodError) {
        console.error("Validation errors:", error.errors);
        return res.status(400).json({ 
          message: "Invalid estimate data", 
          errors: error.errors,
          details: error.errors.map(err => ({
            path: err.path.join('.'),
            message: err.message,
            received: 'received' in err ? (err as z.ZodIssue & { received?: unknown }).received : undefined
          }))
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
      res.status(500).json({ message: "Failed to send estimate email" });
    }
  });

  // Property Zones routes
  app.get("/api/property-zones", async (req, res) => {
    try {
      const propertyZones = await storage.getPropertyZones();
      res.json(propertyZones);
    } catch (error) {
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
      res.status(500).json({ message: "Failed to fetch property zone" });
    }
  });

  app.post("/api/property-zones", requireAuthentication, async (req, res) => {
    try {
      const propertyZoneData = insertPropertyZoneSchema.parse(req.body);
      const propertyZone = await storage.createPropertyZone(propertyZoneData);
      res.status(201).json(propertyZone);
    } catch (error) {
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
      res.status(500).json({ message: "Failed to sync property zones from Google Sheets" });
    }
  });

  // Field Work Sessions routes
  app.get("/api/field-work-sessions", async (req, res) => {
    try {
      const sessions = await storage.getFieldWorkSessions();
      res.json(sessions);
    } catch (error) {
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
      res.status(500).json({ message: "Failed to fetch field work session" });
    }
  });

  app.post("/api/field-work-sessions", requireAuthentication, async (req, res) => {
    try {
      const sessionData = insertFieldWorkSessionSchema.parse(req.body);
      const session = await storage.createFieldWorkSession(sessionData);
      res.status(201).json(session);
    } catch (error) {
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
  async function refreshQuickBooksToken(refreshToken: string) {
    const tokenEndpoint = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
    const authHeader = Buffer.from(`${process.env.QUICKBOOKS_CLIENT_ID}:${process.env.QUICKBOOKS_CLIENT_SECRET}`).toString('base64');
    
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken
    });

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
      console.error('Token refresh failed:', response.status, errorText);
      throw new Error(`Token refresh failed: ${response.status} ${errorText}`);
    }

    const tokenData = await response.json();
    console.log('Successfully refreshed QuickBooks token');
    return tokenData;
  }

  // Helper function to make QuickBooks API requests with intuit_tid capture and automatic token refresh
  async function makeQuickBooksRequest(url: string, options: RequestInit = {}, operation: string = ''): Promise<globalThis.Response> {
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
        const integration = await storage.getQuickBooksIntegration();
        if (integration && integration.refreshToken) {
          const newTokenData = await refreshQuickBooksToken(integration.refreshToken);
          
          // Guard against NaN when expires_in is missing or zero
          const expiresInSeconds = newTokenData.expires_in && newTokenData.expires_in > 0
            ? newTokenData.expires_in
            : 3600;
          if (!newTokenData.expires_in || newTokenData.expires_in <= 0) {
            console.warn('QuickBooks token refresh: expires_in missing or zero, defaulting to 3600 seconds');
          }

          // Update the stored integration with new tokens
          await storage.saveQuickBooksIntegration({
            companyId: integration.companyId,
            accessToken: newTokenData.access_token,
            refreshToken: newTokenData.refresh_token || integration.refreshToken, // Keep old refresh token if new one not provided
            realmId: integration.realmId,
            expiresAt: new Date(Date.now() + (expiresInSeconds * 1000))
          });
          
          // Retry the original request with the new token
          const updatedOptions = { ...options };
          if (updatedOptions.headers) {
            (updatedOptions.headers as Record<string, string>)['Authorization'] = `Bearer ${newTokenData.access_token}`;
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
      } catch (refreshError) {
        console.error('Failed to refresh QuickBooks token:', refreshError);
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
        'QB Service Item Lookup'
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
      }, 'Company Info');
      
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
          expiresAt: qbData.expiresAt
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

      // Get actual QuickBooks integration data
      const integration = await storage.getQuickBooksIntegration(userCompanyId);
      
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
      }, 'Customers Query');

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
        error: "Failed to check QuickBooks connection status"
      });
    }
  });

  app.post("/api/quickbooks/sync-customers", requireQuickBooksAccess, async (req, res) => {
    try {
      
      // Get user's company ID from header (app uses localStorage/header auth, not server sessions)
      const userCompanyId = (req.headers['x-user-company-id'] as string) || null;
      
      // Get actual QuickBooks integration data
      const integration = await storage.getQuickBooksIntegration(userCompanyId);
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
      
      const customersResponse = await makeQuickBooksRequest(`${apiBase}/v3/company/${integration.realmId || integration.companyId}/query?query=SELECT * FROM Customer WHERE Active = true`, {
        headers: {
          'Authorization': `Bearer ${integration.accessToken}`,
          'Accept': 'application/json'
        }
      }, 'Customers Query');

      if (!customersResponse.ok) {
        const errorText = await customersResponse.text();
        const customersTid = customersResponse.headers.get('intuit_tid');
        console.error('Failed to fetch customers from QuickBooks:', customersResponse.status, errorText);
        
        // Handle 403 authorization errors specifically
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
      const qbCustomers = qbData?.QueryResponse?.Customer || [];
      
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
      
      const integration = await storage.getQuickBooksIntegration();
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
      
      const itemsResponse = await makeQuickBooksRequest(`${apiBase}/v3/company/${integration.realmId || integration.companyId}/query?query=SELECT * FROM Item WHERE Type = 'Inventory' AND Active = true`, {
        headers: {
          'Authorization': `Bearer ${integration.accessToken}`,
          'Accept': 'application/json'
        }
      }, 'Items Query');

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
      
      // Get QuickBooks integration data
      const integration = await storage.getQuickBooksIntegration();
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
      }, 'Estimate Invoice Creation');

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

      // Get estimate with zones for email
      const estimateWithZones = await storage.getEstimate(id);
      const zones = estimateWithZones?.zones;
      
      // Import EmailService
      const { EmailService } = await import('./email-service');
      
      // Send approval email
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
        zones: zones?.map(zone => ({
          zoneName: zone.zoneName,
          workDescription: zone.workDescription,
          laborHours: zone.items?.reduce((sum, item) => sum + parseFloat(item.laborHours), 0) || 0,
          partsCost: zone.items?.reduce((sum, item) => sum + parseFloat(item.totalPrice), 0) || 0,
          laborCost: (zone.items?.reduce((sum, item) => sum + parseFloat(item.laborHours), 0) || 0) * parseFloat(estimate.laborRate),
          zoneTotal: (zone.items?.reduce((sum, item) => sum + parseFloat(item.totalPrice), 0) || 0) + 
                    ((zone.items?.reduce((sum, item) => sum + parseFloat(item.laborHours), 0) || 0) * parseFloat(estimate.laborRate))
        }))
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
      res.status(500).json({ message: "Failed to connect to Google Sheets" });
    }
  });

  app.post("/api/integrations/google-sheets/customers/sync", async (req, res) => {
    try {
      const result = await storage.syncCustomersFromGoogleSheets("placeholder-url");
      res.json(result);
    } catch (error) {
      res.status(500).json({ message: "Failed to sync customers from Google Sheets" });
    }
  });

  app.post("/api/integrations/google-sheets/customers/disconnect", async (req, res) => {
    try {
      await storage.disconnectGoogleSheetsCustomers();
      res.json({ message: "Disconnected from Google Sheets successfully" });
    } catch (error) {
      res.status(500).json({ message: "Failed to disconnect from Google Sheets" });
    }
  });

  // QuickBooks Customer Integration
  app.get("/api/integrations/quickbooks/customers/status", async (req, res) => {
    try {
      const status = await storage.getQuickBooksCustomerStatus();
      res.json(status);
    } catch (error) {
      res.status(500).json({ message: "Failed to get QuickBooks status" });
    }
  });

  app.get("/api/integrations/quickbooks/customers/auth-url", async (req, res) => {
    try {
      const authData = await storage.getQuickBooksAuthUrl();
      res.json(authData);
    } catch (error) {
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
      res.status(500).json({ message: "Failed to connect to QuickBooks" });
    }
  });

  app.post("/api/integrations/quickbooks/customers/sync", async (req, res) => {
    try {
      const result = await storage.syncQuickBooksCustomers();
      res.json(result);
    } catch (error) {
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
        aiInputs: reqAiInputs,
        aiShortDescription,
        aiDetailedDescription,
      } = req.body;

      const completedByUserId = req.authenticatedUserId;
      const completedByUser = completedByUserId ? await storage.getUser(completedByUserId) : undefined;
      const completedByUserName = completedByUser?.name || req.headers['x-user-name'];

      // Calculate totals
      const laborRate = 45; // Default labor rate per hour
      const markupRate = 0.15; // 15% markup on parts
      const taxRate = 0.08; // 8% tax
      
      const laborHours = parseFloat(totalHours || '0');
      const partsCost = parseFloat(totalPartsCost || '0');
      
      const laborSubtotal = laborHours * laborRate;
      const partsSubtotal = partsCost;
      const markupAmount = partsSubtotal * markupRate;
      const subtotal = laborSubtotal + partsSubtotal + markupAmount;
      const taxAmount = subtotal * taxRate;
      const totalAmount = subtotal + taxAmount;

      // Merge creation photos with completion photos (don't overwrite)
      const existingWorkOrder = await storage.getWorkOrder(workOrderId);
      const creationPhotos: string[] = existingWorkOrder?.photos || [];
      const completionPhotos: string[] = photos || [];
      const mergedPhotos = [...creationPhotos, ...completionPhotos];

      // Update work order with completion details and calculated totals
      const workOrder = await storage.updateWorkOrder(workOrderId, {
        status: 'completed',
        completedAt: new Date(completedAt),
        completedByUserId: completedByUserId || undefined,
        completedByUserName: completedByUserName as string,
        workSummary,
        customerNotes,
        totalHours: laborHours.toString(),
        photos: mergedPhotos,
        totalPartsCost: partsCost.toString(),
        totalAmount: totalAmount.toFixed(2),
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
      
      const workOrder = await storage.updateWorkOrder(id, { 
        status: "completed", 
        completedAt: new Date(),
        completedByUserId: completedByUserId || undefined,
        completedByUserName: completedByUserName as string
      });
      if (!workOrder) {
        return res.status(404).json({ message: "Work order not found" });
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
          relatedEntityId: id
        });
      }
      
      res.json(workOrder);
    } catch (error) {
      console.error("Error completing work order:", error);
      res.status(500).json({ message: "Failed to complete work order" });
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
      res.status(500).json({ message: "Failed to create invoice from work order" });
    }
  });

  app.post("/api/work-orders/:id/sync-quickbooks", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      // This would need to be implemented for QuickBooks sync
      res.json({ message: "QuickBooks sync endpoint ready for implementation" });
    } catch (error) {
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
      res.status(500).json({ message: "Failed to fetch billing sheets" });
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
      res.status(500).json({ message: "Failed to fetch billing sheet" });
    }
  });

  app.post("/api/billing-sheets", async (req, res) => {
    try {
      console.log('Received billing sheet data:', req.body);
      const billingSheetData = req.body;
      
      // Determine the correct status based on creator's role
      // irrigation_manager => 'approved' (skip manual approval step)
      // field_tech => 'submitted' (goes to irrigation manager for review)
      // Server is source of truth for status based on creator role
      const creatorRole = req.authenticatedUserRole || req.headers['x-user-role'];
      let resolvedStatus: string;
      if (creatorRole === 'irrigation_manager' || creatorRole === 'billing_manager') {
        resolvedStatus = 'approved';
      } else if (creatorRole === 'field_tech') {
        resolvedStatus = 'submitted';
      } else {
        resolvedStatus = billingSheetData.status || 'draft';
      }

      // Clean the data - remove any fields that might interfere with timestamps
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
        laborRate: billingSheetData.laborRate || '45.00',
        laborSubtotal: billingSheetData.laborSubtotal || '0',
        partsSubtotal: billingSheetData.partsSubtotal || '0',
        markupAmount: billingSheetData.markupAmount || '0',
        taxAmount: billingSheetData.taxAmount || '0',
        totalAmount: billingSheetData.totalAmount || '0',
        photos: billingSheetData.photos || [],
        notes: billingSheetData.notes || '',
        branchName: billingSheetData.branchName || null,
        items: Array.isArray(billingSheetData.items) ? billingSheetData.items : undefined,
      };
      
      // Generate billing number
      const count = await storage.getBillingSheetCount();
      const billingNumber = `BS-${new Date().getFullYear()}-${String(count + 1).padStart(3, '0')}`;
      
      console.log('Creating billing sheet with clean data:', {
        ...cleanData,
        billingNumber
      });
      
      const billingSheet = await storage.createBillingSheet({
        ...cleanData,
      });

      const createdItemCount = Array.isArray(cleanData.items) ? cleanData.items.length : 0;
      console.log(`[AUDIT] billing_sheet_created billingSheetId=${billingSheet.id} billingNumber=${billingNumber} itemCount=${createdItemCount} status=${resolvedStatus}`);

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
            message: `Billing sheet ${billingNumber} for ${cleanData.customerName || 'a customer'} has been submitted${cleanData.technicianName ? ` by ${cleanData.technicianName}` : ''}.`,
            relatedEntityType: "billing_sheet",
            relatedEntityId: billingSheet.id,
            isRead: false,
          });
        }
      } catch (notifError) {
        console.error('Failed to send billing sheet notifications:', notifError);
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
      const { items, markupPercent, taxPercent, workLocationLat, workLocationLng, workLocationAddress, companyId, ...billingSheetData } = req.body;
      
      console.log('Updating billing sheet:', id, 'with data:', billingSheetData);
      
      // Convert date string to Date object if present
      if (billingSheetData.workDate && typeof billingSheetData.workDate === 'string') {
        billingSheetData.workDate = new Date(billingSheetData.workDate + 'T00:00:00.000Z');
      }
      
      // Update the billing sheet
      const billingSheet = await storage.updateBillingSheet(id, billingSheetData);
      if (!billingSheet) {
        return res.status(404).json({ message: "Billing sheet not found" });
      }
      
      // Handle items if provided (delete-and-recreate wrapped in a transaction)
      if (items && Array.isArray(items)) {
        const countBefore = (await storage.getBillingSheetById(id))?.items?.length ?? 0;
        const itemsToInsert = items.map((item: any) => ({
          billingSheetId: id,
          partId: item.partId || null,
          partName: item.partName,
          partDescription: item.partDescription || "",
          quantity: item.quantity,
          unitPrice: item.unitPrice.toString(),
          laborHours: item.laborHours.toString(),
          totalPrice: (item.quantity * item.unitPrice).toString(),
          notes: item.notes || "",
        }));
        await storage.replaceBillingSheetItemsInTransaction(id, itemsToInsert);
        console.log(`[AUDIT] billing_sheet_items_replaced billingSheetId=${id} countBefore=${countBefore} countAfter=${items.length}`);
      }

      // Submission guard: if status transitions to submitted/approved, check items vs partsSubtotal
      if (billingSheetData.status === 'submitted' || billingSheetData.status === 'approved') {
        const partsSubtotal = parseFloat(String(billingSheetData.partsSubtotal ?? billingSheet.partsSubtotal ?? '0'));
        if (partsSubtotal > 0) {
          const currentItems = (await storage.getBillingSheetById(id))?.items ?? [];
          if (currentItems.length === 0) {
            return res.status(400).json({ message: "Parts were recorded but no line items were saved — submission blocked to prevent billing data loss" });
          }
        }
        const currentItemCount = (await storage.getBillingSheetById(id))?.items?.length ?? 0;
        console.log(`[AUDIT] billing_sheet_status_change billingSheetId=${id} status=${billingSheetData.status} itemCount=${currentItemCount}`);
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
      res.status(500).json({ message: "Failed to bulk delete billing sheets" });
    }
  });

  app.delete("/api/billing-sheets/:id", requireWorkOrderBillingAccess, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteBillingSheet(id);
      res.json({ message: "Billing sheet deleted successfully" });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete billing sheet" });
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
      res.status(500).json({ message: "Failed to fetch work orders" });
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
      res.status(500).json({ message: "Failed to fetch work order" });
    }
  });

  app.post("/api/work-orders", async (req, res) => {
    try {
      const { items, ...workOrderBody } = req.body;
      const workOrderData = insertWorkOrderSchema.parse(workOrderBody);
      const workOrder = await storage.createWorkOrder(workOrderData);

      // Save items if provided at creation time
      if (items !== undefined && Array.isArray(items) && items.length > 0) {
        let computedPartsCost = 0;
        for (const item of items) {
          const qty = Number(item.quantity) || 0;
          const price = Number(item.unitPrice) || Number(item.partPrice) || 0;
          const lineTotal = qty * price;
          computedPartsCost += lineTotal;
          await storage.addWorkOrderItem({
            workOrderId: workOrder.id,
            partId: item.partId || null,
            partName: item.partName,
            partPrice: price.toString(),
            quantity: qty,
            laborHours: (Number(item.laborHours) || 0).toString(),
            totalPrice: lineTotal.toString(),
            notes: item.notes || null,
            zoneId: item.zoneId || null,
          });
        }
        await storage.updateWorkOrder(workOrder.id, { totalPartsCost: computedPartsCost.toFixed(2) });
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
      const { items, ...workOrderBody } = req.body;
      const workOrderData = insertWorkOrderSchema.partial().parse(workOrderBody);
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
        const itemsToInsert = items.map((item: any) => {
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
            zoneId: item.zoneId || null,
          };
        });
        await storage.replaceWorkOrderItemsInTransaction(id, itemsToInsert);
        const computedPartsCost = itemsToInsert.reduce((sum: number, i: any) => sum + Number(i.totalPrice), 0);
        await storage.updateWorkOrder(id, { totalPartsCost: computedPartsCost.toFixed(2) });
        console.log(`[AUDIT] work_order_items_replaced workOrderId=${id} countBefore=${countBefore} countAfter=${items.length}`);
      }

      // Submission guard: if status transitions to submitted/approved, check items vs partsSubtotal
      if (workOrderData.status === 'submitted' || workOrderData.status === 'approved') {
        const freshWorkOrder = await storage.getWorkOrder(id);
        const partsSubtotal = parseFloat(String(freshWorkOrder?.partsSubtotal ?? '0'));
        if (partsSubtotal > 0) {
          const currentItems = await storage.getWorkOrderItems(id);
          if (currentItems.length === 0) {
            return res.status(400).json({ message: "Parts were recorded but no line items were saved — submission blocked to prevent billing data loss" });
          }
        }
        console.log(`[AUDIT] work_order_status_change workOrderId=${id} status=${workOrderData.status} itemCount=${(await storage.getWorkOrderItems(id)).length}`);
      }

      res.json(workOrder);
    } catch (error) {
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
      const itemData = insertWorkOrderItemSchema.parse({
        ...req.body,
        workOrderId
      });
      const item = await storage.addWorkOrderItem(itemData);
      res.status(201).json(item);
    } catch (error) {
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
      res.status(500).json({ message: "Failed to fetch billing sheet items" });
    }
  });

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

      const { techName, workPerformed, additionalNotes, totalPartsCost, arrivalPhoto, finishedPhoto, actualStartTime, actualEndTime, materialItems, laborItems, additionalCharges, technicianNotes, laborRate: formLaborRate, aiInputs: reqAiInputs, aiShortDescription, aiDetailedDescription, ...rest } = req.body;

      const creatorRole = req.authenticatedUserRole || req.headers['x-user-role'];
      let resolvedStatus: string;
      if (creatorRole === 'irrigation_manager' || creatorRole === 'billing_manager') {
        resolvedStatus = 'approved';
      } else if (creatorRole === 'field_tech') {
        resolvedStatus = 'submitted';
      } else {
        resolvedStatus = 'draft';
      }

      const totalHoursVal = workOrder.totalHours ?? "0";
      const laborRateVal = formLaborRate || "45.00";
      const laborSubtotalVal = (parseFloat(String(totalHoursVal)) * parseFloat(String(laborRateVal))).toFixed(2);
      const partsSubtotalVal = parseFloat(String(totalPartsCost || "0")).toFixed(2);
      const taxAmount = ((parseFloat(laborSubtotalVal) + parseFloat(partsSubtotalVal)) * 0.0825).toFixed(2);
      const totalAmount = (parseFloat(laborSubtotalVal) + parseFloat(partsSubtotalVal) + parseFloat(taxAmount)).toFixed(2);

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

      function mapRawLineItem(item: RawLineItem): ResolvedBillingItem {
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
      }

      // Build billing sheet items from materialItems and laborItems in the request body.
      // Fall back to work_order_items if no items were provided in this request.
      let resolvedItems: ResolvedBillingItem[] = [];

      const rawMaterialItems: RawLineItem[] = Array.isArray(materialItems) ? materialItems : [];
      const rawLaborItems: RawLineItem[] = Array.isArray(laborItems) ? laborItems : [];
      const rawRequestItems = [...rawMaterialItems, ...rawLaborItems];

      if (rawRequestItems.length > 0) {
        resolvedItems = rawRequestItems.map(mapRawLineItem);
      } else {
        // Fall back to items already saved on the work order
        const workOrderItemsList = await storage.getWorkOrderItems(workOrderId);
        if (workOrderItemsList.length > 0) {
          resolvedItems = workOrderItemsList.map((item) => ({
            partId: item.partId || null,
            partName: item.partName,
            partDescription: null,
            quantity: String(item.quantity),
            unitPrice: item.partPrice,
            totalPrice: item.totalPrice,
            laborHours: item.laborHours,
            notes: item.notes || null,
          }));
        }
      }

      const workOrderSourceItemCount = (await storage.getWorkOrderItems(workOrderId)).length;
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
        markupAmount: "0",
        taxAmount,
        totalAmount,
        status: resolvedStatus,
        notes: additionalNotes || technicianNotes || "",
        photos: [],
        workDate: new Date(),
        aiInputs: reqAiInputs || null,
        aiShortDescription: aiShortDescription || null,
        aiDetailedDescription: aiDetailedDescription || null,
        items: resolvedItems.length > 0 ? resolvedItems : undefined,
      });
      console.log(`[AUDIT] work_order_converted_to_billing_sheet workOrderId=${workOrderId} billingSheetId=${newBillingSheet.id} sourceItemCount=${workOrderSourceItemCount} billingSheetItemsWritten=0`);
      res.json({ message: "Billing sheet saved successfully" });
    } catch (error) {
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
      res.status(500).json({ message: "Failed to fetch billing sheet" });
    }
  });

  // File upload routes for photos and attachments
  app.post("/api/upload/photo", async (req, res) => {
    try {
      if (!req.files || !req.files.photo) {
        return res.status(400).json({ message: "No photo file provided" });
      }

      const photo = Array.isArray(req.files.photo) ? req.files.photo[0] : req.files.photo;
      
      // Validate file type (images only)
      if (!photo.mimetype.startsWith('image/')) {
        return res.status(400).json({ message: "Only image files are allowed for photos" });
      }

      const fileName = `photo_${Date.now()}_${photo.name.replace(/\s+/g, '_')}`;
      const uploadPath = `./uploads/${fileName}`;

      await photo.mv(uploadPath);
      res.json({ url: `/uploads/${fileName}`, fileName, originalName: photo.name });
    } catch (error) {
      console.error("Photo upload error:", error);
      res.status(500).json({ message: "Failed to upload photo" });
    }
  });

  app.post("/api/upload/attachment", async (req, res) => {
    try {
      if (!req.files || !req.files.attachment) {
        return res.status(400).json({ message: "No attachment file provided" });
      }

      const attachment = Array.isArray(req.files.attachment) ? req.files.attachment[0] : req.files.attachment;
      const fileName = `attachment_${Date.now()}_${attachment.name.replace(/\s+/g, '_')}`;
      const uploadPath = `./uploads/${fileName}`;

      await attachment.mv(uploadPath);
      res.json({ url: `/uploads/${fileName}`, fileName, originalName: attachment.name });
    } catch (error) {
      console.error("Attachment upload error:", error);
      res.status(500).json({ message: "Failed to upload attachment" });
    }
  });

  // Serve uploaded files
  app.use('/uploads', express.static('./uploads'));

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

  return httpServer;
}
