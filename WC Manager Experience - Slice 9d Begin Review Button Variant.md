# WC Manager Experience — Slice 9d: "Begin Review" Button Variant

**Source:** `docs/wc-manager-experience-visual-audit.md` Delta D5  
**Severity:** P1  
**Prerequisite slices:** 9b (the CTA is also being role-gated there; coordinate so 9b and 9d land together or 9b first)

---

## Scope

The "Begin Review" CTA in `WetCheckReviewPage` (`QueueCard`) uses hardcoded Tailwind colour strings:

```tsx
className="bg-cyan-600 hover:bg-cyan-700 text-white rounded-lg px-4 py-2 text-sm font-medium ..."
```

This bypasses the `<Button variant="default">` token which maps to the design system's primary colour.
If the primary colour ever changes in `tailwind.config.ts`, this CTA silently stays cyan.

The fix is a single-line component swap: replace the hand-rolled `<button>` with `<Button variant="default" size="sm">`.

---

## Files to modify

| File | Change |
|------|--------|
| `artifacts/irrigopro/src/pages/wet-check-review.tsx` | Replace raw `<button className="bg-cyan-600 ...">` with `<Button variant="default" size="sm">` (import already available) |

---

## Concrete changes

```tsx
// In QueueCard, replace:
<button
  className="bg-cyan-600 hover:bg-cyan-700 text-white rounded-lg px-4 py-2 text-sm font-medium transition-colors"
  onClick={onReview}
>
  {label}
</button>

// With:
<Button variant="default" size="sm" onClick={onReview}>
  {label}
</Button>
```

Note: `label` is either "Begin Review" or "View" after **Slice 9b** ships. Ensure the `Button` import
is already present (it is, via `@/components/ui/button`).

---

## Tests

- `wc-audit-capture.test.tsx` re-run: `wc-review.*.html` fixtures should no longer contain `bg-cyan-600` on the CTA button element.
- Add a unit test: mount `QueueCard` with a submitted row → assert the CTA is a `<button>` without `bg-cyan-600` class.

---

## Acceptance criteria

- "Begin Review" button in the review queue uses `<Button variant="default">` — no inline `bg-cyan-600` Tailwind string.
- Visual appearance matches the design system primary button (same colour as other primary CTAs in the app).
- Interaction behaviour unchanged (still opens the wizard / view sheet).

---

## Out of scope

- "Continue Review" amber outline CTA (`partially_converted` state) — covered by **Slice 9z**.
- Badge colours inside `QueueCard` — covered by **Slice 9c**.
- Dashboard review buttons — covered by **Slice 9g**.
