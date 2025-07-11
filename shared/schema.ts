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

export const estimateItems = pgTable("estimate_items", {
  id: serial("id").primaryKey(),
  estimateId: integer("estimate_id").references(() => estimates.id).notNull(),
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
export const insertEstimateItemSchema = createInsertSchema(estimateItems).omit({ id: true });

export type Customer = typeof customers.$inferSelect;
export type Part = typeof parts.$inferSelect;
export type Estimate = typeof estimates.$inferSelect;
export type EstimateItem = typeof estimateItems.$inferSelect;

export type InsertCustomer = z.infer<typeof insertCustomerSchema>;
export type InsertPart = z.infer<typeof insertPartSchema>;
export type InsertEstimate = z.infer<typeof insertEstimateSchema>;
export type InsertEstimateItem = z.infer<typeof insertEstimateItemSchema>;

export type EstimateWithItems = Estimate & {
  items: EstimateItem[];
};
