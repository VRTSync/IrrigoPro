import { pgTable, serial, text, integer, timestamp, jsonb, boolean, index } from "drizzle-orm/pg-core";

// Task #545 — persist client-side error reports posted to
// `POST /api/client-errors`.
// Task #550 — extended in place to match the spec's `app_events` shape so
// later App Health phases (metrics, audits, incidents) can layer onto
// the same firehose without a second migration. The legacy `client_errors`
// table name and its existing columns are preserved so the original
// `/api/admin/client-errors` viewer keeps working unchanged. New columns
// are nullable / defaulted so old writers that only post the legacy
// shape still succeed.
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

    // Task #550 — `app_events` extension columns. `occurredAt` is kept
    // distinct from `createdAt` because in the future the client may
    // batch events whose origin time differs from the server insert time.
    // For now they're populated identically.
    occurredAt: timestamp("occurred_at").defaultNow().notNull(),
    companyId: integer("company_id"),
    sessionId: text("session_id"),
    type: text("type").notNull().default("error"), // error | unhandled_rejection | log
    severity: text("severity").notNull().default("error"), // info | warning | error | fatal
    source: text("source").notNull().default("web"), // web | mobile | api | worker | integration
    component: text("component"), // route / component name (e.g. "/work-orders")
    appVersion: text("app_version"), // mirrors buildHash for new writers
    fingerprint: text("fingerprint"), // sha1(name|topframe|component)
    breadcrumbs: jsonb("breadcrumbs"), // small ring buffer captured by the client
    context: jsonb("context"), // free-form extra context (route, viewport, etc.)
    resolvedAt: timestamp("resolved_at"),
    resolvedBy: integer("resolved_by"),
  },
  (t) => ({
    byBuildHashName: index("client_errors_build_hash_name_idx").on(t.buildHash, t.name),
    byCreatedAt: index("client_errors_created_at_idx").on(t.createdAt),
    byFingerprint: index("client_errors_fingerprint_idx").on(t.fingerprint),
    byOccurredAt: index("client_errors_occurred_at_idx").on(t.occurredAt),
    byCompanyOccurred: index("client_errors_company_occurred_idx").on(t.companyId, t.occurredAt),
    bySeverityOccurred: index("client_errors_severity_occurred_idx").on(t.severity, t.occurredAt),
  }),
);

export type ClientError = typeof clientErrors.$inferSelect;
export type InsertClientError = typeof clientErrors.$inferInsert;

// Task #550 — rolled-up groups, one row per stable fingerprint. The
// Crashes tab queries this table and joins back to `client_errors`
// (the underlying app_events) for the latest event preview / drawer.
export const appEventGroups = pgTable(
  "app_event_groups",
  {
    id: serial("id").primaryKey(),
    fingerprint: text("fingerprint").notNull().unique(),
    name: text("name").notNull().default(""),
    sampleMessage: text("sample_message"),
    severity: text("severity").notNull().default("error"),
    type: text("type").notNull().default("error"),
    source: text("source").notNull().default("web"),
    component: text("component"),
    appVersion: text("app_version"),
    firstSeenAt: timestamp("first_seen_at").defaultNow().notNull(),
    lastSeenAt: timestamp("last_seen_at").defaultNow().notNull(),
    eventCount: integer("event_count").notNull().default(0),
    userCount: integer("user_count").notNull().default(0),
    companyCount: integer("company_count").notNull().default(0),
    // open | muted | resolved | snoozed
    status: text("status").notNull().default("open"),
    isRegression: boolean("is_regression").notNull().default(false),
    assigneeId: integer("assignee_id"),
    snoozedUntil: timestamp("snoozed_until"),
    resolvedAt: timestamp("resolved_at"),
    resolvedBy: integer("resolved_by"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    byStatusLastSeen: index("app_event_groups_status_last_seen_idx").on(t.status, t.lastSeenAt),
    byLastSeen: index("app_event_groups_last_seen_idx").on(t.lastSeenAt),
    bySeverity: index("app_event_groups_severity_idx").on(t.severity),
  }),
);

export type AppEventGroup = typeof appEventGroups.$inferSelect;
export type InsertAppEventGroup = typeof appEventGroups.$inferInsert;
