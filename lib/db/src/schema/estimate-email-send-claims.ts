import { integer, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { companies, estimates } from "./schema";

// Private delivery interlock; deliberately not part of the estimate API model.
export const estimateEmailSendClaims = pgTable("estimate_email_send_claims", {
  estimateId: integer("estimate_id").primaryKey().references(() => estimates.id, { onDelete: "cascade" }),
  companyId: integer("company_id").notNull().references(() => companies.id),
  attemptId: uuid("attempt_id").notNull(),
  claimedAt: timestamp("claimed_at", { withTimezone: true }).defaultNow().notNull(),
});
