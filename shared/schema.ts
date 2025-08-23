import { pgTable, text, serial, integer, boolean, decimal, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Companies table for multi-company support
export const companies = pgTable("companies", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  address: text("address"),
  phone: text("phone"),
  email: text("email"),
  website: text("website"),
  logo: text("logo"), // Logo URL or path
  subscription: text("subscription").notNull().default("basic"), // basic, pro, enterprise
  subscriptionExpiry: timestamp("subscription_expiry"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Users table for authentication with company support
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  name: text("name").notNull(),
  email: text("email"),
  role: text("role").notNull().default("field_tech"), // super_admin, company_admin, irrigation_manager, field_tech, billing_manager
  companyId: integer("company_id").references(() => companies.id), // null for super_admin
  isActive: boolean("is_active").notNull().default(true),
  isDeleted: boolean("is_deleted").notNull().default(false), // Soft delete flag
  deletedAt: timestamp("deleted_at"), // When user was deleted
  // Email verification fields
  emailVerified: boolean("email_verified").notNull().default(false),
  emailVerificationToken: text("email_verification_token"),
  emailVerificationExpires: timestamp("email_verification_expires"),
  // Password reset fields
  passwordResetToken: text("password_reset_token"),
  passwordResetExpires: timestamp("password_reset_expires"),
  // Multi-Factor Authentication fields
  mfaEnabled: boolean("mfa_enabled").notNull().default(false),
  mfaSecret: text("mfa_secret"),
  mfaBackupCodes: text("mfa_backup_codes"), // JSON array of backup codes
  mfaLastUsed: timestamp("mfa_last_used"),
  // Timestamps
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const customers = pgTable("customers", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companies.id).notNull(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  phone: text("phone"),
  address: text("address"),
  // Irrigation system details
  totalControllers: integer("total_controllers").default(1), // Number of controllers (1-10)
  // Contract-based billing rates
  contractType: text("contract_type").default("standard"), // standard, premium, commercial, residential
  laborRate: decimal("labor_rate", { precision: 10, scale: 2 }).default("45.00"),
  markupPercent: decimal("markup_percent", { precision: 5, scale: 2 }).default("20.00"),
  taxPercent: decimal("tax_percent", { precision: 5, scale: 2 }).default("8.25"),
  discountPercent: decimal("discount_percent", { precision: 5, scale: 2 }).default("0.00"),
  // Contract details
  contractStartDate: timestamp("contract_start_date"),
  contractEndDate: timestamp("contract_end_date"),
  paymentTerms: text("payment_terms").default("net_30"), // net_30, net_15, due_on_receipt
  notes: text("notes"),
  propertyNotes: text("property_notes"), // Property-specific notes for technicians
  quickbooksId: text("quickbooks_id"), // QuickBooks customer ID for integration
});

// Site maps and controller management
export const siteMaps = pgTable("site_maps", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companies.id).notNull(),
  customerId: integer("customer_id").references(() => customers.id),
  name: text("name").notNull(),
  description: text("description"),
  kmlFile: text("kml_file"), // Path to uploaded KML file
  kmlData: text("kml_data"), // Parsed KML content as JSON
  centerLat: decimal("center_lat", { precision: 10, scale: 7 }),
  centerLng: decimal("center_lng", { precision: 10, scale: 7 }),
  zoomLevel: integer("zoom_level").default(15),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const controllers = pgTable("controllers", {
  id: serial("id").primaryKey(),
  siteMapId: integer("site_map_id").references(() => siteMaps.id),
  companyId: integer("company_id").references(() => companies.id).notNull(),
  customerId: integer("customer_id").references(() => customers.id),
  name: text("name").notNull(),
  model: text("model"),
  serialNumber: text("serial_number"),
  latitude: decimal("latitude", { precision: 10, scale: 7 }).notNull(),
  longitude: decimal("longitude", { precision: 10, scale: 7 }).notNull(),
  stationCount: integer("station_count").default(8),
  installDate: timestamp("install_date"),
  notes: text("notes"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const irrigationZones = pgTable("irrigation_zones", {
  id: serial("id").primaryKey(),
  controllerId: integer("controller_id").references(() => controllers.id),
  siteMapId: integer("site_map_id").references(() => siteMaps.id),
  companyId: integer("company_id").references(() => companies.id).notNull(),
  customerId: integer("customer_id").references(() => customers.id),
  name: text("name").notNull(),
  stationNumber: integer("station_number").notNull(),
  zoneType: text("zone_type").default("sprinkler"), // sprinkler, drip, bubbler
  coverage: text("coverage"), // area description
  boundaries: text("boundaries"), // GeoJSON polygon data
  runtime: integer("runtime").default(15), // minutes
  flowRate: decimal("flow_rate", { precision: 8, scale: 2 }), // GPM
  pressure: decimal("pressure", { precision: 8, scale: 2 }), // PSI
  notes: text("notes"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const utilityMarkers = pgTable("utility_markers", {
  id: serial("id").primaryKey(),
  siteMapId: integer("site_map_id").references(() => siteMaps.id),
  companyId: integer("company_id").references(() => companies.id).notNull(),
  customerId: integer("customer_id").references(() => customers.id),
  name: text("name").notNull(),
  markerType: text("marker_type").default("utility"), // utility, splice, waste, etc.
  latitude: decimal("latitude", { precision: 10, scale: 8 }).notNull(),
  longitude: decimal("longitude", { precision: 11, scale: 8 }).notNull(),
  description: text("description"),
  notes: text("notes"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Schema types for the new tables
export const insertSiteMapSchema = createInsertSchema(siteMaps);
export const insertControllerSchema = createInsertSchema(controllers);
export const insertIrrigationZoneSchema = createInsertSchema(irrigationZones);
export const insertUtilityMarkerSchema = createInsertSchema(utilityMarkers);

export type SiteMap = typeof siteMaps.$inferSelect;
export type Controller = typeof controllers.$inferSelect;
export type IrrigationZone = typeof irrigationZones.$inferSelect;
export type UtilityMarker = typeof utilityMarkers.$inferSelect;

export type InsertUtilityMarker = z.infer<typeof insertUtilityMarkerSchema>;

export const parts = pgTable("parts", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companies.id).notNull(),
  name: text("name").notNull(),
  description: text("description"),
  price: decimal("price", { precision: 10, scale: 2 }).notNull(),
  cost: decimal("cost", { precision: 10, scale: 2 }),
  laborHours: decimal("labor_hours", { precision: 5, scale: 2 }).notNull(),
  sku: text("sku").notNull(),
  // Enhanced categorization based on your irrigation parts structure
  category: text("category").notNull(), // Main category: Backflow, Bushing, Controller, etc.
  material: text("material"), // PVC, Copper, Brass, NETAFIM, etc.
  size: text("size"), // 1", 1.5", 2", etc.
  brand: text("brand"), // Hunter, Febco, Rainbird, LEIT, etc.
  fittingType: text("fitting_type"), // 90° Coupler, Tee, Union, Cap, etc.
  detail: text("detail"), // Additional specifications like "Pressure Vacuum Breaker"
  quickbooksId: text("quickbooks_id"), // QuickBooks item ID for integration
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Standalone billing sheets for work without work orders
export const billingSheets = pgTable("billing_sheets", {
  id: serial("id").primaryKey(),
  billingNumber: text("billing_number").notNull().unique(),
  customerId: integer("customer_id").references(() => customers.id),
  customerName: text("customer_name").notNull(),
  propertyAddress: text("property_address").notNull(),
  workDate: timestamp("work_date").notNull(),
  technicianName: text("technician_name").notNull(),
  technicianId: integer("technician_id").references(() => users.id),
  workDescription: text("work_description").notNull(),
  status: text("status").notNull().default("draft"), // draft, submitted, approved, billed
  totalHours: decimal("total_hours", { precision: 5, scale: 2 }).notNull(),
  laborRate: decimal("labor_rate", { precision: 10, scale: 2 }).notNull(),
  laborSubtotal: decimal("labor_subtotal", { precision: 10, scale: 2 }).notNull(),
  partsSubtotal: decimal("parts_subtotal", { precision: 10, scale: 2 }).notNull(),
  markupAmount: decimal("markup_amount", { precision: 10, scale: 2 }).notNull(),
  taxAmount: decimal("tax_amount", { precision: 10, scale: 2 }).notNull(),
  totalAmount: decimal("total_amount", { precision: 10, scale: 2 }).notNull(),
  photos: text("photos").array().default([]),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Items used in standalone billing sheets
export const billingSheetItems = pgTable("billing_sheet_items", {
  id: serial("id").primaryKey(),
  billingSheetId: integer("billing_sheet_id").references(() => billingSheets.id),
  partId: integer("part_id").references(() => parts.id),
  partName: text("part_name").notNull(),
  partDescription: text("part_description"),
  quantity: decimal("quantity", { precision: 10, scale: 2 }).notNull(),
  unitPrice: decimal("unit_price", { precision: 10, scale: 2 }).notNull(),
  totalPrice: decimal("total_price", { precision: 10, scale: 2 }).notNull(),
  laborHours: decimal("labor_hours", { precision: 5, scale: 2 }).notNull(),
  notes: text("notes"),
});

// Part usage tracking for frequently used parts
export const partUsage = pgTable("part_usage", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companies.id).notNull(),
  partId: integer("part_id").references(() => parts.id).notNull(),
  usageCount: integer("usage_count").notNull().default(0),
  lastUsedAt: timestamp("last_used_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const estimates = pgTable("estimates", {
  id: serial("id").primaryKey(),
  estimateNumber: text("estimate_number").notNull().unique(),
  customerId: integer("customer_id").references(() => customers.id),
  customerName: text("customer_name").notNull(),
  customerEmail: text("customer_email").notNull(),
  customerPhone: text("customer_phone"),
  projectName: text("project_name").notNull(),
  projectAddress: text("project_address"),
  locationNotes: text("location_notes"), // Additional location details
  accessInstructions: text("access_instructions"), // How to access the property
  createdBy: text("created_by").notNull().default("Irrigation Manager"), // Who created the estimate
  estimateDate: timestamp("estimate_date").defaultNow().notNull(), // Date of estimate creation
  status: text("status").notNull().default("pending"), // pending, approved, rejected, converted_to_work_order
  partsSubtotal: decimal("parts_subtotal", { precision: 10, scale: 2 }).notNull(),
  laborSubtotal: decimal("labor_subtotal", { precision: 10, scale: 2 }).notNull(),
  markupAmount: decimal("markup_amount", { precision: 10, scale: 2 }).notNull(),
  taxAmount: decimal("tax_amount", { precision: 10, scale: 2 }).notNull(),
  totalAmount: decimal("total_amount", { precision: 10, scale: 2 }).notNull(),
  laborRate: decimal("labor_rate", { precision: 10, scale: 2 }).notNull(),
  markupPercent: decimal("markup_percent", { precision: 5, scale: 2 }).notNull(),
  taxPercent: decimal("tax_percent", { precision: 5, scale: 2 }).notNull(),
  approvedAt: timestamp("approved_at"),
  rejectedAt: timestamp("rejected_at"),
  approvalToken: text("approval_token"), // Secure token for email approval links
  approvalSentAt: timestamp("approval_sent_at"), // When approval email was sent
  approvalRespondedAt: timestamp("approval_responded_at"), // When customer responded
  photos: text("photos").array().default([]), // JSON array of photo URLs
  attachments: text("attachments").array().default([]), // JSON array of attachment URLs (landscape plans, etc.)
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const estimateZones = pgTable("estimate_zones", {
  id: serial("id").primaryKey(),
  estimateId: integer("estimate_id").references(() => estimates.id).notNull(),
  controllerId: text("controller_id").notNull(), // Controller A, B, C, D, etc.
  zoneNumber: text("zone_number").notNull(), // Zone number within controller
  zoneName: text("zone_name").notNull(), // Full zone name like "Controller B Zone 21"
  workDescription: text("work_description").notNull(), // Description of work to be done
  clockInTime: text("clock_in_time"),
  sortOrder: integer("sort_order").default(0),
});

export const estimateItems = pgTable("estimate_items", {
  id: serial("id").primaryKey(),
  estimateId: integer("estimate_id").references(() => estimates.id).notNull(),
  zoneId: integer("zone_id").references(() => estimateZones.id),
  partId: integer("part_id").references(() => parts.id).notNull(),
  partName: text("part_name").notNull(),
  partPrice: decimal("part_price", { precision: 10, scale: 2 }).notNull(),
  quantity: integer("quantity").notNull(),
  laborHours: decimal("labor_hours", { precision: 5, scale: 2 }).notNull(),
  totalPrice: decimal("total_price", { precision: 10, scale: 2 }).notNull(),
});



// Property zones for field tech operations
export const propertyZones = pgTable("property_zones", {
  id: serial("id").primaryKey(),
  propertyName: text("property_name").notNull(),
  propertyAddress: text("property_address").notNull(),
  googleSheetsUrl: text("google_sheets_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const zones = pgTable("zones", {
  id: serial("id").primaryKey(),
  propertyId: integer("property_id").references(() => propertyZones.id, { onDelete: "cascade" }).notNull(),
  name: text("name").notNull(),
  description: text("description"),
  clockNumber: text("clock_number").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// Field work sessions
export const fieldWorkSessions = pgTable("field_work_sessions", {
  id: serial("id").primaryKey(),
  propertyId: integer("property_id").references(() => propertyZones.id, { onDelete: "cascade" }).notNull(),
  zoneId: integer("zone_id").references(() => zones.id, { onDelete: "cascade" }).notNull(),
  clockNumber: text("clock_number").notNull(),
  workDescription: text("work_description").notNull(),
  startTime: timestamp("start_time", { withTimezone: true }).notNull(),
  endTime: timestamp("end_time", { withTimezone: true }),
  status: text("status").notNull().default("in-progress"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const fieldWorkItems = pgTable("field_work_items", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").references(() => fieldWorkSessions.id, { onDelete: "cascade" }).notNull(),
  partId: integer("part_id").references(() => parts.id, { onDelete: "cascade" }).notNull(),
  partName: text("part_name").notNull(),
  quantity: integer("quantity").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// QuickBooks integration
export const quickbooksIntegration = pgTable("quickbooks_integration", {
  id: serial("id").primaryKey(),
  companyId: text("company_id").notNull(),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token").notNull(),
  realmId: text("realm_id").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const quickbooksSync = pgTable("quickbooks_sync", {
  id: serial("id").primaryKey(),
  estimateId: integer("estimate_id").references(() => estimates.id, { onDelete: "cascade" }).notNull(),
  quickbooksEstimateId: text("quickbooks_estimate_id"),
  quickbooksCustomerId: text("quickbooks_customer_id"),
  syncStatus: text("sync_status").notNull().default("pending"), // pending, synced, failed
  syncedAt: timestamp("synced_at", { withTimezone: true }),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// Work Orders - created from approved estimates OR direct work orders
export const workOrders = pgTable("work_orders", {
  id: serial("id").primaryKey(),
  workOrderNumber: text("work_order_number").notNull().unique(),
  estimateId: integer("estimate_id").references(() => estimates.id), // Optional - null for direct work orders
  customerId: integer("customer_id").references(() => customers.id).notNull(),
  customerName: text("customer_name").notNull(),
  customerEmail: text("customer_email").notNull(),
  customerPhone: text("customer_phone"),
  projectName: text("project_name").notNull(),
  projectAddress: text("project_address"),
  locationNotes: text("location_notes"), // Additional location details
  accessInstructions: text("access_instructions"), // How to access the property
  workType: text("work_type").notNull().default("estimate_based"), // estimate_based, direct_billing, maintenance
  status: text("status").notNull().default("pending"), // pending, in_progress, completed, cancelled
  priority: text("priority").notNull().default("medium"), // low, medium, high, urgent
  scheduledDate: timestamp("scheduled_date"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  assignedTechnicianId: integer("assigned_technician_id"),
  assignedTechnicianName: text("assigned_technician_name"),
  description: text("description"), // For direct work orders without estimates
  specialInstructions: text("special_instructions"),
  notes: text("notes"),
  // Completion fields - who actually completed the work
  completedByUserId: integer("completed_by_user_id").references(() => users.id),
  completedByUserName: text("completed_by_user_name"),
  workSummary: text("work_summary"), // Summary of work completed
  customerNotes: text("customer_notes"), // Notes to share with customer
  totalHours: decimal("total_hours", { precision: 5, scale: 2 }), // Hours worked
  totalPartsCost: decimal("total_parts_cost", { precision: 10, scale: 2 }), // Cost of parts used
  // Financial fields
  totalAmount: decimal("total_amount", { precision: 10, scale: 2 }).default("0.00"),
  totalItems: integer("total_items").default(0),
  photos: text("photos").array().default([]), // JSON array of photo URLs
  attachments: text("attachments").array().default([]), // JSON array of attachment URLs (landscape plans, etc.)
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Work Order Items - copied from estimate items
export const workOrderItems = pgTable("work_order_items", {
  id: serial("id").primaryKey(),
  workOrderId: integer("work_order_id").references(() => workOrders.id).notNull(),
  zoneId: integer("zone_id").references(() => estimateZones.id),
  partId: integer("part_id").references(() => parts.id).notNull(),
  partName: text("part_name").notNull(),
  partPrice: decimal("part_price", { precision: 10, scale: 2 }).notNull(),
  quantity: integer("quantity").notNull(),
  laborHours: decimal("labor_hours", { precision: 5, scale: 2 }).notNull(),
  totalPrice: decimal("total_price", { precision: 10, scale: 2 }).notNull(),
  actualQuantityUsed: integer("actual_quantity_used"),
  actualLaborHours: decimal("actual_labor_hours", { precision: 5, scale: 2 }),
  notes: text("notes"),
});

// Invoices - created from completed work orders
// Monthly consolidated invoices that include all work for a customer
export const invoices = pgTable("invoices", {
  id: serial("id").primaryKey(),
  invoiceNumber: text("invoice_number").notNull().unique(),
  customerId: integer("customer_id").references(() => customers.id).notNull(),
  customerName: text("customer_name").notNull(),
  customerEmail: text("customer_email").notNull(),
  customerPhone: text("customer_phone"),
  // Monthly period this invoice covers
  invoiceMonth: integer("invoice_month").notNull(), // 1-12
  invoiceYear: integer("invoice_year").notNull(),
  periodStart: timestamp("period_start").notNull(),
  periodEnd: timestamp("period_end").notNull(),
  // Invoice details
  status: text("status").notNull().default("draft"), // draft, sent, paid, overdue, cancelled
  partsSubtotal: decimal("parts_subtotal", { precision: 10, scale: 2 }).notNull(),
  laborSubtotal: decimal("labor_subtotal", { precision: 10, scale: 2 }).notNull(),
  markupAmount: decimal("markup_amount", { precision: 10, scale: 2 }).notNull(),
  taxAmount: decimal("tax_amount", { precision: 10, scale: 2 }).notNull(),
  totalAmount: decimal("total_amount", { precision: 10, scale: 2 }).notNull(),
  // Payment info
  dueDate: timestamp("due_date"),
  sentAt: timestamp("sent_at"),
  paidAt: timestamp("paid_at"),
  quickbooksInvoiceId: text("quickbooks_invoice_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Line items for monthly invoices - can come from work orders OR billing sheets
export const invoiceItems = pgTable("invoice_items", {
  id: serial("id").primaryKey(),
  invoiceId: integer("invoice_id").references(() => invoices.id),
  // Source tracking - either from work order or billing sheet
  sourceType: text("source_type").notNull(), // "work_order" or "billing_sheet"
  sourceId: integer("source_id").notNull(), // ID of work order or billing sheet
  workOrderId: integer("work_order_id").references(() => workOrders.id), // Nullable for billing sheet items
  billingSheetId: integer("billing_sheet_id").references(() => billingSheets.id), // Nullable for work order items
  // Item details
  workDate: timestamp("work_date").notNull(),
  description: text("description").notNull(), // Work description or project name
  partId: integer("part_id").references(() => parts.id),
  partName: text("part_name"),
  partDescription: text("part_description"),
  quantity: decimal("quantity", { precision: 10, scale: 2 }).default("0"),
  unitPrice: decimal("unit_price", { precision: 10, scale: 2 }).default("0"),
  totalPrice: decimal("total_price", { precision: 10, scale: 2 }).default("0"),
  laborHours: decimal("labor_hours", { precision: 5, scale: 2 }).default("0"),
  laborRate: decimal("labor_rate", { precision: 10, scale: 2 }).default("0"),
  laborTotal: decimal("labor_total", { precision: 10, scale: 2 }).default("0"),
});

// Notifications table for workflow notifications
export const notifications = pgTable("notifications", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id).notNull(),
  type: text("type").notNull(), // "work_order_assigned", "work_order_completed", "estimate_pending_approval"
  title: text("title").notNull(),
  message: text("message").notNull(),
  relatedEntityType: text("related_entity_type"), // "work_order", "estimate", "billing_sheet"
  relatedEntityId: integer("related_entity_id"),
  isRead: boolean("is_read").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Drizzle insert schemas
// Zod schemas for validation
export const insertCompanySchema = createInsertSchema(companies).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true, updatedAt: true });
export const insertCustomerSchema = createInsertSchema(customers).omit({ id: true });
export const insertPartSchema = createInsertSchema(parts).omit({ 
  id: true, 
  createdAt: true, 
  updatedAt: true 
}).extend({
  price: z.string().min(0, "Price must be positive"),
  laborHours: z.string().min(0, "Labor hours must be positive"),
});
export const insertEstimateSchema = createInsertSchema(estimates).omit({ id: true, estimateNumber: true, createdAt: true, updatedAt: true });
export const insertEstimateZoneSchema = createInsertSchema(estimateZones).omit({ id: true });
export const insertEstimateItemSchema = createInsertSchema(estimateItems).omit({ id: true });
export const insertPropertyZoneSchema = createInsertSchema(propertyZones).omit({ id: true });
export const insertZoneSchema = createInsertSchema(zones).omit({ id: true });
export const insertFieldWorkSessionSchema = createInsertSchema(fieldWorkSessions).omit({ id: true });
export const insertFieldWorkItemSchema = createInsertSchema(fieldWorkItems).omit({ id: true });
export const insertQuickbooksIntegrationSchema = createInsertSchema(quickbooksIntegration).omit({ id: true });
export const insertQuickbooksSyncSchema = createInsertSchema(quickbooksSync).omit({ id: true });
export const insertWorkOrderSchema = createInsertSchema(workOrders)
  .omit({ id: true, workOrderNumber: true, createdAt: true, updatedAt: true })
  .extend({
    scheduledDate: z.union([z.string(), z.date()]).transform(val => val instanceof Date ? val : val ? new Date(val) : undefined).optional().nullable(),
    startedAt: z.union([z.string(), z.date()]).transform(val => val instanceof Date ? val : val ? new Date(val) : undefined).optional().nullable(),
    completedAt: z.union([z.string(), z.date()]).transform(val => val instanceof Date ? val : val ? new Date(val) : undefined).optional().nullable(),
  });
export const insertWorkOrderItemSchema = createInsertSchema(workOrderItems).omit({ id: true });
export const insertInvoiceSchema = createInsertSchema(invoices).omit({ id: true, invoiceNumber: true, createdAt: true, updatedAt: true });
export const insertInvoiceItemSchema = createInsertSchema(invoiceItems).omit({ id: true });
export const insertBillingSheetSchema = createInsertSchema(billingSheets).omit({ id: true, billingNumber: true, createdAt: true, updatedAt: true });
export const insertBillingSheetItemSchema = createInsertSchema(billingSheetItems).omit({ id: true });
export const insertPartUsageSchema = createInsertSchema(partUsage).omit({ id: true, updatedAt: true });
export const insertNotificationSchema = createInsertSchema(notifications).omit({ id: true, createdAt: true });

export type Company = typeof companies.$inferSelect;
export type User = typeof users.$inferSelect;
export type Customer = typeof customers.$inferSelect;
export type Part = typeof parts.$inferSelect;
export type Estimate = typeof estimates.$inferSelect;
export type EstimateZone = typeof estimateZones.$inferSelect;
export type EstimateItem = typeof estimateItems.$inferSelect;
export type PropertyZone = typeof propertyZones.$inferSelect;
export type Zone = typeof zones.$inferSelect;
export type FieldWorkSession = typeof fieldWorkSessions.$inferSelect;
export type FieldWorkItem = typeof fieldWorkItems.$inferSelect;
export type QuickbooksIntegration = typeof quickbooksIntegration.$inferSelect;
export type QuickbooksSync = typeof quickbooksSync.$inferSelect;
export type WorkOrder = typeof workOrders.$inferSelect;
export type WorkOrderItem = typeof workOrderItems.$inferSelect;
export type Invoice = typeof invoices.$inferSelect;
export type InvoiceItem = typeof invoiceItems.$inferSelect;
export type BillingSheet = typeof billingSheets.$inferSelect;
export type BillingSheetItem = typeof billingSheetItems.$inferSelect;
export type PartUsage = typeof partUsage.$inferSelect;
export type Notification = typeof notifications.$inferSelect;

export type InsertCompany = z.infer<typeof insertCompanySchema>;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type InsertCustomer = z.infer<typeof insertCustomerSchema>;
export type InsertPart = z.infer<typeof insertPartSchema>;
export type InsertEstimate = z.infer<typeof insertEstimateSchema>;
export type InsertEstimateZone = z.infer<typeof insertEstimateZoneSchema>;
export type InsertEstimateItem = z.infer<typeof insertEstimateItemSchema>;
export type InsertPropertyZone = z.infer<typeof insertPropertyZoneSchema>;
export type InsertZone = z.infer<typeof insertZoneSchema>;
export type InsertFieldWorkSession = z.infer<typeof insertFieldWorkSessionSchema>;
export type InsertFieldWorkItem = z.infer<typeof insertFieldWorkItemSchema>;
export type InsertQuickbooksIntegration = z.infer<typeof insertQuickbooksIntegrationSchema>;
export type InsertQuickbooksSync = z.infer<typeof insertQuickbooksSyncSchema>;
export type InsertWorkOrder = z.infer<typeof insertWorkOrderSchema>;
export type InsertWorkOrderItem = z.infer<typeof insertWorkOrderItemSchema>;
export type InsertInvoice = z.infer<typeof insertInvoiceSchema>;
export type InsertInvoiceItem = z.infer<typeof insertInvoiceItemSchema>;
export type InsertBillingSheet = z.infer<typeof insertBillingSheetSchema>;
export type InsertBillingSheetItem = z.infer<typeof insertBillingSheetItemSchema>;
export type InsertPartUsage = z.infer<typeof insertPartUsageSchema>;
export type InsertNotification = z.infer<typeof insertNotificationSchema>;
export type InsertSiteMap = z.infer<typeof insertSiteMapSchema>;
export type InsertController = z.infer<typeof insertControllerSchema>;
export type InsertIrrigationZone = z.infer<typeof insertIrrigationZoneSchema>;

export type EstimateWithZones = Estimate & {
  zones: (EstimateZone & { items: EstimateItem[] })[];
};

export type EstimateWithItems = Estimate & {
  items: EstimateItem[];
};

export type PropertyZoneWithZones = PropertyZone & {
  zones: Zone[];
};

export type FieldWorkSessionWithItems = FieldWorkSession & {
  items: FieldWorkItem[];
};

export type WorkOrderWithItems = WorkOrder & {
  items: WorkOrderItem[];
};

export type InvoiceWithItems = Invoice & {
  items: InvoiceItem[];
};

export type BillingSheetWithItems = BillingSheet & {
  items: BillingSheetItem[];
};
