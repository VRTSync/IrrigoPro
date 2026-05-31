# WC Manager Experience — Slice 9a: Detail Shell Unification

**Source:** `docs/wc-manager-experience-visual-audit.md` Delta D1  
**Severity:** P1  
**Prerequisite slices:** None (audit only, no prior fixes required)

---

## Scope

At `/wet-checks/:id/review` two different shell components render the same wet-check record depending on the caller's role:

| Role | Component rendered |
|------|--------------------|
| `irrigation_manager`, `company_admin` | `ManagerWetCheckDetailPage` — custom triage layout |
| `billing_manager`, `super_admin` | `WetCheckReviewPage` → `WetCheckWizard(id)` — wizard shell |

Both show the correct record, but the framing, padding, header pattern, and action surface differ.
This slice unifies the shell so every role that can view a detail record lands on the same page component.

---

## Files to modify

| File | Change |
|------|--------|
| `artifacts/irrigopro/src/App.tsx` | Route `billing_manager` Switch `/wet-checks/:id/review` → `ManagerWetCheckDetailPage` instead of `WetCheckReviewPage` |
| `artifacts/irrigopro/src/App.tsx` | Route `super_admin` Switch `/wet-checks/:id/review` → `ManagerWetCheckDetailPage` |
| `artifacts/irrigopro/src/pages/wet-checks/ManagerWetCheckDetailPage.tsx` | Confirm it handles `billing_manager` and `super_admin` role read: hide write-only actions (labor stepper, disposition controls) behind `role !== "billing_manager"` guard |

---

## Concrete changes

1. **App.tsx billing_manager switch:** change the `/wet-checks/:id/review` route from `WetCheckReviewPage` to `lazyPage(() => import("@/pages/wet-checks/ManagerWetCheckDetailPage"))`.
2. **App.tsx super_admin switch:** same change.
3. **ManagerWetCheckDetailPage:** add a `readOnly` prop (derived from `role === "billing_manager"`) that suppresses `LaborHoursStepper` and disposition mutation buttons. All read elements (badges, finding list, zone record summary) remain visible.

---

## Tests

- Add a test case to `artifacts/irrigopro/src/test/wc-audit-capture.test.tsx` that asserts `mgr-findings-summary` appears for all 4 roles at `/wet-checks/1/review` (post-fix, the sentinel must be consistent across roles).
- Add a snapshot assertion that `labor-hours-stepper` is NOT present in the `billing_manager` fixture.

---

## Acceptance criteria

- All 4 roles at `/wet-checks/1/review` render `ManagerWetCheckDetailPage` (same outer shell, same `data-testid="mgr-findings-summary"` present in all 4 fixtures).
- `billing_manager` and `super_admin` fixtures do NOT contain `data-testid="labor-hours-stepper"` or any mutation trigger.
- `irrigation_manager` and `company_admin` fixtures continue to show the labor stepper and disposition controls.
- No other routes changed.

---

## Out of scope

- Redesigning `ManagerWetCheckDetailPage` layout.
- Changing `WetCheckReviewPage` wizard mode (used by nav entries under `/manager/wet-checks/:id`).
- Role-guarding within the wizard itself (covered by **Slice 9b**).
