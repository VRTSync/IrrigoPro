# Production run record — `retire-followup-work-orders-v1`

**Status: NOT RUN — blocked on a publish.** Pre-run facts below were read from the
production replica on **2026-09-21**. The run itself, and the post-run verification,
must be done by a person on the deployed Super Admin → DB Migrations page.

This file is the green-light record the schema-drop task cites. Sections marked
`TO BE FILLED BY THE OPERATOR` are the parts that only the live run can produce.

---

## 1. Deployment check — currently FAILING

The migration is registered in `main` at commit `9200c5d7`
("Add retire-followup-work-orders-v1 migration and swap the registry",
2026-09-21 16:52 UTC).

The most recent publish marker in the repo is commit `6ce5d798`
("Published your App", 2026-09-16 20:57 UTC) — three commits behind, and *before*
the migration commit. The live deployment (`https://irrigopro.com`, autoscale,
build healthy) therefore does not carry the migration yet.

Corroborating: production `app_settings` contains only the **old**
`woodglennFollowup` key (written 2026-08-12); there is no
`retireFollowupWorkOrders.done` marker.

**Action required before anything else: publish the current `main`.** Then, on the
deployed DB Migrations page, confirm:

- [ ] `retire-followup-work-orders-v1` appears in the list.
- [ ] `woodglenn-followup-v1` no longer appears (it was removed from the registry in the same commit).
- [ ] The target banner reads **PRODUCTION**.

---

## 2. Pre-run state of the four named records (production replica, 2026-09-21)

All four resolve, all belong to company `1` (Woodglenn Squares HOA), and all are in
status `assigned` — which is cancellable, so the preflight should pass and no abort
condition applies.

| Role | Work order | id | Status before | Company | Customer | Parent | Items |
|---|---|---|---|---|---|---|---|
| Phantom | `WO-1787333695634-675` | 71 | `assigned` | 1 | Woodglenn Squares HOA | `WO-1785869241143-67` (id 63, **billed**) | 3 |
| Phantom | `WO-1787333883734-723` | 72 | `assigned` | 1 | Woodglenn Squares HOA | `WO-1785869264925-44` (id 64, **billed**) | 4 |
| Phantom | `WO-1787334011979-485` | 73 | `assigned` | 1 | Woodglenn Squares HOA | `WO-1785869292161-458` (id 65, **billed**) | 1 |
| **Keeper** | `WO-1786572356558-607` | 68 | `assigned` | 1 | Woodglenn Squares HOA | `WO-1783955816671-314` (id 50, **billed**) | 18 |

The three phantoms carry exactly the quoted-but-substituted PVC repair parts
described in the migration header (slip-fix couplers, glue & primer, one scrubber
valve); the keeper carries 18 items, matching the genuine outstanding-work record.
Every parent is already `billed`, so none of the phantoms can be reconciled back.

Expected after the run: phantoms 71/72/73 → `cancelled`; keeper 68 unchanged at
`assigned`, id 68, 18 items.

---

## 3. Extras inventory — **one extra row, needs a decision**

The preview enumerates every work order with a non-null `parent_work_order_id`.
Production currently holds **five** such rows: the four named above, plus one more.

| Work order | id | Status | Company | Customer | Parent | Created | Items |
|---|---|---|---|---|---|---|---|
| `WO-1787249305968-950` | 70 | `assigned` | 1 | **Artisan Plazas II** | `WO-1787248352103-317` (id 69, **billed**) | 2026-08-20 18:08 UTC | 1 |

Evidence gathered for triage:

- It was auto-created by the same deferred-items mechanism, one day before the three
  Woodglenn phantoms, within seconds of its parent being completed
  (parent `updated_at` 18:08:25.781, child `created_at` 18:08:25.985).
- Parent id 69 (`estimate_based`, Artisan Plazas II) is already **billed**, and its
  four line items are the wire-repair parts actually used: irrigation box, wire
  locator rental, DBR/Y gel kits, 14-gauge wire.
- The child carries a single leftover quoted line: **Wire Nuts Waterproof ×24,
  $82.08, 0 labor hours** — i.e. the one quoted consumable the tech did not use
  (the gel kits cover the same splice). This has the same signature as the Woodglenn
  phantoms: a billed parent, zero labor, one unused consumable.

**This migration will not touch it.** It is reported as a `finding_extra_…` step only.

**Triage decision (recorded 2026-09-21):** **Same phantom pattern — it needs
retiring too, in a separate task.** It is deliberately left out of
`retire-followup-work-orders-v1`, whose named set was verified against the Woodglenn
data only; widening that migration's write set to a customer it was never checked
against is not something to do on the day of the run.

This is the record the schema drop needs. Row 70's lineage is now written down here,
so dropping `parent_work_order_id` no longer destroys the only explanation of where
it came from — but the row itself is still `assigned` in Artisan Plazas II's active
queue until its own retirement task runs.

---

## 4. Run — `TO BE FILLED BY THE OPERATOR`

Preview first and read all of it, then Run Migration. Capture the per-step outcome:

| Step | Expected | Observed |
|---|---|---|
| `preflight` | success | |
| `cancel_WO-1787333695634-675` | success, 1 row | |
| `cancel_WO-1787333883734-723` | success, 1 row | |
| `cancel_WO-1787334011979-485` | success, 1 row | |
| `keep_WO-1786572356558-607` | skipped, 0 rows | |
| `finding_extra_WO-1787249305968-950` | skipped, reported only | |
| `verify` | success | |

Job state: ______ Finished at: ______

---

## 5. Verification from fresh reads — `TO BE FILLED BY THE OPERATOR`

The run's own report is not evidence. Re-read after the run:

- [ ] `WO-1787333695634-675` → `cancelled`
- [ ] `WO-1787333883734-723` → `cancelled`
- [ ] `WO-1787334011979-485` → `cancelled`
- [ ] `WO-1786572356558-607` → still `assigned`, id 68, 18 items, untouched
- [ ] One cancelled work order's **Activity** tab shows the audit entry:
      action `work_order.cancelled`, actor `super_admin_migration`, severity
      `warning`, summary naming `retire-followup-work-orders-v1` and the parent
      work order number.
- [ ] Woodglenn Squares HOA → **Jobs** tab: the three phantoms are out of the active
      lane, `WO-1786572356558-607` is still there.

---

## 6. Idempotency — `TO BE FILLED BY THE OPERATOR`

Run it a second time:

- [ ] The three `cancel_…` steps report **skipped**, 0 rows.
- [ ] The keeper step still reports skipped.
- [ ] Nothing else changes; the four statuses re-read the same as in section 5.

---

## 7. Green light — `TO BE FILLED BY THE OPERATOR`

Signed off by: ______  Date: ______

- Four named ids resolved, before → after statuses recorded (sections 2 and 5).
- Extras list read: 1 extra row (`WO-1787249305968-950`), decision recorded (section 3).
- Keeper `WO-1786572356558-607` confirmed unmodified.

Only with all three above filled in may the schema-drop task push
`parent_work_order_id` removal to production.

---

## 8. Schema drop — code landed, production push still gated

The schema-drop task has removed `parentWorkOrderId` and
`work_orders_follow_up_unique_idx` from `lib/db/src/schema/schema.ts`, and the drop
is applied and verified on the **dev** database (column absent, follow-up index
absent, `origin_wet_check_id` and the estimate / status-scheduled indexes intact).
The DDL record carries it as `lib/db/migrations/0022_drop_work_order_parent_follow_up.sql`,
an idempotent reversal of `0019`; `0019` itself stays, matching how
`0018_document_controller_fk_drop_legacy.sql` recorded an earlier drop.

**The production schema push has NOT happened and must not happen yet.** Sections 4
through 7 above are still unfilled, so the gate is closed. Concretely, before
anyone confirms a destructive production schema change that drops
`parent_work_order_id`:

1. Publish `main` so the deployed build carries `retire-followup-work-orders-v1`
   (section 1 is still failing).
2. Run and verify the migration on the deployed Super Admin → DB Migrations page
   (sections 4–6).
3. Confirm the extras decision for `WO-1787249305968-950` is still the recorded one
   (section 3) — its lineage is written down here, which is what keeps the drop from
   destroying the only explanation of that row.

Note that the migration code itself intentionally still references
`parent_work_order_id`: it reads the column through raw SQL and has an explicit
"column no longer exists" branch, so it keeps working before *and* after the drop.
That is not leftover retirement code and should not be deleted to satisfy a grep.
