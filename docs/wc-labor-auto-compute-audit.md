# WC Labor Auto-Compute Audit
**Date:** 2026-05-28  
**Auditor:** Task #1024 (Slice 1 — Diagnose Only)  
**Scope:** `_recomputeZoneRepairLaborIfAuto` zero-labor root cause; blast-radius on production DB; read-path mapping; Slice 2/3 recommendations.

---

## 1. Reproducer Summary — WC-2026-1027 (Villas at the Boulders)

**Symptom:** 50 repairs across 31 zones, all repair labor displayed as "auto 0.00". Repair Labor Subtotal = $0.00 against $428.06 parts. The billing sheet was submitted with no labor revenue captured.

**WC-2026-1027 is not isolated.** Production queries (run 2026-05-28) show **15 submitted WCBs across High Plains Property Maintenance** with the same defect — all have non-zero parts and exactly $0.00 labor. None have been invoiced yet (Q2 = 0 rows). The Slice 3 backfill must be run before any of these 15 WCBs are invoiced.

**Billing path for WC-2026-1027:**  
`wet_checks` → `wet_check_zone_records` → `wet_check_findings` → `wet_check_billings`  
Labor source: `wet_check_zone_records.repair_labor_hours` (Slice 4 Option B, Task #753)

---

## 2. Step A — Root Cause Diagnosis

### Hypothesis evaluation

Three hypotheses were evaluated by inspecting `_recomputeZoneRepairLaborIfAuto` (`storage.ts:7673–7707`) against the database state:

| Hypothesis | Description | Production Verdict |
|---|---|---|
| H1 | Company missing `issue_type_configs` rows → empty Map → 0.00 | **Ruled out** — Q4 = 0 rows; all companies have catalog rows |
| H2 | Finding `issueType` strings don't match catalog keys → Map.get() miss → 0.00 | **Ruled out** — Q3 = 0 rows; all issueTypes match their company catalog |
| H3 | Zone records created **before Task #891** added the `_recomputeZoneRepairLaborIfAuto` call to `createWetCheckFinding` → column stays at default `0.00`, never updated | **CONFIRMED primary cause** |

### H3 confirmation evidence

Dev DB diagnostic query (Q0, run 2026-05-28): **All 1,031 dev findings** sit on zone records with `repair_labor_hours = 0.00`. Every affected company had 10 issue_type_configs rows seeded before those findings were created. If `_recomputeZoneRepairLaborIfAuto` had fired correctly, zone labor would be non-zero. It is zero universally — the call was never made.

Production confirmation: Q5 shows 15/39 WCBs (38.5%) for High Plains Property Maintenance have zero repair labor despite non-zero parts.

**Root cause:** Task #891 added `_recomputeZoneRepairLaborIfAuto` to `createWetCheckFinding` and `updateWetCheckFinding`, but all findings that existed at the time of that deploy — and any findings created through bulk seed or direct DB insert paths that bypassed those functions — were never backfilled. The `repair_labor_hours` column stays at its schema default of `0.00`.

### Manual walk of `_recomputeZoneRepairLaborIfAuto` for one zone (zone_record_id = 1, 1× head_replacement)

```
storage.ts:7673 — _recomputeZoneRepairLaborIfAuto(db, zoneRecordId=1, companyId=99)

  Line 7678: SELECT repairLaborManuallySet FROM wet_check_zone_records WHERE id=1
             → { repairLaborManuallySet: false }  ← does NOT return early

  Line 7686: SELECT issueType FROM wet_check_findings WHERE zoneRecordId=1
             → [{ issueType: "head_replacement" }]  ← findings.length = 1

  Line 7693: SELECT issueType, defaultLaborHours FROM issue_type_configs WHERE companyId=99
             → [10 rows including { issueType: "head_replacement", defaultLaborHours: "0.25" }]
             configMap = { head_replacement → "0.25", ... }

  Line 7698: for f of findings:
               raw = configMap.get("head_replacement") = "0.25"
               totalHours += parseFloat("0.25") = 0.25

  Line 7704: UPDATE wet_check_zone_records SET repairLaborHours="0.25" WHERE id=1

  Expected result: repairLaborHours = "0.25"
  Actual result in DB: repairLaborHours = "0.00"
  Conclusion: the function was NEVER CALLED for this zone record.
```

The function itself is correct. The problem is that it was never invoked for historical findings.

### Secondary bug — quantity not factored (storage.ts:7700)

```typescript
// storage.ts:7700 (current)
if (raw) totalHours += parseFloat(String(raw)) || 0;
```

`finding.quantity` is **never read**. A zone with a `head_replacement` finding at quantity=3 adds `0.25 h` instead of `0.75 h`. This under-reports labor for any finding with quantity > 1.

The `wet_check_findings.quantity` column is typed `integer NOT NULL` (schema.ts:1344). The fix in Slice 2:

```typescript
// Slice 2 fix (proposed)
if (raw) totalHours += (parseFloat(String(raw)) || 0) * (f.quantity ?? 1);
```

**Recommendation:** Fix this in Slice 2 alongside the backfill trigger. See Section 6.

---

## 3. Step B — Labor Read-Path Table

Every surface that displays repair labor for a WCB traces back to `wet_check_zone_records.repair_labor_hours`. An incorrect value in that column flows through all surfaces simultaneously.

| Surface | File | Key lines | Reads from | Would show $0 for WC-2026-1027? |
|---|---|---|---|---|
| **WC Sheet Totals card** (Repair Labor Subtotal) | `wet-check-billing-view.tsx` (frontend) | 491–494 | `view.laborSubtotal` from `WetCheckBillingView` payload, which is `SUM(zone.zoneLaborSubtotal)` | **Yes — $0.00** |
| **WCB view modal** (Repairs Summary table, Repair Hrs column) | `wet-check-billing-view.tsx` (frontend) | 358–374 | `zone.repairLaborHours` from `WetCheckBillingView` payload | **Yes — 0.00 per zone** |
| **buildWetCheckBillingView** (assembler, both BS and WCB paths) | `artifacts/api-server/src/wet-check-billing-view.ts` | 225–226 | `zr.repairLaborHours` from `wet_check_zone_records` row | **Yes — reads the 0.00 column** |
| **getBillingSheetWetCheckView** (legacy BS path) | `artifacts/api-server/src/storage.ts` | 4161–4253 | Loads zone records from DB, passes to `buildWetCheckBillingView` | **Yes — 0.00 column propagates** |
| **getWetCheckBillingViewById** (WCB path) | `artifacts/api-server/src/storage.ts` | 4264–4358 | Same pattern as above | **Yes** |
| **WetCheckDetail labor pill** (field-tech detail page, chip rail) | `artifacts/irrigopro/src/pages/wet-checks/WetCheckDetail.tsx` | 493–496 | `allFindings` counts and `wc.totalLaborHours` (inspection overhead only, not repair labor) | Not directly affected; no per-zone repair labor shown in field-tech UI |
| **WetCheckReviewPage** (Est. Value column) | `artifacts/irrigopro/src/pages/wet-check-review.tsx` | 26, 100 | `wc.totalBillable` from `GET /api/wet-checks/pending-review` payload | Depends on server aggregation; if derived from WCB totals → **Yes, $0.00** |
| **PDF view-model** | `artifacts/api-server/src/pdf-view-model.ts`, `pdf-helpers.ts:527` | via `WetCheckBillingView.zones` | `zone.repairLaborHours` from assembled view | **Yes — $0.00 on invoice PDF** |
| **Wet check summary CSV export** | `artifacts/irrigopro/src/lib/wet-check-csv.ts` | 105, 127 | `zone.repairLaborHours ?? "0.00"` directly from the `WetCheckWithDetails` API response | **Yes — 0.00 per zone row** |
| **WCB totals (billing_sheets row)** | `wet_check_billings.labor_subtotal`, computed at WCB creation | WCB insert | `SUM(zone.repairLaborHours) × laborRate` at snapshot time | **Yes — $0.00 baked in at creation** |

**Key observation:** Because `labor_subtotal` is a snapshotted column on `wet_check_billings`, the zero is **baked in at WCB creation time** and does not re-derive from zone records on each view load. Fixing the zone records after WCB creation requires a targeted WCB re-total (Slice 3 backfill, Step 3b).

---

## 4. Step C — Blast-Radius SQL Results (Production)

All five queries were executed against the **production database** on 2026-05-28.

### Summary table

| Query | Result | Interpretation |
|---|---|---|
| Q1 — Unbilled WCBs with zero labor | **15 rows** | Must be fixed before any of these 15 are invoiced |
| Q2 — Invoiced WCBs with zero labor | **0 rows** | No under-billed invoices yet — window is open |
| Q3 — Unmatched issueType strings | **0 rows** | Hypothesis 2 ruled out |
| Q4 — Companies with no catalog | **0 rows** | Hypothesis 1 ruled out |
| Q5 — Per-company health | 39 WCBs, 15 zero-labor (38.5%), 0 invoiced | All exposure is recoverable via Slice 3 |

### Q1 — Unbilled WCBs with zero repair-labor (production, 15 rows)

| WCB | Billing Number | Customer | Status | Parts | Labor |
|---|---|---|---|---|---|
| 35 | WC-2026-1034 | First_Bank | submitted | $47.65 | $0.00 |
| 34 | WC-2026-1033 | First Bank of Colorado | submitted | $0.79 | $0.00 |
| 33 | WC-2026-1032 | First Bank of Colorado | submitted | $0.79 | $0.00 |
| 32 | WC-2026-1031 | First Bank | submitted | $34.84 | $0.00 |
| 31 | WC-2026-1030 | First Bank of Colorado | submitted | $0.79 | $0.00 |
| 30 | WC-2026-1029 | First Bank of Colorado | submitted | $0.79 | $0.00 |
| 29 | WC-2026-1028 | First Bank of Colorado | submitted | $117.90 | $0.00 |
| 28 | WC-2026-1027 | Villas at the Boulders | submitted | $428.06 | $0.00 |
| 27 | WC-2026-1026 | First Bank of Colorado | submitted | $18.28 | $0.00 |
| 26 | WC-2026-1025 | First Bank of Colorado | submitted | $5.30 | $0.00 |
| 25 | WC-2026-1024 | First Bank of Colorado | submitted | $26.50 | $0.00 |
| 24 | WC-2026-1023 | Westlake Townhomes | submitted | $208.44 | $0.00 |
| 23 | WC-2026-1022 | Vista West | submitted | $101.40 | $0.00 |
| 22 | WC-2026-1021 | Rolling Hills | submitted | $91.45 | $0.00 |
| 1  | WC-2026-1000 | First_Bank | submitted | $5.30 | $0.00 |

**Total parts across affected WCBs: $1,088.28**  
**Labor billed: $0.00 (should be non-zero after Slice 3 backfill)**

All 15 are in `submitted` status under company_id=1 (High Plains Property Maintenance). None are invoiced — the Slice 3 backfill can correct all of them before any invoice is cut.

### Q2 — Invoiced WCBs with zero repair-labor (production)

```
(empty — 0 invoiced WCBs with zero repair labor as of 2026-05-28)
```

**No under-billed invoices.** The window is open. Slice 3 must run before any Q1 WCB is invoiced.

### Q3 — Unmatched issueType strings (production)

```
(empty — all production findings use issueType strings present in their company catalog)
```

Hypothesis 2 (key mismatch) is **ruled out for production**.

### Q4 — Companies with no issue_type_configs rows (production)

```
(empty — all active companies have catalog rows)
```

Hypothesis 1 (empty catalog) is **ruled out for production**.

### Q5 — Per-company WCB labor health (production)

| Company | Total WCBs | Zero-Labor WCBs | % Zero-Labor | Invoiced | Invoiced Zero-Labor |
|---|---|---|---|---|---|
| High Plains Property Maintenance | 39 | 15 | 38.5% | 0 | 0 |

Only one company has WCBs in production. 38.5% of those WCBs have been submitted with zero repair labor. None are yet invoiced.

---

## 5. Accounting Impact

**All exposure is currently recoverable.**

### Unbilled WCBs (Q1 scope — 15 WCBs)

- **Total parts across affected WCBs: $1,088.28**
- **Repair labor currently captured: $0.00**
- These WCBs are in `submitted` status and have not yet been invoiced.
- After the Slice 2 fix and Slice 3 backfill, their `labor_subtotal` will reflect the correct auto-computed labor hours × labor rate.
- **Action required:** Run the Slice 3 backfill script against production **before** any of these 15 WCBs is invoiced. See Section 6.

### Already-invoiced WCBs (Q2 scope — 0 WCBs)

No invoices have been cut with zero repair labor. There is no correcting credit memo work needed at this time. If Q2 becomes non-empty before Slice 3 runs, those rows will require a separate billing review.

### Quantity-multiplier under-reporting (secondary bug — active regression)

For findings with `quantity > 1`, labor is under-reported even on WCBs created after Task #891. This compounds with the backfill gap. Run the following on production to estimate the additional under-report:

```sql
SELECT
  f.quantity,
  COUNT(*) AS finding_count,
  SUM(COALESCE(itc.default_labor_hours::numeric, 0) * f.quantity)
    - SUM(COALESCE(itc.default_labor_hours::numeric, 0)) AS delta_hours_missed
FROM wet_check_findings f
JOIN wet_checks wc ON wc.id = f.wet_check_id
LEFT JOIN issue_type_configs itc
  ON itc.company_id = wc.company_id AND itc.issue_type = f.issue_type
WHERE f.quantity > 1
GROUP BY f.quantity
ORDER BY f.quantity;
```

---

## 6. Slice 2 / Slice 3 Recommendations

### Slice 2 — Code fixes (three changes required)

**Fix 1 (primary — required): Add quantity to the auto-compute sum**

File: `artifacts/api-server/src/storage.ts`, lines 7686 and 7700

```typescript
// Line 7686 — also select quantity from findings
const findings = await tx.select({
  issueType: wetCheckFindings.issueType,
  quantity:  wetCheckFindings.quantity,           // ADD THIS
}).from(wetCheckFindings)
  .where(eq(wetCheckFindings.zoneRecordId, zoneRecordId));

// Line 7700 — multiply by quantity
// BEFORE (ignores quantity):
if (raw) totalHours += parseFloat(String(raw)) || 0;

// AFTER (quantity-aware):
if (raw) totalHours += (parseFloat(String(raw)) || 0) * (f.quantity ?? 1);
```

**Fix 2 (defensive — recommended): Warn when no catalog rows exist**

When `configs.length === 0` and `findings.length > 0`, emit a structured server-side warning. Do NOT throw — finding creation must not be broken for a missing catalog entry. This surfaces un-seeded companies immediately rather than letting zeros accumulate silently:

```typescript
if (findings.length > 0 && configs.length === 0) {
  logger.warn({ companyId, zoneRecordId, event: 'wc.labor.no_catalog' },
    'Company has no issue_type_configs — repair_labor_hours will remain 0.00');
}
```

**Fix 3 (recommended): Wire `_recomputeZoneRepairLaborIfAuto` on finding delete**

`deleteWetCheckFinding` (`storage.ts:7978`) does not call `_recomputeZoneRepairLaborIfAuto` after the delete. If a tech deletes one of two findings, zone labor stays at the two-finding sum. Add (only when `!zr.repairLaborManuallySet`, after the delete commits):

```typescript
await this._recomputeZoneRepairLaborIfAuto(db, f.zoneRecordId, companyId);
```

### Slice 3 — Backfill scope

The backfill has two sequential steps.

**Step 3a — Recompute zone records (Slice 3 scope: full historical)**

For every zone record where `repair_labor_manually_set = false` and `repair_labor_hours = 0.00` but the zone has at least one finding, call the equivalent logic of `_recomputeZoneRepairLaborIfAuto`:

```sql
-- Dry-run count of zone records in scope
SELECT COUNT(*)
FROM wet_check_zone_records wzr
WHERE wzr.repair_labor_manually_set = FALSE
  AND CAST(wzr.repair_labor_hours AS numeric) = 0
  AND EXISTS (
    SELECT 1 FROM wet_check_findings f WHERE f.zone_record_id = wzr.id
  );
```

Production expected count: all findings created before Task #891 was deployed, plus any created through bulk-insert paths. Dev count: **1,031 zone records**.

**Step 3b — Re-total WCBs (Slice 3 scope: Q1 — 15 WCBs)**

After Step 3a completes, for every WCB in Q1 (unbilled, zero labor, non-zero parts): recompute `total_hours = wc.total_labor_hours + SUM(zone.repair_labor_hours)` for all zones in the WCB, then update `labor_subtotal` and `total_amount`.

Production scope: **15 WCBs** (WC-2026-1000, WC-2026-1021 through WC-2026-1034).

**Resumable script pattern:** Use `app_settings.wcLaborBackfill.done` (processed zone record IDs) and `app_settings.wcLaborBackfill.failed` (failures), mirroring `backfill-estimate-lifecycle.ts`. Support `--dry-run` and `--batch=N` flags.

### Critical timing constraint

**The Slice 3 backfill must run before any of the 15 Q1 WCBs is invoiced.** Once invoiced, the `labor_subtotal` snapshot is terminal and a correcting credit memo is required. The Slice 2 fix alone does not help already-created WCBs — Step 3b is the only path that updates the WCB snapshot.

---

*All SQL query files: `docs/wc-labor-auto-compute-queries/Q1–Q5-*.sql`*  
*Production result CSVs: `docs/wc-labor-auto-compute-queries/results-2026-05-28/`*  
*No production code was modified in this slice.*
