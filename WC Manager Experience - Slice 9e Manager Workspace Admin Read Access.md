# WC Manager Experience — Slice 9e: Manager Workspace Admin Read Access

**Source:** `docs/wc-manager-experience-visual-audit.md` Delta D6  
**Severity:** P1  
**Prerequisite slices:** None

---

## Scope

`/manager-workspace` is routed exclusively to `irrigation_manager` (App.tsx Switch). This is the
live pipeline view: pending wet checks, work orders to review, and the status strip.

`company_admin` and `super_admin` currently have no route to this surface — navigating there yields
`NotFound`. These supervisory roles have legitimate read needs (audit, workload monitoring, escalation
triage) but no supported URL path.

This slice provisions a **read-only** variant of `ManagerWorkspace` for `company_admin` and
`super_admin` by adding the route to their Switch blocks.

---

## Files to modify

| File | Change |
|------|--------|
| `artifacts/irrigopro/src/App.tsx` | Add `/manager-workspace` route to `company_admin` Switch → `ManagerWorkspace` |
| `artifacts/irrigopro/src/App.tsx` | Add `/manager-workspace` route to `super_admin` Switch → `ManagerWorkspace` |
| `artifacts/irrigopro/src/pages/manager-workspace.tsx` | Add `readOnly` mode that hides mutation actions (e.g. "Create Wet Check" FAB) when the caller is `company_admin` or `super_admin` |
| `artifacts/irrigopro/src/components/layout/nav-config.ts` | Add `/manager-workspace` leaf entry to `companyAdminNav` and `superAdminNav` under an "Operations" group |

---

## Concrete changes

### App.tsx — company_admin Switch

```tsx
<Route
  path="/manager-workspace"
  component={lazyPage(() => import("@/pages/manager-workspace"))}
/>
```

### App.tsx — super_admin Switch

Same entry.

### `manager-workspace.tsx`

```tsx
const me = getCurrentUser();
const isReadOnly = me?.role === "company_admin" || me?.role === "super_admin";

// Suppress FAB and "Create" actions when readOnly:
{!isReadOnly && <FAB ... />}
```

### `nav-config.ts` — companyAdminNav + superAdminNav

```ts
{ type: "leaf", label: "Manager Queue", path: "/manager-workspace", icon: ClipboardCheck }
```

---

## Tests

- `wc-audit-capture.test.tsx`: after the fix, `wc-dashboard.company_admin.html` should contain `data-testid="manager-workspace"` (not `NotFound`).
- Assert FAB is absent in `company_admin` and `super_admin` fixtures.
- Assert FAB is present in `irrigation_manager` fixture.

---

## Acceptance criteria

- `company_admin` and `super_admin` at `/manager-workspace` render `ManagerWorkspace`.
- FAB / mutation CTAs are hidden for `company_admin` and `super_admin`.
- `irrigation_manager` experience is unchanged.
- Nav items for `company_admin` and `super_admin` include "Manager Queue" link.

---

## Out of scope

- Changing the `ManagerWorkspace` data sources (it fetches company-scoped data; that is unchanged).
- Filtering the queue to show only records assigned to a specific manager.
- `billing_manager` access (billing role does not need pipeline visibility).
