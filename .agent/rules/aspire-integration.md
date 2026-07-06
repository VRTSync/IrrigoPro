---
name: Aspire Integration Guardrails
description: Non-negotiable rules for all Aspire integration work
---

These rules apply to every file touched under the Aspire integration effort
(new tables prefixed aspire_/external_, services in server/services/aspire-*,
routes under /api/company/:companyId/integrations/aspire and
/api/super-admin/integrations/aspire).

1. Every new route MUST call requireAuthentication. No exceptions — two
   unauthenticated routes already caused a critical incident in this codebase
   (POST /api/admin/reset-users, POST /api/reset-randy-password). Do not
   repeat that pattern.

2. Every new or touched storage method MUST take companyId as a required,
   non-optional parameter, and MUST use it in the WHERE clause. Existing
   methods like getCustomer(id) and getEstimates() in storage.ts do NOT
   enforce companyId — do not copy that pattern. Follow the discipline used
   in the irrigation-profile methods (listIrrigationControllers,
   getIrrigationController, etc.) instead — they are the best-scoped code
   in the codebase and are the reference implementation.

3. Follow the existing DbExecutor pattern from storage.ts for any method
   that needs to participate in a transaction (accept `db` or `tx`).

4. Never return encryptedClientId, encryptedClientSecret, or
   encryptedAccessToken in any API response, log line, or error message.
   Tenant-facing responses show only a masked preview
   (e.g. "XXXX...abc4") and status fields.

5. Aspire credentials are the first properly-encrypted credential store in
   this codebase (the existing quickbooks_integration table stores tokens
   in plaintext — that is a known gap, not a pattern to copy). Use
   AES-256-GCM via Node's crypto module as specified in the architecture
   doc. Decrypt only inside aspire-token-service.ts, immediately before use.

6. If a sync operation touches the estimates table, write all three status
   columns (lifecycle, status, internalStatus) — see existing estimate
   write paths for the pattern. Aspire-originated estimates must NOT set
   originWetCheckId; use the aspire_entity_map table for lineage instead.

7. Every cron run and every manual sync trigger MUST write a row to
   aspire_sync_jobs before starting and update it on completion or failure.
   No silent runs.

8. A detected field conflict MUST NOT throw and stop the sync run. Write it
   to aspire_conflict_queue and continue processing the rest of that batch.

9. ASPIRE_ENCRYPTION_KEY must be checked for existence at server startup,
   failing hard if missing — same pattern as the existing SESSION_SECRET
   check in app.ts.

10. If any step in a mission reveals that a file, table, or method assumed
    to exist does not — STOP and surface it in the mission report rather
    than improvising a workaround.
