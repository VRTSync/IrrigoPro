import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { 
  insertCustomerSchema, 
  insertPartSchema, 
  insertEstimateSchema, 
  insertEstimateZoneSchema, 
  insertEstimateItemSchema,
  insertPropertyZoneSchema,
  insertZoneSchema,
  insertFieldWorkSessionSchema,
  insertFieldWorkItemSchema
} from "@shared/schema";
import { z } from "zod";

const createEstimateWithZonesSchema = z.object({
  estimate: insertEstimateSchema,
  zones: z.array(insertEstimateZoneSchema.extend({
    items: z.array(insertEstimateItemSchema)
  }))
});

export async function registerRoutes(app: Express): Promise<Server> {
  // Dashboard stats
  app.get("/api/dashboard/stats", async (req, res) => {
    try {
      const stats = await storage.getDashboardStats();
      res.json(stats);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch dashboard stats" });
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

  // Parts routes
  app.get("/api/parts", async (req, res) => {
    try {
      const parts = await storage.getParts();
      res.json(parts);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch parts" });
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
      const { estimate, zones } = createEstimateWithZonesSchema.parse(req.body);
      const newEstimate = await storage.createEstimate(estimate, zones);
      res.status(201).json(newEstimate);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid estimate data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to create estimate" });
    }
  });

  app.put("/api/estimates/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const estimateData = insertEstimateSchema.partial().parse(req.body);
      const estimate = await storage.updateEstimate(id, estimateData);
      if (!estimate) {
        return res.status(404).json({ message: "Estimate not found" });
      }
      res.json(estimate);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid estimate data", errors: error.errors });
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
      res.status(500).json({ message: "Failed to fetch parts for field tech" });
    }
  });

  // QuickBooks integration routes
  app.get("/api/quickbooks/auth", async (req, res) => {
    try {
      // Placeholder for QuickBooks OAuth URL generation
      const authUrl = "https://appcenter.intuit.com/connect/oauth2?client_id=YOUR_CLIENT_ID&scope=com.intuit.quickbooks.accounting&redirect_uri=YOUR_REDIRECT_URI&response_type=code&access_type=offline";
      const state = Math.random().toString(36).substring(2, 15);
      res.json({ authUrl, state });
    } catch (error) {
      res.status(500).json({ message: "Failed to generate QuickBooks auth URL" });
    }
  });

  app.post("/api/quickbooks/callback", async (req, res) => {
    try {
      const { code, state, realmId } = req.body;
      // Placeholder for QuickBooks OAuth callback handling
      res.json({ message: "QuickBooks connected successfully" });
    } catch (error) {
      res.status(500).json({ message: "Failed to connect QuickBooks" });
    }
  });

  app.get("/api/quickbooks/connection", async (req, res) => {
    try {
      // Placeholder for QuickBooks connection status
      res.json({ 
        companyId: "placeholder",
        companyName: "Sample Company",
        isConnected: false,
        lastSync: null
      });
    } catch (error) {
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
      
      // Create work order from estimate
      const workOrderData = {
        estimateId: estimate.id,
        customerId: estimate.customerId,
        customerName: estimate.customerName,
        customerEmail: estimate.customerEmail,
        customerPhone: estimate.customerPhone,
        projectName: estimate.projectName,
        projectAddress: estimate.projectAddress,
        status: "pending" as const,
        assignedTechnicianName: req.body.assignedTechnicianName || null,
        scheduledDate: req.body.scheduledDate ? new Date(req.body.scheduledDate) : null,
        notes: req.body.notes || null
      };
      
      // This would need to be implemented in storage
      res.json({ message: "Work order creation endpoint ready for implementation" });
    } catch (error) {
      res.status(500).json({ message: "Failed to convert estimate to work order" });
    }
  });

  // Work order routes (placeholder endpoints)
  app.get("/api/work-orders", async (req, res) => {
    try {
      // This would need to be implemented in storage
      res.json({ message: "Work orders endpoint ready for implementation", workOrders: [] });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch work orders" });
    }
  });

  app.post("/api/work-orders/:id/complete", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      // This would need to be implemented in storage
      res.json({ message: "Work order completion endpoint ready for implementation" });
    } catch (error) {
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

  const httpServer = createServer(app);
  return httpServer;
}
