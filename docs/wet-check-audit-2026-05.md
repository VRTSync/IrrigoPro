# Wet Check System — End-to-End Audit (May 2026, Task #612)

Scope: every surface that touches wet checks — web (`artifacts/irrigopro`),
mobile (`artifacts/irrigopro-mobile`), API (`artifacts/api-server`), and the
shared schema (`lib/db/src/schema/schema.ts`). The audit covers the full
lifecycle (start → zones → findings → photos → submit → manager review →
auto-bill / work order → invoice), offline / sync, permissions, and data
integrity invariants.

Fixes landed in this task are marked **[fixed]**. Everything else is
either tracked as a follow-up or already covered by an open task.

## 1. Lifecycle map

```
in_progress ──► (tech submits)
                    │
                    ├─► fully completed-in-field + auto-bill ON ──► billing_sheets
                    │                                              + work_order
                    │                                              + invoice (QBO)
                    │
                    └─► any "needs_review" / auto-bill OFF      ──► manager queue
                                                                    │
                                          ┌─────────────────────────┼─────────────────────────┐
                                          ▼                         ▼                         ▼
                                  approved + bill          send to estimate           send to work order
                                  → billing_sheets         (customer-facing)          (schedule + tech)
                                          │                         │                         │
                                          ▼                         ▼                         ▼
                                       invoice                signed → WO              completion → billing
```

Routes: `artifacts/api-server/src/routes/routes.ts` lines ~14759–15900.
Storage: `artifacts/api-server/src/storage.ts` lines ~6230–6556.

## 1a. Per-flow matrix

Every user-visible wet-check flow with its web path, mobile path, API
endpoints, DB tables, and edge cases. Endpoints assume
`/api` prefix; storage methods live in
`artifacts/api-server/src/storage.ts`.

| # | Flow | Web path | Mobile path | API endpoints | DB tables | Edge cases |
|---|---|---|---|---|---|---|
| 1 | Start a wet check from a customer | `/customers/:id` → "New wet check" | `/customers/[id]` → "New wet check" | `POST /wet-checks` | `wet_checks` | offline: clientId pre-issued, server dedupes on `(companyId, clientId)`; multi-tech: only `field_tech.assigned` may start; converting customer mid-flow returns 409 |
| 2 | Open a wet check (server id) | `/wet-checks/:id` | `/wet-check/[id]` | `GET /wet-checks/:id` | `wet_checks`, `wet_check_zone_records`, `wet_check_findings`, `wet_check_photos`, `parts` | 401 → `getQueryFn` returns `null` (Task #540); 404 if cross-company; lazy hydrate of `findings`/`photos` |
| 3 | Open a wet check (offline-only, client id) | `/wet-checks/c/:clientId` | n/a (mobile uses numeric id only) | `GET /wet-checks/c/:clientId` | same | clientId-only path is read-only until first successful POST; cached photos served from local store |
| 4 | Set zone status (OK / Needs Work / N/A) | `WetCheckDetail` → `ZoneScreen` → primary actions | `[id]` → `[zoneRecordId]` → status radio | `POST /wet-checks/:id/zone-records` (upsert) or `PATCH /wet-checks/zone-records/:id` | `wet_check_zone_records` | offline: queued via `upsertZoneRecord` (Task #561); marker `markedCompleteAt` cleared when leaving Needs Work; revert cascade gated by confirm (Task #455) |
| 5 | Mark Zone Complete (Needs Work + reviewed) | `btn-mark-zone-complete` | n/a (mobile shows the badge but no separate CTA) | `PATCH /wet-checks/zone-records/:id` `{ markedCompleteAt }` | `wet_check_zone_records` | empty-findings case requires double-tap confirm; offline mirrors stamp via `upsertZoneRecord` |
| 6 | Add a finding | `FindingSheet` preset → save | `Add finding` modal | `POST /wet-checks/:id/findings` | `wet_check_findings`, `wet_check_photos` (relink) | issueGroup derived server-side; partId tenant-checked; optimistic add tagged by clientId for replay dedupe |
| 7 | Edit a finding (notes, part, labor, complete-in-field, no-part-needed) | `FindingSheet` edit | `Edit finding` modal | `PATCH /wet-checks/findings/:id` | `wet_check_findings` | Task #468 — omitting `repairedInField` is a no-op (does not demote); Task #612 — `noPartNeeded`+`partId` two-state invariant; converted findings refuse PATCH (404/409) |
| 8 | Tech disposition toggle | inline group `finding-disposition-:id` | inline pill in finding card | `PATCH /wet-checks/findings/:id` `{ techDisposition }` | `wet_check_findings` | always visible regardless of WET_CHECK_AUTO_BILL (Task #428); optimistic flip + rollback (Task #454) |
| 9 | Delete a finding | trash icon | swipe / button in editor | `DELETE /wet-checks/findings/:id` | `wet_check_findings`, `wet_check_photos` (set null) | converted findings 409 with `target` / `targetId`; non-pending findings refuse 409 unless reset to pending; offline: parent clientId chained |
| 10 | Capture a photo (zone or finding) | `PhotoCaptureButton` | inline camera CTA | `POST /wet-checks/:id/photos` (multipart) | `wet_check_photos`, object storage `originals/`, `web/`, `thumb/` | optimistic merge by clientId (Task #597); thumb pipeline ≤3840px JPEG q=90; offline: local URI + queued upload |
| 11 | Attach / relink loose photo | `LoosePhotosSection` | `loose-photos-banner` (link via zone screen) | `PATCH /wet-checks/photos/:id` `{ findingId | zoneRecordId }` | `wet_check_photos` | server cross-checks photo.wetCheckId == finding.wetCheckId |
| 12 | Delete a photo | `PhotoThumb` delete | per-photo action | `DELETE /wet-checks/photos/:id` | `wet_check_photos` | always allowed while wet check `in_progress`; cascades nothing |
| 13 | Submit | `btn-submit-wet-check` | `Submit wet check` | `POST /wet-checks/:id/submit-preview`, `POST /wet-checks/:id/submit` | `wet_checks`, `billing_sheets`, `work_orders`, `invoices` (when auto-bill) | preview skipped offline / for clientId-only ids; "complete without part" hard-blocks submit; idempotent on retry |
| 14 | Manager review / route | `/manager/wet-checks/:id/review` | n/a | `POST /wet-checks/:id/route` `{ findingId, target }` | `wet_check_findings`, `billing_sheets`, `estimates`, `work_orders` | role gate: manager+; once routed, finding is immutable |
| 15 | Auto-bill on submit | (server) | (server) | `POST /wet-checks/:id/submit` (when auto-bill ON) | `billing_sheets`, `work_orders`, `invoices` | only completed-in-field findings auto-bill; Task #612 invariant guarantees no double-state in the auto-bill walk |
| 16 | List wet checks | `/wet-checks` | `/wet-checks` | `GET /wet-checks` | `wet_checks` | **not** paginated (see follow-up #613); 401 → null via `useArrayQuery` (Task #540) |
| 17 | Manager queue | `/manager/wet-checks` | n/a | `GET /wet-checks?status=submitted` | `wet_checks`, `wet_check_findings` | role-scoped; billing_manager sees read-only |

## 2. Findings by severity

### Critical (P0)
*None found.* Earlier candidates flagged by the explorer turned out to be
false positives:

- **"Sub-resource permission leak"** — claimed that
  `PATCH /api/wet-checks/findings/:id`, `DELETE /api/wet-checks/photos/:id`,
  and `PATCH /api/wet-checks/zone-records/:id` only validate the
  finding/photo/zone, not the parent wet check's company. *Invalid.* Every
  storage method re-resolves the wet check and calls
  `assertWetCheckBelongsToCompany` or `assertWetCheckEditableByTech`
  (storage.ts: `updateWetCheckFinding`, `deleteWetCheckFinding`,
  `deleteWetCheckPhoto`, `updateWetCheckZoneRecord`,
  `linkWetCheckPhotoToFinding`). `wet-checks-zone-leak.test.ts` already
  pins this against regression.

### High (P1)

1. **`noPartNeeded` + `partId` could both be true**.
   - Repro: a tech edits a finding that already has a part assigned (e.g.
     `partId=42, partName='1804-PRS40'`), opens the FindingSheet, ticks
     "No part needed (labor only)", and saves. The client PATCH body is
     `{ noPartNeeded: true }` only.
   - File:line: `artifacts/api-server/src/storage.ts` `updateWetCheckFinding`
     — pre-fix the `next = { ...patch, updatedAt }` spread only carried
     `noPartNeeded`; the column-clear branch only ran when
     `patch.partId != null`, so the row was UPDATEd to
     `noPartNeeded=true` while keeping `partId=42, partName=…,
     partPrice=…`. Auto-bill preview then double-counted the line.
   - **[fixed]** — invariant logic extracted to
     `artifacts/api-server/src/storage/wet-check-finding-invariants.ts`
     (`applyNoPartNeededInvariant`) and pinned by
     `wet-check-finding-invariants.test.ts` (5 cases covering both
     rule directions + no-op patches).

### Medium (P2)
1. **Pricing-strip walk on writes** — `applyPricingVisibility` is correctly
   short-circuited for non-field-tech roles, but the in-place walk still
   runs on every write response (POST/PATCH finding, zone, photo). Probably
   fine given the small payload but worth measuring with `field_tech` on
   slow LTE.
2. **In-memory throttle counters** (Task #554) — also apply to the wet-check
   write hotspot. Multi-replica deploys let each replica accept up to the
   per-tenant cap. Documented limit, not changed here.
3. **`X-Total-Count` not returned for wet-check list endpoints** — the
   `paginate()` helper (Task #532) was applied to customers / estimates /
   invoices / work-orders, **not** `/api/wet-checks`. Field techs with
   long histories still get the full list. Tracked as a follow-up.

### Low (P3)
1. **Zone label optional metadata** — schema has no `label` column on
   `wet_check_zone_records`. The facelift tile would benefit from a short
   user-entered label (e.g. "front lawn"); deferred.
2. **Cache key duplication** — the detail query uses two keys
   (`["/api/wet-checks", id]` and `["/api/wet-checks", "c", clientId]`).
   Every optimistic patch has to be applied to both. Already handled
   correctly in `ZoneScreen`, but the pattern is easy to forget; a thin
   `useWetCheckCache(id, clientId)` helper would centralize it.
3. **Mobile `FindingSheet` parts cache** — prefetched per-issue parts list
   keyed by `(issueType, customerId)` is solid, but the staleTime is
   5 min while the parts catalog is typically refreshed monthly; could be
   bumped to 30 min to save bytes on the truck.

## 3. Offline / sync

State of play (post-#561 / #455 / #512 / #597):
- Zone status flips, findings CRUD, photo uploads, finding deletes, and
  the revert cascade all run through the offline engine with explicit
  `parentClientId` chaining when offline.
- `DEFAULT_MAX_RETRY_AGE_MS = 12h` (Task #532) means a half-shift in a
  basement still drains.
- Optimistic snapshots are taken **before** any await on every mutation
  with rollback on error (verified in `ZoneScreen.setStatus`,
  `deleteFindingMut`, `dispositionMut`, `markCompleteMut`,
  `performRevert`).
- 401 → `null` from `getQueryFn` is covered by `useArrayQuery` /
  `asArray()` everywhere wet-check arrays are read (Task #540).

No regressions introduced by this task — the only storage change
(`noPartNeeded` symmetric clear) runs inside the same single
`db.update(...).set(next)` call and the offline mirror writes the same
`next` object, so queued replays behave identically.

## 4. Permissions matrix (verified)

| Role            | List | Open | Edit zones/findings | Submit | Approve / route | Force-revert |
|-----------------|:---:|:----:|:------------------:|:------:|:--------------:|:------------:|
| super_admin     | ✓   | ✓   | ✓ (any)            | ✓      | ✓              | ✓            |
| company_admin   | ✓   | ✓   | own company        | ✓      | ✓              | ✓            |
| manager         | ✓   | ✓   | own company        | ✓      | ✓              | ✓            |
| billing_manager | ✓   | ✓   | read-only          | —      | ✓ (bill only)  | —            |
| field_tech      | own | own | own in-progress    | own    | —              | —            |

All routes call `requireAuthentication` first, then storage re-verifies
company scoping via `assertWetCheckBelongsToCompany`. Field-tech editing
is additionally gated by `assertWetCheckEditableByTech` (status =
`in_progress` AND tech is assignee). Except for labor-rate override and
per-zone repair labor on unbilled WCBs (Slice 5).

### Role vs shell — locked decision (2026 May, post-WC Manager Experience family)

The five roles above are the source of truth for permissions. They do
NOT change based on device. However, the irrigation manager role
specifically has TWO shell-appropriate presentations:

- **Web shell** (`artifacts/irrigopro/src/App.tsx:297+`) routes the
  irrigation manager to `/manager-workspace` (WC Manager Experience
  Slice 8) as their daily home. The page mirrors the billing
  manager's `/billing-workspace` visual vocabulary while serving the
  manager's queue (wet checks pending review, work orders awaiting
  approval, findings needing routing).
- **Mobile shell** (`artifacts/irrigopro-mobile/app/(tabs)/index.tsx`)
  routes the same role to a field-action dashboard (WC Manager
  Experience Slice 10) with launches for Start Wet Check, Create
  Work Order, Assign Tech, Today's Schedule.

The same person, with the same role, sees the management dashboard on
their laptop and the field-action launches on their phone. There is
NO separate "mobile irrigation manager" role.

This pattern extends to company_admin and super_admin: same role,
shell-appropriate landing page. The field tech role has only the
mobile shell.

This decision was made and locked in the WC Manager Experience
family planning. Do not introduce a parallel "irrigation_manager_field"
or "irrigation_manager_web" role to "fix" presentation differences —
that's the wrong lever. Open a follow-up slice in the WC Manager
Experience family or its successor instead.

## 5. Data integrity invariants

| # | Invariant | Status |
|---|---|---|
| 1 | A `wet_check_finding` is never both `noPartNeeded=true` and has a `partId`. | **[fixed]** symmetric clear in `updateWetCheckFinding`. |
| 2 | Deleting a `wet_check_zone_record` cascades to its findings (FK ON DELETE CASCADE). | ✓ schema:1147+ |
| 3 | Deleting a `wet_check_finding` sets `wet_check_photos.findingId = null`. | ✓ schema. |
| 4 | A converted finding (`billingSheetId / estimateId / workOrderId / convertedAt`) refuses any edit/delete. | ✓ `assertFindingNotConverted` + storage gates. |
| 5 | Submitting requires zero "completed without part" findings. | ✓ enforced server-side AND surfaced as an inline hint (`submit-needs-part-or-no-part-hint`). |
| 6 | `markedCompleteAt` is cleared when a zone leaves `checked_with_issues`. | ✓ `applyOptimisticZoneStatus` + storage. |
| 7 | Photo `findingId` must reference a finding on the same wet check. | ✓ `linkWetCheckPhotoToFinding` cross-checks `wetCheckId`. |

## 6. Facelift — what changed

### Web — `WetCheckDetail.tsx`
- Added a **summary header** above the Controllers grid showing the four
  state counts (Ran OK / Needs work / N/A / Not checked) plus a
  "Marked complete" pill when the tech has confirmed any Needs-Work
  zones. Uses the same green / red / gray / amber tints as the tiles
  and the lifecycle helpers so the language matches everywhere.
- Controller tiles now surface a **work-item count** (red Wrench
  badge) alongside the existing OK / issues / N/A / photo counts,
  so a tech scanning the grid sees which controllers have findings
  before drilling in. New testid:
  `controller-<L>-finding-count`. Existing tile chrome
  (lifecycle tints, photo badge, marked-complete check, ≥44px
  touch target) is preserved.

### Web — `ZoneScreen.tsx`
- Primary actions bumped from 48px to **64px** tall, with stacked
  icon + label, font-semibold, saturated tint when selected, and a
  matching outline ring so the current call is obvious without
  reading the status pill above.
- Hover/active tints (`hover:bg-green-50`, `hover:bg-red-50`,
  `hover:bg-gray-50`) so an unselected primary still telegraphs its
  intent on tap.
- Finding cards, one-tap `PhotoCaptureButton`, identity band, and
  revert-confirm dialog kept intact — all existing `data-testid`s
  preserved (`btn-zone-yes/no/na`, `btn-mark-zone-complete`,
  `zone-identity-*`, `finding-*`).

### Mobile — zone screen `[zoneRecordId].tsx`
- `statusOption` row bumped to **56pt** tall (was ~44pt) with
  `borderWidth: 2` so the selected state reads at glance, larger
  18pt radio dot, and `fontSize: 16 / fontWeight: 700` label.
  No logic changes — `statusMutation` and the offline-replay path
  are untouched.

### Mobile — `[id].tsx`
- ChipRow gained a fifth chip ("Marked complete · N") whenever any
  Needs-Work zones have `markedCompleteAt`, mirroring the web header.
- Zone tile gained a top-left red work-item count dot (Feather
  `tool` icon + count) alongside the existing top-right
  marked-complete check and bottom-right camera dot. Zero-count
  zones render the tile as before. Tone, layout, and offline
  rendering of the 5-column grid are unchanged.

## 7. Tests

Existing coverage that exercises the changed code path:
- `wet-check-finding-patch.test.ts` — locks the patch-body → patch object
  translation; unaffected by storage-layer invariant change.
- `wet-checks-zone-leak.test.ts` — sub-resource permission scoping.
- `wet-checks-null-safe.test.tsx` — null-array safety.
- `wet-check-auto-bill*.test.ts` — auto-bill / preview path.
- `wet-check-idempotency.test.ts` — replay safety on the offline path.

Manual verification: typecheck across the workspace passes; the new
storage branch is dead code unless a client sends
`{ noPartNeeded: true }` on an existing-part finding, which the
`FindingSheet` only emits from the explicit labor-only checkbox.

## 8. Out of scope / deferred

- Pagination + `X-Total-Count` on `/api/wet-checks` (per the
  Performance task pattern).
- Zone label metadata column + tile copy.
- `useWetCheckCache(id, clientId)` helper to centralize the dual
  cache-key updates.
- IndexedDB read-side cache for the wet-check list page (already
  flagged in the Performance section of `replit.md`).
