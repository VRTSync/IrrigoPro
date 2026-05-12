import { pgTable, serial, text, integer, timestamp, index } from "drizzle-orm/pg-core";

// Task #545 — persist client-side error reports posted to
// `POST /api/client-errors` so we can grep for trends over time
// (e.g. "spike on buildHash X" or "TypeError on /work-orders") without
// scraping log files. Append-only, capped to ~30 days of retention by
// the API server's periodic cleanup.
export const clientErrors = pgTable(
  "client_errors",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull().default(""),
    message: text("message").notNull().default(""),
    stack: text("stack"),
    componentStack: text("component_stack"),
    url: text("url"),
    userAgent: text("user_agent"),
    buildHash: text("build_hash").notNull().default(""),
    userId: integer("user_id"),
    role: text("role"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    byBuildHashName: index("client_errors_build_hash_name_idx").on(t.buildHash, t.name),
    byCreatedAt: index("client_errors_created_at_idx").on(t.createdAt),
  }),
);

export type ClientError = typeof clientErrors.$inferSelect;
export type InsertClientError = typeof clientErrors.$inferInsert;
