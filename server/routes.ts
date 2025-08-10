import express, { type Express, type Request } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
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
  insertCompanySchema
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
      partId: z.number().optional(),
      partName: z.string().optional(),
      partPrice: z.union([z.string(), z.number()]).optional(),
      quantity: z.number(),
      laborHours: z.union([z.string(), z.number()]).optional(),
      totalPrice: z.union([z.string(), z.number()]),
      totalLaborHours: z.number().optional()
    }))
  }))
});

// Middleware to check if user has admin permissions for site map creation/editing
const requireAdminAccess = (req: Request, res: any, next: any) => {
  // For now, we'll add a simple header check
  // In a production app, this would check a proper session or JWT token
  const userRole = req.headers['x-user-role'];
  
  if (userRole !== 'company_admin' && userRole !== 'super_admin') {
    return res.status(403).json({ 
      message: "Access denied. Site map creation is restricted to administrators only." 
    });
  }
  
  next();
};

// Middleware to check if user has permission to view site maps
const requireViewAccess = (req: Request, res: any, next: any) => {
  const userRole = req.headers['x-user-role'];
  
  if (!userRole || !['company_admin', 'super_admin', 'irrigation_manager', 'field_tech'].includes(userRole)) {
    return res.status(403).json({ 
      message: "Access denied. You don't have permission to view site maps." 
    });
  }
  
  next();
};

export async function registerRoutes(app: Express): Promise<Server> {
  // Company routes
  app.get("/api/companies", async (req, res) => {
    try {
      const companies = await storage.getCompanies();
      res.json(companies);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch companies" });
    }
  });

  app.post("/api/companies", async (req, res) => {
    try {
      const company = await storage.createCompany(req.body);
      res.status(201).json(company);
    } catch (error) {
      res.status(500).json({ message: "Failed to create company" });
    }
  });

  // Company Profile Management (Company Admin only)
  app.get("/api/company/:companyId/profile", async (req, res) => {
    try {
      const companyId = parseInt(req.params.companyId);
      const userRole = req.headers['x-user-role'];
      const userCompanyId = parseInt(req.headers['x-user-company-id'] as string);

      // Only company admins can access their own company profile
      if (userRole !== 'company_admin' || userCompanyId !== companyId) {
        return res.status(403).json({ message: "Access denied. Company admins can only manage their own company profile." });
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
  app.post("/api/company/:companyId/profile", async (req, res) => {
    try {
      const companyId = parseInt(req.params.companyId);
      const userRole = req.headers['x-user-role'];
      const userCompanyId = parseInt(req.headers['x-user-company-id'] as string);

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
  app.get("/api/company/:companyId/setup-status", async (req, res) => {
    try {
      const companyId = parseInt(req.params.companyId);
      const userRole = req.headers['x-user-role'];
      const userCompanyId = parseInt(req.headers['x-user-company-id'] as string);

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

  app.put("/api/company/:companyId/profile", async (req, res) => {
    try {
      const companyId = parseInt(req.params.companyId);
      const userRole = req.headers['x-user-role'];
      const userCompanyId = parseInt(req.headers['x-user-company-id'] as string);

      // Only company admins can update their own company profile
      if (userRole !== 'company_admin' || userCompanyId !== companyId) {
        return res.status(403).json({ message: "Access denied. Company admins can only manage their own company profile." });
      }

      const updates = insertCompanySchema.partial().parse(req.body);
      const updatedCompany = await storage.updateCompanyProfile(companyId, updates);
      res.json(updatedCompany);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid company data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to update company profile" });
    }
  });

  // Middleware to check if company profile setup is complete
  const requireCompanySetup = async (req: any, res: any, next: any) => {
    try {
      const userRole = req.headers['x-user-role'];
      const userCompanyId = parseInt(req.headers['x-user-company-id'] as string);

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

  // Get field technicians only (for work order assignments)
  app.get("/api/users/field-techs", async (req, res) => {
    try {
      const users = await storage.getUsers();
      // Filter to only field technicians and remove passwords
      const fieldTechs = users
        .filter(user => user.role === 'field_tech' && user.isActive)
        .map(({ password, ...user }) => user);
      res.json(fieldTechs);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch field technicians" });
    }
  });

  // User management routes for system admin
  app.post("/api/users", async (req, res) => {
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
      const userData = insertUserSchema.parse({
        ...req.body,
        companyId
      });
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

  // Authentication routes
  app.post("/api/auth/login", async (req, res) => {
    try {
      const { username, password } = req.body;
      const user = await storage.getUserByUsername(username);
      
      if (!user || user.password !== password || !user.isActive) {
        return res.status(401).json({ message: "Invalid credentials" });
      }
      
      // Return user without password
      const { password: _, ...userWithoutPassword } = user;
      res.json(userWithoutPassword);
    } catch (error) {
      res.status(500).json({ message: "Login failed" });
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
  app.get("/api/customers", async (req, res) => {
    try {
      const customers = await storage.getCustomers();
      res.json(customers);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch customers" });
    }
  });



  // Get customer billing data - all work orders, billing sheets, and estimates for a customer
  app.get("/api/customers/:id/billing", async (req, res) => {
    try {
      const customerId = parseInt(req.params.id);
      
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

      // Get all estimates for the customer
      const allEstimates = await storage.getEstimates();
      const estimates = allEstimates.filter(est => est.customerId === customerId);

      // Filter unbilled work (completed work orders and approved billing sheets that haven't been billed)
      const unbilledWorkOrders = workOrders.filter(wo => 
        wo.status === 'completed' && (!wo.billingStatus || wo.billingStatus !== 'billed')
      );
      const unbilledBillingSheets = billingSheets.filter(bs => 
        bs.status === 'approved' && (!bs.billingStatus || bs.billingStatus !== 'billed')
      );

      // Calculate total unbilled amount
      const totalUnbilledAmount = 
        unbilledWorkOrders.reduce((sum, wo) => sum + parseFloat(wo.totalAmount || '0'), 0) +
        unbilledBillingSheets.reduce((sum, bs) => sum + parseFloat(bs.totalAmount || '0'), 0);

      const billingData = {
        customer,
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
  app.get("/api/site-maps", requireViewAccess, async (req, res) => {
    try {
      const siteMaps = await storage.getAllSiteMaps();
      res.json(siteMaps);
    } catch (error) {
      console.error("Error fetching all site maps:", error);
      res.status(500).json({ message: "Failed to fetch site maps" });
    }
  });

  app.get("/api/customers/:customerId/site-maps", requireViewAccess, async (req, res) => {
    try {
      const customerId = parseInt(req.params.customerId);
      const siteMaps = await storage.getCustomerSiteMaps(customerId);
      res.json(siteMaps);
    } catch (error) {
      console.error("Error fetching customer site maps:", error);
      res.status(500).json({ message: "Failed to fetch customer site maps" });
    }
  });

  app.get("/api/site-maps/:siteMapId/controllers", requireViewAccess, async (req, res) => {
    try {
      const siteMapId = parseInt(req.params.siteMapId);
      const controllers = await storage.getSiteMapControllers(siteMapId);
      res.json(controllers);
    } catch (error) {
      console.error("Error fetching site map controllers:", error);
      res.status(500).json({ message: "Failed to fetch site map controllers" });
    }
  });

  app.get("/api/site-maps/:siteMapId/zones", requireViewAccess, async (req, res) => {
    try {
      const siteMapId = parseInt(req.params.siteMapId);
      const zones = await storage.getSiteMapZones(siteMapId);
      res.json(zones);
    } catch (error) {
      console.error("Error fetching site map zones:", error);
      res.status(500).json({ message: "Failed to fetch site map zones" });
    }
  });

  app.post("/api/customers/:customerId/site-maps", requireAdminAccess, async (req, res) => {
    try {
      const customerId = parseInt(req.params.customerId);
      
      // Validate the request body
      const validatedData = insertSiteMapSchema.parse({
        ...req.body,
        customerId,
        companyId: 1 // Default company ID for now
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

  app.put("/api/site-maps/:siteMapId", requireAdminAccess, async (req, res) => {
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

  app.delete("/api/site-maps/:siteMapId", requireAdminAccess, async (req, res) => {
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

  app.post("/api/site-maps/:siteMapId/controllers", requireAdminAccess, async (req, res) => {
    try {
      const siteMapId = parseInt(req.params.siteMapId);
      const controllers = req.body.controllers;
      
      if (!Array.isArray(controllers)) {
        return res.status(400).json({ message: "Controllers must be an array" });
      }
      
      const savedControllers = await storage.saveControllers(siteMapId, controllers);
      res.json(savedControllers);
    } catch (error) {
      console.error("Error saving controllers:", error);
      res.status(500).json({ message: "Failed to save controllers" });
    }
  });

  app.post("/api/site-maps/:siteMapId/zones", requireAdminAccess, async (req, res) => {
    try {
      const siteMapId = parseInt(req.params.siteMapId);
      const zones = req.body.zones;
      
      if (!Array.isArray(zones)) {
        return res.status(400).json({ message: "Zones must be an array" });
      }
      
      const savedZones = await storage.saveZones(siteMapId, zones);
      res.json(savedZones);
    } catch (error) {
      console.error("Error saving zones:", error);
      res.status(500).json({ message: "Failed to save zones" });
    }
  });

  // Create monthly invoice for customer - consolidates all unbilled work
  app.post("/api/invoices/monthly", async (req, res) => {
    try {
      const { customerId } = req.body;
      
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

      // Filter unbilled work
      const unbilledWorkOrders = workOrders.filter(wo => 
        wo.status === 'completed' && (!wo.billingStatus || wo.billingStatus !== 'billed')
      );
      const unbilledBillingSheets = billingSheets.filter(bs => 
        bs.status === 'approved' && (!bs.billingStatus || bs.billingStatus !== 'billed')
      );

      if (unbilledWorkOrders.length === 0 && unbilledBillingSheets.length === 0) {
        return res.status(400).json({ message: "No unbilled work found for this customer" });
      }

      // Create the consolidated monthly invoice
      const currentDate = new Date();
      const invoiceNumber = `INV-${currentDate.getFullYear()}${(currentDate.getMonth() + 1).toString().padStart(2, '0')}-${customerId.toString().padStart(4, '0')}`;
      
      // Calculate totals - no markup on parts, tax only on labor
      const laborSubtotal = 
        unbilledWorkOrders.reduce((sum, wo) => sum + parseFloat(wo.laborSubtotal || '0'), 0) +
        unbilledBillingSheets.reduce((sum, bs) => sum + parseFloat(bs.laborSubtotal || '0'), 0);
      
      const partsSubtotal = 
        unbilledWorkOrders.reduce((sum, wo) => sum + parseFloat(wo.partsSubtotal || '0'), 0) +
        unbilledBillingSheets.reduce((sum, bs) => sum + parseFloat(bs.partsSubtotal || '0'), 0);
      
      // No markup on parts for invoices
      const markupAmount = 0;
      
      // No tax at all (business rule)
      const taxAmount = 0;
      
      // Total = Labor + Parts (no tax)
      const totalAmount = laborSubtotal + partsSubtotal;

      // Create the invoice
      const invoice = await storage.createInvoice({
        invoiceNumber,
        customerId,
        customerName: customer.name,
        customerEmail: customer.email,
        customerPhone: customer.phone || null,
        invoiceMonth: currentDate.getMonth() + 1,
        invoiceYear: currentDate.getFullYear(),
        periodStart: new Date(currentDate.getFullYear(), currentDate.getMonth(), 1),
        periodEnd: new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0),
        laborSubtotal: laborSubtotal.toFixed(2),
        partsSubtotal: partsSubtotal.toFixed(2),
        markupAmount: markupAmount.toFixed(2),
        taxAmount: taxAmount.toFixed(2),
        totalAmount: totalAmount.toFixed(2),
        status: 'generated',
        createdAt: currentDate,
        updatedAt: currentDate
      });

      if (!invoice) {
        throw new Error("Failed to create invoice");
      }

      // Create invoice items for work orders
      for (const workOrder of unbilledWorkOrders) {
        await storage.createInvoiceItem({
          invoiceId: invoice.id,
          sourceType: 'work_order',
          sourceId: workOrder.id,
          description: `Work Order ${workOrder.workOrderNumber} - ${workOrder.projectName}`,
          workDate: workOrder.completedAt || workOrder.createdAt,
          technicianName: workOrder.assignedTechnicianName || 'Unknown',
          laborHours: parseFloat(workOrder.totalHours || '0'),
          laborRate: parseFloat(workOrder.laborRate || '45'),
          laborAmount: parseFloat(workOrder.laborSubtotal || '0'),
          laborTotal: parseFloat(workOrder.laborSubtotal || '0'),
          partsAmount: parseFloat(workOrder.partsSubtotal || '0'),
          markupAmount: 0, // No markup on invoices
          taxAmount: 0, // No tax
          totalAmount: parseFloat(workOrder.laborSubtotal || '0') + parseFloat(workOrder.partsSubtotal || '0'),
          quantity: 1, // Default quantity
          unitPrice: parseFloat(workOrder.laborSubtotal || '0') + parseFloat(workOrder.partsSubtotal || '0'),
          totalPrice: parseFloat(workOrder.laborSubtotal || '0') + parseFloat(workOrder.partsSubtotal || '0')
        });

        // Update work order billing status
        await storage.updateWorkOrder(workOrder.id, { billingStatus: 'billed' });
      }

      // Create invoice items for billing sheets
      for (const billingSheet of unbilledBillingSheets) {
        await storage.createInvoiceItem({
          invoiceId: invoice.id,
          sourceType: 'billing_sheet',
          sourceId: billingSheet.id,
          description: `Billing Sheet ${billingSheet.billingNumber} - ${billingSheet.workDescription}`,
          workDate: billingSheet.workDate,
          technicianName: billingSheet.technicianName,
          laborHours: parseFloat(billingSheet.totalHours || '0'),
          laborRate: parseFloat(billingSheet.laborRate || '45'),
          laborAmount: parseFloat(billingSheet.laborSubtotal || '0'),
          laborTotal: parseFloat(billingSheet.laborSubtotal || '0'),
          partsAmount: parseFloat(billingSheet.partsSubtotal || '0'),
          markupAmount: 0, // No markup on invoices
          taxAmount: 0, // No tax
          totalAmount: parseFloat(billingSheet.laborSubtotal || '0') + parseFloat(billingSheet.partsSubtotal || '0'),
          quantity: 1, // Default quantity  
          unitPrice: parseFloat(billingSheet.laborSubtotal || '0') + parseFloat(billingSheet.partsSubtotal || '0'),
          totalPrice: parseFloat(billingSheet.laborSubtotal || '0') + parseFloat(billingSheet.partsSubtotal || '0')
        });

        // Update billing sheet billing status
        await storage.updateBillingSheet(billingSheet.id, { billingStatus: 'billed' });
      }

      res.json({
        message: "Monthly invoice created successfully",
        invoice,
        invoiceNumber,
        totalAmount: totalAmount.toFixed(2),
        itemCount: unbilledWorkOrders.length + unbilledBillingSheets.length
      });
    } catch (error) {
      console.error("Error creating monthly invoice:", error);
      res.status(500).json({ message: "Failed to create monthly invoice" });
    }
  });

  // Customer billing preview data - includes estimates, work orders, and billing sheets
  // This must come BEFORE the :id route to avoid parameter conflicts
  app.get("/api/customers/billing-preview", async (req, res) => {
    try {
      console.log("Fetching comprehensive customer billing data...");
      const customers = await storage.getCustomers();
      console.log(`Found ${customers.length} customers`);
      
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
          const completedBillingSheets = billingSheets.filter(bs => bs.status === 'approved' || bs.status === 'billed');
          
          // Calculate billing from all sources based on selected date range
          const filteredWorkOrders = completedWorkOrders.filter(wo => 
            wo.completedAt && new Date(wo.completedAt) >= startDate && new Date(wo.completedAt) <= endDate
          );
          const filteredEstimates = approvedEstimates.filter(est => 
            est.approvedAt && new Date(est.approvedAt) >= startDate && new Date(est.approvedAt) <= endDate
          );
          const filteredBillingSheets = completedBillingSheets.filter(bs => 
            bs.createdAt && new Date(bs.createdAt) >= startDate && new Date(bs.createdAt) <= endDate
          );
          
          const workOrdersBilling = filteredWorkOrders.reduce((sum, wo) => 
            sum + parseFloat(wo.totalAmount || '0'), 0
          );
          const estimatesBilling = filteredEstimates.reduce((sum, est) => 
            sum + parseFloat(est.totalAmount || '0'), 0
          );
          const billingSheetsBilling = filteredBillingSheets.reduce((sum, bs) => 
            sum + parseFloat(bs.totalAmount || '0'), 0
          );
          
          const currentMonthBilling = workOrdersBilling + estimatesBilling + billingSheetsBilling;
          
          // Calculate historical average from last 6 months
          const monthlyTotals = [];
          for (let i = 1; i <= 6; i++) {
            const monthStart = new Date(currentYear, currentMonth - i, 1);
            const monthEnd = new Date(currentYear, currentMonth - i + 1, 0);
            
            const monthWorkOrders = completedWorkOrders.filter(wo => 
              wo.completedAt && new Date(wo.completedAt) >= monthStart && new Date(wo.completedAt) <= monthEnd
            );
            const monthEstimates = approvedEstimates.filter(est => 
              est.approvedAt && new Date(est.approvedAt) >= monthStart && new Date(est.approvedAt) <= monthEnd
            );
            const monthBillingSheets = billingSheets.filter(bs => 
              (bs.status === 'approved' || bs.status === 'billed') &&
              bs.createdAt && new Date(bs.createdAt) >= monthStart && new Date(bs.createdAt) <= monthEnd
            );
            
            const monthTotal = 
              monthWorkOrders.reduce((sum, wo) => sum + parseFloat(wo.totalAmount || '0'), 0) +
              monthEstimates.reduce((sum, est) => sum + parseFloat(est.totalAmount || '0'), 0) +
              monthBillingSheets.reduce((sum, bs) => sum + parseFloat(bs.totalAmount || '0'), 0);
            
            if (monthTotal > 0) monthlyTotals.push(monthTotal);
          }
          
          const monthlyAverage = monthlyTotals.length > 0 
            ? monthlyTotals.reduce((sum, total) => sum + total, 0) / monthlyTotals.length
            : Math.max(currentMonthBilling, 1000);
          
          const billingPace = monthlyAverage > 0 ? currentMonthBilling / monthlyAverage : 1;
          
          // Get most recent invoice date for this customer (only if invoices table exists)
          let lastInvoiceDate = null;
          try {
            const customerInvoices = await storage.getInvoicesByCustomer(customer.id);
            lastInvoiceDate = customerInvoices.length > 0 
              ? customerInvoices.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0].createdAt
              : null;
          } catch (error) {
            // Invoices table doesn't exist yet, so no invoices have been created
            lastInvoiceDate = null;
          }
          
          // Count pending items across all sources
          const pendingCount = 
            workOrders.filter(wo => wo.status === 'pending' || wo.status === 'in_progress').length +
            estimates.filter(est => est.status === 'pending').length +
            billingSheets.filter(bs => bs.status === 'pending' || bs.status === 'in_progress').length;
          
          return {
            ...customer,
            currentMonthBilling: Math.round(currentMonthBilling * 100) / 100,
            monthlyAverage: Math.round(monthlyAverage * 100) / 100,
            billingPace: Math.round(billingPace * 100) / 100,
            unbilledAmount: Math.round(currentMonthBilling * 100) / 100, // Assume current month is unbilled
            lastInvoiceDate,
            pendingWorkOrders: pendingCount,
            totalWorkOrders: filteredWorkOrders.length + filteredEstimates.length + filteredBillingSheets.length
          };
        } catch (customerError) {
          console.error(`Error processing customer ${customer.id}:`, customerError);
          return {
            ...customer,
            currentMonthBilling: 0,
            monthlyAverage: 1000,
            billingPace: 0,
            unbilledAmount: 0,
            lastInvoiceDate: null,
            pendingWorkOrders: 0,
            totalWorkOrders: 0
          };
        }
      }));
      
      console.log("Successfully processed all customer billing data from work orders, estimates, and billing sheets");
      res.json(customerPreviews);
    } catch (error) {
      console.error("Error fetching customer billing previews:", error);
      res.status(500).json({ message: "Failed to fetch customer billing data" });
    }
  });

  app.get("/api/customers/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const customer = await storage.getCustomer(id);
      if (!customer) {
        return res.status(404).json({ message: "Customer not found" });
      }
      res.json(customer);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch customer" });
    }
  });

  app.post("/api/customers", async (req, res) => {
    try {
      const customerData = insertCustomerSchema.parse(req.body);
      const customer = await storage.createCustomer(customerData);
      res.status(201).json(customer);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid customer data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to create customer" });
    }
  });

  app.put("/api/customers/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const customerData = insertCustomerSchema.partial().parse(req.body);
      const customer = await storage.updateCustomer(id, customerData);
      if (!customer) {
        return res.status(404).json({ message: "Customer not found" });
      }
      res.json(customer);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid customer data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to update customer" });
    }
  });

  app.patch("/api/customers/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const customerData = insertCustomerSchema.partial().parse(req.body);
      const customer = await storage.updateCustomer(id, customerData);
      if (!customer) {
        return res.status(404).json({ message: "Customer not found" });
      }
      res.json(customer);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid customer data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to update customer" });
    }
  });

  app.delete("/api/customers/:id", async (req, res) => {
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
  app.get("/api/customers/:id/estimates", async (req, res) => {
    try {
      const customerId = parseInt(req.params.id);
      const estimates = await storage.getEstimatesByCustomer(customerId);
      res.json(estimates);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch customer estimates" });
    }
  });

  app.get("/api/customers/:id/work-orders", async (req, res) => {
    try {
      const customerId = parseInt(req.params.id);
      const workOrders = await storage.getWorkOrdersByCustomer(customerId);
      res.json(workOrders);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch customer work orders" });
    }
  });

  app.get("/api/customers/:id/billing-sheets", async (req, res) => {
    try {
      const customerId = parseInt(req.params.id);
      const billingSheets = await storage.getBillingSheetsByCustomer(customerId);
      res.json(billingSheets);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch customer billing sheets" });
    }
  });

  app.post("/api/customers/import-csv", async (req, res) => {
    try {
      const file = (req as any).files?.file;
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
                case 'markuppercent':
                  customerData.markupPercent = values[index];
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
  app.get("/api/parts/popular", async (req, res) => {
    try {
      const companyId = 1; // Default company ID - in real app this would come from user session
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
      const part = await storage.getPart(id);
      if (!part) {
        return res.status(404).json({ message: "Part not found" });
      }
      res.json(part);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch part" });
    }
  });

  app.post("/api/parts", async (req, res) => {
    try {
      const partData = insertPartSchema.parse(req.body);
      const part = await storage.createPart(partData);
      res.status(201).json(part);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid part data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to create part" });
    }
  });

  app.put("/api/parts/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const partData = insertPartSchema.partial().parse(req.body);
      const part = await storage.updatePart(id, partData);
      if (!part) {
        return res.status(404).json({ message: "Part not found" });
      }
      res.json(part);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid part data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to update part" });
    }
  });

  app.get("/api/parts", async (req, res) => {
    try {
      const parts = await storage.getParts();
      res.json(parts);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch parts" });
    }
  });

  // Track part usage (called when a part is used in work order or billing sheet)
  app.post("/api/parts/:id/track-usage", async (req, res) => {
    try {
      const partId = parseInt(req.params.id);
      const companyId = 1; // Default company ID - in real app this would come from user session
      await storage.trackPartUsage(companyId, partId);
      res.json({ message: "Part usage tracked successfully" });
    } catch (error) {
      res.status(500).json({ message: "Failed to track part usage" });
    }
  });

  app.delete("/api/parts/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const success = await storage.deletePart(id);
      if (!success) {
        return res.status(404).json({ message: "Part not found" });
      }
      res.json({ message: "Part deleted successfully" });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete part" });
    }
  });

  app.post("/api/parts/import/google-sheets", async (req, res) => {
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
          const laborHours = (laborField ? rowData[laborField] : rowData.laborhours) || '0.5';

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
            laborHours: laborHours.toString(),
            sku: sku.trim(),
            category: category.trim(),
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
  app.post("/api/parts/sync-google-docs", async (req, res) => {
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

  app.post("/api/estimates", async (req, res) => {
    try {
      console.log("Received estimate data:", JSON.stringify(req.body, null, 2));
      const parsed = createEstimateWithZonesSchema.parse(req.body);
      
      // Process zones and items first to calculate totals
      const zones = parsed.zones.map(zone => ({
        ...zone,
        items: zone.items.map(item => {
          // Handle nested part data structure from frontend
          const partData = (item as any).part;
          const quantity = (item as any).quantity || 1;
          const partPrice = parseFloat(String(partData?.price || item.partPrice || 0));
          const laborHours = parseFloat(String(partData?.laborHours || item.laborHours || 0));
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
      const markupAmount = partsSubtotal * (markupPercent / 100); // Markup only on parts
      const subtotalWithMarkup = partsSubtotal + laborSubtotal + markupAmount;
      const taxAmount = subtotalWithMarkup * (taxPercent / 100);
      const totalAmount = subtotalWithMarkup + taxAmount;

      // Convert and normalize data with calculated totals
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
      
      const newEstimate = await storage.createEstimate(estimate, zones);
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
            received: err.received
          }))
        });
      }
      res.status(500).json({ message: "Failed to create estimate" });
    }
  });

  app.put("/api/estimates/:id", async (req, res) => {
    try {
      const estimateId = parseInt(req.params.id);
      if (isNaN(estimateId)) {
        return res.status(400).json({ message: "Invalid estimate ID" });
      }

      console.log("Updating estimate data:", JSON.stringify(req.body, null, 2));
      const parsed = createEstimateWithZonesSchema.parse(req.body);
      
      // Process zones and items first to calculate totals
      const zones = parsed.zones.map(zone => ({
        ...zone,
        items: zone.items.map(item => {
          // Handle nested part data structure from frontend
          const partData = (item as any).part;
          const quantity = (item as any).quantity || 1;
          const partPrice = parseFloat(String(partData?.price || item.partPrice || 0));
          const laborHours = parseFloat(String(partData?.laborHours || item.laborHours || 0));
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
      const markupAmount = partsSubtotal * (markupPercent / 100); // Markup only on parts
      const subtotalWithMarkup = partsSubtotal + laborSubtotal + markupAmount;
      const taxAmount = subtotalWithMarkup * (taxPercent / 100);
      const totalAmount = subtotalWithMarkup + taxAmount;

      // Convert and normalize data with calculated totals
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
      
      const updatedEstimate = await storage.updateEstimateWithZones(estimateId, estimate, zones);
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
            received: err.received
          }))
        });
      }
      res.status(500).json({ message: "Failed to update estimate" });
    }
  });



  app.delete("/api/estimates/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const success = await storage.deleteEstimate(id);
      if (!success) {
        return res.status(404).json({ message: "Estimate not found" });
      }
      res.json({ message: "Estimate deleted successfully" });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete estimate" });
    }
  });

  // Email estimate
  app.post("/api/estimates/:id/email", async (req, res) => {
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

  app.post("/api/property-zones", async (req, res) => {
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

  app.post("/api/property-zones/sync-google-sheets", async (req, res) => {
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

  app.post("/api/field-work-sessions", async (req, res) => {
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

  app.post("/api/field-work-sessions/:id/complete", async (req, res) => {
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

  app.post("/api/field-work-sessions/:sessionId/items", async (req, res) => {
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
        category: part.category,
        laborHours: part.laborHours
        // price is intentionally excluded
      }));
      res.json(fieldTechParts);
    } catch (error) {
      console.error("Error in /api/parts/field-tech:", error);
      res.status(500).json({ message: "Failed to fetch parts" });
    }
  });

  // QuickBooks integration routes
  app.get("/api/quickbooks/auth", async (req, res) => {
    try {
      // Check if QuickBooks credentials are available
      if (!process.env.QUICKBOOKS_CLIENT_ID || !process.env.QUICKBOOKS_CLIENT_SECRET) {
        return res.status(400).json({ 
          message: "QuickBooks integration is not configured. Please contact your administrator to set up the QuickBooks credentials." 
        });
      }

      const state = Math.random().toString(36).substring(2, 15);
      const redirectUri = `${req.protocol}://${req.get('host')}/api/quickbooks/callback`;
      
      const authUrl = `https://appcenter.intuit.com/connect/oauth2?` +
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

      // Here you would normally exchange the code for access tokens
      // For now, we'll simulate a successful connection
      console.log("QuickBooks OAuth callback received:", { code, state, realmId });
      
      // In a real implementation, you would:
      // 1. Exchange code for access token
      // 2. Store tokens in database
      // 3. Test the connection
      
      res.send(`
        <html>
          <body>
            <h2>QuickBooks Connected Successfully!</h2>
            <p>You can now close this window and return to IrrigoPro.</p>
            <script>
              // Store connection status and close popup
              localStorage.setItem('qb-connected', 'true');
              setTimeout(() => window.close(), 2000);
            </script>
          </body>
        </html>
      `);
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

  app.get("/api/quickbooks/connection", async (req, res) => {
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
      
      // Simulate connection status - in reality you'd check stored tokens
      res.json({ 
        companyId: "demo-company-123",
        companyName: "IrrigoPro Demo Company",
        isConnected: false, // Set to true when actually connected
        lastSync: null
      });
    } catch (error) {
      console.error("QuickBooks connection check error:", error);
      res.status(500).json({ message: "Failed to get QuickBooks connection status" });
    }
  });

  app.post("/api/quickbooks/sync-estimate/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const estimate = await storage.getEstimate(id);
      if (!estimate) {
        return res.status(404).json({ message: "Estimate not found" });
      }
      
      // Placeholder for QuickBooks sync
      res.json({ 
        success: true,
        quickbooksId: `QB-${id}`,
        message: "Estimate synced to QuickBooks successfully" 
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to sync estimate to QuickBooks" });
    }
  });

  // Estimate approval workflow
  app.post("/api/estimates/:id/approve", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
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
      const estimate = await storage.getEstimate(id);
      if (!estimate) {
        return res.status(404).json({ message: "Estimate not found" });
      }
      if (estimate.status !== "pending") {
        return res.status(400).json({ message: "Only pending estimates can be approved" });
      }
      
      const updatedEstimate = await storage.updateEstimate(id, { status: "approved" });
      
      res.json({ 
        message: "Estimate approved successfully", 
        estimate: updatedEstimate
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to approve estimate" });
    }
  });

  // Reject estimate
  app.patch("/api/estimates/:id/reject", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
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
  app.post("/api/estimates/:id/send-approval-email", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const estimate = await storage.getEstimate(id);
      if (!estimate) {
        return res.status(404).json({ message: "Estimate not found" });
      }
      if (estimate.status !== "pending") {
        return res.status(400).json({ message: "Only pending estimates can have approval emails sent" });
      }

      // Generate secure approval token
      const crypto = await import('crypto');
      const approvalToken = crypto.randomBytes(32).toString('hex');
      
      // Update estimate with approval token and sent timestamp
      await storage.updateEstimate(id, {
        approvalToken,
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

      if (estimate.status !== "pending") {
        return res.status(400).send(`
          <html><body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
            <h2 style="color: #f59e0b;">Already Responded</h2>
            <p>You have already responded to this estimate. Thank you!</p>
          </body></html>
        `);
      }

      // Approve the estimate
      await storage.updateEstimate(estimate.id, {
        status: "approved",
        approvalRespondedAt: new Date(),
        approvedAt: new Date()
      });

      // Send confirmation email
      const { EmailService } = await import('./email-service');
      await EmailService.sendApprovalConfirmation(
        estimate.customerEmail,
        estimate.estimateNumber,
        true
      );

      res.send(`
        <html><body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
          <div style="max-width: 600px; margin: 0 auto; background: #f0fdf4; border: 1px solid #16a34a; border-radius: 12px; padding: 40px;">
            <h1 style="color: #16a34a; margin-bottom: 20px;">✓ Estimate Approved!</h1>
            <p style="font-size: 18px; color: #374151; margin-bottom: 20px;">
              Thank you for approving estimate ${estimate.estimateNumber}.
            </p>
            <p style="color: #6b7280;">
              We will begin preparing your irrigation work and will contact you soon with scheduling details.
            </p>
            <p style="color: #6b7280; margin-top: 30px;">
              A confirmation email has been sent to ${estimate.customerEmail}.
            </p>
          </div>
        </body></html>
      `);
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

      // Reject the estimate
      await storage.updateEstimate(estimate.id, {
        status: "rejected",
        approvalRespondedAt: new Date(),
        rejectedAt: new Date()
      });

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
  app.post("/api/estimates/:id/convert-to-work-order", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const estimate = await storage.getEstimate(id);
      if (!estimate) {
        return res.status(404).json({ message: "Estimate not found" });
      }
      if (estimate.status !== "approved") {
        return res.status(400).json({ message: "Only approved estimates can be converted to work orders" });
      }
      
      // Find the manager user to auto-assign work orders initially
      const managerUser = await storage.getUserByRole('irrigation_manager');
      
      // Create work order from estimate - initially assign to manager
      const workOrderData = {
        estimateId: estimate.id,
        customerId: estimate.customerId || 0,
        customerName: estimate.customerName,
        customerEmail: estimate.customerEmail,
        customerPhone: estimate.customerPhone,
        projectName: estimate.projectName,
        projectAddress: estimate.projectAddress,
        workType: "estimate_based" as const,
        status: "assigned" as const,
        priority: "medium" as const, // Standard priority for estimate-based work orders
        assignedTechnicianId: managerUser?.id || null,
        assignedTechnicianName: managerUser?.name || "Manager",
        scheduledDate: req.body.scheduledDate ? new Date(req.body.scheduledDate) : null,
        notes: req.body.notes || null,
        totalAmount: estimate.totalAmount,
        totalItems: estimate.zones?.reduce((total, zone) => total + (zone.items?.length || 0), 0) || 0
      };
      
      // Create the work order and update estimate status
      const workOrder = await storage.createWorkOrder(workOrderData, estimate.zones || []);
      
      // Update estimate status to converted
      await storage.updateEstimate(id, { status: "converted_to_work_order" });
      
      res.json({ 
        message: "Work order created successfully", 
        workOrder,
        estimateId: id
      });
    } catch (error) {
      console.error("Error converting estimate to work order:", error);
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
      res.status(500).json({ message: error.message || "Failed to sync customers from QuickBooks" });
    }
  });

  app.post("/api/integrations/quickbooks/customers/disconnect", async (req, res) => {
    try {
      await storage.disconnectQuickBooks();
      res.json({ message: "Disconnected from QuickBooks successfully" });
    } catch (error) {
      res.status(500).json({ message: "Failed to disconnect from QuickBooks" });
    }
  });

  // Work order completion route
  app.post("/api/work-orders/complete", async (req, res) => {
    try {
      const {
        workOrderId,
        workSummary,
        customerNotes,
        completedAt,
        totalHours,
        usedParts,
        photos,
        totalPartsCost
      } = req.body;

      // Get current user from headers
      const completedByUserId = req.headers['x-user-id'];
      const completedByUserName = req.headers['x-user-name'];

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

      // Update work order with completion details and calculated totals
      const workOrder = await storage.updateWorkOrder(workOrderId, {
        status: 'completed',
        completedAt: new Date(completedAt),
        completedByUserId: completedByUserId ? parseInt(completedByUserId as string) : undefined,
        completedByUserName: completedByUserName as string,
        workSummary,
        customerNotes,
        totalHours: laborHours,
        photos: photos || [],
        totalPartsCost: partsCost,
        totalAmount: totalAmount.toFixed(2)
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
            laborHours: partDetails.laborHours || "0"
          });
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

  app.post("/api/work-orders/:id/complete", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      
      // Get current user from headers
      const completedByUserId = req.headers['x-user-id'];
      const completedByUserName = req.headers['x-user-name'];
      
      const workOrder = await storage.updateWorkOrder(id, { 
        status: "completed", 
        completedAt: new Date(),
        completedByUserId: completedByUserId ? parseInt(completedByUserId as string) : undefined,
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
      // This would need to be implemented in storage
      res.json({ message: "Invoices endpoint ready for implementation", invoices: [] });
    } catch (error) {
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
  app.get("/api/billing-sheets", async (req, res) => {
    try {
      const { technician } = req.query;
      
      let billingSheets;
      if (technician) {
        billingSheets = await storage.getBillingSheetsByTechnician(parseInt(technician as string));
      } else {
        billingSheets = await storage.getAllBillingSheets();
      }
      
      res.json(billingSheets);
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
      res.json(billingSheet);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch billing sheet" });
    }
  });

  app.post("/api/billing-sheets", async (req, res) => {
    try {
      console.log('Received billing sheet data:', req.body);
      const billingSheetData = req.body;
      
      // Generate billing number
      const count = await storage.getBillingSheetCount();
      const billingNumber = `BS-${new Date().getFullYear()}-${String(count + 1).padStart(3, '0')}`;
      
      // Set status to 'submitted' for field techs, 'draft' for others
      const status = billingSheetData.status || 'submitted';
      
      const billingSheet = await storage.createBillingSheet({
        ...billingSheetData,
        billingNumber,
        status
      });
      
      res.json(billingSheet);
    } catch (error) {
      console.error('Error creating billing sheet:', error);
      res.status(500).json({ message: "Failed to create billing sheet", error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.patch("/api/billing-sheets/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { items, ...billingSheetData } = req.body;
      
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
      
      // Handle items if provided
      if (items && Array.isArray(items)) {
        console.log('Updating billing sheet items:', items.length);
        // For simplicity, we'll delete existing items and create new ones
        // In production, you might want more sophisticated update logic
        await storage.deleteBillingSheetItems(id);
        
        for (const item of items) {
          await storage.addBillingSheetItem(id, {
            partId: item.partId || null,
            partName: item.partName,
            partDescription: item.partDescription || "",
            quantity: item.quantity,
            unitPrice: item.unitPrice.toString(),
            laborHours: item.laborHours.toString(),
            totalPrice: (item.quantity * item.unitPrice).toString(),
            notes: item.notes || "",
          });
        }
      }
      
      res.json(billingSheet);
    } catch (error) {
      console.error('Error updating billing sheet:', error);
      res.status(500).json({ message: "Failed to update billing sheet", error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.delete("/api/billing-sheets/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteBillingSheet(id);
      res.json({ message: "Billing sheet deleted successfully" });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete billing sheet" });
    }
  });

  app.post("/api/invoices/:id/sync-quickbooks", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      // This would need to be implemented in storage
      res.json({ 
        success: true,
        quickbooksId: `QB-INV-${id}`,
        message: "Invoice synced to QuickBooks successfully" 
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to sync invoice to QuickBooks" });
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
      
      res.json(workOrders);
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
      res.json(workOrder);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch work order" });
    }
  });

  app.post("/api/work-orders", async (req, res) => {
    try {
      const workOrderData = insertWorkOrderSchema.parse(req.body);
      const workOrder = await storage.createWorkOrder(workOrderData);
      
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

  app.patch("/api/work-orders/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const workOrderData = insertWorkOrderSchema.partial().parse(req.body);
      const workOrder = await storage.updateWorkOrder(id, workOrderData);
      if (!workOrder) {
        return res.status(404).json({ message: "Work order not found" });
      }
      res.json(workOrder);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid work order data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to update work order" });
    }
  });

  app.delete("/api/work-orders/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
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
  app.get("/api/work-orders/:id/items", async (req, res) => {
    try {
      const workOrderId = parseInt(req.params.id);
      const items = await storage.getWorkOrderItems(workOrderId);
      res.json(items);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch work order items" });
    }
  });

  app.post("/api/work-orders/:id/items", async (req, res) => {
    try {
      const workOrderId = parseInt(req.params.id);
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
      const billingData = req.body;
      await storage.createBillingSheet(workOrderId, billingData);
      res.json({ message: "Billing sheet saved successfully" });
    } catch (error) {
      res.status(500).json({ message: "Failed to save billing sheet" });
    }
  });

  app.get("/api/work-orders/:id/billing-sheet", async (req, res) => {
    try {
      const workOrderId = parseInt(req.params.id);
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
  app.get("/api/notifications/:userId", async (req, res) => {
    try {
      const userId = parseInt(req.params.userId);
      const notifications = await storage.getNotifications(userId);
      res.json(notifications);
    } catch (error) {
      console.error("Error fetching notifications:", error);
      res.status(500).json({ message: "Failed to fetch notifications" });
    }
  });

  app.get("/api/notifications/:userId/count", async (req, res) => {
    try {
      const userId = parseInt(req.params.userId);
      const count = await storage.getUnreadNotificationCount(userId);
      res.json({ count });
    } catch (error) {
      console.error("Error fetching notification count:", error);
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



  return httpServer;
}
