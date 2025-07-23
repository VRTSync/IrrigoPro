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
});

export const parts = pgTable("parts", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companies.id).notNull(),
  name: text("name").notNull(),
  description: text("description"),
  price: decimal("price", { precision: 10, scale: 2 }).notNull(),
  laborHours: decimal("labor_hours", { precision: 5, scale: 2 }).notNull(),
  sku: text("sku").notNull(),
  category: text("category"),
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

export const estimates = pgTable("estimates", {
  id: serial("id").primaryKey(),
  estimateNumber: text("estimate_number").notNull().unique(),
  customerId: integer("customer_id").references(() => customers.id),
  customerName: text("customer_name").notNull(),
  customerEmail: text("customer_email").notNull(),
  customerPhone: text("customer_phone"),
  projectName: text("project_name").notNull(),
  projectAddress: text("project_address"),
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
  // Completion fields
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
export const insertCompanySchema = createInsertSchema(companies).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true, updatedAt: true });
export const insertCustomerSchema = createInsertSchema(customers).omit({ id: true });
export const insertPartSchema = createInsertSchema(parts).omit({ id: true });
export const insertEstimateSchema = createInsertSchema(estimates).omit({ id: true, estimateNumber: true, createdAt: true, updatedAt: true });
export const insertEstimateZoneSchema = createInsertSchema(estimateZones).omit({ id: true });
export const insertEstimateItemSchema = createInsertSchema(estimateItems).omit({ id: true });
export const insertPropertyZoneSchema = createInsertSchema(propertyZones).omit({ id: true });
export const insertZoneSchema = createInsertSchema(zones).omit({ id: true });
export const insertFieldWorkSessionSchema = createInsertSchema(fieldWorkSessions).omit({ id: true });
export const insertFieldWorkItemSchema = createInsertSchema(fieldWorkItems).omit({ id: true });
export const insertQuickbooksIntegrationSchema = createInsertSchema(quickbooksIntegration).omit({ id: true });
export const insertQuickbooksSyncSchema = createInsertSchema(quickbooksSync).omit({ id: true });
export const insertWorkOrderSchema = createInsertSchema(workOrders).omit({ id: true, workOrderNumber: true, createdAt: true, updatedAt: true });
export const insertWorkOrderItemSchema = createInsertSchema(workOrderItems).omit({ id: true });
export const insertInvoiceSchema = createInsertSchema(invoices).omit({ id: true, invoiceNumber: true, createdAt: true, updatedAt: true });
export const insertInvoiceItemSchema = createInsertSchema(invoiceItems).omit({ id: true });
export const insertBillingSheetSchema = createInsertSchema(billingSheets).omit({ id: true, billingNumber: true, createdAt: true, updatedAt: true });
export const insertBillingSheetItemSchema = createInsertSchema(billingSheetItems).omit({ id: true });
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
export type InsertNotification = z.infer<typeof insertNotificationSchema>;

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
