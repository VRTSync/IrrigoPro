import { pgTable, serial, text, integer, timestamp, jsonb, index } from "drizzle-orm/pg-core";

// Task #553 — App Health Phase 4: Incidents detection engine.
//
// One row per active or historical "incident" — a rule firing detected
// by the 60-second runner. The same rule may fire many times over the
// lifetime of an incident; we update `last_firing_at` / `fire_count`
// in place rather than inserting duplicates while one is still open
// or mitigated.
//
// Lifecycle:
//   open       — rule is currently firing
//   mitigated  — rule has been clean for 10m; admin or auto-flip
//   resolved   — clean for 30m total (or admin closed it out)
//
// Severity values follow the spec (P1 = page worthy, P4 = informational).
export const incidents = pgTable(
  "incidents",
  {
    id: serial("id").primaryKey(),

    ruleId: text("rule_id").notNull(),
    severity: text("severity").notNull(), // P1 | P2 | P3 | P4
    status: text("status").notNull().default("open"), // open | mitigated | resolved
    trigger: text("trigger").notNull().default("auto"), // auto | manual

    summary: text("summary").notNull(),
    runbookUrl: text("runbook_url"),

    // Owner — set when an operator acks the incident.
    ownerUserId: integer("owner_user_id"),
    ownerLabel: text("owner_label"),

    startedAt: timestamp("started_at").defaultNow().notNull(),
    lastFiringAt: timestamp("last_firing_at").defaultNow().notNull(),
    cleanSinceAt: timestamp("clean_since_at"),
    mitigatedAt: timestamp("mitigated_at"),
    resolvedAt: timestamp("resolved_at"),
    ackedAt: timestamp("acked_at"),

    // Affected scope — JSON arrays of company / user ids that the rule
    // saw on its most recent firing. Used for the banner sub-line.
    affectedCompanies: jsonb("affected_companies"),
    affectedUsers: jsonb("affected_users"),

    // Free-form rule-specific context (counts, thresholds, last sample).
    details: jsonb("details"),

    fireCount: integer("fire_count").notNull().default(1),
  },
  (t) => ({
    byStatus: index("incidents_status_idx").on(t.status, t.startedAt),
    byRule: index("incidents_rule_idx").on(t.ruleId, t.status),
    bySeverity: index("incidents_severity_idx").on(t.severity, t.status),
  }),
);

export type IncidentRow = typeof incidents.$inferSelect;
export type InsertIncident = typeof incidents.$inferInsert;
