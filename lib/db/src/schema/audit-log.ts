import { pgTable, serial, text, integer, timestamp, jsonb, index } from "drizzle-orm/pg-core";

// Task #550 (Phase 2) — Super Admin App Health: Audit Log tab.
//
// Single append-only stream of operationally interesting events that
// don't already live in `client_errors` (the app_events firehose).
// Sources are intentionally additive — Phase 2 wires auth events
// (login success / login failure / logout) and lays the table out
// for later phases to add: deploys, role changes, data exports,
// impersonation start/stop, integration toggles, and bulk admin
// actions.
//
// Action types are open strings so a new emitter doesn't need a
// schema migration; the UI's filter drop-down enumerates the
// known set today and falls back to "—" for unknown values.
export const auditLog = pgTable(
  "audit_log",
  {
    id: serial("id").primaryKey(),
    occurredAt: timestamp("occurred_at").defaultNow().notNull(),

    // Who did it. `actorUserId` may be null for unauthenticated /
    // failed logins — `actorLabel` then carries the attempted username
    // (e.g. for failed-login rows) so the auditor can still trace it.
    actorUserId: integer("actor_user_id"),
    actorLabel: text("actor_label"),
    actorRole: text("actor_role"),
    actorCompanyId: integer("actor_company_id"),

    // Coarse action_type (auth | admin | data | deploy | integration |
    // impersonation | export | role_change | other). The narrower
    // `action` is a slug like "auth.login", "auth.login_failed",
    // "deploy.published", etc.
    actionType: text("action_type").notNull().default("other"),
    action: text("action").notNull(),

    // info | warning | error | critical
    severity: text("severity").notNull().default("info"),

    // Optional pointer to the entity the action affected.
    targetType: text("target_type"),
    targetId: text("target_id"),

    summary: text("summary"),
    details: jsonb("details"),

    ip: text("ip"),
    userAgent: text("user_agent"),
    sessionId: text("session_id"),
  },
  (t) => ({
    byOccurredAt: index("audit_log_occurred_at_idx").on(t.occurredAt),
    byActor: index("audit_log_actor_idx").on(t.actorUserId, t.occurredAt),
    byCompany: index("audit_log_company_idx").on(t.actorCompanyId, t.occurredAt),
    byActionType: index("audit_log_action_type_idx").on(t.actionType, t.occurredAt),
    bySeverity: index("audit_log_severity_idx").on(t.severity, t.occurredAt),
  }),
);

export type AuditLogRow = typeof auditLog.$inferSelect;
export type InsertAuditLog = typeof auditLog.$inferInsert;
