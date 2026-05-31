# WC Manager Experience — Visual Audit (Slice 9)

**Date:** 2026-05-31  
**Scope:** Cross-role visual consistency of all pre-handoff wet-check surfaces.  
**Out of scope:** Implementing any fix (fixes ship in sub-slices 9a–9g, 9z).  
**Baseline:** Slices 6, 7, and 8 have landed; fixtures reflect the post-unification target state.

---

## Fixture index

Sixteen HTML baseline snapshots live in `docs/wc-manager-experience-visual-audit-fixtures/`:

| Surface | `/wet-checks` | `/wet-checks/:id/review` | `/wet-checks/pending-review` | `/manager-workspace` |
|---------|--------------|--------------------------|------------------------------|----------------------|
| **Fixture prefix** | `wc-list` | `wc-detail` | `wc-review` | `wc-dashboard` |
| irrigation_manager | wc-list.irrigation_manager.html | wc-detail.irrigation_manager.html | wc-review.irrigation_manager.html | wc-dashboard.irrigation_manager.html |
| company_admin | wc-list.company_admin.html | wc-detail.company_admin.html | wc-review.company_admin.html | wc-dashboard.company_admin.html |
| super_admin | wc-list.super_admin.html | wc-detail.super_admin.html | wc-review.super_admin.html | wc-dashboard.super_admin.html |
| billing_manager | wc-list.billing_manager.html | wc-detail.billing_manager.html | wc-review.billing_manager.html | wc-dashboard.billing_manager.html |

A `fixture-completeness.test.ts` vitest check asserts all 16 files exist.  
To regenerate (re-renders real components, writes all 16 files):  
`cd artifacts/irrigopro && npx vitest run src/test/wc-audit-capture.test.tsx`  
Or via the pointer script: `npx tsx docs/wc-manager-experience-visual-audit-fixtures/_capture.ts`

### Capture routing truth

`WetCheckReviewPage` is dual-mode (uses `useRoute` internally):

| Path | irrigation_manager | company_admin | billing_manager | super_admin |
|------|--------------------|---------------|-----------------|-------------|
| `/wet-checks` | `WetChecksListPage` | same | same | same |
| `/wet-checks/pending-review` | `WetCheckReviewPage` → `PendingReviewInbox` | same | same | same |
| `/wet-checks/:id/review` | `ManagerWetCheckDetailPage` | `ManagerWetCheckDetailPage` | `WetCheckReviewPage` → `WetCheckWizard(id)` | `WetCheckReviewPage` → `WetCheckWizard(id)` |
| `/manager-workspace` | `ManagerWorkspace` | `NotFound` | `NotFound` | `NotFound` |

---

## Surface 1 — `/wet-checks` (List)

**Component:** `WetChecksListPage.tsx` (all 4 roles)  
**Relevant fixture prefix:** `wc-list.*`

| Element | irrigation_manager | company_admin | super_admin | billing_manager (read-only) | Delta | Severity |
|---------|-------------------|---------------|-------------|------------------------------|-------|----------|
| **Status badge — submitted** | `<Badge variant="default">` (primary/black) | same | same | same | `variant="default"` conveys no semantic meaning for a status value; should be `variant="success"` or `"info"` | P2 |
| **Status badge — in_progress** | `<Badge variant="secondary">` (muted gray) | same | same | same | No visual urgency signal; should be `variant="warning"` or a neutral info variant | P2 |
| **Delete button** | Hidden (`canDelete=false`) | Shown — `Trash2` ghost btn, `hover:text-red-600` | Shown | Hidden | Rows look identical until hover; no visual diff between deletable and non-deletable rows for mixed-role views | P2 |
| **Row hover** | `hover:bg-gray-50` | same | same | same | Consistent ✓ | — |
| **Empty state** | Plain text "No wet checks yet." inside `<Card>` — no icon | same | same | same | Missing icon + heading; diverges from review queue and dashboard empty states | P2 |
| **Loading state** | `<Loader2 animate-spin>` centered div | same | same | same | Consistent ✓ | — |
| **Page container** | `max-w-3xl mx-auto py-4 px-3 sm:px-4 pb-safe` — raw div | same | same | same | Does not use `<PageContainer>/<PageHeader>` design system; page title is a bare `<h1>` | P2 |

---

## Surface 2 — `/wet-checks/:id/review` (Detail)

**Components:**  
- `ManagerWetCheckDetailPage.tsx` — `irrigation_manager` + `company_admin` (App.tsx L346; company-admin-app.tsx L199)  
- `WetCheckReviewPage.tsx` → `WetCheckWizard(id)` — `billing_manager` + `super_admin` (App.tsx L394/L444)  
  (`WetCheckReviewPage` self-dispatches to wizard mode when `useRoute("/wet-checks/:id/review")` matches)

**Relevant fixture prefix:** `wc-detail.*`

| Element | irrigation_manager | company_admin | super_admin | billing_manager | Delta | Severity |
|---------|-------------------|---------------|-------------|-----------------|-------|----------|
| **Routed component** | `ManagerWetCheckDetailPage` | `ManagerWetCheckDetailPage` | `WetCheckReviewPage` → `WetCheckWizard(id)` | `WetCheckReviewPage` → `WetCheckWizard(id)` | Two different shell components render the same wet-check record. `billing_manager` and `super_admin` use the wizard shell while `irrigation_manager` and `company_admin` use `ManagerWetCheckDetailPage`. Both show detail for the correct record. Sub-slice spec: **9a**. | P1 |
| **Status badge implementation** | Raw `STATUS_BADGE` className map (`bg-blue-100 text-blue-800 border border-blue-300` for submitted) — bypasses design system | same | Uses `<Badge variant="info">` (via WetCheckWizard) | same | Inconsistent with review queue which uses `<Badge variant="info">`. Same status string, potentially different shade. Sub-slice: **9c**. | P1 |
| **Resolution badge** | Raw `RESOLUTION_META` className strings (`bg-emerald-50 text-emerald-700 border-emerald-200` for repaired) — bypasses `<Badge variant>` | same | N/A — wizard renders resolution inline | N/A | No design-system token; manual maintenance required when palette changes. Sub-slice: **9c**. | P1 |
| **Repair labor stepper** | Visible — `LaborHoursStepper` per zone | same | N/A — wizard controls | N/A | Write action visible to `irrigation_manager` and `company_admin` via ManagerWetCheckDetailPage; expected per role permission model. ✓ | — |
| **Page container** | Custom layout, no `PageContainer/PageHeader` | same | `WetCheckWizard` uses its own modal/sheet layout | same | Detail page (`irrigation_manager`/`company_admin`) diverges from wizard shell (`billing_manager`/`super_admin`); padding and header pattern differ | P2 |

---

## Surface 3 — `/wet-checks/pending-review` (Review Queue)

**Component:** `WetCheckReviewPage.tsx` → `PendingReviewInbox` (all 4 roles)  
**Relevant fixture prefix:** `wc-review.*`

| Element | irrigation_manager | company_admin | super_admin | billing_manager (read-only) | Delta | Severity |
|---------|-------------------|---------------|-------------|------------------------------|-------|----------|
| **billing_manager write guard** | N/A (write access expected) | N/A | N/A | "Begin Review" CTA opens `WetCheckWizard` — a write action. No role guard present. billing_manager should see "View" (read-only). Sub-slice: **9b**. | **P0** |
| **"Begin Review" CTA** | `bg-cyan-600 hover:bg-cyan-700 text-white` — hardcoded Tailwind, not a `Button` variant | same | same | same (see P0 above) | Should use `<Button variant="default">` so the color follows the design system's primary token. Sub-slice: **9d**. | P1 |
| **"Continue Review" CTA (partially_converted)** | `border-amber-300 text-amber-700 hover:bg-amber-50` — hardcoded amber outline | same | same | same | Amber hardcoded; should use `<Button variant="outline">` with an appropriate semantic class | P2 |
| **Status badge — submitted** | `<Badge variant="info">` ✓ | same | same | same | Consistent across all roles ✓ | — |
| **Status badge — partially_converted** | `<Badge variant="warning">` ✓ | same | same | same | Consistent ✓ | — |
| **Status badge — approved** | `<Badge variant="success">` ✓ | same | same | same | Consistent ✓ | — |
| **Card left accent** | `border-l-4 border-l-cyan-500` | same | same | same | Consistent ✓ | — |
| **Finding chips** | `bg-sky-50/bg-amber-50/bg-red-50` per type | same | same | same | Consistent ✓ | — |
| **Empty state icon** | `CheckCircle2 w-8 h-8 text-emerald-500` in `bg-emerald-100 rounded-2xl` | same | same | same | Consistent across roles ✓ — but diverges from dashboard empty state (Delta D7) | — |
| **Empty state copy** | "All caught up" / "No wet checks are waiting for review" | same | same | same | Consistent ✓ | — |
| **Loading skeleton** | `QueueCardSkeleton` — structured placeholder matching card shape | same | same | same | Consistent ✓ | — |
| **Page container** | `<PageContainer>/<PageHeader>` ✓ | same | same | same | Consistent; uses design system ✓ | — |

---

## Surface 4 — `/manager-workspace` (Dashboard)

**Component:** `ManagerWorkspace` (`manager-workspace.tsx`) — `irrigation_manager` only  
Non-manager roles: `NotFound` (expected — no `/manager-workspace` route in their Switch blocks; no nav link either)  
**Relevant fixture prefix:** `wc-dashboard.*`

| Element | irrigation_manager | company_admin | super_admin | billing_manager | Delta | Severity |
|---------|-------------------|---------------|-------------|-----------------|-------|----------|
| **Route accessibility** | Accessible — `ManagerWorkspace` mounts at `/manager-workspace` ✓ | 404 NotFound | 404 NotFound | 404 NotFound | Correct role-scoped routing. However, `company_admin` and `super_admin` have no path to observe the irrigation manager's live queue. Providing a read-only view for supervisory roles would require a new route or a role-awareness flag. Sub-slice spec: **9e**. | P1 |
| **Wet checks pending tile** | `bg-cyan-50 border-cyan-200` (active: `hover:bg-cyan-100`) — cyan accent | N/A | N/A | N/A | Cyan for wet checks tile is consistent with review queue card accent ✓ | — |
| **Pipeline tiles** | Custom `rounded-xl` buttons with inline bg/border — no `<Card>` | N/A | N/A | N/A | Bespoke pattern; differs from rest of codebase that uses `<Card>` | P2 |
| **"Needs Your Attention" empty state icon** | `ClipboardCheck w-10 h-10 text-slate-200` — very pale, low-contrast | N/A | N/A | N/A | Pale slate-200 icon vs review queue `text-emerald-500` and manager-wet-checks page `text-green-500`. Three distinct empty-state icon colors across wet-check surfaces. Sub-slice: **9f**. | P1 |
| **Review buttons (work orders)** | `border-amber-300 text-amber-700 hover:bg-amber-50` outline | N/A | N/A | N/A | Amber for work-order review initiation; cyan for wet-check review initiation — same "initiate review" gesture, two different colors. Sub-slice: **9g**. | P1 |
| **StatusBadge** | `<Badge variant="warning/info/secondary/success">` per status | N/A | N/A | N/A | Uses design system variants ✓ | — |
| **Loading skeletons** | `PipelineBarSkeleton` + `SectionSkeleton` — `<Skeleton>` component | N/A | N/A | N/A | Uses design system ✓ | — |
| **Page container** | `<PageContainer>/<PageHeader>` ✓ | N/A | N/A | N/A | Uses design system ✓ | — |

---

## Delta summary

| ID | Surface | Element | Severity | Sub-slice |
|----|---------|---------|----------|-----------|
| D1 | wc-detail | Shell mismatch: `billing_manager`/`super_admin` render `WetCheckWizard` shell; `irrigation_manager`/`company_admin` render `ManagerWetCheckDetailPage` — same data, different frame | P1 | **9a** |
| D2 | wc-review, wc-detail | `billing_manager` has unguarded write CTA ("Begin Review" → WetCheckWizard) on the review queue; the wizard itself has no role guard either | **P0** | **9b** |
| D3 | wc-detail | `ManagerWetCheckDetailPage` status badge uses raw `STATUS_BADGE` className map instead of `<Badge variant>` | P1 | **9c** |
| D4 | wc-detail | `ManagerWetCheckDetailPage` resolution badge uses raw `RESOLUTION_META` classNames instead of `<Badge variant>` | P1 | **9c** |
| D5 | wc-review, wc-detail | "Begin Review" CTA hardcodes `bg-cyan-600` instead of using a `Button` variant | P1 | **9d** |
| D6 | wc-dashboard | `company_admin` and `super_admin` have no route or nav link to observe the manager's wet-check queue; supervisory read-only access to `/manager-workspace` is unprovisioned | P1 | **9e** |
| D7 | wc-dashboard | Empty-state icon color diverges: `text-slate-200` (dashboard) vs `text-emerald-500` (queue) vs `text-green-500` (manager-wet-checks) | P1 | **9f** |
| D8 | wc-dashboard | Action button color: amber for WO review vs cyan for wet-check review — same "initiate review" gesture, two colors | P1 | **9g** |
| D9 | wc-list | Status badge `variant="secondary/default"` lacks semantic color meaning | P2 | **9z** |
| D10 | wc-list | Delete button present for admin roles with no visual differentiation of deletable vs non-deletable rows | P2 | **9z** |
| D11 | wc-list | Empty state is plain text ("No wet checks yet.") with no icon or heading | P2 | **9z** |
| D12 | wc-dashboard | Pipeline tiles use custom `rounded-xl` buttons rather than `<Card>` | P2 | **9z** |
| D13 | wc-list | Page container is a raw `max-w-3xl div`, not `<PageContainer>/<PageHeader>` | P2 | **9z** |
| D14 | wc-detail | Detail page (`irrigation_manager`/`company_admin`) uses custom layout; `billing_manager`/`super_admin` get wizard shell | P2 | **9z** |
| D15 | wc-review | "Continue Review" (partially_converted) hardcodes amber outline instead of semantic outline variant | P2 | **9z** |
