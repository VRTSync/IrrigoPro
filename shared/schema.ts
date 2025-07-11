import { pgTable, text, serial, integer, boolean, decimal, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const customers = pgTable("customers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  phone: text("phone"),
  address: text("address"),
});

export const parts = pgTable("parts", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  price: decimal("price", { precision: 10, scale: 2 }).notNull(),
  laborHours: decimal("labor_hours", { precision: 5, scale: 2 }).notNull(),
  sku: text("sku").notNull().unique(),
  category: text("category"),
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
  status: text("status").notNull().default("pending"), // pending, approved, rejected
  partsSubtotal: decimal("parts_subtotal", { precision: 10, scale: 2 }).notNull(),
  laborSubtotal: decimal("labor_subtotal", { precision: 10, scale: 2 }).notNull(),
  markupAmount: decimal("markup_amount", { precision: 10, scale: 2 }).notNull(),
  taxAmount: decimal("tax_amount", { precision: 10, scale: 2 }).notNull(),
  totalAmount: decimal("total_amount", { precision: 10, scale: 2 }).notNull(),
  laborRate: decimal("labor_rate", { precision: 10, scale: 2 }).notNull(),
  markupPercent: decimal("markup_percent", { precision: 5, scale: 2 }).notNull(),
  taxPercent: decimal("tax_percent", { precision: 5, scale: 2 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const estimateZones = pgTable("estimate_zones", {
  id: serial("id").primaryKey(),
  estimateId: integer("estimate_id").references(() => estimates.id).notNull(),
  zoneName: text("zone_name").notNull(),
  workDescription: text("work_description"),
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

export const insertCustomerSchema = createInsertSchema(customers).omit({ id: true });
export const insertPartSchema = createInsertSchema(parts).omit({ id: true });
export const insertEstimateSchema = createInsertSchema(estimates).omit({ 
  id: true, 
  estimateNumber: true,
  createdAt: true, 
  updatedAt: true 
});
export const insertEstimateZoneSchema = createInsertSchema(estimateZones).omit({ id: true });
export const insertEstimateItemSchema = createInsertSchema(estimateItems).omit({ id: true });

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

export const insertPropertyZoneSchema = createInsertSchema(propertyZones).omit({ id: true });
export const insertZoneSchema = createInsertSchema(zones).omit({ id: true });
export const insertFieldWorkSessionSchema = createInsertSchema(fieldWorkSessions).omit({ id: true });
export const insertFieldWorkItemSchema = createInsertSchema(fieldWorkItems).omit({ id: true });
export const insertQuickbooksIntegrationSchema = createInsertSchema(quickbooksIntegration).omit({ id: true });
export const insertQuickbooksSyncSchema = createInsertSchema(quickbooksSync).omit({ id: true });

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
