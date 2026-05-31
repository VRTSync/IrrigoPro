# WC Manager Experience — Slice 9c: Status & Resolution Badge Token Alignment

**Source:** `docs/wc-manager-experience-visual-audit.md` Deltas D3, D4  
**Severity:** P1  
**Prerequisite slices:** None (visual-only, no routing changes)

---

## Scope

`ManagerWetCheckDetailPage` uses two hand-rolled className maps for status and resolution badges:

- **`STATUS_BADGE`** — maps `submitted → "bg-blue-100 text-blue-800 border border-blue-300"` etc.
- **`RESOLUTION_META`** — maps `repaired_in_field → "bg-emerald-50 text-emerald-700 border-emerald-200"` etc.

Both bypass the shared `<Badge variant>` design system, which means:
- The blue shade for `submitted` potentially differs from `<Badge variant="info">` (used by the review queue for the same status).
- Resolution tags require manual maintenance if the palette ever changes.

This slice replaces both maps with `<Badge variant>` calls.

---

## Files to modify

| File | Change |
|------|--------|
| `artifacts/irrigopro/src/pages/wet-checks/ManagerWetCheckDetailPage.tsx` | Replace `STATUS_BADGE` map + raw `className` usage with `<Badge variant>` |
| `artifacts/irrigopro/src/pages/wet-checks/ManagerWetCheckDetailPage.tsx` | Replace `RESOLUTION_META` map + raw className usage with `<Badge variant>` |

---

## Concrete changes

### Status badge mapping

```tsx
// Remove STATUS_BADGE object and hand-rolled <span>
// Replace with:
function StatusBadge({ status }: { status: string }) {
  const variantMap: Record<string, BadgeVariant> = {
    submitted:            "info",
    in_progress:          "warning",
    approved:             "success",
    rejected:             "destructive",
    billed:               "secondary",
    partially_converted:  "warning",
  };
  return (
    <Badge variant={variantMap[status] ?? "secondary"}>
      {STATUS_LABELS[status] ?? status}
    </Badge>
  );
}
```

### Resolution badge mapping

```tsx
// Remove RESOLUTION_META object and hand-rolled <span>
// Replace with:
function ResolutionBadge({ resolution }: { resolution: string }) {
  const variantMap: Record<string, BadgeVariant> = {
    repaired_in_field:  "success",
    needs_part:         "warning",
    needs_estimate:     "info",
    no_action_needed:   "secondary",
  };
  return (
    <Badge variant={variantMap[resolution] ?? "secondary"}>
      {RESOLUTION_LABELS[resolution] ?? resolution}
    </Badge>
  );
}
```

---

## Tests

- Snapshot diff: run `wc-audit-capture.test.tsx` before and after; the `wc-detail.irrigation_manager.html` fixture should no longer contain `bg-blue-100` or `bg-emerald-50` inline class strings on badge elements.
- Add a unit test asserting `<Badge variant="info">` is rendered for status `"submitted"` and `<Badge variant="success">` for resolution `"repaired_in_field"`.

---

## Acceptance criteria

- `ManagerWetCheckDetailPage` contains no `STATUS_BADGE` or `RESOLUTION_META` objects.
- Status badges on the detail page use the same `<Badge variant>` tokens as the review queue (`variant="info"` for `submitted`, `variant="warning"` for `in_progress`, etc.).
- Resolution badges use `<Badge variant>` tokens with no raw Tailwind color strings on badge elements.
- No visual regression on other surfaces.

---

## Out of scope

- Updating badge variants on the review queue or list pages (those already use `<Badge variant>`).
- Adding new resolution or status values not present in the current codebase.
