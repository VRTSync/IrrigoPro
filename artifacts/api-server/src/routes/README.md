# Estimate routes — role × screen coverage matrix

This README is the human-readable contract that
`estimate-role-matrix.test.ts` (server) and
`estimate-role-matrix.test.tsx` (frontend, in
`artifacts/irrigopro/src/components/estimates/`) enforce as code.
When the matrix changes, update all three together.

## Roles in play

| Role                  | Notes                                                                                            |
| --------------------- | ------------------------------------------------------------------------------------------------ |
| `super_admin`         | Replit operator. Bypasses cross-company ownership checks.                                        |
| `company_admin`       | Company owner. Full estimate authority.                                                          |
| `billing_manager`     | Approves estimates, sends to customer. Cannot submit-for-review (handler-level check).           |
| `manager`             | Canonical "irrigation manager" role. Can *read* the PDF; cannot internally approve.              |
| `irrigation_manager`  | Legacy alias for `manager`. Honored by PDF gate AND by `/transition` submit-for-review path.     |
| `field_tech`          | Truck-level role. No estimate read PDF, no approval, no email, no transition.                    |

## Endpoint × role matrix

`✓` = handler reached (200 / 201 / 404 depending on body). `403` = role
guard rejects with 403. `401` = unauthenticated. `n/a` = not applicable
(e.g. unauthenticated branch).

Guards referenced below are exported from `./estimate-role-guards.ts`:

- `requireEstimateApprovalAccess` — `ESTIMATE_APPROVAL_ROLES` =
  `{super_admin, company_admin, billing_manager}`.
- `requireEstimatePdfAccess` — `ESTIMATE_PDF_READ_ROLES` =
  `{super_admin, company_admin, billing_manager, manager,
  irrigation_manager}`.
- `canPerformEstimateTransition(role, action)` —
  per-action rules used inside the `/transition` handler:
  - `submit_for_review` / `resend` → `ESTIMATE_SUBMIT_FOR_REVIEW_ROLES`
    = `{super_admin, company_admin, irrigation_manager}`.
  - `send_to_customer` → `ESTIMATE_SEND_TO_CUSTOMER_ROLES` =
    `{super_admin, company_admin, billing_manager}`.

| Method | Path                                              | Guard                                                  | super_admin | company_admin | manager | irrigation_manager | billing_manager | field_tech | anon |
| ------ | ------------------------------------------------- | ------------------------------------------------------ | ----------- | ------------- | ------- | ------------------ | --------------- | ---------- | ---- |
| GET    | `/api/estimates`                                  | (none)                                                 | ✓           | ✓             | ✓       | ✓                  | ✓               | ✓          | ✓    |
| GET    | `/api/estimates/:id`                              | (none)                                                 | ✓           | ✓             | ✓       | ✓                  | ✓               | ✓          | ✓    |
| GET    | `/api/estimates/pending-approval`                 | `requireAuth` + `requireEstimateApprovalAccess`        | ✓           | ✓             | 403     | 403                | ✓               | 403        | 401  |
| POST   | `/api/estimates`                                  | `requireAuth`                                          | ✓           | ✓             | ✓       | ✓                  | ✓               | ✓          | 401  |
| PUT    | `/api/estimates/:id`                              | `requireAuth`                                          | ✓           | ✓             | ✓       | ✓                  | ✓               | ✓          | 401  |
| POST   | `/api/estimates/:id/submit-for-review`            | `requireAuth`                                          | ✓           | ✓             | ✓       | ✓                  | ✓               | ✓          | 401  |
| DELETE | `/api/estimates/:id`                              | `requireAuth`                                          | ✓           | ✓             | ✓       | ✓                  | ✓               | ✓          | 401  |
| POST   | `/api/estimates/:id/approve` (legacy)             | `requireAuth` + `requireEstimateApprovalAccess`        | ✓           | ✓             | 403     | 403                | ✓               | 403        | 401  |
| POST   | `/api/estimates/:id/reject`                       | `requireAuth` + `requireEstimateApprovalAccess`        | ✓           | ✓             | 403     | 403                | ✓               | 403        | 401  |
| PATCH  | `/api/estimates/:id/approve`                      | `requireAuth` + `requireEstimateApprovalAccess`        | ✓           | ✓             | 403     | 403                | ✓               | 403        | 401  |
| PATCH  | `/api/estimates/:id/reject`                       | `requireAuth` + `requireEstimateApprovalAccess`        | ✓           | ✓             | 403     | 403                | ✓               | 403        | 401  |
| PATCH  | `/api/estimates/:id/internal-approve`             | `requireAuth` + `requireEstimateApprovalAccess`        | ✓           | ✓             | 403     | 403                | ✓               | 403        | 401  |
| POST   | `/api/estimates/:id/send-approval-email`          | `requireAuth` + `requireEstimateApprovalAccess`        | ✓           | ✓             | 403     | 403                | ✓               | 403        | 401  |
| POST   | `/api/estimates/:id/email`                        | `requireAuth` + `requireEstimateApprovalAccess`        | ✓           | ✓             | 403     | 403                | ✓               | 403        | 401  |
| POST   | `/api/estimates/:id/transition` (submit_for_review/resend) | `requireAuth` + handler dispatch (`canPerformEstimateTransition`) | ✓ | ✓ | 403 | ✓ | 403 | 403 | 401 |
| POST   | `/api/estimates/:id/transition` (send_to_customer)         | `requireAuth` + handler dispatch                       | ✓           | ✓             | 403     | 403                | ✓               | 403        | 401  |
| POST   | `/api/estimates/:id/convert-to-work-order`        | `requireAuth`                                          | ✓           | ✓             | ✓       | ✓                  | ✓               | ✓          | 401  |
| GET    | `/api/estimates/:id/pdf`                          | `requireAuth` + `requireEstimatePdfAccess`             | ✓           | ✓             | ✓       | ✓                  | ✓               | 403        | 401  |
| POST   | `/api/estimates/:id/pdf`                          | `requireAuth` + `requireEstimatePdfAccess`             | ✓           | ✓             | ✓       | ✓                  | ✓               | 403        | 401  |

### Cross-company ownership

Every approval handler invokes `estimateOwnershipMatches(req,
estimate.companyId)` AFTER the role guard. The contract is:

- `super_admin` always passes.
- All other roles must satisfy
  `req.authenticatedUserCompanyId === estimate.companyId` strictly.
- A mismatch returns **404 (not 403)** so callers cannot probe whether
  an estimate with a given id exists in another tenant.

## Frontend button visibility

The estimate detail modal
(`artifacts/irrigopro/src/components/estimates/estimate-detail-modal.tsx`)
gates buttons as follows:

| Button (testid)              | Gate                                                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------------------- |
| `detail-modal-view-pdf`      | `PDF_READ_ROLES` (same set as the server-side `ESTIMATE_PDF_READ_ROLES`).                          |
| `detail-modal-download-pdf`  | `PDF_READ_ROLES`.                                                                                  |
| `detail-modal-approve`       | `estimate.status === 'pending'`. **Not role-gated client-side**; server 403s for disallowed roles. |
| `detail-modal-reject`        | `estimate.status === 'pending'`. Not role-gated client-side.                                       |
| `detail-modal-send-email`    | `estimate.status === 'pending'`. Not role-gated client-side.                                       |
| `detail-modal-convert`       | `estimate.status === 'approved'`. Not role-gated client-side; the convert route is auth-only.      |

The "approval-style" buttons render for every role because the server
is the authority on whether the action is allowed. The matrix above
is what the server is committed to enforcing — the client showing
the button just produces a server-side 403 toast for the disallowed
role, which is acceptable defense-in-depth. If/when we add a
client-side role gate, the frontend matrix test in
`estimate-role-matrix.test.tsx` is the place to pin it.

## Where the tests live

- **Server** —
  `artifacts/api-server/src/routes/estimate-role-matrix.test.ts`
  mounts a real Express app with the real guards (from
  `estimate-role-guards.ts`) plus `registerEstimateRoutes` and
  exercises every endpoint × role combination.
- **Frontend** —
  `artifacts/irrigopro/src/components/estimates/estimate-role-matrix.test.tsx`
  mounts `<EstimateDetailModal/>` for each role on both a pending and
  an approved estimate fixture and asserts which buttons render.

## Why guards live in their own module

`routes.ts` is the legacy monolith and has top-level
`setInterval`/QuickBooks/data-fix code that won't run in tests
without a live DB. The guards are pure: they read
`req.authenticatedUserRole` and return 403 / next(). Extracting them
into `./estimate-role-guards.ts` lets the matrix test mount the
*real* middleware against a tiny stub Express app — so any change to
the guard logic in production code immediately fails the matrix test
without us having to maintain a parallel JS predicate.
