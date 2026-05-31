# WC Manager Experience — Slice 9z: P2 Token Cleanup (Deferred)

**Source:** `docs/wc-manager-experience-visual-audit.md` Deltas D9–D15  
**Severity:** P2 (deferred — can ship anytime after 9a–9g without blocking them)  
**Prerequisite slices:** 9a–9g recommended first (avoids rebase conflicts on shared files)

---

## Scope

Catch-all for all P2 visual-polish items surfaced by the Slice 9 audit. Each item is a one-or-two-line
fix with no user-facing behavioural change. They are bundled here to reduce PR overhead.

---

## Delta inventory

### D9 — wc-list: Status badge semantic variant (`WetChecksListPage`)

`WetChecksListPage` renders status badges with `variant="default"` (primary/black) for `submitted`
and `variant="secondary"` (muted gray) for `in_progress`. These carry no semantic colour signal.

**Fix:** Apply the same `variantMap` introduced in **Slice 9c** to `WetChecksListPage`:
- `submitted` → `variant="info"`
- `in_progress` → `variant="warning"`
- `approved` → `variant="success"`
- `rejected` → `variant="destructive"`

**File:** `artifacts/irrigopro/src/pages/wet-checks/WetChecksListPage.tsx`

---

### D10 — wc-list: Delete button visual differentiation

Deletable rows (`company_admin`, `super_admin`) and non-deletable rows (`irrigation_manager`,
`billing_manager`) look identical until hover because the `Trash2` button is only conditionally
rendered with no row-level visual cue.

**Fix:** Add a subtle `border-l-4 border-l-red-200` accent on rows where `canDelete=true`, so
admins can visually scan which records are deletable before hovering.

**File:** `artifacts/irrigopro/src/pages/wet-checks/WetChecksListPage.tsx`

---

### D11 — wc-list: Empty state icon + heading

The "no wet checks" empty state is plain text inside a `<Card>` with no icon or heading. The review
queue and dashboard both have a structured empty state with an icon, a heading, and a short subtitle.

**Fix:** Replace the bare text with:
```tsx
<div className="text-center py-8">
  <div className="bg-gray-100 rounded-2xl p-3 inline-block mb-3">
    <Droplets className="w-8 h-8 text-gray-400" />
  </div>
  <p className="font-medium text-gray-700">No wet checks yet</p>
  <p className="text-sm text-gray-500 mt-1">Wet checks will appear here once a technician starts one.</p>
</div>
```

**File:** `artifacts/irrigopro/src/pages/wet-checks/WetChecksListPage.tsx`

---

### D12 — wc-dashboard: Pipeline tile `<Card>` migration

Pipeline tiles in `ManagerWorkspace` use custom `rounded-xl` buttons with inline `bg-*/border-*`
Tailwind strings rather than `<Card>` components.

**Fix:** Wrap each tile in `<Card className="border-l-4 ...">` + `<CardContent>` matching the
review queue card pattern. Remove the bespoke button container.

**File:** `artifacts/irrigopro/src/pages/manager-workspace.tsx`

---

### D13 — wc-list: `PageContainer`/`PageHeader` wrapper

`WetChecksListPage` uses a raw `max-w-6xl mx-auto py-6 space-y-4 px-4` div as its page container,
and inline heading markup. Other surfaces use `<PageContainer>/<PageHeader>`.

**Fix:** Wrap the page in `<PageContainer>` and replace the inline heading with
`<PageHeader title="Wet Checks" ...>`.

**File:** `artifacts/irrigopro/src/pages/wet-checks/WetChecksListPage.tsx`

---

### D14 — wc-detail: Custom layout vs design system (`ManagerWetCheckDetailPage`)

`ManagerWetCheckDetailPage` uses a custom layout without `<PageContainer>/<PageHeader>`.
After **Slice 9a** all roles use this page, so the layout inconsistency becomes visible when
comparing the detail page to the queue and dashboard.

**Fix:** Wrap in `<PageContainer>` + add `<PageHeader title={`Wet Check — ${customerName}`} subtitle={...} />`.
Remove the custom heading markup.

**File:** `artifacts/irrigopro/src/pages/wet-checks/ManagerWetCheckDetailPage.tsx`

---

### D15 — wc-review: "Continue Review" amber outline

"Continue Review" CTA for `partially_converted` status uses `border-amber-300 text-amber-700 hover:bg-amber-50`
hardcoded.

**Fix:** Replace with `<Button variant="outline" size="sm">Continue Review</Button>`. If the amber
urgency cue is intentional, add `className="border-amber-300 text-amber-700 hover:bg-amber-50"` to
the `Button` instead of using a bare `<button>`.

**File:** `artifacts/irrigopro/src/pages/wet-check-review.tsx`

---

## Tests

- Re-run `wc-audit-capture.test.tsx` after the full bundle of D9–D15 fixes.
- Assert: `wc-list.*.html` fixtures no longer contain `variant="default"` or `variant="secondary"` on status badge elements.
- Assert: `wc-review.*.html` fixtures do not contain bare `border-amber-300` on button elements.
- No new test files required — the existing capture test + fixture-completeness guard provide sufficient regression coverage.

---

## Acceptance criteria

All D9–D15 items resolved. After this slice:
- Every wet-check surface (`wc-list`, `wc-detail`, `wc-review`, `wc-dashboard`) uses `<PageContainer>/<PageHeader>`.
- Status badges on `wc-list` use the same semantic `<Badge variant>` mapping as `wc-review` and `wc-detail`.
- No bare `border-amber-300`, `bg-cyan-600`, `bg-blue-100` colour strings remain on interactive elements.
- Delete-row visual differentiation present in `wc-list` for admin roles.

---

## Out of scope

- Implementing any new feature (this is purely cosmetic token alignment).
- Changing data-fetching, routing, or permission logic.
- Redesigning the wet-check wizard or creating new UI components.
- The P0/P1 deltas handled by Slices 9a–9g.
