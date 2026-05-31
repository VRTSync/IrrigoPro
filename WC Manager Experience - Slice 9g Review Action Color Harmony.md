# WC Manager Experience — Slice 9g: Review Action Button Color Harmony

**Source:** `docs/wc-manager-experience-visual-audit.md` Delta D8  
**Severity:** P1  
**Prerequisite slices:** 9d (which fixes the wet-check "Begin Review" button variant; land 9d first)

---

## Scope

On `/manager-workspace`, two "initiate review" actions use different colours for the same semantic gesture:

| Action | Current colour |
|--------|----------------|
| Wet check "Begin Review" CTA | `bg-cyan-600` hardcoded (or `<Button variant="default">` after **Slice 9d** ships) |
| Work order review buttons (pipeline tiles) | `border-amber-300 text-amber-700 hover:bg-amber-50` outline — hardcoded amber |

A user scanning the dashboard sees cyan for "start a wet-check review" and amber for "start a work-order
review." These are the same initiation verb applied to two different entity types; they should use the
same semantic `<Button variant>` so intent is communicated through label and icon, not colour.

This slice replaces the hardcoded amber work-order review buttons with `<Button variant="outline" size="sm">`.

---

## Files to modify

| File | Change |
|------|--------|
| `artifacts/irrigopro/src/pages/manager-workspace.tsx` | Replace inline amber `className` on work-order review `<button>` elements with `<Button variant="outline" size="sm">` |

---

## Concrete changes

```tsx
// In the pipeline tile / work-order row action, replace:
<button
  className="border border-amber-300 text-amber-700 hover:bg-amber-50 rounded px-3 py-1 text-sm"
  onClick={...}
>
  Review
</button>

// With:
<Button variant="outline" size="sm" onClick={...}>
  Review
</Button>
```

If the amber colour is intentional as a semantic signal (e.g. work orders that are overdue), use
`<Button variant="outline" size="sm" className="border-amber-300 text-amber-700 hover:bg-amber-50">`
to retain the amber tint while grounding it in the Button component contract — but prefer the plain
outline variant unless a product decision requires the amber urgency cue.

---

## Tests

- Re-run `wc-audit-capture.test.tsx`; `wc-dashboard.irrigation_manager.html` should not contain the
  bare inline `border-amber-300 text-amber-700` class combination on any `<button>` element.
- Add a unit test: mount `ManagerWorkspace` with mock work-order data → work-order review buttons
  are rendered as `<Button>` elements (check for `data-slot="button"` or equivalent).

---

## Acceptance criteria

- Work-order review buttons in `ManagerWorkspace` use `<Button variant="outline">` — no bare `border-amber-300 text-amber-700` inline string on button elements.
- After **Slice 9d** also lands, both wet-check and work-order review initiation use `<Button>` components.
- Visual appearance may retain amber tint if added back via `className` prop on `Button`, but the base component must be `<Button>`.

---

## Out of scope

- Changing the pipeline tile card container style (addressed by **Slice 9z** D12).
- The "Continue Review" amber button on the wet-check queue (`partially_converted` state) — **Slice 9z**.
- Work-order surfaces outside `/manager-workspace`.
