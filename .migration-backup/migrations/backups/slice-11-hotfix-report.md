# Slice 11 Hotfix — Diagnostic Report

**Date:** 2026-05-06
**Outcome:** **Path C** per the hotfix prompt — production state is *unexpected* in a benign way: the two zone-related FK constraints already exist under the exact Drizzle-expected names. No DB rename and no migration-file edit are required. Re-publishing is the correct next action; no further code change is needed from this task.

## Step 1 — Diagnostic results (run against production, read-only replica)

### Query A — actual FK constraint names on the two zone_id columns

| table_name        | constraint_name                                       | definition                                              |
| ----------------- | ----------------------------------------------------- | ------------------------------------------------------- |
| estimate_items    | `estimate_items_zone_id_estimate_zones_id_fk`         | FOREIGN KEY (zone_id) REFERENCES estimate_zones(id)     |
| work_order_items  | `work_order_items_zone_id_estimate_zones_id_fk`       | FOREIGN KEY (zone_id) REFERENCES estimate_zones(id)     |

**Both constraints are already named exactly what the failing migration's `DROP CONSTRAINT` statements target.** Neither the legacy `_fkey` form (Path A) nor a missing constraint (Path B) is present.

### Query B — half-applied state check

| photo_late_additions_exists | estimate_zones_still_exists |
| --------------------------- | --------------------------- |
| (null)                      | `estimate_zones`            |

`photo_late_additions` was **not** created and `estimate_zones` is still present. Per the prompt's Step 3 mapping this is "the migration was atomic and rolled back cleanly. Nothing to undo." → safe to proceed.

### Query C — billing counter intact

| counter_rows |
| ------------ |
| 1            |

`billing_number_counters` was not affected by the failed migration attempt — Slice 11's primary save (declaring it in `shared/schema.ts`) is holding.

### Bonus diagnostics

- **`wet_check_findings` rows violating the new `wet_check_finding_single_target` CHECK constraint:** **0**. The new CHECK constraint can be added without rejecting existing data.
- **Inventory of legacy `_fkey`-named FK constraints in production** (drift candidates outside this hotfix's scope, useful for the follow-up audit slice):
  - `issue_type_configs_company_id_fkey`
  - `wet_check_photos_*_fkey` ×4
  - `wet_check_zone_records_*_fkey` ×2
  - `wet_checks_*_fkey` ×4
  - `property_controllers_*_fkey` ×3
  - `wet_check_findings_*_fkey` ×7

  None of these tables are touched by the Slice 11 / 10a migration set, so they will not bite this deploy. They remain a latent drift hazard for any future migration that drops/renames their FKs.

## Step 2 — Path selection: **Path C (stop and report)**

The hotfix prompt's path selection assumes either:

- **Path A:** constraints exist under PostgreSQL's default `_fkey` naming → rename them in the live DB.
- **Path B:** zone constraints do not exist at all → make the migration's `DROP CONSTRAINT` idempotent with `IF EXISTS`.
- **Path C:** anything else → stop and report.

Production already has the constraints under the **new Drizzle naming convention** that the migration targets. That means:

1. There is nothing to rename. The migration's `DROP CONSTRAINT` statements will succeed as-written on the next attempt.
2. There is no static migration file in this repo that contains those `DROP CONSTRAINT` statements to edit. Replit's Publish flow auto-generates the SQL diff at publish time from `shared/schema.ts` against the live DB. The three checked-in files in `migrations/` (`0000_wet_check_capture.sql`, `0001_little_stature.sql`, `0002_billing_sheet_pin.sql`) contain **no** `DROP CONSTRAINT` or `DROP TABLE` statements (verified via `rg -n "DROP CONSTRAINT|DROP TABLE" migrations/` → 0 hits), so there is nothing to defensively wrap with `IF EXISTS` here.

The most likely cause of the original failure: a transient race between Drizzle's snapshot and the live DB during the previous publish attempt, or the constraints were renamed out-of-band between the failure and now. Either way, the live state today matches what the regenerated diff will target, so the **next publish should run cleanly without any code or DB change**.

## Step 3 — Half-applied state: clean

Per Query B, the migration was atomic and rolled back. No cleanup needed.

## Step 4 — Re-run the deploy

Cannot be performed from this task — Replit's Publish UI is the only supported path for production schema changes (per `.local/skills/database/references/database-migrations-on-publish.md`). Hand-off to the user:

> **Action:** Click **Publish** again. The publish flow will regenerate the SQL diff, surface any rename/destructive prompts, and apply it. The constraints it expects to drop now exist under the exact target names, so the previous "constraint does not exist" error should not recur.
>
> If a different constraint trips the same `does not exist` pattern, capture the constraint name from the publish error and re-run Query A scoped to that table — that's a new drift case for a follow-up.

## Step 5 — Smoke tests

Cannot be executed pre-publish from this task. After the user re-publishes, the prompt's Step-5 smoke tests should be run against production:

1. Re-run Query C → expect `counter_rows = 1` (unchanged from pre-deploy).
2. Create one billing sheet through the app → expect a sequential billing number (one greater than the previous max).
3. Load wet-check / estimate / work-order pages → expect no errors.
4. Create one wet-check finding → expect success (Query A bonus check shows 0 existing violators of the new CHECK constraint, so this should pass).
5. Confirm `to_regclass('estimate_zones') IS NULL` and `to_regclass('photo_late_additions') = 'photo_late_additions'`.

## Step 6 — Final report

- **Path taken:** **C** (state matches neither A nor B; constraints already correctly named).
- **Before/after constraint names:** unchanged — `estimate_items_zone_id_estimate_zones_id_fk` and `work_order_items_zone_id_estimate_zones_id_fk` are already in production with those exact names.
- **Migration diff:** none required (no static migration file in repo carries the failing statements; Replit Publish generates them on demand).
- **Pre-deploy `billing_number_counters` row count:** 1 (post-deploy verification deferred to user).
- **Smoke tests:** deferred to post-publish; preconditions verified (counter intact, no CHECK-constraint violators).

## Files changed by this task

Diagnostic-only outcome. Nothing in `shared/schema.ts` or in any `migrations/*.sql` file needs to change to unblock the next publish. Only this report (`migrations/backups/slice-11-hotfix-report.md`) is added.

## Escalation / unblock plan (since Path C is final agent-side state)

The agent cannot:

- Run DDL against the production database (per `.local/skills/database/references/database-migrations-on-publish.md`, production access is read-only and DDL must go through Replit's Publish UI).
- Trigger a Replit publish/deploy.
- Exercise the live billing-sheet creation flow against production.

Therefore Steps 4-5 of the hotfix prompt (re-run the deploy, post-deploy smoke tests) require the **user** to act:

1. **User clicks Publish.** The publish flow regenerates the SQL diff and applies it. Based on this report's diagnostics, the prior failure point (the two zone FK drops) is no longer a blocker — the constraints already exist under the names the diff targets.
2. If publish succeeds, the user runs the Step-5 smoke tests listed above.
3. If publish fails again, the user pastes the new error here. The most likely follow-up case is another constraint hitting the same `_fkey` drift (see the legacy `_fkey` inventory above) — that's a one-line rename diagnostic, not a structural problem.

No code, schema, or migration-file edit is appropriate for the agent to make right now: there is nothing in the repo that, if changed, would alter the SQL the next publish generates for these specific constraints.
