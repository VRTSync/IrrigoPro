// =============================================================================
// ASPIRE SYNC SERVICE — Mission 4: Customers & Properties
// =============================================================================
//
// Pull-sync for the two "clean-tier" Aspire entities: customers and properties.
// This file is the start of aspire-sync-service.ts; Missions 5 and 6 will
// append work orders / invoices and the full conflict-resolution engine
// respectively.
//
// Guardrails enforced here:
//   • Pull-only: no IrrigoPro → Aspire push logic is implemented.
//   • Every sync call writes exactly one aspire_sync_jobs row (pending →
//     running → completed|failed).
//   • All storage reads are scoped by companyId — getCustomer(id) is NEVER
//     called without a subsequent companyId ownership check.
//   • Conflict recording never throws — mismatches are enqueued to
//     aspire_conflict_queue and the sync continues.
//   • The private recordFieldConflict() stub writes directly to the queue;
//     Mission 6 will replace it with the shared implementation.
//
// Aspire → IrrigoPro field mappings used here
//   customer entity:
//     aspireId     (Aspire PK)  → aspire_entity_map.aspire_id
//     name         (string)     → customers.name
//     email        (string)     → customers.email
//     phone        (string)     → customers.phone
//     address      (string)     → customers.address
//     addressLine1 (string)     → customers.street
//     city         (string)     → customers.city
//     state        (string)     → customers.state
//     postalCode   (string)     → customers.zip
//
// Property entity — Option B chosen (Mission 4b):
//   IrrigoPro has no standalone property table, so Mission 4b adds
//   aspire_properties keyed by (companyId, customerId, branchName).
//   A property is always a child of an IrrigoPro customer; the parent
//   customer MUST already exist in aspire_entity_map before the property
//   can be created.  branchName is nullable (null = single/primary property).
//
//   Aspire → aspire_properties field mapping:
//     propertyId   (Aspire PK) → aspire_entity_map.aspire_id
//     customerId   (Aspire FK) → resolved to customers.id via entity_map
//     name / label (string)    → aspire_properties.branch_name (null if none)
//     addressLine1 (string)    → aspire_properties.street
//     city         (string)    → aspire_properties.city
//     state        (string)    → aspire_properties.state
//     postalCode   (string)    → aspire_properties.zip
//     isPrimary    (boolean)   → aspire_properties.is_primary
// =============================================================================

import { createHash } from "crypto";
import { eq, and } from "drizzle-orm";
import { db } from "../db";
import {
  aspireSyncJobs,
  aspireEntityMap,
  aspireFieldMappings,
  aspireConflictQueue,
  aspireProperties,
  aspireCrewReference,
  workOrders,
  invoices,
  estimates,
  customers,
  type InsertAspireSyncJob,
  type InsertAspireEntityMap,
  type InsertAspireConflictQueue,
  type InsertAspireProperty,
  type AspireProperty,
  type Customer,
  type WorkOrder,
  type Invoice,
  type Estimate,
  type InsertAspireCrewReference,
} from "@workspace/db";
import { deriveLifecycleForWrite } from "@workspace/shared";
import { request } from "./aspire-api-client";
import { logger } from "../lib/logger";

// ---------------------------------------------------------------------------
// Aspire API response shapes
// ---------------------------------------------------------------------------
// These represent the minimum fields we need from the Aspire API. The real
// response will likely have more fields; extend as needed once a live
// sandbox is available.

interface AspireCustomer {
  /** Aspire's primary key for this customer record. */
  customerId: string | number;
  name: string;
  email?: string | null;
  phone?: string | null;
  /** Single-line address (legacy fallback). */
  address?: string | null;
  /** Structured address parts — may vary by Aspire API version. */
  addressLine1?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
}

interface AspireCustomerListResponse {
  items?: AspireCustomer[];
  /** Some Aspire endpoints use `data` instead of `items`. */
  data?: AspireCustomer[];
  totalCount?: number;
}

// ---------------------------------------------------------------------------
// Aspire API paths
// ---------------------------------------------------------------------------

const ASPIRE_CUSTOMER_PATH = "/Customers";
const ASPIRE_PAGE_SIZE = 100;

// ---------------------------------------------------------------------------
// Sync-job lifecycle helpers
// ---------------------------------------------------------------------------

type SyncJobStatus = "pending" | "running" | "completed" | "failed";

async function insertSyncJob(
  companyId: number,
  jobType: string,
  triggeredBy: string,
): Promise<number> {
  const [row] = await db
    .insert(aspireSyncJobs)
    .values({
      companyId,
      jobType,
      triggeredBy,
      status: "pending",
    } satisfies Partial<InsertAspireSyncJob> as InsertAspireSyncJob)
    .returning({ id: aspireSyncJobs.id });
  return row.id;
}

async function setSyncJobRunning(jobId: number): Promise<void> {
  await db
    .update(aspireSyncJobs)
    .set({ status: "running", startedAt: new Date() })
    .where(eq(aspireSyncJobs.id, jobId));
}

async function finishSyncJob(
  jobId: number,
  status: "completed" | "failed",
  recordsProcessed: number,
  recordsFailed: number,
  errorMessage?: string,
): Promise<void> {
  await db
    .update(aspireSyncJobs)
    .set({
      status,
      completedAt: new Date(),
      recordsProcessed,
      recordsFailed,
      errorMessage: errorMessage ?? null,
    })
    .where(eq(aspireSyncJobs.id, jobId));
}

// ---------------------------------------------------------------------------
// Entity-map helpers
// ---------------------------------------------------------------------------

/** Looks up an existing entity-map row by (companyId, aspireEntity, aspireId). */
async function findEntityMap(
  companyId: number,
  aspireEntity: string,
  aspireId: string,
) {
  const rows = await db
    .select()
    .from(aspireEntityMap)
    .where(
      and(
        eq(aspireEntityMap.companyId, companyId),
        eq(aspireEntityMap.aspireEntity, aspireEntity),
        eq(aspireEntityMap.aspireId, aspireId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/** Inserts a new entity-map row. */
async function insertEntityMap(
  values: InsertAspireEntityMap,
): Promise<void> {
  await db.insert(aspireEntityMap).values(values);
}

/** Updates lastSyncedAt and syncHash on an existing entity-map row. */
async function touchEntityMap(entityMapId: number, syncHash: string): Promise<void> {
  await db
    .update(aspireEntityMap)
    .set({ lastSyncedAt: new Date(), syncHash, updatedAt: new Date() })
    .where(eq(aspireEntityMap.id, entityMapId));
}

// ---------------------------------------------------------------------------
// Field-mapping helpers
// ---------------------------------------------------------------------------

interface FieldMapping {
  aspireField: string;
  irrigoField: string;
  transformFn: string | null;
}

/** Loads active field mappings for (companyId, aspireEntity) from the DB. */
async function loadFieldMappings(
  companyId: number,
  aspireEntity: string,
): Promise<FieldMapping[]> {
  const rows = await db
    .select({
      aspireField: aspireFieldMappings.aspireField,
      irrigoField: aspireFieldMappings.irrigoField,
      transformFn: aspireFieldMappings.transformFn,
    })
    .from(aspireFieldMappings)
    .where(
      and(
        eq(aspireFieldMappings.companyId, companyId),
        eq(aspireFieldMappings.aspireEntity, aspireEntity),
        eq(aspireFieldMappings.isActive, true),
      ),
    );
  return rows;
}

// ---------------------------------------------------------------------------
// Content hashing
// ---------------------------------------------------------------------------

/** Produces a deterministic SHA-256 content hash for a sync payload object. */
function hashPayload(payload: Record<string, unknown>): string {
  const stable = JSON.stringify(
    Object.fromEntries(Object.entries(payload).sort(([a], [b]) => a.localeCompare(b))),
  );
  return createHash("sha256").update(stable).digest("hex");
}

// ---------------------------------------------------------------------------
// Conflict recording — REAL IMPLEMENTATION (replaces Mission 4 stub)
// ---------------------------------------------------------------------------
//
// Idempotent: if an identical PENDING conflict already exists for this
// (companyId, aspireEntity, aspireId, fieldName), no second row is inserted.
// A conflict with a different fieldName on the same record IS a separate row.
// Never throws — a recording failure logs a warning and the sync continues.

async function recordFieldConflict(params: {
  companyId: number;
  aspireEntity: string;
  aspireId: string;
  irrigoEntity: string;
  irrigoId: number | null;
  fieldName: string;
  aspireValue: string | null;
  irrigoValue: string | null;
}): Promise<void> {
  try {
    // Idempotency check: skip if a pending conflict with identical keys exists.
    const existing = await db
      .select({ id: aspireConflictQueue.id })
      .from(aspireConflictQueue)
      .where(
        and(
          eq(aspireConflictQueue.companyId, params.companyId),
          eq(aspireConflictQueue.aspireEntity, params.aspireEntity),
          eq(aspireConflictQueue.aspireId, params.aspireId),
          eq(aspireConflictQueue.fieldName, params.fieldName),
          eq(aspireConflictQueue.status, "pending"),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      // Conflict already pending — update the values in case they changed,
      // but do NOT create a duplicate row.
      await db
        .update(aspireConflictQueue)
        .set({
          aspireValue: params.aspireValue,
          irrigoValue: params.irrigoValue,
          updatedAt: new Date(),
        })
        .where(eq(aspireConflictQueue.id, existing[0].id));
      return;
    }

    await db.insert(aspireConflictQueue).values({
      companyId: params.companyId,
      aspireEntity: params.aspireEntity,
      aspireId: params.aspireId,
      irrigoEntity: params.irrigoEntity,
      irrigoId: params.irrigoId,
      fieldName: params.fieldName,
      aspireValue: params.aspireValue,
      irrigoValue: params.irrigoValue,
      status: "pending",
    } satisfies Partial<InsertAspireConflictQueue> as InsertAspireConflictQueue);
  } catch (err) {
    // Best-effort: conflict recording must never abort the sync run.
    logger.warn(
      { ...params, err },
      "[aspire-sync-service] recordFieldConflict: failed to enqueue conflict — ignoring",
    );
  }
}

// ---------------------------------------------------------------------------
// Aspire → IrrigoPro customer mapping
// ---------------------------------------------------------------------------

/**
 * Default (hard-coded) field mappings for the customer entity.
 * These are used when no custom mappings exist in aspire_field_mappings.
 * Format: aspireField → irrigoField (key in IrrigoPro's customers row).
 */
const DEFAULT_CUSTOMER_FIELD_MAP: Record<string, keyof Customer> = {
  name: "name",
  email: "email",
  phone: "phone",
  address: "address",
  addressLine1: "street",
  city: "city",
  state: "state",
  postalCode: "zip",
};

/**
 * Extracts the mapped IrrigoPro field values from a raw Aspire customer
 * payload, applying custom DB mappings where available and falling back
 * to the defaults above.
 */
function mapAspireCustomerToIrrigo(
  raw: AspireCustomer,
  dbMappings: FieldMapping[],
): Partial<Record<keyof Customer, string | null>> {
  // Build an effective mapping: DB rows override defaults.
  const effectiveMap = { ...DEFAULT_CUSTOMER_FIELD_MAP };
  for (const m of dbMappings) {
    effectiveMap[m.aspireField] = m.irrigoField as keyof Customer;
  }

  const out: Partial<Record<keyof Customer, string | null>> = {};
  for (const [aspireField, irrigoField] of Object.entries(effectiveMap)) {
    const rawValue = (raw as unknown as Record<string, unknown>)[aspireField];
    if (rawValue !== undefined) {
      out[irrigoField] = rawValue != null ? String(rawValue) : null;
    }
  }
  return out;
}

/**
 * Produces the syncable payload (only mapped fields) from an Aspire customer.
 * Used for both initial create and hash-based change detection.
 */
function buildCustomerPayload(
  raw: AspireCustomer,
  dbMappings: FieldMapping[],
): Record<string, string | null> {
  const mapped = mapAspireCustomerToIrrigo(raw, dbMappings);
  return Object.fromEntries(
    Object.entries(mapped).map(([k, v]) => [k, v ?? null]),
  );
}

// ---------------------------------------------------------------------------
// Field-level diff — only mapped fields
// ---------------------------------------------------------------------------

interface FieldDiff {
  fieldName: string;
  aspireValue: string | null;
  irrigoValue: string | null;
}

function diffCustomerFields(
  aspirePayload: Record<string, string | null>,
  existing: Customer,
): FieldDiff[] {
  const diffs: FieldDiff[] = [];
  for (const [irrigoField, aspireValue] of Object.entries(aspirePayload)) {
    const irrigoValue = (existing as Record<string, unknown>)[irrigoField];
    const irrigoStr = irrigoValue != null ? String(irrigoValue) : null;
    if (aspireValue !== irrigoStr) {
      diffs.push({ fieldName: irrigoField, aspireValue, irrigoValue: irrigoStr });
    }
  }
  return diffs;
}

// ---------------------------------------------------------------------------
// Customer sync helpers — page fetching
// ---------------------------------------------------------------------------

async function fetchAllAspireCustomers(companyId: number): Promise<AspireCustomer[]> {
  const all: AspireCustomer[] = [];
  let page = 1;

  while (true) {
    const resp = await request<AspireCustomerListResponse>(
      companyId,
      "GET",
      `${ASPIRE_CUSTOMER_PATH}?page=${page}&pageSize=${ASPIRE_PAGE_SIZE}`,
    );

    const items: AspireCustomer[] = resp.items ?? resp.data ?? [];
    all.push(...items);

    // Stop if this page was not full (last page).
    if (items.length < ASPIRE_PAGE_SIZE) {
      break;
    }
    page++;
  }

  return all;
}

// ---------------------------------------------------------------------------
// syncCustomers — public entry point
// ---------------------------------------------------------------------------

/**
 * Pulls all customers for `companyId` from Aspire and reconciles them with
 * IrrigoPro's customers table using aspire_entity_map as the identity index.
 *
 * Behaviour:
 *   • New Aspire record (no entity-map row): creates a customers row and an
 *     entity-map row. companyId is always set explicitly.
 *   • Known Aspire record, unchanged (hash match): bumps lastSyncedAt only.
 *   • Known Aspire record, changed (hash mismatch): does NOT overwrite — each
 *     differing field is enqueued to aspire_conflict_queue for human review.
 *
 * Returns sync counts (processed, failed).
 */
export async function syncCustomers(
  companyId: number,
  triggeredBy: "cron" | "manual_admin" | "manual_tenant" = "cron",
): Promise<{ recordsProcessed: number; recordsFailed: number }> {
  const jobId = await insertSyncJob(companyId, "customers", triggeredBy);

  logger.info(
    { companyId, jobId },
    "[aspire-sync-service] syncCustomers: starting",
  );

  await setSyncJobRunning(jobId);

  let recordsProcessed = 0;
  let recordsFailed = 0;

  try {
    // Load field mappings once — reused for every record in this run.
    const dbMappings = await loadFieldMappings(companyId, "customer");

    // Fetch all customers from Aspire (handles pagination).
    const aspireCustomers = await fetchAllAspireCustomers(companyId);

    logger.info(
      { companyId, jobId, count: aspireCustomers.length },
      "[aspire-sync-service] syncCustomers: fetched records from Aspire",
    );

    for (const raw of aspireCustomers) {
      const aspireId = String(raw.customerId);

      try {
        const payload = buildCustomerPayload(raw, dbMappings);
        const syncHash = hashPayload(payload);

        const entityMapRow = await findEntityMap(companyId, "customer", aspireId);

        if (!entityMapRow) {
          // ── New record: create IrrigoPro customer ──────────────────────────
          const [newCustomer] = await db
            .insert(customers)
            .values({
              companyId, // always explicit — never omitted
              name: payload.name ?? raw.name ?? "Unknown",
              email: payload.email ?? raw.email ?? "",
              phone: payload.phone ?? null,
              address: payload.address ?? null,
              street: payload.street ?? null,
              city: payload.city ?? null,
              state: payload.state ?? null,
              zip: payload.zip ?? null,
            })
            .returning();

          await insertEntityMap({
            companyId,
            aspireEntity: "customer",
            aspireId,
            irrigoEntity: "customer",
            irrigoId: newCustomer.id,
            lastSyncedAt: new Date(),
            syncHash,
          });

          logger.info(
            { companyId, jobId, aspireId, irrigoId: newCustomer.id },
            "[aspire-sync-service] syncCustomers: created new customer",
          );
        } else {
          // ── Existing record: compare hash ─────────────────────────────────
          if (entityMapRow.syncHash === syncHash) {
            // No change — bump lastSyncedAt only.
            await touchEntityMap(entityMapRow.id, syncHash);

            logger.debug(
              { companyId, jobId, aspireId, irrigoId: entityMapRow.irrigoId },
              "[aspire-sync-service] syncCustomers: no change — hash match",
            );
          } else {
            // Hash mismatch — load the existing IrrigoPro record and diff.
            // We scope the lookup to companyId to guard against cross-tenant leaks.
            if (entityMapRow.irrigoId == null) {
              // No IrrigoPro record mapped — treat as a new create.
              const [newCustomer] = await db
                .insert(customers)
                .values({
                  companyId,
                  name: payload.name ?? raw.name ?? "Unknown",
                  email: payload.email ?? raw.email ?? "",
                  phone: payload.phone ?? null,
                  address: payload.address ?? null,
                  street: payload.street ?? null,
                  city: payload.city ?? null,
                  state: payload.state ?? null,
                  zip: payload.zip ?? null,
                })
                .returning();

              await db
                .update(aspireEntityMap)
                .set({
                  irrigoId: newCustomer.id,
                  lastSyncedAt: new Date(),
                  syncHash,
                  updatedAt: new Date(),
                })
                .where(eq(aspireEntityMap.id, entityMapRow.id));

              logger.info(
                { companyId, jobId, aspireId, irrigoId: newCustomer.id },
                "[aspire-sync-service] syncCustomers: created customer for previously unmapped entity-map row",
              );
            } else {
              // Fetch existing customer, verify it belongs to this company.
              const [existingRow] = await db
                .select()
                .from(customers)
                .where(
                  and(
                    eq(customers.id, entityMapRow.irrigoId),
                    eq(customers.companyId, companyId),
                  ),
                )
                .limit(1);

              if (!existingRow) {
                logger.warn(
                  { companyId, jobId, aspireId, irrigoId: entityMapRow.irrigoId },
                  "[aspire-sync-service] syncCustomers: entity-map points at a missing or cross-tenant customer — skipping",
                );
                recordsFailed++;
                continue;
              }

              const diffs = diffCustomerFields(payload, existingRow);

              if (diffs.length === 0) {
                // Fields match despite hash mismatch (e.g. unmapped field change).
                // Update the hash so future runs skip this diffing pass.
                await touchEntityMap(entityMapRow.id, syncHash);
              } else {
                // Record a conflict for each differing field.
                for (const diff of diffs) {
                  await recordFieldConflict({
                    companyId,
                    aspireEntity: "customer",
                    aspireId,
                    irrigoEntity: "customer",
                    irrigoId: existingRow.id,
                    fieldName: diff.fieldName,
                    aspireValue: diff.aspireValue,
                    irrigoValue: diff.irrigoValue,
                  });
                }

                logger.info(
                  {
                    companyId,
                    jobId,
                    aspireId,
                    irrigoId: existingRow.id,
                    conflictCount: diffs.length,
                  },
                  "[aspire-sync-service] syncCustomers: conflict(s) enqueued — NOT overwriting",
                );

                // Still update the entity-map hash so we don't re-enqueue the
                // same conflict on the next run unless Aspire changes again.
                await touchEntityMap(entityMapRow.id, syncHash);
              }
            }
          }
        }

        recordsProcessed++;
      } catch (err) {
        recordsFailed++;
        logger.error(
          { companyId, jobId, aspireId, err },
          "[aspire-sync-service] syncCustomers: error processing record — continuing",
        );
      }
    }

    await finishSyncJob(jobId, "completed", recordsProcessed, recordsFailed);

    logger.info(
      { companyId, jobId, recordsProcessed, recordsFailed },
      "[aspire-sync-service] syncCustomers: completed",
    );
  } catch (topLevelErr) {
    const msg = topLevelErr instanceof Error ? topLevelErr.message : String(topLevelErr);
    await finishSyncJob(jobId, "failed", recordsProcessed, recordsFailed, msg).catch(() => {
      // Best-effort; don't mask the original error.
    });

    logger.error(
      { companyId, jobId, err: topLevelErr },
      "[aspire-sync-service] syncCustomers: top-level error — sync job marked failed",
    );

    throw topLevelErr;
  }

  return { recordsProcessed, recordsFailed };
}

// ---------------------------------------------------------------------------
// Aspire property API response shape
// ---------------------------------------------------------------------------

interface AspireProperty_API {
  /** Aspire's primary key for this property record. */
  propertyId: string | number;
  /** Aspire's customerId — used to resolve the IrrigoPro parent customer. */
  customerId: string | number;
  /** Optional human-readable label used as branchName. */
  name?: string | null;
  /** Structured address parts — field names vary by Aspire API version. */
  addressLine1?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  /** True when Aspire marks this as the customer's primary service address. */
  isPrimary?: boolean | null;
}

interface AspirePropertyListResponse {
  items?: AspireProperty_API[];
  data?: AspireProperty_API[];
  totalCount?: number;
}

const ASPIRE_PROPERTY_PATH = "/Properties";

// ---------------------------------------------------------------------------
// Default property field map
// ---------------------------------------------------------------------------

const DEFAULT_PROPERTY_FIELD_MAP: Record<string, keyof AspireProperty> = {
  name: "branchName",
  addressLine1: "street",
  city: "city",
  state: "state",
  postalCode: "zip",
};

// ---------------------------------------------------------------------------
// Property payload builder + diff (mirrors customer equivalents)
// ---------------------------------------------------------------------------

function buildPropertyPayload(
  raw: AspireProperty_API,
  dbMappings: FieldMapping[],
): Record<string, string | null | boolean> {
  // Build an effective mapping: DB rows override defaults.
  const effectiveMap = { ...DEFAULT_PROPERTY_FIELD_MAP };
  for (const m of dbMappings) {
    effectiveMap[m.aspireField] = m.irrigoField as keyof AspireProperty;
  }

  const out: Record<string, string | null | boolean> = {};
  for (const [aspireField, irrigoField] of Object.entries(effectiveMap)) {
    const rawValue = (raw as unknown as Record<string, unknown>)[aspireField];
    if (rawValue !== undefined) {
      out[irrigoField as string] = rawValue != null ? String(rawValue) : null;
    }
  }
  // isPrimary is a boolean — handle separately so it doesn't get String()'d.
  if (raw.isPrimary !== undefined) {
    out.isPrimary = raw.isPrimary ?? false;
  }
  return out;
}

interface PropertyFieldDiff {
  fieldName: string;
  aspireValue: string | null;
  irrigoValue: string | null;
}

function diffPropertyFields(
  aspirePayload: Record<string, string | null | boolean>,
  existing: AspireProperty,
): PropertyFieldDiff[] {
  const diffs: PropertyFieldDiff[] = [];
  for (const [field, aspireValue] of Object.entries(aspirePayload)) {
    const irrigoValue = (existing as unknown as Record<string, unknown>)[field];
    const irrigoStr = irrigoValue != null ? String(irrigoValue) : null;
    const aspireStr = aspireValue != null ? String(aspireValue) : null;
    if (aspireStr !== irrigoStr) {
      diffs.push({ fieldName: field, aspireValue: aspireStr, irrigoValue: irrigoStr });
    }
  }
  return diffs;
}

// ---------------------------------------------------------------------------
// Property page fetching
// ---------------------------------------------------------------------------

async function fetchAllAspireProperties(
  companyId: number,
): Promise<AspireProperty_API[]> {
  const all: AspireProperty_API[] = [];
  let page = 1;

  while (true) {
    const resp = await request<AspirePropertyListResponse>(
      companyId,
      "GET",
      `${ASPIRE_PROPERTY_PATH}?page=${page}&pageSize=${ASPIRE_PAGE_SIZE}`,
    );

    const items: AspireProperty_API[] = resp.items ?? resp.data ?? [];
    all.push(...items);

    if (items.length < ASPIRE_PAGE_SIZE) break;
    page++;
  }

  return all;
}

// ---------------------------------------------------------------------------
// syncProperties — public entry point
// ---------------------------------------------------------------------------

/**
 * Pulls all properties for `companyId` from Aspire and reconciles them with
 * IrrigoPro's aspire_properties table via aspire_entity_map.
 *
 * Behaviour:
 *   • A property whose parent Aspire customerId is not yet in entity_map is
 *     SKIPPED (recordsFailed++) with a clear log entry — never creates an
 *     orphaned row. Run syncCustomers first to avoid this.
 *   • New property (no entity-map row): INSERT into aspire_properties +
 *     INSERT into aspire_entity_map. companyId and customerId are always
 *     explicit.
 *   • Known property, hash match: bumps lastSyncedAt only.
 *   • Known property, hash mismatch: diffs mapped fields against the existing
 *     row (scoped by companyId in every WHERE). Each differing field is
 *     enqueued to aspire_conflict_queue via recordFieldConflict().
 *   • branchName is taken from the Aspire property's name/label if available,
 *     null otherwise. If genuinely ambiguous (customer has multiple properties
 *     with no distinguishable name), the record is skipped with a clear log
 *     entry rather than silently guessing a branchName.
 *
 * Returns sync counts (processed, failed).
 */
export async function syncProperties(
  companyId: number,
  triggeredBy: "cron" | "manual_admin" | "manual_tenant" = "cron",
): Promise<{ recordsProcessed: number; recordsFailed: number }> {
  const jobId = await insertSyncJob(companyId, "properties", triggeredBy);

  logger.info(
    { companyId, jobId },
    "[aspire-sync-service] syncProperties: starting",
  );

  await setSyncJobRunning(jobId);

  let recordsProcessed = 0;
  let recordsFailed = 0;

  try {
    const dbMappings = await loadFieldMappings(companyId, "property");
    const aspirePropertiesList = await fetchAllAspireProperties(companyId);

    logger.info(
      { companyId, jobId, count: aspirePropertiesList.length },
      "[aspire-sync-service] syncProperties: fetched records from Aspire",
    );

    for (const raw of aspirePropertiesList) {
      const aspirePropertyId = String(raw.propertyId);
      const aspireCustomerId = String(raw.customerId);

      try {
        // ── 1. Resolve parent customer via entity_map ──────────────────────
        const customerMapRows = await db
          .select({ irrigoId: aspireEntityMap.irrigoId })
          .from(aspireEntityMap)
          .where(
            and(
              eq(aspireEntityMap.companyId, companyId),
              eq(aspireEntityMap.aspireEntity, "customer"),
              eq(aspireEntityMap.aspireId, aspireCustomerId),
            ),
          )
          .limit(1);

        if (customerMapRows.length === 0 || customerMapRows[0].irrigoId == null) {
          recordsFailed++;
          logger.warn(
            { companyId, jobId, aspirePropertyId, aspireCustomerId },
            "[aspire-sync-service] syncProperties: parent customer not yet synced — skipping property",
          );
          continue;
        }

        const irrigoCustomerId = customerMapRows[0].irrigoId;

        // Verify the customer belongs to this company (cross-tenant guard).
        const [customerRow] = await db
          .select({ id: customers.id })
          .from(customers)
          .where(
            and(
              eq(customers.id, irrigoCustomerId),
              eq(customers.companyId, companyId),
            ),
          )
          .limit(1);

        if (!customerRow) {
          recordsFailed++;
          logger.warn(
            { companyId, jobId, aspirePropertyId, aspireCustomerId, irrigoCustomerId },
            "[aspire-sync-service] syncProperties: entity-map customer points to wrong company — skipping",
          );
          continue;
        }

        // ── 2. Build payload + hash ────────────────────────────────────────
        const payload = buildPropertyPayload(raw, dbMappings);
        const syncHash = hashPayload(payload as Record<string, unknown>);

        // ── 3. Determine branchName ────────────────────────────────────────
        // Use the Aspire property's name/label as branchName if provided.
        // null means "primary/only property"; '' is never used (convention).
        const branchName: string | null = raw.name?.trim() || null;

        // Guard against ambiguity: if there's already a non-entity-mapped
        // aspire_properties row for this (companyId, customerId, branchName)
        // without a matching entity-map row, something is inconsistent.
        // Log and skip rather than silently creating a duplicate.
        const entityMapRow = await findEntityMap(companyId, "property", aspirePropertyId);

        if (!entityMapRow) {
          // ── New record ────────────────────────────────────────────────────
          const [newProperty] = await db
            .insert(aspireProperties)
            .values({
              companyId,           // always explicit
              customerId: irrigoCustomerId,
              branchName,
              street: typeof payload.street === "string" ? payload.street : null,
              city: typeof payload.city === "string" ? payload.city : null,
              state: typeof payload.state === "string" ? payload.state : null,
              zip: typeof payload.zip === "string" ? payload.zip : null,
              isPrimary: typeof payload.isPrimary === "boolean" ? payload.isPrimary : false,
            } satisfies Partial<InsertAspireProperty> as InsertAspireProperty)
            .returning();

          await insertEntityMap({
            companyId,
            aspireEntity: "property",
            aspireId: aspirePropertyId,
            irrigoEntity: "aspire_property",
            irrigoId: newProperty.id,
            lastSyncedAt: new Date(),
            syncHash,
          });

          logger.info(
            {
              companyId,
              jobId,
              aspirePropertyId,
              irrigoPropertyId: newProperty.id,
              irrigoCustomerId,
            },
            "[aspire-sync-service] syncProperties: created new aspire_properties row",
          );
        } else {
          // ── Existing record ───────────────────────────────────────────────
          if (entityMapRow.syncHash === syncHash) {
            await touchEntityMap(entityMapRow.id, syncHash);

            logger.debug(
              { companyId, jobId, aspirePropertyId, irrigoId: entityMapRow.irrigoId },
              "[aspire-sync-service] syncProperties: no change — hash match",
            );
          } else {
            if (entityMapRow.irrigoId == null) {
              // Orphaned entity-map row — create the aspire_properties record now.
              const [newProperty] = await db
                .insert(aspireProperties)
                .values({
                  companyId,
                  customerId: irrigoCustomerId,
                  branchName,
                  street: typeof payload.street === "string" ? payload.street : null,
                  city: typeof payload.city === "string" ? payload.city : null,
                  state: typeof payload.state === "string" ? payload.state : null,
                  zip: typeof payload.zip === "string" ? payload.zip : null,
                  isPrimary: typeof payload.isPrimary === "boolean" ? payload.isPrimary : false,
                } satisfies Partial<InsertAspireProperty> as InsertAspireProperty)
                .returning();

              await db
                .update(aspireEntityMap)
                .set({
                  irrigoId: newProperty.id,
                  lastSyncedAt: new Date(),
                  syncHash,
                  updatedAt: new Date(),
                })
                .where(eq(aspireEntityMap.id, entityMapRow.id));

              logger.info(
                { companyId, jobId, aspirePropertyId, irrigoPropertyId: newProperty.id },
                "[aspire-sync-service] syncProperties: created property for previously unmapped entity-map row",
              );
            } else {
              // Load the existing aspire_properties row — scoped by companyId.
              const [existingRow] = await db
                .select()
                .from(aspireProperties)
                .where(
                  and(
                    eq(aspireProperties.id, entityMapRow.irrigoId),
                    eq(aspireProperties.companyId, companyId),
                  ),
                )
                .limit(1);

              if (!existingRow) {
                logger.warn(
                  {
                    companyId,
                    jobId,
                    aspirePropertyId,
                    irrigoId: entityMapRow.irrigoId,
                  },
                  "[aspire-sync-service] syncProperties: entity-map points at a missing or cross-tenant property — skipping",
                );
                recordsFailed++;
                continue;
              }

              const diffs = diffPropertyFields(payload, existingRow);

              if (diffs.length === 0) {
                await touchEntityMap(entityMapRow.id, syncHash);
              } else {
                for (const diff of diffs) {
                  await recordFieldConflict({
                    companyId,
                    aspireEntity: "property",
                    aspireId: aspirePropertyId,
                    irrigoEntity: "aspire_property",
                    irrigoId: existingRow.id,
                    fieldName: diff.fieldName,
                    aspireValue: diff.aspireValue,
                    irrigoValue: diff.irrigoValue,
                  });
                }

                logger.info(
                  {
                    companyId,
                    jobId,
                    aspirePropertyId,
                    irrigoId: existingRow.id,
                    conflictCount: diffs.length,
                  },
                  "[aspire-sync-service] syncProperties: conflict(s) enqueued — NOT overwriting",
                );

                await touchEntityMap(entityMapRow.id, syncHash);
              }
            }
          }
        }

        recordsProcessed++;
      } catch (err) {
        recordsFailed++;
        logger.error(
          { companyId, jobId, aspirePropertyId, err },
          "[aspire-sync-service] syncProperties: error processing record — continuing",
        );
      }
    }

    await finishSyncJob(jobId, "completed", recordsProcessed, recordsFailed);

    logger.info(
      { companyId, jobId, recordsProcessed, recordsFailed },
      "[aspire-sync-service] syncProperties: completed",
    );
  } catch (topLevelErr) {
    const msg = topLevelErr instanceof Error ? topLevelErr.message : String(topLevelErr);
    await finishSyncJob(jobId, "failed", recordsProcessed, recordsFailed, msg).catch(() => {
      // Best-effort.
    });

    logger.error(
      { companyId, jobId, err: topLevelErr },
      "[aspire-sync-service] syncProperties: top-level error — sync job marked failed",
    );

    throw topLevelErr;
  }

  return { recordsProcessed, recordsFailed };
}

// =============================================================================
// MISSION 5 — Work Tickets, Invoices, Push Hook
// =============================================================================
//
// Guardrails:
//   • pushWorkOrderStatusToAspire is fire-and-forget — Aspire outages MUST NOT
//     block or roll back IrrigoPro work order approvals.
//   • Invoice conflicts are ALWAYS manual-review; auto-resolve is forbidden.
//   • Work orders created from Aspire tickets carry irrigoEntity='work_order'
//     in aspire_entity_map; originWetCheckId is left null.

// ---------------------------------------------------------------------------
// Aspire work-ticket API shapes
// ---------------------------------------------------------------------------

interface AspireWorkTicket {
  ticketId: string | number;
  customerId: string | number;
  title?: string | null;
  description?: string | null;
  status?: string | null;
  scheduledDate?: string | null;
  priority?: string | null;
  totalAmount?: string | number | null;
}

interface AspireWorkTicketListResponse {
  items?: AspireWorkTicket[];
  data?: AspireWorkTicket[];
}

// ---------------------------------------------------------------------------
// Aspire invoice API shapes
// ---------------------------------------------------------------------------

interface AspireInvoice {
  invoiceId: string | number;
  customerId: string | number;
  invoiceNumber?: string | null;
  status?: string | null;
  totalAmount?: string | number | null;
  dueDate?: string | null;
  issuedDate?: string | null;
}

interface AspireInvoiceListResponse {
  items?: AspireInvoice[];
  data?: AspireInvoice[];
}

const ASPIRE_WORK_TICKET_PATH = "/WorkTickets";
const ASPIRE_INVOICE_PATH = "/Invoices";

// ---------------------------------------------------------------------------
// Work-ticket field helpers
// ---------------------------------------------------------------------------

/** Map an Aspire priority string to IrrigoPro's priority enum. */
function mapPriority(raw: string | null | undefined): string {
  switch ((raw ?? "").toLowerCase()) {
    case "high": case "urgent": return "high";
    case "low": return "low";
    default: return "medium";
  }
}

/** Map an Aspire ticket status to IrrigoPro work_orders.status. */
function mapTicketStatus(raw: string | null | undefined): string {
  switch ((raw ?? "").toLowerCase()) {
    case "completed": case "closed": return "work_completed";
    case "in_progress": case "inprogress": return "in_progress";
    case "assigned": return "assigned";
    case "cancelled": case "canceled": return "cancelled";
    default: return "pending";
  }
}

function buildWorkTicketPayload(raw: AspireWorkTicket): Record<string, string | null> {
  return {
    projectName: raw.title?.trim() || null,
    description: raw.description?.trim() || null,
    status: mapTicketStatus(raw.status),
    priority: mapPriority(raw.priority),
    scheduledDate: raw.scheduledDate ?? null,
    totalAmount: raw.totalAmount != null ? String(raw.totalAmount) : null,
  };
}

function diffWorkOrderFields(
  payload: Record<string, string | null>,
  existing: WorkOrder,
): Array<{ fieldName: string; aspireValue: string | null; irrigoValue: string | null }> {
  const diffs: Array<{ fieldName: string; aspireValue: string | null; irrigoValue: string | null }> = [];
  for (const [field, aspireValue] of Object.entries(payload)) {
    const irrigoRaw = (existing as unknown as Record<string, unknown>)[field];
    const irrigoValue = irrigoRaw != null ? String(irrigoRaw) : null;
    if (aspireValue !== irrigoValue) {
      diffs.push({ fieldName: field, aspireValue, irrigoValue });
    }
  }
  return diffs;
}

async function fetchAllAspireWorkTickets(companyId: number): Promise<AspireWorkTicket[]> {
  const all: AspireWorkTicket[] = [];
  let page = 1;
  while (true) {
    const resp = await request<AspireWorkTicketListResponse>(
      companyId, "GET",
      `${ASPIRE_WORK_TICKET_PATH}?page=${page}&pageSize=${ASPIRE_PAGE_SIZE}`,
    );
    const items = resp.items ?? resp.data ?? [];
    all.push(...items);
    if (items.length < ASPIRE_PAGE_SIZE) break;
    page++;
  }
  return all;
}

// ---------------------------------------------------------------------------
// syncWorkTickets
// ---------------------------------------------------------------------------

export async function syncWorkTickets(
  companyId: number,
  triggeredBy: "cron" | "manual_admin" | "manual_tenant" = "cron",
): Promise<{ recordsProcessed: number; recordsFailed: number }> {
  const jobId = await insertSyncJob(companyId, "work_tickets", triggeredBy);
  logger.info({ companyId, jobId }, "[aspire-sync-service] syncWorkTickets: starting");
  await setSyncJobRunning(jobId);

  let recordsProcessed = 0;
  let recordsFailed = 0;

  try {
    const dbMappings = await loadFieldMappings(companyId, "work_ticket");
    const tickets = await fetchAllAspireWorkTickets(companyId);

    logger.info({ companyId, jobId, count: tickets.length },
      "[aspire-sync-service] syncWorkTickets: fetched from Aspire");

    for (const raw of tickets) {
      const aspireId = String(raw.ticketId);
      const aspireCustomerId = String(raw.customerId);
      try {
        // Resolve parent customer
        const [custMap] = await db.select({ irrigoId: aspireEntityMap.irrigoId })
          .from(aspireEntityMap)
          .where(and(
            eq(aspireEntityMap.companyId, companyId),
            eq(aspireEntityMap.aspireEntity, "customer"),
            eq(aspireEntityMap.aspireId, aspireCustomerId),
          )).limit(1);

        if (!custMap?.irrigoId) {
          recordsFailed++;
          logger.warn({ companyId, jobId, aspireId, aspireCustomerId },
            "[aspire-sync-service] syncWorkTickets: parent customer not synced — skipping");
          continue;
        }

        // Cross-tenant guard on customer
        const [custRow] = await db.select({ id: customers.id }).from(customers)
          .where(and(eq(customers.id, custMap.irrigoId), eq(customers.companyId, companyId)))
          .limit(1);
        if (!custRow) {
          recordsFailed++;
          logger.warn({ companyId, jobId, aspireId },
            "[aspire-sync-service] syncWorkTickets: customer cross-tenant mismatch — skipping");
          continue;
        }

        const payload = buildWorkTicketPayload(raw);
        // Apply any custom DB field mappings on top of the built payload
        for (const m of dbMappings) {
          const rawVal = (raw as unknown as Record<string, unknown>)[m.aspireField];
          payload[m.irrigoField] = rawVal != null ? String(rawVal) : null;
        }
        const syncHash = hashPayload(payload as Record<string, unknown>);
        const entityMapRow = await findEntityMap(companyId, "work_ticket", aspireId);

        if (!entityMapRow) {
          // New work order — originWetCheckId left null per mission spec
          const woNumber = `WO-ASPIRE-${aspireId}-${Date.now()}`;
          const [newWo] = await db.insert(workOrders).values({
            companyId,
            customerId: custMap.irrigoId,
            workOrderNumber: woNumber,
            customerName: payload.projectName ?? "Aspire Ticket",
            customerEmail: "",
            projectName: payload.projectName ?? `Aspire Ticket ${aspireId}`,
            workType: "direct_billing",
            status: (payload.status ?? "pending") as string,
            priority: (payload.priority ?? "medium") as string,
            description: payload.description,
            totalAmount: payload.totalAmount ?? "0.00",
            // originWetCheckId intentionally null
          } as Parameters<typeof db.insert>[0] extends { values: (v: infer V) => unknown } ? V : never)
            .returning();

          await insertEntityMap({
            companyId,
            aspireEntity: "work_ticket",
            aspireId,
            irrigoEntity: "work_order",
            irrigoId: newWo.id,
            lastSyncedAt: new Date(),
            syncHash,
          });

          logger.info({ companyId, jobId, aspireId, irrigoId: newWo.id },
            "[aspire-sync-service] syncWorkTickets: created work order");
        } else if (entityMapRow.syncHash === syncHash) {
          await touchEntityMap(entityMapRow.id, syncHash);
        } else {
          if (entityMapRow.irrigoId == null) {
            recordsFailed++;
            logger.warn({ companyId, jobId, aspireId },
              "[aspire-sync-service] syncWorkTickets: entity-map irrigoId null — skipping");
          } else {
            const [existingWo] = await db.select().from(workOrders)
              .where(and(
                eq(workOrders.id, entityMapRow.irrigoId),
                eq(workOrders.companyId, companyId),
              )).limit(1);

            if (!existingWo) {
              recordsFailed++;
              logger.warn({ companyId, jobId, aspireId },
                "[aspire-sync-service] syncWorkTickets: missing/cross-tenant WO — skipping");
            } else {
              const diffs = diffWorkOrderFields(payload, existingWo);
              for (const d of diffs) {
                await recordFieldConflict({
                  companyId, aspireEntity: "work_ticket", aspireId,
                  irrigoEntity: "work_order", irrigoId: existingWo.id,
                  fieldName: d.fieldName, aspireValue: d.aspireValue, irrigoValue: d.irrigoValue,
                });
              }
              if (diffs.length > 0) {
                logger.info({ companyId, jobId, aspireId, irrigoId: existingWo.id, conflictCount: diffs.length },
                  "[aspire-sync-service] syncWorkTickets: conflict(s) enqueued — NOT overwriting");
              }
              await touchEntityMap(entityMapRow.id, syncHash);
            }
          }
        }

        recordsProcessed++;
      } catch (err) {
        recordsFailed++;
        logger.error({ companyId, jobId, aspireId, err },
          "[aspire-sync-service] syncWorkTickets: record error — continuing");
      }
    }

    await finishSyncJob(jobId, "completed", recordsProcessed, recordsFailed);
    logger.info({ companyId, jobId, recordsProcessed, recordsFailed },
      "[aspire-sync-service] syncWorkTickets: completed");
  } catch (topLevelErr) {
    const msg = topLevelErr instanceof Error ? topLevelErr.message : String(topLevelErr);
    await finishSyncJob(jobId, "failed", recordsProcessed, recordsFailed, msg).catch(() => {});
    logger.error({ companyId, jobId, err: topLevelErr },
      "[aspire-sync-service] syncWorkTickets: top-level error");
    throw topLevelErr;
  }

  return { recordsProcessed, recordsFailed };
}

// ---------------------------------------------------------------------------
// Invoice field helpers
// ---------------------------------------------------------------------------

function buildInvoicePayload(raw: AspireInvoice): Record<string, string | null> {
  return {
    invoiceNumber: raw.invoiceNumber ?? null,
    status: raw.status ?? null,
    totalAmount: raw.totalAmount != null ? String(raw.totalAmount) : null,
    dueDate: raw.dueDate ?? null,
    sentAt: raw.issuedDate ?? null,
  };
}

function diffInvoiceFields(
  payload: Record<string, string | null>,
  existing: Invoice,
): Array<{ fieldName: string; aspireValue: string | null; irrigoValue: string | null }> {
  const diffs: Array<{ fieldName: string; aspireValue: string | null; irrigoValue: string | null }> = [];
  for (const [field, aspireValue] of Object.entries(payload)) {
    const irrigoRaw = (existing as unknown as Record<string, unknown>)[field];
    const irrigoValue = irrigoRaw != null ? String(irrigoRaw) : null;
    if (aspireValue !== irrigoValue) {
      diffs.push({ fieldName: field, aspireValue, irrigoValue });
    }
  }
  return diffs;
}

async function fetchAllAspireInvoices(companyId: number): Promise<AspireInvoice[]> {
  const all: AspireInvoice[] = [];
  let page = 1;
  while (true) {
    const resp = await request<AspireInvoiceListResponse>(
      companyId, "GET",
      `${ASPIRE_INVOICE_PATH}?page=${page}&pageSize=${ASPIRE_PAGE_SIZE}`,
    );
    const items = resp.items ?? resp.data ?? [];
    all.push(...items);
    if (items.length < ASPIRE_PAGE_SIZE) break;
    page++;
  }
  return all;
}

// ---------------------------------------------------------------------------
// syncInvoices
// ---------------------------------------------------------------------------

/**
 * Conservative invoice sync: any field mismatch is ALWAYS queued for manual
 * review. Auto-resolution is explicitly forbidden for financial data.
 */
export async function syncInvoices(
  companyId: number,
  triggeredBy: "cron" | "manual_admin" | "manual_tenant" = "cron",
): Promise<{ recordsProcessed: number; recordsFailed: number }> {
  const jobId = await insertSyncJob(companyId, "invoices", triggeredBy);
  logger.info({ companyId, jobId }, "[aspire-sync-service] syncInvoices: starting");
  await setSyncJobRunning(jobId);

  let recordsProcessed = 0;
  let recordsFailed = 0;

  try {
    const aspireInvoices = await fetchAllAspireInvoices(companyId);
    logger.info({ companyId, jobId, count: aspireInvoices.length },
      "[aspire-sync-service] syncInvoices: fetched from Aspire");

    for (const raw of aspireInvoices) {
      const aspireId = String(raw.invoiceId);
      const aspireCustomerId = String(raw.customerId);
      try {
        // Resolve parent customer (same guard as other syncs)
        const [custMap] = await db.select({ irrigoId: aspireEntityMap.irrigoId })
          .from(aspireEntityMap)
          .where(and(
            eq(aspireEntityMap.companyId, companyId),
            eq(aspireEntityMap.aspireEntity, "customer"),
            eq(aspireEntityMap.aspireId, aspireCustomerId),
          )).limit(1);

        if (!custMap?.irrigoId) {
          recordsFailed++;
          logger.warn({ companyId, jobId, aspireId, aspireCustomerId },
            "[aspire-sync-service] syncInvoices: parent customer not synced — skipping");
          continue;
        }

        const [custRow] = await db.select({ id: customers.id, name: customers.name, email: customers.email })
          .from(customers)
          .where(and(eq(customers.id, custMap.irrigoId), eq(customers.companyId, companyId)))
          .limit(1);
        if (!custRow) {
          recordsFailed++;
          logger.warn({ companyId, jobId, aspireId },
            "[aspire-sync-service] syncInvoices: customer cross-tenant mismatch — skipping");
          continue;
        }

        const payload = buildInvoicePayload(raw);
        const syncHash = hashPayload(payload as Record<string, unknown>);
        const entityMapRow = await findEntityMap(companyId, "invoice", aspireId);

        if (!entityMapRow) {
          // New invoice — create with minimal safe defaults
          const now = new Date();
          const [newInv] = await db.insert(invoices).values({
            companyId,
            customerId: custMap.irrigoId,
            customerName: custRow.name,
            customerEmail: custRow.email ?? "",
            invoiceNumber: payload.invoiceNumber ?? `ASPIRE-${aspireId}`,
            status: payload.status ?? "draft",
            partsSubtotal: "0.00",
            laborSubtotal: "0.00",
            totalAmount: payload.totalAmount ?? "0.00",
            invoiceMonth: now.getMonth() + 1,
            invoiceYear: now.getFullYear(),
            periodStart: now,
            periodEnd: now,
            dueDate: payload.dueDate ? new Date(payload.dueDate) : null,
            sentAt: payload.sentAt ? new Date(payload.sentAt) : null,
          } as Parameters<typeof db.insert>[0] extends { values: (v: infer V) => unknown } ? V : never)
            .returning();

          await insertEntityMap({
            companyId,
            aspireEntity: "invoice",
            aspireId,
            irrigoEntity: "invoice",
            irrigoId: newInv.id,
            lastSyncedAt: new Date(),
            syncHash,
          });

          logger.info({ companyId, jobId, aspireId, irrigoId: newInv.id },
            "[aspire-sync-service] syncInvoices: created invoice");
        } else if (entityMapRow.syncHash === syncHash) {
          await touchEntityMap(entityMapRow.id, syncHash);
        } else {
          // Hash mismatch — ALWAYS queue for manual review, no exceptions.
          if (entityMapRow.irrigoId == null) {
            recordsFailed++;
            logger.warn({ companyId, jobId, aspireId },
              "[aspire-sync-service] syncInvoices: entity-map irrigoId null — skipping");
          } else {
            const [existingInv] = await db.select().from(invoices)
              .where(and(
                eq(invoices.id, entityMapRow.irrigoId),
                eq(invoices.companyId, companyId),
              )).limit(1);

            if (!existingInv) {
              recordsFailed++;
              logger.warn({ companyId, jobId, aspireId },
                "[aspire-sync-service] syncInvoices: missing/cross-tenant invoice — skipping");
            } else {
              const diffs = diffInvoiceFields(payload, existingInv);
              // Financial data: every diff is manual-review. Never auto-resolve.
              for (const d of diffs) {
                await recordFieldConflict({
                  companyId, aspireEntity: "invoice", aspireId,
                  irrigoEntity: "invoice", irrigoId: existingInv.id,
                  fieldName: d.fieldName, aspireValue: d.aspireValue, irrigoValue: d.irrigoValue,
                });
              }
              if (diffs.length > 0) {
                logger.info({
                  companyId, jobId, aspireId, irrigoId: existingInv.id, conflictCount: diffs.length,
                }, "[aspire-sync-service] syncInvoices: financial conflict(s) queued for MANUAL REVIEW — NOT overwriting");
              }
              await touchEntityMap(entityMapRow.id, syncHash);
            }
          }
        }

        recordsProcessed++;
      } catch (err) {
        recordsFailed++;
        logger.error({ companyId, jobId, aspireId, err },
          "[aspire-sync-service] syncInvoices: record error — continuing");
      }
    }

    await finishSyncJob(jobId, "completed", recordsProcessed, recordsFailed);
    logger.info({ companyId, jobId, recordsProcessed, recordsFailed },
      "[aspire-sync-service] syncInvoices: completed");
  } catch (topLevelErr) {
    const msg = topLevelErr instanceof Error ? topLevelErr.message : String(topLevelErr);
    await finishSyncJob(jobId, "failed", recordsProcessed, recordsFailed, msg).catch(() => {});
    logger.error({ companyId, jobId, err: topLevelErr },
      "[aspire-sync-service] syncInvoices: top-level error");
    throw topLevelErr;
  }

  return { recordsProcessed, recordsFailed };
}

// ---------------------------------------------------------------------------
// pushWorkOrderStatusToAspire — FIRE AND FORGET
// ---------------------------------------------------------------------------
//
// Called from the work order approval path AFTER the IrrigoPro transaction
// commits. Must NEVER throw in a way that prevents the approval from
// completing. An Aspire API outage is logged and recorded in aspire_sync_jobs
// but does not affect IrrigoPro state.
//
// If the work order has no entity-map row (native IrrigoPro order) this is
// a no-op.

export async function pushWorkOrderStatusToAspire(
  workOrderId: number,
  companyId: number,
): Promise<void> {
  // Look up entity-map: is this WO Aspire-originated?
  const mapRows = await db.select().from(aspireEntityMap)
    .where(and(
      eq(aspireEntityMap.companyId, companyId),
      eq(aspireEntityMap.irrigoEntity, "work_order"),
      eq(aspireEntityMap.irrigoId, workOrderId),
    )).limit(1);

  if (mapRows.length === 0) {
    // Native IrrigoPro work order — no push needed.
    logger.debug({ companyId, workOrderId },
      "[aspire-sync-service] pushWorkOrderStatusToAspire: no entity-map row — no-op");
    return;
  }

  const mapRow = mapRows[0];
  const aspireTicketId = mapRow.aspireId;

  // Load the current IrrigoPro WO status to push.
  const [wo] = await db.select({ status: workOrders.status, approvedAt: workOrders.approvedAt })
    .from(workOrders)
    .where(and(eq(workOrders.id, workOrderId), eq(workOrders.companyId, companyId)))
    .limit(1);

  if (!wo) {
    logger.warn({ companyId, workOrderId },
      "[aspire-sync-service] pushWorkOrderStatusToAspire: WO not found — skipping push");
    return;
  }

  // Attempt the push. Any failure is fire-and-forget.
  let pushJobId: number | null = null;
  try {
    pushJobId = await insertSyncJob(companyId, "push_work_ticket_status", "approval");
    await setSyncJobRunning(pushJobId);

    await request(companyId, "PATCH", `/WorkTickets/${aspireTicketId}`, {
      status: wo.status,
      approvedAt: wo.approvedAt?.toISOString() ?? null,
    });

    await finishSyncJob(pushJobId, "completed", 1, 0);
    logger.info({ companyId, workOrderId, aspireTicketId },
      "[aspire-sync-service] pushWorkOrderStatusToAspire: push succeeded");
  } catch (err) {
    // Log failure — do NOT re-throw. The approval already committed.
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ companyId, workOrderId, aspireTicketId, err },
      "[aspire-sync-service] pushWorkOrderStatusToAspire: PUSH FAILED (non-blocking)");
    if (pushJobId != null) {
      await finishSyncJob(pushJobId, "failed", 0, 1, msg).catch(() => {});
    }
  }
}

// =============================================================================
// MISSION 6 — Estimates, Contacts, Crews & Conflict Resolution
// =============================================================================

// ---------------------------------------------------------------------------
// Estimate lifecycle mapping
// ---------------------------------------------------------------------------
// deriveLifecycleForWrite(opts) rules (from lib/shared/src/lifecycle.ts):
//   status='approved' or 'converted_to_work_order' → lifecycle='approved'
//   status='rejected'                               → lifecycle='rejected'
//   internalStatus='draft'                          → lifecycle='draft'
//   internalStatus='sent_to_customer', status='pending' → lifecycle='sent'
//   default                                         → lifecycle='pending_review'
//
// Aspire estimate status → IrrigoPro three-column mapping:
//   'draft'     → status='pending', internalStatus='draft',              lifecycle='draft'
//   'pending'   → status='pending', internalStatus='pending_approval',   lifecycle='pending_review'
//   'sent'      → status='pending', internalStatus='sent_to_customer',   lifecycle='sent'
//   'approved'  → status='approved', internalStatus='sent_to_customer',  lifecycle='approved'
//   'rejected'  → status='rejected', internalStatus='sent_to_customer',  lifecycle='rejected'
//   default     → status='pending', internalStatus='pending_approval',   lifecycle='pending_review'

interface AspireEstimate {
  estimateId: string | number;
  customerId: string | number;
  title?: string | null;
  description?: string | null;
  status?: string | null;
  totalAmount?: string | number | null;
  laborAmount?: string | number | null;
  partsAmount?: string | number | null;
  estimateDate?: string | null;
}

interface AspireEstimateListResponse {
  items?: AspireEstimate[];
  data?: AspireEstimate[];
}

interface AspireContact {
  contactId: string | number;
  customerId: string | number;
  name: string;
  email?: string | null;
  phone?: string | null;
  role?: string | null;
  isPrimary?: boolean | null;
}

interface AspireContactListResponse {
  items?: AspireContact[];
  data?: AspireContact[];
}

interface AspireCrew {
  crewId: string | number;
  name: string;
  description?: string | null;
  members?: Array<{ name: string } | string>;
}

interface AspireCrewListResponse {
  items?: AspireCrew[];
  data?: AspireCrew[];
}

const ASPIRE_ESTIMATE_PATH = "/Estimates";
const ASPIRE_CONTACT_PATH = "/Contacts";
const ASPIRE_CREW_PATH = "/Crews";

/** Map Aspire estimate status string to IrrigoPro three-column tuple. */
function mapAspireEstimateStatus(raw: string | null | undefined): {
  status: string;
  internalStatus: string;
  lifecycle: string;
} {
  switch ((raw ?? "").toLowerCase()) {
    case "draft":
      return { status: "pending", internalStatus: "draft", lifecycle: "draft" };
    case "sent":
      return { status: "pending", internalStatus: "sent_to_customer", lifecycle: "sent" };
    case "approved":
      return { status: "approved", internalStatus: "sent_to_customer", lifecycle: "approved" };
    case "rejected":
      return { status: "rejected", internalStatus: "sent_to_customer", lifecycle: "rejected" };
    case "pending":
    default:
      return { status: "pending", internalStatus: "pending_approval", lifecycle: "pending_review" };
  }
}

async function fetchAllAspireEstimates(companyId: number): Promise<AspireEstimate[]> {
  const all: AspireEstimate[] = [];
  let page = 1;
  while (true) {
    const resp = await request<AspireEstimateListResponse>(
      companyId, "GET",
      `${ASPIRE_ESTIMATE_PATH}?page=${page}&pageSize=${ASPIRE_PAGE_SIZE}`,
    );
    const items = resp.items ?? resp.data ?? [];
    all.push(...items);
    if (items.length < ASPIRE_PAGE_SIZE) break;
    page++;
  }
  return all;
}

// ---------------------------------------------------------------------------
// syncEstimates
// ---------------------------------------------------------------------------

export async function syncEstimates(
  companyId: number,
  triggeredBy: "cron" | "manual_admin" | "manual_tenant" = "cron",
): Promise<{ recordsProcessed: number; recordsFailed: number }> {
  const jobId = await insertSyncJob(companyId, "estimates", triggeredBy);
  logger.info({ companyId, jobId }, "[aspire-sync-service] syncEstimates: starting");
  await setSyncJobRunning(jobId);

  let recordsProcessed = 0;
  let recordsFailed = 0;

  try {
    const aspireEstimates = await fetchAllAspireEstimates(companyId);
    logger.info({ companyId, jobId, count: aspireEstimates.length },
      "[aspire-sync-service] syncEstimates: fetched from Aspire");

    for (const raw of aspireEstimates) {
      const aspireId = String(raw.estimateId);
      const aspireCustomerId = String(raw.customerId);
      try {
        // Resolve parent customer
        const [custMap] = await db.select({ irrigoId: aspireEntityMap.irrigoId })
          .from(aspireEntityMap)
          .where(and(
            eq(aspireEntityMap.companyId, companyId),
            eq(aspireEntityMap.aspireEntity, "customer"),
            eq(aspireEntityMap.aspireId, aspireCustomerId),
          )).limit(1);

        if (!custMap?.irrigoId) {
          recordsFailed++;
          logger.warn({ companyId, jobId, aspireId, aspireCustomerId },
            "[aspire-sync-service] syncEstimates: parent customer not synced — skipping");
          continue;
        }

        // Cross-tenant guard
        const [custRow] = await db.select({ id: customers.id, name: customers.name, email: customers.email })
          .from(customers)
          .where(and(eq(customers.id, custMap.irrigoId), eq(customers.companyId, companyId)))
          .limit(1);
        if (!custRow) {
          recordsFailed++;
          logger.warn({ companyId, jobId, aspireId },
            "[aspire-sync-service] syncEstimates: customer cross-tenant mismatch — skipping");
          continue;
        }

        const statusCols = mapAspireEstimateStatus(raw.status);
        const totalAmount = raw.totalAmount != null ? String(raw.totalAmount) : "0.00";
        const partsSubtotal = raw.partsAmount != null ? String(raw.partsAmount) : "0.00";
        const laborSubtotal = raw.laborAmount != null ? String(raw.laborAmount) : "0.00";

        // Hash only the fields we diff — status changes always go to conflict queue.
        const hashPayloadObj = {
          title: raw.title ?? null,
          description: raw.description ?? null,
          totalAmount,
          partsSubtotal,
          laborSubtotal,
          aspireStatus: raw.status ?? null,
        };
        const syncHash = hashPayload(hashPayloadObj);
        const entityMapRow = await findEntityMap(companyId, "estimate", aspireId);

        if (!entityMapRow) {
          // New estimate: allocate a company-scoped estimate number.
          const estimateNumber = `ASPIRE-${aspireId}`;
          const [newEst] = await db.insert(estimates).values({
            companyId,
            customerId: custMap.irrigoId,
            customerName: custRow.name,
            customerEmail: custRow.email ?? "",
            estimateNumber,
            projectName: raw.title?.trim() || `Aspire Estimate ${aspireId}`,
            partsSubtotal,
            laborSubtotal,
            totalAmount,
            laborRate: "0.00",
            totalLaborHours: "0.00",
            createdBy: "Aspire Sync",
            // originWetCheckId intentionally null
            ...statusCols,
          } as typeof estimates.$inferInsert).returning();

          await insertEntityMap({
            companyId,
            aspireEntity: "estimate",
            aspireId,
            irrigoEntity: "estimate",
            irrigoId: newEst.id,
            lastSyncedAt: new Date(),
            syncHash,
          });

          logger.info({ companyId, jobId, aspireId, irrigoId: newEst.id },
            "[aspire-sync-service] syncEstimates: created estimate");
        } else if (entityMapRow.syncHash === syncHash) {
          await touchEntityMap(entityMapRow.id, syncHash);
        } else {
          if (entityMapRow.irrigoId == null) {
            recordsFailed++;
            logger.warn({ companyId, jobId, aspireId },
              "[aspire-sync-service] syncEstimates: entity-map irrigoId null — skipping");
          } else {
            const [existingEst] = await db.select().from(estimates)
              .where(and(
                eq(estimates.id, entityMapRow.irrigoId),
                eq(estimates.companyId, companyId),
              )).limit(1);

            if (!existingEst) {
              recordsFailed++;
              logger.warn({ companyId, jobId, aspireId },
                "[aspire-sync-service] syncEstimates: missing/cross-tenant estimate — skipping");
            } else {
              // Status mismatch: ALWAYS queue, never auto-resolve.
              if (existingEst.status !== statusCols.status ||
                  existingEst.internalStatus !== statusCols.internalStatus) {
                await recordFieldConflict({
                  companyId, aspireEntity: "estimate", aspireId,
                  irrigoEntity: "estimate", irrigoId: existingEst.id,
                  fieldName: "status",
                  // Raw Aspire status value (e.g. "approved", "draft", "sent").
                  // mapAspireEstimateStatus() is called fresh at resolution time.
                  aspireValue: raw.status ?? null,
                  // IrrigoPro's current lifecycle value for display in the conflict UI.
                  irrigoValue: existingEst.lifecycle ?? existingEst.status,
                });
                logger.info({ companyId, jobId, aspireId, irrigoId: existingEst.id },
                  "[aspire-sync-service] syncEstimates: status conflict queued — NOT auto-resolving");
              }

              // Non-status field diffs
              const fieldChecks: Array<[string, string | null, string | null]> = [
                ["projectName", raw.title?.trim() || null, existingEst.projectName],
                ["totalAmount", totalAmount, existingEst.totalAmount],
                ["partsSubtotal", partsSubtotal, existingEst.partsSubtotal],
                ["laborSubtotal", laborSubtotal, existingEst.laborSubtotal],
              ];
              for (const [field, aspireValue, irrigoValue] of fieldChecks) {
                if (aspireValue !== irrigoValue) {
                  await recordFieldConflict({
                    companyId, aspireEntity: "estimate", aspireId,
                    irrigoEntity: "estimate", irrigoId: existingEst.id,
                    fieldName: field, aspireValue, irrigoValue,
                  });
                }
              }
              await touchEntityMap(entityMapRow.id, syncHash);
            }
          }
        }

        recordsProcessed++;
      } catch (err) {
        recordsFailed++;
        logger.error({ companyId, jobId, aspireId, err },
          "[aspire-sync-service] syncEstimates: record error — continuing");
      }
    }

    await finishSyncJob(jobId, "completed", recordsProcessed, recordsFailed);
    logger.info({ companyId, jobId, recordsProcessed, recordsFailed },
      "[aspire-sync-service] syncEstimates: completed");
  } catch (topLevelErr) {
    const msg = topLevelErr instanceof Error ? topLevelErr.message : String(topLevelErr);
    await finishSyncJob(jobId, "failed", recordsProcessed, recordsFailed, msg).catch(() => {});
    logger.error({ companyId, jobId, err: topLevelErr },
      "[aspire-sync-service] syncEstimates: top-level error");
    throw topLevelErr;
  }

  return { recordsProcessed, recordsFailed };
}

// ---------------------------------------------------------------------------
// syncContacts — stores Aspire contacts as JSON on the customer row
// ---------------------------------------------------------------------------

export async function syncContacts(
  companyId: number,
  triggeredBy: "cron" | "manual_admin" | "manual_tenant" = "cron",
): Promise<{ recordsProcessed: number; recordsFailed: number }> {
  const jobId = await insertSyncJob(companyId, "contacts", triggeredBy);
  logger.info({ companyId, jobId }, "[aspire-sync-service] syncContacts: starting");
  await setSyncJobRunning(jobId);

  let recordsProcessed = 0;
  let recordsFailed = 0;

  try {
    // Fetch all contacts for this company from Aspire.
    const allContacts: AspireContact[] = [];
    let page = 1;
    while (true) {
      const resp = await request<AspireContactListResponse>(
        companyId, "GET",
        `${ASPIRE_CONTACT_PATH}?page=${page}&pageSize=${ASPIRE_PAGE_SIZE}`,
      );
      const items = resp.items ?? resp.data ?? [];
      allContacts.push(...items);
      if (items.length < ASPIRE_PAGE_SIZE) break;
      page++;
    }

    logger.info({ companyId, jobId, count: allContacts.length },
      "[aspire-sync-service] syncContacts: fetched from Aspire");

    // Group contacts by aspireCustomerId for batch update.
    const byCustomer = new Map<string, AspireContact[]>();
    for (const c of allContacts) {
      const key = String(c.customerId);
      if (!byCustomer.has(key)) byCustomer.set(key, []);
      byCustomer.get(key)!.push(c);
    }

    for (const [aspireCustomerId, contacts] of byCustomer) {
      try {
        const [custMap] = await db.select({ irrigoId: aspireEntityMap.irrigoId })
          .from(aspireEntityMap)
          .where(and(
            eq(aspireEntityMap.companyId, companyId),
            eq(aspireEntityMap.aspireEntity, "customer"),
            eq(aspireEntityMap.aspireId, aspireCustomerId),
          )).limit(1);

        if (!custMap?.irrigoId) {
          recordsFailed += contacts.length;
          logger.warn({ companyId, jobId, aspireCustomerId },
            "[aspire-sync-service] syncContacts: parent customer not synced — skipping group");
          continue;
        }

        // Cross-tenant guard
        const [custRow] = await db.select({ id: customers.id })
          .from(customers)
          .where(and(eq(customers.id, custMap.irrigoId), eq(customers.companyId, companyId)))
          .limit(1);
        if (!custRow) {
          recordsFailed += contacts.length;
          logger.warn({ companyId, jobId, aspireCustomerId },
            "[aspire-sync-service] syncContacts: customer cross-tenant mismatch — skipping group");
          continue;
        }

        // Build the JSON array to write — completely replaces any prior value.
        const externalContacts = contacts.map(c => ({
          aspireId: String(c.contactId),
          name: c.name,
          email: c.email ?? null,
          phone: c.phone ?? null,
          role: c.role ?? null,
          isPrimary: c.isPrimary ?? false,
        }));

        await db.update(customers)
          .set({
            externalContacts,
            updatedAt: new Date(),
          } as Partial<typeof customers.$inferInsert>)
          .where(and(eq(customers.id, custRow.id), eq(customers.companyId, companyId)));

        recordsProcessed += contacts.length;
        logger.info({ companyId, jobId, aspireCustomerId, irrigoId: custRow.id, count: contacts.length },
          "[aspire-sync-service] syncContacts: updated externalContacts on customer");
      } catch (err) {
        recordsFailed += contacts.length;
        logger.error({ companyId, jobId, aspireCustomerId, err },
          "[aspire-sync-service] syncContacts: group error — continuing");
      }
    }

    await finishSyncJob(jobId, "completed", recordsProcessed, recordsFailed);
    logger.info({ companyId, jobId, recordsProcessed, recordsFailed },
      "[aspire-sync-service] syncContacts: completed");
  } catch (topLevelErr) {
    const msg = topLevelErr instanceof Error ? topLevelErr.message : String(topLevelErr);
    await finishSyncJob(jobId, "failed", recordsProcessed, recordsFailed, msg).catch(() => {});
    logger.error({ companyId, jobId, err: topLevelErr },
      "[aspire-sync-service] syncContacts: top-level error");
    throw topLevelErr;
  }

  return { recordsProcessed, recordsFailed };
}

// ---------------------------------------------------------------------------
// syncCrews — populates aspire_crew_reference (display/reference only)
// ---------------------------------------------------------------------------

export async function syncCrews(
  companyId: number,
  triggeredBy: "cron" | "manual_admin" | "manual_tenant" = "cron",
): Promise<{ recordsProcessed: number; recordsFailed: number }> {
  const jobId = await insertSyncJob(companyId, "crews", triggeredBy);
  logger.info({ companyId, jobId }, "[aspire-sync-service] syncCrews: starting");
  await setSyncJobRunning(jobId);

  let recordsProcessed = 0;
  let recordsFailed = 0;

  try {
    const allCrews: AspireCrew[] = [];
    let page = 1;
    while (true) {
      const resp = await request<AspireCrewListResponse>(
        companyId, "GET",
        `${ASPIRE_CREW_PATH}?page=${page}&pageSize=${ASPIRE_PAGE_SIZE}`,
      );
      const items = resp.items ?? resp.data ?? [];
      allCrews.push(...items);
      if (items.length < ASPIRE_PAGE_SIZE) break;
      page++;
    }

    logger.info({ companyId, jobId, count: allCrews.length },
      "[aspire-sync-service] syncCrews: fetched from Aspire");

    for (const raw of allCrews) {
      const aspireId = String(raw.crewId);
      try {
        const memberNames: string[] = (raw.members ?? []).map(m =>
          typeof m === "string" ? m : m.name,
        );

        const syncHash = hashPayload({
          crewName: raw.name,
          description: raw.description ?? null,
          memberNames,
        });

        const entityMapRow = await findEntityMap(companyId, "crew", aspireId);

        if (!entityMapRow) {
          // Insert new crew reference row.
          const [newCrew] = await db.insert(aspireCrewReference).values({
            companyId,
            aspireId,
            crewName: raw.name,
            memberNames,
            description: raw.description ?? null,
          } satisfies Partial<InsertAspireCrewReference> as InsertAspireCrewReference)
            .returning();

          await insertEntityMap({
            companyId,
            aspireEntity: "crew",
            aspireId,
            irrigoEntity: "aspire_crew",
            irrigoId: newCrew.id,
            lastSyncedAt: new Date(),
            syncHash,
          });

          logger.info({ companyId, jobId, aspireId, irrigoId: newCrew.id },
            "[aspire-sync-service] syncCrews: created crew reference");
        } else if (entityMapRow.syncHash === syncHash) {
          await touchEntityMap(entityMapRow.id, syncHash);
        } else {
          // Update the reference row in-place (crews are display-only, no conflict queue).
          if (entityMapRow.irrigoId != null) {
            await db.update(aspireCrewReference)
              .set({
                crewName: raw.name,
                memberNames,
                description: raw.description ?? null,
                updatedAt: new Date(),
              })
              .where(and(
                eq(aspireCrewReference.id, entityMapRow.irrigoId),
                eq(aspireCrewReference.companyId, companyId),
              ));
          }
          await touchEntityMap(entityMapRow.id, syncHash);
          logger.debug({ companyId, jobId, aspireId },
            "[aspire-sync-service] syncCrews: updated crew reference");
        }

        recordsProcessed++;
      } catch (err) {
        recordsFailed++;
        logger.error({ companyId, jobId, aspireId, err },
          "[aspire-sync-service] syncCrews: record error — continuing");
      }
    }

    await finishSyncJob(jobId, "completed", recordsProcessed, recordsFailed);
    logger.info({ companyId, jobId, recordsProcessed, recordsFailed },
      "[aspire-sync-service] syncCrews: completed");
  } catch (topLevelErr) {
    const msg = topLevelErr instanceof Error ? topLevelErr.message : String(topLevelErr);
    await finishSyncJob(jobId, "failed", recordsProcessed, recordsFailed, msg).catch(() => {});
    logger.error({ companyId, jobId, err: topLevelErr },
      "[aspire-sync-service] syncCrews: top-level error");
    throw topLevelErr;
  }

  return { recordsProcessed, recordsFailed };
}

// ---------------------------------------------------------------------------
// resolveConflict
// ---------------------------------------------------------------------------
//
// Applies the winning value to the live IrrigoPro record, updates the
// entity-map syncHash so the next sync run doesn't re-flag it, and stamps
// the conflict_queue row resolved.
//
// resolution options:
//   'use_aspire'   — write aspireValue to the IrrigoPro field
//   'use_irrigo'   — keep irrigoValue; just dismiss the conflict
//   'manual_edit'  — write manualValue (caller must supply it)

export async function resolveConflict(
  conflictId: number,
  resolution: "use_aspire" | "use_irrigo" | "manual_edit" | "dismissed",
  resolvedByUserId: number,
  opts: { note?: string; manualValue?: string | null } = {},
): Promise<void> {
  // Load the conflict row — no companyId scoping here because the caller
  // is expected to be an admin who has already verified tenant ownership.
  const [conflict] = await db.select().from(aspireConflictQueue)
    .where(eq(aspireConflictQueue.id, conflictId))
    .limit(1);

  if (!conflict) {
    throw new Error(`[aspire-sync-service] resolveConflict: conflict ${conflictId} not found`);
  }
  if (conflict.status !== "pending") {
    throw new Error(
      `[aspire-sync-service] resolveConflict: conflict ${conflictId} is already ${conflict.status}`,
    );
  }

  const winningValue =
    resolution === "use_aspire" ? conflict.aspireValue
    : resolution === "use_irrigo" ? conflict.irrigoValue
    : resolution === "dismissed" ? null
    : (opts.manualValue ?? null);

  const statusMap: Record<typeof resolution, string> = {
    use_aspire: "resolved_use_aspire",
    use_irrigo: "resolved_use_irrigo",
    manual_edit: "resolved_manual_edit",
    dismissed: "dismissed",
  };

  // 'dismissed': mark the queue row without touching the live record or
  // resetting syncHash (per spec — dismissed doesn't guarantee permanent
  // suppression, just clears the current instance).
  if (resolution === "dismissed") {
    await db.update(aspireConflictQueue)
      .set({
        status: "dismissed",
        resolvedBy: resolvedByUserId,
        resolvedAt: new Date(),
        resolutionNote: opts.note ?? null,
        updatedAt: new Date(),
      })
      .where(eq(aspireConflictQueue.id, conflictId));
    logger.info(
      { conflictId, resolvedByUserId },
      "[aspire-sync-service] resolveConflict: dismissed — queue row marked, live record untouched",
    );
    return;
  }

  // Apply the winning value to the live IrrigoPro record — but only for
  // 'use_aspire' and 'manual_edit'. 'use_irrigo' keeps the existing value.
  if (resolution !== "use_irrigo" && conflict.irrigoId != null && winningValue !== null) {
    await applyConflictResolution(conflict, winningValue, resolution);
  }

  // Stamp the conflict row resolved.
  await db.update(aspireConflictQueue)
    .set({
      status: statusMap[resolution],
      resolvedBy: resolvedByUserId,
      resolvedAt: new Date(),
      resolutionNote: opts.note ?? null,
      updatedAt: new Date(),
    })
    .where(eq(aspireConflictQueue.id, conflictId));

  // Update entity-map syncHash so the next sync run treats this record as
  // resolved — prevents the same conflict from reappearing immediately.
  const entityMapRow = await findEntityMap(
    conflict.companyId,
    conflict.aspireEntity,
    conflict.aspireId,
  );
  if (entityMapRow) {
    // Invalidate the cached hash so the next sync re-diffs the record with
    // the now-resolved values. Setting it to null forces a full re-diff.
    await db.update(aspireEntityMap)
      .set({ syncHash: null, updatedAt: new Date() })
      .where(eq(aspireEntityMap.id, entityMapRow.id));
  }

  logger.info(
    { conflictId, resolution, resolvedByUserId, irrigoEntity: conflict.irrigoEntity, irrigoId: conflict.irrigoId },
    "[aspire-sync-service] resolveConflict: resolved",
  );
}

/**
 * Reverse of deriveLifecycleForWrite (from @workspace/shared).
 *
 * Maps an IrrigoPro lifecycle column value to the canonical three-column
 * triple (status, internalStatus, lifecycle) needed for a full atomic write.
 * Used exclusively by the manual_edit branch of applyConflictResolution,
 * where the human-supplied value is already in IrrigoPro's lifecycle
 * vocabulary (same as the pre-filled irrigoValue shown in the UI).
 *
 * Keep in sync with the forward direction in lifecycle.ts:
 *   approved → { status: "approved", internalStatus: "sent_to_customer" }
 *   rejected → { status: "rejected", internalStatus: "sent_to_customer" }
 *   sent     → { status: "pending",  internalStatus: "sent_to_customer" }
 *   draft    → { status: "pending",  internalStatus: "draft" }
 *   pending_review → { status: "pending", internalStatus: "pending_approval" }
 *
 * Callers MUST validate that `lifecycle` is one of the five stored values
 * before calling this function.
 */
function deriveStatusColumnsForLifecycle(lifecycle: string): {
  status: string;
  internalStatus: string;
  lifecycle: string;
} {
  switch (lifecycle) {
    case "approved":
      return { status: "approved",  internalStatus: "sent_to_customer", lifecycle: "approved" };
    case "rejected":
      return { status: "rejected",  internalStatus: "sent_to_customer", lifecycle: "rejected" };
    case "sent":
      return { status: "pending",   internalStatus: "sent_to_customer", lifecycle: "sent" };
    case "draft":
      return { status: "pending",   internalStatus: "draft",            lifecycle: "draft" };
    case "pending_review":
    default:
      // `pending_approval` is the canonical "freshly submitted for review" state.
      // We choose it over `approved_internal` here because a human entering
      // "pending_review" in the conflict-resolution box typically means
      // "back to the manager review queue", which is pending_approval.
      return { status: "pending",   internalStatus: "pending_approval", lifecycle: "pending_review" };
  }
}

/**
 * Routes the winning value to the correct IrrigoPro table and field.
 *
 * For estimate `status` conflicts the three-column discipline means we MUST
 * write all three of (status, internalStatus, lifecycle) atomically. The
 * behaviour depends on who is calling:
 *
 *   - Human resolution via 'use_aspire': winningValue is the Aspire-side
 *     status string (e.g. "approved"). We run it through mapAspireEstimateStatus
 *     to derive the correct triple and write all three columns.
 *   - Human resolution via 'use_irrigo': the IrrigoPro columns are already
 *     correct — nothing to write. Log and return.
 *   - Human resolution via 'manual_edit': winningValue uses IrrigoPro's own
 *     lifecycle vocabulary (draft/pending_review/sent/approved/rejected) —
 *     the same vocabulary pre-filled in the UI's input from conflict.irrigoValue.
 *     deriveStatusColumnsForLifecycle() derives the three-column triple.
 *   - Sync-time auto-diff: this function is NOT called from the sync path;
 *     recordFieldConflict is called instead. No change needed here.
 */
async function applyConflictResolution(
  conflict: typeof aspireConflictQueue.$inferSelect,
  winningValue: string,
  resolution: "use_aspire" | "use_irrigo" | "manual_edit",
): Promise<void> {
  const { irrigoEntity, irrigoId, fieldName, companyId } = conflict;
  if (irrigoId == null) return;

  try {
    if (irrigoEntity === "customer") {
      await db.update(customers)
        .set({ [fieldName]: winningValue, updatedAt: new Date() } as Partial<typeof customers.$inferInsert>)
        .where(and(eq(customers.id, irrigoId), eq(customers.companyId, companyId)));

    } else if (irrigoEntity === "estimate") {
      // Estimate status is a three-column system. Routing depends on resolution mode.
      if (fieldName === "status") {
        if (resolution === "use_aspire") {
          // aspireValue is the raw Aspire status string (e.g. "approved",
          // "draft", "sent"). Call mapAspireEstimateStatus() directly to
          // derive the canonical three-column triple — no composite-string
          // parsing, no separate logic that can drift from the mapping function.
          const statusTriple = mapAspireEstimateStatus(winningValue);
          await db.update(estimates)
            .set({
              status: statusTriple.status,
              internalStatus: statusTriple.internalStatus,
              lifecycle: statusTriple.lifecycle,
              updatedAt: new Date(),
            })
            .where(and(eq(estimates.id, irrigoId), eq(estimates.companyId, companyId)));
          logger.info({ conflictId: conflict.id, aspireRaw: winningValue, statusTriple },
            "[aspire-sync-service] applyConflictResolution (use_aspire): estimate status — wrote three-column triple via mapAspireEstimateStatus");
        } else if (resolution === "use_irrigo") {
          // IrrigoPro columns are already correct — nothing to write.
          logger.info({ conflictId: conflict.id },
            "[aspire-sync-service] applyConflictResolution (use_irrigo): estimate status — existing columns kept as-is");
        } else {
          // manual_edit for estimate status: the human-provided value uses
          // IrrigoPro's own lifecycle vocabulary (draft, pending_review, sent,
          // approved, rejected) — the same vocabulary already pre-filled in
          // the UI's input box from conflict.irrigoValue. Validate against that
          // set, then call deriveStatusColumnsForLifecycle() to produce the
          // canonical three-column triple. Writing only `status` in isolation
          // would break the internalStatus/lifecycle invariant.
          //
          // mapAspireEstimateStatus() is intentionally NOT called here — it
          // translates from Aspire's vocabulary, which is used by the sync
          // path and use_aspire resolution. This path starts from IrrigoPro's
          // lifecycle column value, so it needs the IrrigoPro-side reverse map.
          const VALID_IRRIGO_LIFECYCLE_INPUTS = new Set([
            "draft", "pending_review", "sent", "approved", "rejected",
          ]);
          const normalised = (winningValue ?? "").toLowerCase().trim();
          if (!VALID_IRRIGO_LIFECYCLE_INPUTS.has(normalised)) {
            throw new Error(
              `[aspire-sync-service] applyConflictResolution (manual_edit): ` +
              `"${winningValue}" is not a valid IrrigoPro estimate lifecycle status. ` +
              `Valid values: ${[...VALID_IRRIGO_LIFECYCLE_INPUTS].join(", ")}`,
            );
          }
          const statusTriple = deriveStatusColumnsForLifecycle(normalised);
          await db.update(estimates)
            .set({
              status: statusTriple.status,
              internalStatus: statusTriple.internalStatus,
              lifecycle: statusTriple.lifecycle,
              updatedAt: new Date(),
            })
            .where(and(eq(estimates.id, irrigoId), eq(estimates.companyId, companyId)));
          logger.info({ conflictId: conflict.id, winningValue, statusTriple },
            "[aspire-sync-service] applyConflictResolution (manual_edit): estimate status — derived via deriveStatusColumnsForLifecycle (IrrigoPro vocabulary), wrote three-column triple");
        }
        return;
      }
      await db.update(estimates)
        .set({ [fieldName]: winningValue, updatedAt: new Date() } as Partial<typeof estimates.$inferInsert>)
        .where(and(eq(estimates.id, irrigoId), eq(estimates.companyId, companyId)));

    } else if (irrigoEntity === "work_order") {
      await db.update(workOrders)
        .set({ [fieldName]: winningValue, updatedAt: new Date() } as Partial<typeof workOrders.$inferInsert>)
        .where(and(eq(workOrders.id, irrigoId), eq(workOrders.companyId, companyId)));

    } else if (irrigoEntity === "invoice") {
      await db.update(invoices)
        .set({ [fieldName]: winningValue, updatedAt: new Date() } as Partial<typeof invoices.$inferInsert>)
        .where(and(eq(invoices.id, irrigoId), eq(invoices.companyId, companyId)));

    } else {
      logger.warn({ irrigoEntity, irrigoId, fieldName },
        "[aspire-sync-service] applyConflictResolution: unhandled irrigoEntity — skipping field write");
    }
  } catch (err) {
    logger.error({ conflictId: conflict.id, irrigoEntity, irrigoId, fieldName, err },
      "[aspire-sync-service] applyConflictResolution: field write failed");
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Exports for testing / future missions
// ---------------------------------------------------------------------------

// The `_` prefix signals test/internal use only.
export {
  recordFieldConflict as _recordFieldConflict,
  insertSyncJob as _insertSyncJob,
  finishSyncJob as _finishSyncJob,
  hashPayload as _hashPayload,
  diffCustomerFields as _diffCustomerFields,
  buildCustomerPayload as _buildCustomerPayload,
  buildWorkTicketPayload as _buildWorkTicketPayload,
  buildInvoicePayload as _buildInvoicePayload,
  diffWorkOrderFields as _diffWorkOrderFields,
  diffInvoiceFields as _diffInvoiceFields,
  mapAspireEstimateStatus as _mapAspireEstimateStatus,
  applyConflictResolution as _applyConflictResolution,
};
