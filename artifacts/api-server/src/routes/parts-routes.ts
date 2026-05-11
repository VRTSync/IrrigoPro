// Parts + Part Settings + Manual Part Reviews routes — extracted from
// routes.ts as part of Task #446. Behavior is byte-for-byte identical to the
// previous inline definitions; this module just narrows the surface so the
// parts catalog and its reference lists live in their own file.

import type { Express, Request, RequestHandler } from "express";
import { z } from "zod/v4";
import { insertPartSchema } from "@workspace/db";
import { storage } from "../storage";

export interface RegisterPartRoutesDeps {
  requireAuthentication: RequestHandler;
  applyPricingVisibility: <T>(req: Request, data: T) => T;
}

interface BulkImportColumnMapping {
  csvColumn: string;
  dbField: string;
}

// Mutable accumulator used while assembling a part record from a single CSV
// row. Field names mirror the CSV → DB mapping switch below; the final value
// is fed to insertPartSchema.parse for full validation.
interface BulkImportPartDraft {
  name?: string;
  category?: string;
  price?: string | number;
  cost?: number | null;
  material?: string | null;
  size?: string | null;
  brand?: string | null;
  fittingType?: string | null;
  detail?: string | null;
  description?: string | null;
  sku?: string | null;
  companyId?: number;
}

export function registerPartRoutes(
  app: Express,
  { requireAuthentication, applyPricingVisibility }: RegisterPartRoutesDeps,
): void {
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
        res.status(400).json({ message: "Search query is required" });
        return;
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
        res.status(403).json({ message: "Access denied." });
        return;
      }
      const companyId = req.authenticatedUserCompanyId;
      if (!companyId) { res.status(400).json({ message: "Company ID required" }); return; }
      const pendingParts = await storage.getPendingParts(companyId);
      res.json(pendingParts);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch pending parts" });
    }
  });

  app.get("/api/parts/:id", async (req, res) => {
    try {
      const id = parseInt(String(req.params.id));

      // Validate part ID is a valid number
      if (isNaN(id) || id <= 0) {
        res.status(400).json({ message: "Invalid part ID" });
        return;
      }

      const part = await storage.getPart(id);
      if (!part) {
        res.status(404).json({ message: "Part not found" });
        return;
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
        res.status(403).json({ message: "Access denied. You don't have permission to create parts." });
        return;
      }

      const rawData = req.body;

      const MAX_DECIMAL = 99999999.99;
      if (rawData.price !== undefined) {
        const priceNum = Number(rawData.price);
        if (!Number.isFinite(priceNum) || priceNum < 0 || priceNum > MAX_DECIMAL) {
          res.status(400).json({ message: "Price must be between 0 and 99,999,999.99" });
          return;
        }
      }
      if (rawData.cost !== undefined && rawData.cost !== "" && rawData.cost !== null) {
        const costNum = Number(rawData.cost);
        if (!Number.isFinite(costNum) || costNum < 0 || costNum > MAX_DECIMAL) {
          res.status(400).json({ message: "Cost must be between 0 and 99,999,999.99" });
          return;
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
        res.status(400).json({ message: "Invalid part data", errors: error.issues });
        return;
      }
      console.error("Error creating part:", error instanceof Error ? error.message : error, { price: req.body?.price, cost: req.body?.cost });
      res.status(500).json({ message: "Failed to create part" });
    }
  });

  app.put("/api/parts/:id", requireAuthentication, async (req, res) => {
    try {
      const id = parseInt(String(req.params.id));

      // Validate part ID is a valid number
      if (isNaN(id) || id <= 0) {
        res.status(400).json({ message: "Invalid part ID" });
        return;
      }

      // Check role-based access for parts editing
      const userRole = req.authenticatedUserRole;
      const allowedRoles = ['company_admin', 'super_admin', 'billing_manager', 'irrigation_manager'];
      if (!allowedRoles.includes(userRole as string)) {
        console.error(`PUT /api/parts/:id - Access denied. Role ${userRole} cannot edit parts`);
        res.status(403).json({ message: "Access denied. You don't have permission to edit parts." });
        return;
      }

      // Check if part exists and belongs to user's company
      const existingPart = await storage.getPart(id);
      if (!existingPart) {
        res.status(404).json({ message: "Part not found" });
        return;
      }

      const authenticatedCompanyId = req.authenticatedUserCompanyId;
      if (authenticatedCompanyId !== null && existingPart.companyId !== authenticatedCompanyId) {
        res.status(403).json({ message: "Access denied. You can only update parts from your company." });
        return;
      }

      const partData = insertPartSchema.partial().parse(req.body);
      const part = await storage.updatePart(id, partData);
      if (!part) {
        res.status(404).json({ message: "Part not found" });
        return;
      }
      res.json(part);
    } catch (error) {
      console.error("Error updating part (PUT):", error);
      if (error instanceof z.ZodError) {
        res.status(400).json({ message: "Invalid part data", errors: error.issues });
        return;
      }
      res.status(500).json({ message: "Failed to update part" });
    }
  });

  // PATCH alias for PUT (frontend expects PATCH for partial updates)
  app.patch("/api/parts/:id", requireAuthentication, async (req, res) => {
    const partId = String(req.params.id);

    try {
      const id = parseInt(partId);

      // Production debugging for part 393 issue
      if (id === 393) {
        console.log(`[PART-393-DEBUG] User ${req.authenticatedUserId} (role: ${req.authenticatedUserRole}, company: ${req.authenticatedUserCompanyId}) attempting to edit part 393`);
      }

      // Validate part ID is a valid number
      if (isNaN(id) || id <= 0) {
        console.error(`PATCH /api/parts/${partId} - Invalid part ID`);
        res.status(400).json({ message: "Invalid part ID" });
        return;
      }

      // Check role-based access for parts editing
      const userRole = req.authenticatedUserRole;
      const allowedRoles = ['company_admin', 'super_admin', 'billing_manager', 'irrigation_manager'];
      if (!allowedRoles.includes(userRole as string)) {
        console.error(`PATCH /api/parts/:id - Access denied. Role ${userRole} cannot edit parts`);
        res.status(403).json({ message: "Access denied. You don't have permission to edit parts." });
        return;
      }

      // Check if part exists before updating - with explicit error handling
      let existingPart;
      try {
        existingPart = await storage.getPart(id);
      } catch (partLookupError) {
        console.error(`PATCH /api/parts/:id - Database error during part lookup:`, partLookupError);
        res.status(500).json({ message: "Database error while checking part" });
        return;
      }

      if (!existingPart) {
        console.error(`PATCH /api/parts/:id - Part not found: ${id}`);
        res.status(404).json({ message: "Part not found" });
        return;
      }

      // Ensure the part belongs to the user's company
      const authenticatedCompanyId = req.authenticatedUserCompanyId;

      // Only check company ownership if the user has a company (not null)
      if (authenticatedCompanyId !== null && existingPart.companyId !== authenticatedCompanyId) {
        console.error(`PATCH /api/parts/:id - Access denied. User company ${authenticatedCompanyId} cannot update part from company ${existingPart.companyId}`);
        res.status(403).json({ message: "Access denied. You can only update parts from your company." });
        return;
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
          console.error("PATCH /api/parts/:id - Zod validation errors:", validationError.issues);
          res.status(400).json({ message: "Invalid part data", errors: validationError.issues });
          return;
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
          res.status(400).json({
            message: "Invalid data provided. Please check all fields and try again.",
            details: errorMessage
          });
          return;
        }

        res.status(500).json({ message: "Database error while updating part" });
        return;
      }

      if (!part) {
        console.error(`PATCH /api/parts/:id - Update failed for part: ${id}`);
        res.status(404).json({ message: "Part not found after update" });
        return;
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
        res.status(400).json({ message: "CSV data is required" });
        return;
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
        res.status(400).json({ message: "CSV must have header and at least one data row" });
        return;
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
        (columnMappings as BulkImportColumnMapping[]).forEach((mapping) => {
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
          res.status(400).json({
            message: `Missing required field mappings: ${missingFields.join(', ')}`
          });
          return;
        }
      } else {
        // Old behavior - map by header names
        const headers = csvHeaders.map((h: string) => h.toLowerCase());
        const requiredFields = ['name', 'category', 'price'];
        const missingFields = requiredFields.filter(field => !headers.includes(field));

        if (missingFields.length > 0) {
          res.status(400).json({
            message: `Missing required fields: ${missingFields.join(', ')}`
          });
          return;
        }

        // Create legacy mapping
        headers.forEach((header: string, index: number) => {
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
          const partData: BulkImportPartDraft = {};


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
          if (partData.name && existingNames.has(partData.name.toLowerCase())) {
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
          existingNames.add(partData.name!.toLowerCase());

        } catch (error) {
          console.error(`Row ${i + 1} validation error:`, error);

          if (error instanceof z.ZodError) {
            // Provide detailed validation errors
            const errorMessages = error.issues.map(e => {
              const field = e.path.join('.');
              return `${field}: ${e.message}`;
            });
            results.errors.push({
              row: i + 1,
              field: String(error.issues[0]?.path[0] || 'general'),
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

  const requirePartsSettingsAccess: RequestHandler = (req, res, next) => {
    const userRole = req.authenticatedUserRole;
    if (userRole !== 'company_admin' && userRole !== 'billing_manager' && userRole !== 'irrigation_manager') {
      res.status(403).json({ message: "Access denied. Only company administrators, billing managers, and irrigation managers can manage parts settings." });
      return;
    }
    next();
  };

  // Part Categories
  app.get("/api/part-settings/categories", requireAuthentication, async (req, res) => {
    const companyId = req.authenticatedUserCompanyId;
    if (!companyId) { res.status(401).json({ message: "Unauthorized" }); return; }
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
    if (!companyId) { res.status(401).json({ message: "Unauthorized" }); return; }
    const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
    if (!name) { res.status(400).json({ message: "Name is required" }); return; }
    let markupPercent = "0.00";
    if (req.body.markupPercent !== undefined) {
      const parsed = parseFloat(req.body.markupPercent);
      if (isNaN(parsed) || parsed < 0) { res.status(400).json({ message: "markupPercent must be a non-negative number" }); return; }
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
    if (!companyId) { res.status(401).json({ message: "Unauthorized" }); return; }
    const id = parseInt(String(req.params.id));
    if (isNaN(id)) { res.status(400).json({ message: "Invalid id" }); return; }
    const update: { name?: string; markupPercent?: string } = {};
    if (typeof req.body.name === "string") {
      update.name = req.body.name.trim();
      if (!update.name) { res.status(400).json({ message: "Name cannot be empty" }); return; }
    }
    if (req.body.markupPercent !== undefined) {
      const parsed = parseFloat(req.body.markupPercent);
      if (isNaN(parsed) || parsed < 0) { res.status(400).json({ message: "markupPercent must be a non-negative number" }); return; }
      update.markupPercent = parsed.toFixed(2);
    }
    if (Object.keys(update).length === 0) { res.status(400).json({ message: "No valid fields to update" }); return; }
    try {
      const category = await storage.updatePartCategory(id, companyId, update);
      if (!category) { res.status(404).json({ message: "Category not found" }); return; }
      res.json(category);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to update part category" });
    }
  });

  app.delete("/api/part-settings/categories/:id", requireAuthentication, requirePartsSettingsAccess, async (req, res) => {
    const companyId = req.authenticatedUserCompanyId;
    if (!companyId) { res.status(401).json({ message: "Unauthorized" }); return; }
    const id = parseInt(String(req.params.id));
    if (isNaN(id)) { res.status(400).json({ message: "Invalid id" }); return; }
    try {
      const deleted = await storage.deletePartCategory(id, companyId);
      if (!deleted) { res.status(404).json({ message: "Category not found" }); return; }
      res.json({ message: "Category deleted" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to delete part category" });
    }
  });

  // Part Brands
  app.get("/api/part-settings/brands", requireAuthentication, async (req, res) => {
    const companyId = req.authenticatedUserCompanyId;
    if (!companyId) { res.status(401).json({ message: "Unauthorized" }); return; }
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
    if (!companyId) { res.status(401).json({ message: "Unauthorized" }); return; }
    const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
    if (!name) { res.status(400).json({ message: "Name is required" }); return; }
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
    if (!companyId) { res.status(401).json({ message: "Unauthorized" }); return; }
    const id = parseInt(String(req.params.id));
    if (isNaN(id)) { res.status(400).json({ message: "Invalid id" }); return; }
    const update: { name?: string } = {};
    if (typeof req.body.name === "string") {
      update.name = req.body.name.trim();
      if (!update.name) { res.status(400).json({ message: "Name cannot be empty" }); return; }
    }
    if (Object.keys(update).length === 0) { res.status(400).json({ message: "No valid fields to update" }); return; }
    try {
      const brand = await storage.updatePartBrand(id, companyId, update);
      if (!brand) { res.status(404).json({ message: "Brand not found" }); return; }
      res.json(brand);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to update part brand" });
    }
  });

  app.delete("/api/part-settings/brands/:id", requireAuthentication, requirePartsSettingsAccess, async (req, res) => {
    const companyId = req.authenticatedUserCompanyId;
    if (!companyId) { res.status(401).json({ message: "Unauthorized" }); return; }
    const id = parseInt(String(req.params.id));
    if (isNaN(id)) { res.status(400).json({ message: "Invalid id" }); return; }
    try {
      const deleted = await storage.deletePartBrand(id, companyId);
      if (!deleted) { res.status(404).json({ message: "Brand not found" }); return; }
      res.json({ message: "Brand deleted" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to delete part brand" });
    }
  });

  // Part Sizes
  app.get("/api/part-settings/sizes", requireAuthentication, async (req, res) => {
    const companyId = req.authenticatedUserCompanyId;
    if (!companyId) { res.status(401).json({ message: "Unauthorized" }); return; }
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
    if (!companyId) { res.status(401).json({ message: "Unauthorized" }); return; }
    const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
    if (!name) { res.status(400).json({ message: "Name is required" }); return; }
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
    if (!companyId) { res.status(401).json({ message: "Unauthorized" }); return; }
    const id = parseInt(String(req.params.id));
    if (isNaN(id)) { res.status(400).json({ message: "Invalid id" }); return; }
    const update: { name?: string } = {};
    if (typeof req.body.name === "string") {
      update.name = req.body.name.trim();
      if (!update.name) { res.status(400).json({ message: "Name cannot be empty" }); return; }
    }
    if (Object.keys(update).length === 0) { res.status(400).json({ message: "No valid fields to update" }); return; }
    try {
      const size = await storage.updatePartSize(id, companyId, update);
      if (!size) { res.status(404).json({ message: "Size not found" }); return; }
      res.json(size);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to update part size" });
    }
  });

  app.delete("/api/part-settings/sizes/:id", requireAuthentication, requirePartsSettingsAccess, async (req, res) => {
    const companyId = req.authenticatedUserCompanyId;
    if (!companyId) { res.status(401).json({ message: "Unauthorized" }); return; }
    const id = parseInt(String(req.params.id));
    if (isNaN(id)) { res.status(400).json({ message: "Invalid id" }); return; }
    try {
      const deleted = await storage.deletePartSize(id, companyId);
      if (!deleted) { res.status(404).json({ message: "Size not found" }); return; }
      res.json({ message: "Size deleted" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to delete part size" });
    }
  });

  // Part Materials
  app.get("/api/part-settings/materials", requireAuthentication, async (req, res) => {
    const companyId = req.authenticatedUserCompanyId;
    if (!companyId) { res.status(401).json({ message: "Unauthorized" }); return; }
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
    if (!companyId) { res.status(401).json({ message: "Unauthorized" }); return; }
    const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
    if (!name) { res.status(400).json({ message: "Name is required" }); return; }
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
    if (!companyId) { res.status(401).json({ message: "Unauthorized" }); return; }
    const id = parseInt(String(req.params.id));
    if (isNaN(id)) { res.status(400).json({ message: "Invalid id" }); return; }
    const update: { name?: string } = {};
    if (typeof req.body.name === "string") {
      update.name = req.body.name.trim();
      if (!update.name) { res.status(400).json({ message: "Name cannot be empty" }); return; }
    }
    if (Object.keys(update).length === 0) { res.status(400).json({ message: "No valid fields to update" }); return; }
    try {
      const material = await storage.updatePartMaterial(id, companyId, update);
      if (!material) { res.status(404).json({ message: "Material not found" }); return; }
      res.json(material);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to update part material" });
    }
  });

  app.delete("/api/part-settings/materials/:id", requireAuthentication, requirePartsSettingsAccess, async (req, res) => {
    const companyId = req.authenticatedUserCompanyId;
    if (!companyId) { res.status(401).json({ message: "Unauthorized" }); return; }
    const id = parseInt(String(req.params.id));
    if (isNaN(id)) { res.status(400).json({ message: "Invalid id" }); return; }
    try {
      const deleted = await storage.deletePartMaterial(id, companyId);
      if (!deleted) { res.status(404).json({ message: "Material not found" }); return; }
      res.json({ message: "Material deleted" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to delete part material" });
    }
  });

  // Part Fitting Types
  app.get("/api/part-settings/fitting-types", requireAuthentication, async (req, res) => {
    const companyId = req.authenticatedUserCompanyId;
    if (!companyId) { res.status(401).json({ message: "Unauthorized" }); return; }
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
    if (!companyId) { res.status(401).json({ message: "Unauthorized" }); return; }
    const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
    if (!name) { res.status(400).json({ message: "Name is required" }); return; }
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
    if (!companyId) { res.status(401).json({ message: "Unauthorized" }); return; }
    const id = parseInt(String(req.params.id));
    if (isNaN(id)) { res.status(400).json({ message: "Invalid id" }); return; }
    const update: { name?: string } = {};
    if (typeof req.body.name === "string") {
      update.name = req.body.name.trim();
      if (!update.name) { res.status(400).json({ message: "Name cannot be empty" }); return; }
    }
    if (Object.keys(update).length === 0) { res.status(400).json({ message: "No valid fields to update" }); return; }
    try {
      const fittingType = await storage.updatePartFittingType(id, companyId, update);
      if (!fittingType) { res.status(404).json({ message: "Fitting type not found" }); return; }
      res.json(fittingType);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to update part fitting type" });
    }
  });

  app.delete("/api/part-settings/fitting-types/:id", requireAuthentication, requirePartsSettingsAccess, async (req, res) => {
    const companyId = req.authenticatedUserCompanyId;
    if (!companyId) { res.status(401).json({ message: "Unauthorized" }); return; }
    const id = parseInt(String(req.params.id));
    if (isNaN(id)) { res.status(400).json({ message: "Invalid id" }); return; }
    try {
      const deleted = await storage.deletePartFittingType(id, companyId);
      if (!deleted) { res.status(404).json({ message: "Fitting type not found" }); return; }
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
      const partId = parseInt(String(req.params.id));
      if (isNaN(partId) || partId <= 0) {
        res.status(400).json({ message: "Invalid part ID" });
        return;
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
        res.status(403).json({ message: "Access denied." });
        return;
      }
      const id = parseInt(String(req.params.id));
      if (isNaN(id) || id <= 0) { res.status(400).json({ message: "Invalid part ID" }); return; }

      // Verify company ownership (except super_admin who can approve any)
      const existingPart = await storage.getPart(id);
      if (!existingPart) { res.status(404).json({ message: "Part not found" }); return; }
      const companyId = req.authenticatedUserCompanyId;
      if (userRole !== 'super_admin' && companyId !== null && existingPart.companyId !== companyId) {
        res.status(403).json({ message: "Access denied. You can only approve parts from your company." });
        return;
      }

      const { price, cost } = req.body;
      if (!price) { res.status(400).json({ message: "price is required" }); return; }

      const updatedPart = await storage.approvePart(id, String(price), cost ? String(cost) : undefined, existingPart.companyId);
      if (!updatedPart) { res.status(404).json({ message: "Part not found" }); return; }

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
        res.status(403).json({ message: "Access denied." });
        return;
      }
      const companyId = req.authenticatedUserCompanyId;
      if (!companyId) { res.status(400).json({ message: "Company ID required" }); return; }
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
        res.status(403).json({ message: "Access denied." });
        return;
      }
      const id = parseInt(String(req.params.id));
      if (isNaN(id) || id <= 0) { res.status(400).json({ message: "Invalid review ID" }); return; }

      // Verify company ownership (except super_admin who can approve any)
      const existingReview = await storage.getManualPartReview(id);
      if (!existingReview) { res.status(404).json({ message: "Review not found" }); return; }
      const companyId = req.authenticatedUserCompanyId;
      if (userRole !== 'super_admin' && companyId !== null && existingReview.companyId !== companyId) {
        res.status(403).json({ message: "Access denied. You can only approve reviews from your company." });
        return;
      }

      const { reviewedPrice } = req.body;
      if (!reviewedPrice) { res.status(400).json({ message: "reviewedPrice is required" }); return; }

      const updated = await storage.approveManualPartReview(id, String(reviewedPrice));
      if (!updated) { res.status(404).json({ message: "Review not found" }); return; }

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
        res.status(403).json({ message: "Access denied. You don't have permission to delete parts." });
        return;
      }

      const id = parseInt(String(req.params.id));
      if (isNaN(id) || id <= 0) {
        res.status(400).json({ message: "Invalid part ID" });
        return;
      }

      const existingPart = await storage.getPart(id);
      if (!existingPart) {
        res.status(404).json({ message: "Part not found" });
        return;
      }

      const authenticatedCompanyId = req.authenticatedUserCompanyId;
      if (authenticatedCompanyId !== null && existingPart.companyId !== authenticatedCompanyId) {
        res.status(403).json({ message: "Access denied. You can only delete parts from your company." });
        return;
      }

      const success = await storage.deletePart(id);
      if (!success) {
        res.status(404).json({ message: "Part not found" });
        return;
      }
      res.json({ message: "Part deleted successfully" });
    } catch (error) {
      console.error("Error deleting part:", error instanceof Error ? error.message : error);
      res.status(500).json({ message: "Failed to delete part" });
    }
  });
}
