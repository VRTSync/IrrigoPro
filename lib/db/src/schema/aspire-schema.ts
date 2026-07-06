// =============================================================================
// ASPIRE INTEGRATION SCHEMA
// =============================================================================
//
// Six tables that form the database layer for the Aspire CRM integration,
// plus aspire_properties (added in Mission 4b) which records the child-level
// property records synced from Aspire's property entity.
// companyId is `integer NOT NULL` on every table except aspire_sync_jobs
// (nullable — global cron runs have no single tenant). All companyId columns
// carry a FK to companies.id. This is the first properly-encrypted credential
// store in the codebase; do NOT copy the quickbooks_integration plaintext
// pattern.
//
// Style reference: irrigationControllers / irrigationPrograms / irrigationProfileZones
// in schema.ts — all indexes follow their short-prefix naming convention.
// =============================================================================

import {
  pgTable,
  text,
  serial,
  integer,
  boolean,
  timestamp,
  uniqueIndex,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { companies, customers, users } from "./schema";

// ---------------------------------------------------------------------------
// 1. external_integrations
//    One row per (company, integrationType) — the canonical connection-status
//    record for any external system. Aspire is the first consumer.
// ---------------------------------------------------------------------------
export const externalIntegrations = pgTable("external_integrations", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companies.id).notNull(),
  // e.g. 'aspire'
  integrationType: text("integration_type").notNull(),
  // 'disconnected' | 'connected' | 'error' | 'reconnect_required'
  connectionStatus: text("connection_status").notNull().default("disconnected"),
  connectedAt: timestamp("connected_at", { withTimezone: true }),
  lastHealthCheckAt: timestamp("last_health_check_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  // A company may have at most one row per integration type.
  companyTypeUniq: uniqueIndex("ext_integrations_company_type_uniq")
    .on(table.companyId, table.integrationType),
  companyIdx: index("ext_integrations_company_idx").on(table.companyId),
}));

export const insertExternalIntegrationSchema = createInsertSchema(externalIntegrations);
export type ExternalIntegration = typeof externalIntegrations.$inferSelect;
export type InsertExternalIntegration = typeof externalIntegrations.$inferInsert;

// ---------------------------------------------------------------------------
// 2. aspire_credentials
//    Encrypted OAuth2 / API credentials for one Aspire tenant. Tokens are
//    stored AES-256-GCM encrypted via aspire-token-service.ts and NEVER
//    returned in API responses (see guardrail #4).
// ---------------------------------------------------------------------------
export const aspireCredentials = pgTable("aspire_credentials", {
  id: serial("id").primaryKey(),
  // One credentials row per company — enforced by UNIQUE on companyId.
  companyId: integer("company_id").references(() => companies.id).notNull().unique(),
  // AES-256-GCM ciphertext — decrypt only inside aspire-token-service.ts.
  encryptedClientId: text("encrypted_client_id").notNull(),
  encryptedClientSecret: text("encrypted_client_secret").notNull(),
  // Nullable: populated after first successful token exchange.
  encryptedAccessToken: text("encrypted_access_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  // 'disconnected' | 'connected' | 'error' | 'reconnect_required'
  connectionStatus: text("connection_status").notNull().default("disconnected"),
  // Set when Aspire returns 429 / rate-limit; the sync layer backs off until now() > throttleUntil.
  throttleUntil: timestamp("throttle_until", { withTimezone: true }),
  errorMessage: text("error_message"),
  syncEnabled: boolean("sync_enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  companyIdx: index("aspire_creds_company_idx").on(table.companyId),
}));

export const insertAspireCredentialsSchema = createInsertSchema(aspireCredentials);
export type AspireCredentials = typeof aspireCredentials.$inferSelect;
export type InsertAspireCredentials = typeof aspireCredentials.$inferInsert;

// ---------------------------------------------------------------------------
// 3. aspire_sync_jobs
//    Audit log for every sync run (cron or manual). EVERY run MUST write a
//    row before starting and update it on completion or failure — no silent
//    runs (guardrail #7). companyId is nullable to allow global health-check
//    runs that span all tenants.
// ---------------------------------------------------------------------------
export const aspireSyncJobs = pgTable("aspire_sync_jobs", {
  id: serial("id").primaryKey(),
  // Nullable — global cron runs (e.g. health_check across all tenants) have no single companyId.
  companyId: integer("company_id").references(() => companies.id),
  // 'health_check' | 'full_sync' | 'customers' | 'properties' | 'work_tickets' |
  // 'invoices' | 'estimates' | 'contacts' | 'crews' | 'manual'
  jobType: text("job_type").notNull(),
  // 'cron' | 'manual_admin' | 'manual_tenant'
  triggeredBy: text("triggered_by").notNull(),
  // 'pending' | 'running' | 'completed' | 'failed'
  status: text("status").notNull().default("pending"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  recordsProcessed: integer("records_processed"),
  recordsFailed: integer("records_failed"),
  errorMessage: text("error_message"),
  // Optional structured log blob — errors, warnings, per-entity counts, etc.
  logJson: jsonb("log_json"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  companyIdx: index("aspire_sync_jobs_company_idx").on(table.companyId),
  statusIdx: index("aspire_sync_jobs_status_idx").on(table.status),
  companyStatusIdx: index("aspire_sync_jobs_company_status_idx")
    .on(table.companyId, table.status),
}));

export const insertAspireSyncJobSchema = createInsertSchema(aspireSyncJobs);
export type AspireSyncJob = typeof aspireSyncJobs.$inferSelect;
export type InsertAspireSyncJob = typeof aspireSyncJobs.$inferInsert;

// ---------------------------------------------------------------------------
// 4. aspire_field_mappings
//    Per-company mapping of Aspire entity fields → IrrigoPro fields.
//    Supports optional transform functions (stored as function-name strings
//    resolved at runtime by the mapping engine).
// ---------------------------------------------------------------------------
export const aspireFieldMappings = pgTable("aspire_field_mappings", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companies.id).notNull(),
  // 'customer' | 'property' | 'contact' | 'work_ticket' | 'estimate' | 'invoice' | 'crew'
  aspireEntity: text("aspire_entity").notNull(),
  // The field name as it appears in the Aspire API response.
  aspireField: text("aspire_field").notNull(),
  // The corresponding field name in the IrrigoPro model.
  irrigoField: text("irrigo_field").notNull(),
  // Optional: name of a registered transform function to apply during mapping.
  transformFn: text("transform_fn"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  // A company may have only one mapping per (aspireEntity, aspireField) pair.
  companyEntityFieldUniq: uniqueIndex("aspire_field_map_company_entity_field_uniq")
    .on(table.companyId, table.aspireEntity, table.aspireField),
  companyIdx: index("aspire_field_map_company_idx").on(table.companyId),
  companyEntityIdx: index("aspire_field_map_company_entity_idx")
    .on(table.companyId, table.aspireEntity),
}));

export const insertAspireFieldMappingSchema = createInsertSchema(aspireFieldMappings);
export type AspireFieldMapping = typeof aspireFieldMappings.$inferSelect;
export type InsertAspireFieldMapping = typeof aspireFieldMappings.$inferInsert;

// ---------------------------------------------------------------------------
// 5. aspire_entity_map
//    Bidirectional identity map between Aspire entity IDs and IrrigoPro IDs.
//    Some Aspire entities (contacts, crews) may not map to a dedicated IrrigoPro
//    row — irrigoId is nullable for those cases.
//    syncHash is a content hash of the last synced payload; a hash mismatch
//    triggers a field-level diff pass before upsert.
// ---------------------------------------------------------------------------
export const aspireEntityMap = pgTable("aspire_entity_map", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companies.id).notNull(),
  // Aspire side — entity type (e.g. 'customer', 'property', 'work_ticket').
  aspireEntity: text("aspire_entity").notNull(),
  // The Aspire API's primary key for this record.
  aspireId: text("aspire_id").notNull(),
  // IrrigoPro side — entity type (e.g. 'customer', 'work_order').
  irrigoEntity: text("irrigo_entity").notNull(),
  // Nullable: contacts / crews may not have a corresponding IrrigoPro row.
  irrigoId: integer("irrigo_id"),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  // SHA-256 (or similar) hash of the last successfully synced Aspire payload.
  // Used to skip no-op upserts when the remote record has not changed.
  syncHash: text("sync_hash"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  // The Aspire entity ID is unique within (company, aspireEntity) — no
  // two rows for the same Aspire record within the same company.
  companyEntityAspireIdUniq: uniqueIndex("aspire_entity_map_company_entity_aspire_id_uniq")
    .on(table.companyId, table.aspireEntity, table.aspireId),
  companyIdx: index("aspire_entity_map_company_idx").on(table.companyId),
  companyEntityIdx: index("aspire_entity_map_company_entity_idx")
    .on(table.companyId, table.aspireEntity),
  // Fast lookup by IrrigoPro side (e.g. "which Aspire ID owns this estimate?").
  irrigoLookupIdx: index("aspire_entity_map_irrigo_lookup_idx")
    .on(table.companyId, table.irrigoEntity, table.irrigoId),
}));

export const insertAspireEntityMapSchema = createInsertSchema(aspireEntityMap);
export type AspireEntityMap = typeof aspireEntityMap.$inferSelect;
export type InsertAspireEntityMap = typeof aspireEntityMap.$inferInsert;

// ---------------------------------------------------------------------------
// 6. aspire_conflict_queue
//    Field-level conflicts detected during sync are written here and MUST NOT
//    throw or abort the sync run (guardrail #8). Conflicts remain pending until
//    a tenant admin or super admin resolves them via the conflict-resolution UI.
// ---------------------------------------------------------------------------
export const aspireConflictQueue = pgTable("aspire_conflict_queue", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companies.id).notNull(),
  // Which Aspire entity type the conflict is on.
  aspireEntity: text("aspire_entity").notNull(),
  // The Aspire API's primary key for the conflicting record.
  aspireId: text("aspire_id").notNull(),
  // Which IrrigoPro entity the conflict affects.
  irrigoEntity: text("irrigo_entity").notNull(),
  // Nullable — same rationale as aspire_entity_map.irrigoId.
  irrigoId: integer("irrigo_id"),
  // The specific field where the values differ.
  fieldName: text("field_name").notNull(),
  // Serialised string representations of each side's value (nullable if one
  // side does not have the field at all).
  aspireValue: text("aspire_value"),
  irrigoValue: text("irrigo_value"),
  detectedAt: timestamp("detected_at", { withTimezone: true }).defaultNow().notNull(),
  // 'pending' | 'resolved_use_aspire' | 'resolved_use_irrigo' |
  // 'resolved_manual_edit' | 'dismissed'
  status: text("status").notNull().default("pending"),
  // Who resolved this conflict (references users.id).
  resolvedBy: integer("resolved_by").references(() => users.id),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolutionNote: text("resolution_note"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  // Fast pending-conflict queries per company (the primary queue view).
  companyStatusIdx: index("aspire_conflict_company_status_idx")
    .on(table.companyId, table.status),
  companyIdx: index("aspire_conflict_company_idx").on(table.companyId),
  // Allow looking up all conflicts for a specific Aspire record.
  aspireEntityIdIdx: index("aspire_conflict_aspire_entity_id_idx")
    .on(table.companyId, table.aspireEntity, table.aspireId),
}));

export const insertAspireConflictQueueSchema = createInsertSchema(aspireConflictQueue);
export type AspireConflictQueue = typeof aspireConflictQueue.$inferSelect;
export type InsertAspireConflictQueue = typeof aspireConflictQueue.$inferInsert;

// ---------------------------------------------------------------------------
// 7. aspire_properties  (Mission 4b)
//    One row per Aspire property record, keyed by (companyId, customerId,
//    branchName). Mirrors the branch-aware pattern used by property_controllers,
//    wet_checks, and site_maps throughout the codebase.
//
//    branchName is nullable — null means "the customer's primary/only property".
//    Do NOT coerce a null branchName to an empty string here; the NULL convention
//    distinguishes "no branch" from an unnamed branch (''), consistent with
//    how wet_checks and site_maps record a null branch for unpartitioned customers.
//    (property_controllers uses '' as its null-sentinel because its unique index
//    was defined before the NULL convention was settled; do not copy that pattern.)
//
//    companyId is NOT NULL; irrigoId in aspire_entity_map will hold this row's id.
// ---------------------------------------------------------------------------
export const aspireProperties = pgTable("aspire_properties", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companies.id).notNull(),
  // FK to IrrigoPro's customers table — the parent account for this property.
  customerId: integer("customer_id").references(() => customers.id).notNull(),
  // Nullable branch discriminator.  null = single-property / primary property.
  // When Aspire returns a human-readable property name, use it here.
  branchName: text("branch_name"),
  // Property address — separate structured fields mirror how customers.street etc.
  // are stored; synced from Aspire's property address payload.
  street: text("street"),
  city: text("city"),
  state: text("state"),
  zip: text("zip"),
  // When true this is the customer's primary service address (Aspire flag or
  // inferred when a customer has exactly one property).
  isPrimary: boolean("is_primary").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  // Primary lookup: all property queries are scoped to (companyId, customerId).
  companyCustomerIdx: index("aspire_properties_company_customer_idx")
    .on(table.companyId, table.customerId),
  // Fast lookup by (companyId, customerId, branchName) — the business key used
  // to detect duplicates before inserting via entity-map.
  companyCustomerBranchIdx: index("aspire_properties_company_customer_branch_idx")
    .on(table.companyId, table.customerId, table.branchName),
  // Company-scoped scan (e.g. list all properties for a company dashboard).
  companyIdx: index("aspire_properties_company_idx").on(table.companyId),
}));

export const insertAspirePropertySchema = createInsertSchema(aspireProperties);
export type AspireProperty = typeof aspireProperties.$inferSelect;
export type InsertAspireProperty = typeof aspireProperties.$inferInsert;

// ---------------------------------------------------------------------------
// 8. aspire_crew_reference  (Mission 6)
//    Lightweight reference table for Aspire crews. IrrigoPro is individual-
//    based (field_tech users), not crew-based — do not attempt to reconcile
//    crew membership with users.  This table is purely for display / reporting.
//
//    companyId is NOT NULL.  irrigoEntity in entity_map = 'aspire_crew'.
//    memberNames stores the Aspire crew member list as a JSON array of strings.
// ---------------------------------------------------------------------------
export const aspireCrewReference = pgTable("aspire_crew_reference", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companies.id).notNull(),
  // Aspire crew identifier (the string stored in aspire_entity_map.aspire_id).
  aspireId: text("aspire_id").notNull(),
  crewName: text("crew_name").notNull(),
  // JSON array of member display names from Aspire (strings, not FK references).
  memberNames: jsonb("member_names").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  // Optional description / notes field from Aspire.
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  // (companyId, aspireId) is the business key — only one row per Aspire crew per company.
  companyAspireUniq: uniqueIndex("aspire_crew_reference_company_aspire_uniq")
    .on(table.companyId, table.aspireId),
  companyIdx: index("aspire_crew_reference_company_idx").on(table.companyId),
}));

export const insertAspireCrewReferenceSchema = createInsertSchema(aspireCrewReference);
export type AspireCrewReference = typeof aspireCrewReference.$inferSelect;
export type InsertAspireCrewReference = typeof aspireCrewReference.$inferInsert;
