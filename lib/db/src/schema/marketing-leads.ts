import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const marketingLeads = pgTable("marketing_leads", {
  id: serial("id").primaryKey(),
  companyName: text("company_name").notNull(),
  contactName: text("contact_name").notNull(),
  email: text("email").notNull(),
  phone: text("phone"),
  numTechnicians: integer("num_technicians"),
  message: text("message"),
  source: text("source").default("marketing-site"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertMarketingLeadSchema = createInsertSchema(marketingLeads).omit({
  id: true,
  createdAt: true,
  source: true,
});

export type InsertMarketingLead = z.infer<typeof insertMarketingLeadSchema>;
export type MarketingLead = typeof marketingLeads.$inferSelect;
