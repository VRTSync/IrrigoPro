# WC Manager Experience — Slice 9b: billing_manager Write Guard

**Source:** `docs/wc-manager-experience-visual-audit.md` Delta D2  
**Severity:** P0  
**Prerequisite slices:** None (independent of 9a)

---

## Scope

`billing_manager` is a read-only role for wet-check data: they review billing dispositions but do not
triage findings or approve/reject inspections. Two surfaces currently expose unguarded write CTAs to
`billing_manager`:

1. **`/wet-checks/pending-review` queue** — "Begin Review" button opens `WetCheckWizard` (full write
   flow: finding disposition, approval, labor adjustment).
2. **`/wet-checks/:id/review` detail** — (addressed in **Slice 9a**; listed here for completeness)
   `WetCheckReviewPage` → `WetCheckWizard(id)` with no role guard inside the wizard.

This slice adds a role gate so `billing_manager` sees a read-only "View" variant in place of every
write CTA on the wet-check surfaces.

---

## Files to modify

| File | Change |
|------|--------|
| `artifacts/irrigopro/src/pages/wet-check-review.tsx` | Replace "Begin Review" `button` with role-conditional: `billing_manager` → `<Button variant="outline">View</Button>` that opens a read-only inspection sheet |
| `artifacts/irrigopro/src/components/manager/wet-check-wizard.tsx` | Add `readOnly` prop; when `true` suppress all mutation actions (approve, reject, disposition controls, labor stepper). Only render the finding summary view. |

---

## Concrete changes

### `wet-check-review.tsx` — `QueueCard`

```tsx
const me = getCurrentUser();
const isReadOnly = me?.role === "billing_manager";

// Replace:
<button ... onClick={onReview}>Begin Review</button>

// With:
<Button
  variant={isReadOnly ? "outline" : "default"}
  size="sm"
  onClick={onReview}
>
  {isReadOnly ? "View" : "Begin Review"}
</Button>
```

### `wet-check-wizard.tsx`

Add `readOnly?: boolean` to props. When `readOnly`:
- Hide `ApproveButton`, `RejectButton`, `DispositionSelector`, `LaborHoursStepper`.
- Replace the footer action bar with a single `<Button variant="outline" onClick={onClose}>Close</Button>`.
- Show a `<Badge variant="secondary">Read-only</Badge>` label in the wizard header.

---

## Tests

- Unit test in `wet-checks-billing-manager-guard.test.tsx`:
  - Mount `QueueCard` with `role="billing_manager"` → assert button label is "View", not "Begin Review".
  - Mount `QueueCard` with `role="irrigation_manager"` → assert label is "Begin Review".
- Mount `WetCheckWizard` with `readOnly={true}` → assert `data-testid="approve-btn"` is absent.

---

## Acceptance criteria

- `billing_manager` at `/wet-checks/pending-review` sees "View" (outline button), not "Begin Review".
- Opening the view modal/wizard as `billing_manager` presents only read content; no approve/reject/disposition/labor controls are present in the DOM.
- All existing `irrigation_manager` and `company_admin` flows are unchanged.
- No API mutation endpoints are reachable from the `billing_manager` wet-check UI paths.

---

## Out of scope

- Changing the `billing_manager` billing-workspace surfaces.
- Super-admin impersonation flows.
- Field-tech role guards (separate surface).
