# WC Manager Experience — Slice 9f: Empty State Icon Token Harmonisation

**Source:** `docs/wc-manager-experience-visual-audit.md` Delta D7  
**Severity:** P1  
**Prerequisite slices:** None

---

## Scope

Three wet-check surfaces have empty states with different icon colours, producing an incoherent visual
language for the same "nothing here yet" message:

| Surface | Component | Icon | Colour |
|---------|-----------|------|--------|
| `/wet-checks/pending-review` queue | `EmptyQueue` in `wet-check-review.tsx` | `CheckCircle2` | `text-emerald-500` in `bg-emerald-100 rounded-2xl` |
| `/manager-workspace` dashboard | `ManagerWorkspace` | `ClipboardCheck` | `text-slate-200` |
| Manager wet-checks detail (`ManagerWetCheckDetailPage`) | inline empty zone | N/A | `text-green-500` |

`text-slate-200` (nearly white, very low contrast) differs significantly from the emerald tones on
the other two surfaces. This slice normalises all wet-check empty-state icons to `text-emerald-500`
in `bg-emerald-100 rounded-2xl` — the pattern already used by the review queue (which has the most
visual polish).

---

## Files to modify

| File | Change |
|------|--------|
| `artifacts/irrigopro/src/pages/manager-workspace.tsx` | Change the "Needs Your Attention" empty state icon from `text-slate-200` to `text-emerald-500` inside `bg-emerald-100 rounded-2xl` |
| `artifacts/irrigopro/src/pages/wet-checks/ManagerWetCheckDetailPage.tsx` | Normalise inline zone-empty icon colour from `text-green-500` to `text-emerald-500` |

---

## Concrete changes

### `manager-workspace.tsx` — "Needs Your Attention" empty section

```tsx
// Before:
<ClipboardCheck className="w-10 h-10 text-slate-200" />

// After:
<div className="bg-emerald-100 rounded-2xl p-3 mb-3">
  <ClipboardCheck className="w-10 h-10 text-emerald-500" />
</div>
```

### `ManagerWetCheckDetailPage.tsx` — zone empty state

```tsx
// Before (wherever text-green-500 appears on empty zone icon):
<SomeIcon className="... text-green-500" />

// After:
<SomeIcon className="... text-emerald-500" />
```

---

## Tests

- Re-run `wc-audit-capture.test.tsx`; the `wc-dashboard.irrigation_manager.html` fixture should not
  contain `text-slate-200` on icon elements.
- Add a simple snapshot assertion: the empty-state icon in the dashboard fixture contains `text-emerald-500`.

---

## Acceptance criteria

- All wet-check surface empty states use `text-emerald-500` for the primary icon colour.
- The `bg-emerald-100 rounded-2xl` container wrapper is present on the dashboard empty state icon (matching the review queue pattern).
- No other colours changed; only icon tone tokens affected.

---

## Out of scope

- Empty state copy/labels (text is intentionally different per surface).
- Non-wet-check empty states elsewhere in the app.
- Icon choice (which icon to use per surface is not changed here).
