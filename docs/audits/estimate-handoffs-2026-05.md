# Estimate Handoff Audit — May 2026

**Scope:** end-to-end review of every place an estimate "changes hands"
between users (field_tech / irrigation_manager → company_admin /
billing_manager → customer → operations on conversion). Investigation
only — no behavior changes are made by this commit.

**Code reviewed at:** `artifacts/api-server/src/routes/routes.ts`,
`artifacts/api-server/src/routes/estimate-routes.ts`,
`artifacts/api-server/src/storage.ts`,
`artifacts/api-server/src/lifecycle.ts`,
`lib/db/src/schema/schema.ts`,
`lib/db/src/schema/audit-log.ts`,
`artifacts/api-server/src/scripts/audit-inconsistent-estimate-drafts.ts`,
`artifacts/irrigopro/src/pages/estimates*.tsx`,
`artifacts/irrigopro/src/components/estimates/*`.

---

## 1. Summary

| Severity     | Security | Data Integrity | Auditability | UX | Total |
|--------------|---------:|---------------:|-------------:|---:|------:|
| **Critical** |        3 |              1 |            0 |  0 |     4 |
| **High**     |        2 |              3 |            2 |  1 |     8 |
| **Medium**   |        1 |              2 |            1 |  2 |     6 |
| **Low**      |        0 |              0 |            1 |  3 |     4 |
| **Total**    |        6 |              6 |            4 |  6 |    22 |

The headline picture: lifecycle enforcement and approval-side guards
are reasonably good, but **read/write of estimates outside the
approval routes is essentially un-gated** and there is **no
audit-log row written for any estimate transition**. The customer
approval-token surface is also weaker than the rest of the app —
weakly-keyed lookup, no expiry on the reject path, no revocation,
and no PDF/email snapshot.

---

## 2. Findings

### F-01 — `GET /api/estimates` and `GET /api/estimates/:id` are unauthenticated
- **Severity:** Critical — Security
- **Where:** `routes.ts:7399-7411`, `routes.ts:7437-7450`
- **Current:** Neither route declares `requireAuthentication`. They
  return the full list / single row, including `customerEmail`,
  `customerPhone`, `projectAddress`, `totalAmount`, parts list, and
  `approvalToken` (the long-lived customer-facing approval secret).
- **Why it's risky:** Anyone who can reach the API can enumerate
  estimates and harvest approval tokens, then call
  `/api/estimates/approve-via-token/:token` to approve a job on the
  customer's behalf. Even without the token field, the response
  leaks pricing + PII to anonymous callers.
- **Repro:** `curl $REPLIT_DEV_DOMAIN/api/estimates` returns rows
  with `approvalToken: "…"` whenever an estimate has been sent.
- **Recommended fix:** Add `requireAuthentication` to both routes;
  scope the list to `req.authenticatedUserCompanyId` for non-super-admin
  callers; strip `approvalToken` and `tokenExpiresAt` from the
  serializer (the token must never leave the server other than
  embedded in an outbound email URL).

### F-02 — `PUT /api/estimates/:id` is not company-scoped or role-scoped
- **Severity:** Critical — Security / Data Integrity
- **Where:** `estimate-routes.ts:306-309` →
  `handleEstimateUpdate` (`estimate-routes.ts:190-304`).
- **Current:** Auth is `requireAuthentication`. The handler loads
  the existing estimate but never compares `existing.companyId`
  against `req.authenticatedUserCompanyId`, and never checks role.
- **Why it's risky:** Any authenticated user — including a
  `field_tech` from a totally different company — can mutate any
  estimate they can guess the integer id for. The handler does
  strip `companyId`/`createdBy`/`createdByUserId` from the payload
  (good), but it will still rewrite `customerId`, every line item,
  internalStatus (via the wizard payload), and labor rate.
- **Recommended fix:** Use the same pattern the approval routes
  use: `estimateOwnershipMatches(req, existing.companyId)` →
  404 on mismatch, plus an explicit role allow-list
  (`irrigation_manager | company_admin | billing_manager | super_admin`).

### F-03 — `DELETE /api/estimates/:id` is not company-scoped or role-scoped
- **Severity:** Critical — Security
- **Where:** `routes.ts:7459-7472`.
- **Current:** Only `requireAuthentication`. No ownership check, no
  role check, no audit row.
- **Why it's risky:** Any authenticated user (incl. field techs)
  can delete any estimate by guessing the id, cross-company. Storage
  `deleteEstimate` (`storage.ts:2002`) doesn't filter by company
  either.
- **Recommended fix:** Restrict to `company_admin | super_admin`;
  enforce `estimateOwnershipMatches`; write an `audit_log` row
  (`estimate.deleted`).

### F-04 — Duplicate, divergent approve / reject endpoints
- **Severity:** Critical — Data Integrity
- **Where:**
  - `POST /api/estimates/:id/approve` (`routes.ts:8801-8833`)
  - `PATCH /api/estimates/:id/approve` (`routes.ts:8899-8963`)
  - `POST /api/estimates/:id/reject` (`routes.ts:8834-8867`)
  - `PATCH /api/estimates/:id/reject` (`routes.ts:8965-9000`)
- **Current behavior diverges:**
  - `POST .../approve` flips `status=approved` with **no
    `status === 'pending'` precondition**. Re-approving an already
    `rejected` or `expired` estimate succeeds silently.
  - `POST .../approve` does **not** auto-create the work order.
  - `PATCH .../approve` guards on `pending` and then calls
    `createWorkOrderFromEstimate`, assigns to the irrigation
    manager, and emits a notification.
  - `POST .../reject` similarly skips the `pending` guard.
- **Why it's risky:** Two endpoints, "same" action, different side
  effects. A caller that hits the POST flavor (the older one) can
  resurrect a `rejected` estimate or approve an `expired` one with
  no work-order creation. Lifecycle correctness then depends on
  whichever endpoint the client happened to call.
- **Recommended fix:** Delete the POST variants. The frontend
  already uses the PATCH ones (see
  `estimates-pending-approval.tsx:69` — `apiRequest('/reject',
  'PATCH', {})`). Add a deprecation log first, then remove.

### F-05 — `POST /api/estimates/:id/convert-to-work-order` has no role gate
- **Severity:** High — Security
- **Where:** `routes.ts:9416-9466`.
- **Current:** `requireAuthentication` only — no role check, no
  ownership check, no idempotency. Accepts `assignedTechnicianId`
  / `scheduledDate` / `notes` from any caller. The underlying
  `storage.createWorkOrderFromEstimate` checks
  `status === 'approved'` and "already has WO" but those checks
  are not atomic with the insert.
- **Why it's risky:**
  - A field_tech from any company can convert any approved
    estimate (even cross-company) into a work order assigned to
    whoever they specify.
  - Two near-simultaneous calls race past the "already exists"
    guard (lines 2710-2713 in `storage.ts` are a `select` then a
    later `insert` with no unique index) and produce **duplicate
    work orders** with the same `estimateId`.
- **Repro (race):** open the estimate detail modal in two tabs,
  click "Convert" within the same second.
- **Recommended fix:** Allow-list (`company_admin |
  irrigation_manager | billing_manager | super_admin`); enforce
  `estimateOwnershipMatches`; add a partial unique index on
  `work_orders(estimate_id) WHERE estimate_id IS NOT NULL`; wrap
  the load + insert + estimates.workOrderId update in a single
  transaction.

### F-06 — Customer approval token: O(N) scan, no revocation, partial expiry, no PDF snapshot
- **Severity:** High — Security / Data Integrity
- **Where:**
  - Generation: `_sendEstimateApprovalEmailFlow`
    (`routes.ts:9019-9061`).
  - Approve: `GET /api/estimates/approve-via-token/:token`
    (`routes.ts:9202-9322`).
  - Reject: `GET /api/estimates/reject-via-token/:token`
    (`routes.ts:9324-9415`).
- **Current:**
  - 32 random bytes hex — entropy is fine.
  - Lookup is `storage.getEstimates().find(e =>
    e.approvalToken === token)` — full table scan + plaintext
    compare. No index on `approval_token` and no constant-time
    compare.
  - Token is **not invalidated** after a successful approve or
    reject (the row keeps `approvalToken`/`tokenExpiresAt`). The
    "already responded" gate is `status !== 'pending'`, so re-use
    of the same URL is rejected by status — but the secret stays
    on the row indefinitely.
  - **Reject path does NOT check `tokenExpiresAt`.** Only the
    approve path does (`routes.ts:9220-9233`). An attacker with a
    stale token can still reject the estimate.
  - **Resending a sent estimate mints a new token but does not
    revoke the previous one** (no `approvalToken = null` write on
    update or resend). Both URLs work until one is used.
  - **Editing after send is silent.** Manager can `PUT` the
    estimate and the customer's existing email link will, on the
    next click, approve the new totals. There is no PDF snapshot
    — `_sendEstimateApprovalEmailFlow` reads `getEstimate(id)`
    live each time and the email body / detail page reads live
    data.
- **Recommended fix:**
  - Hash the token at rest (sha256), look up by hash with an
    index. Compare in constant time.
  - On approve / reject success, write `approvalToken = null`
    and `tokenExpiresAt = null`.
  - Enforce `tokenExpiresAt` on the reject path.
  - When `PUT /api/estimates/:id` lands on an estimate whose
    `internalStatus === 'sent_to_customer'`, either reject the
    edit (recommended) or invalidate the token and force a fresh
    send.
  - Snapshot the rendered PDF + totals to `invoice_pdfs`-style
    storage at send time and serve THAT on the customer page.

### F-07 — Token endpoints leak pricing & PII to anonymous callers
- **Severity:** High — Security
- **Where:** `routes.ts:9202-9415`. The approve-via-token JSON
  response (line 9305-9313) returns `customerEmail` and the
  rendered HTML reject page echoes `customerEmail` (line 9408).
  The 9202 handler also calls `storage.getEstimates()` (returning
  every estimate company-wide in memory) just to find one row.
- **Why it's risky:** The token is the only auth — anyone with a
  forwarded customer email URL can fetch
  `customerEmail`/`customerName`/`estimateNumber`. The full-list
  fetch additionally pulls every row into a single Node process
  on a cold path, which is a small DoS amplifier on large
  tenants.
- **Recommended fix:** Add `getEstimateByApprovalTokenHash` to
  storage that does a single indexed lookup. Trim the JSON to
  `{ success, estimateNumber, workOrderCreated, workOrderNumber }`
  — drop `customerEmail`.

### F-08 — No optimistic locking / lost-update window on PUT
- **Severity:** High — Data Integrity
- **Where:** `handleEstimateUpdate` (`estimate-routes.ts:190-304`)
  → `storage.updateEstimateWithItems`.
- **Current:** There is no `version` / `updated_at` precondition.
  The schema has `updatedAt` but it is set by the writer, not
  used as an If-Match.
- **Why it's risky:** Classic lost-update — manager A opens the
  detail, manager B opens the detail, A saves, B saves over A's
  changes. The audit script
  (`scripts/audit-inconsistent-estimate-drafts.ts`) shows we
  already know about a related class of bug (drafts left half-
  submitted by the previous PUT-then-/transition wizard flow).
- **Recommended fix:** Add an `int version` column, bump it on
  every write, require the client to echo it back, 409 on
  mismatch. Apply identically to the approval routes that mutate
  status (approve/reject/internal-approve/send/transition).

### F-09 — Drafts editable by anyone in the company
- **Severity:** High — Data Integrity / UX
- **Where:** `handleEstimateUpdate` again — no creator check, no
  draft-ownership check. Even if F-02 is fixed (company scope),
  any company user can rewrite another user's draft.
- **Current:** `createdByUserId` is stamped at create
  (`estimate-routes.ts:136-146`) and stripped from update
  payloads (good), but never consulted as an authorization
  signal.
- **Read path:** `GET /api/estimates` returns all rows including
  drafts authored by other techs/managers; the board / list shows
  them. The frontend filters by no creator field.
- **Recommended fix (sketch):** Drafts (`internalStatus === 'draft'`)
  should be editable only by `createdByUserId` plus
  `company_admin` / `super_admin` / `irrigation_manager`. On the
  read path, drafts should be filtered to the same set unless the
  caller is a manager+. Document the policy in `replit.md`.

### F-10 — `POST /api/estimates/:id/approve` & `/reject` skip status precondition
- **Severity:** High — Data Integrity
- See F-04 — already merged into the recommendation. Calling them
  on `rejected` or `expired` estimates "succeeds" and reshapes
  status without re-checking pricing visibility, without
  recreating the work order, and without re-running any guard.
  Removing these endpoints (preferred) or back-porting the
  `status === 'pending'` gate from the PATCH variants is the fix.

### F-11 — No `audit_log` rows for any estimate transition
- **Severity:** High — Auditability
- **Where:** Cross-cut. Greps over `routes.ts` for `auditLog`
  show one writer (`routes.ts:1155`) — it is the generic
  telemetry sink for `auth.*` events and admin actions. None of
  the estimate handlers emit through it.
- **Matrix of transitions vs audit log row written:**

  | Transition                                              | Endpoint                                  | Audit row? | Actor captured? |
  |---------------------------------------------------------|-------------------------------------------|:----------:|:---------------:|
  | create (draft / pending_approval)                       | `POST /api/estimates`                     | No         | createdByUserId on row only |
  | edit content                                            | `PUT /api/estimates/:id`                  | No         | No |
  | submit for review (legacy)                              | `POST /api/estimates/:id/transition`      | No         | No |
  | submit for review (atomic)                              | `POST /api/estimates/:id/submit-for-review` | No       | No |
  | internal approve                                        | `PATCH .../internal-approve`              | No         | No |
  | send approval email                                     | `POST .../send-approval-email` and `transition` | No   | No |
  | resend (post-expiry)                                    | `POST .../transition`                     | No         | No |
  | approve (manager)                                       | `PATCH .../approve` (and POST duplicate)  | No         | No |
  | reject  (manager)                                       | `PATCH .../reject` (and POST duplicate)   | No         | No |
  | approve (customer token)                                | `GET .../approve-via-token/:token`        | No         | No (no user id) |
  | reject  (customer token)                                | `GET .../reject-via-token/:token`         | No         | No |
  | auto-expire on token use                                | inside approve-via-token                  | No         | No |
  | convert to work order                                   | `POST .../convert-to-work-order`          | No         | No |
  | delete                                                  | `DELETE /api/estimates/:id`               | No         | No |

- **Why it's risky:** App-Health Phase 2 ships an audit-log
  viewer that is now meaningfully blind to the entire estimate
  pipeline. "Who sent this to the customer at the wrong price"
  and "who deleted estimate 4123" are unanswerable today.
- **Recommended fix:** Add a small `recordEstimateAudit(req,
  estimate, action, details)` helper in `routes.ts` that wraps
  the existing telemetry sink at `routes.ts:1155`. Emit one row
  per transition with `targetType='estimate'`, `targetId=String(id)`,
  and `action` in `estimate.created|edited|submitted|
  internal_approved|sent|resent|approved|rejected|expired|
  converted|deleted`. Token-path rows should record
  `actorLabel='customer (token)'` with no `actorUserId`.

### F-12 — Customer token approve doesn't carry actor on the resulting work order
- **Severity:** Medium — Auditability
- **Where:** `routes.ts:9248-9275` + `storage.ts:2697`.
- **Current:** When the customer clicks the approval URL,
  `createWorkOrderFromEstimate` runs and the work order's only
  trace of "who triggered this" is `assignedTechnicianName` (the
  irrigation manager, via the auto-assign block). There is no
  `convertedBy` / `convertedByUserId` / `approvalSource` carry-
  over on the work order.
- **Recommended fix:** Surface `approvalSource` (already on
  `estimates`) onto the work order. Emit `estimate.converted`
  audit row with `actorLabel = 'customer:<email>'` plus the source
  estimate id.

### F-13 — `PATCH .../approve` work-order creation is best-effort, swallowed
- **Severity:** Medium — Data Integrity
- **Where:** `routes.ts:8927-8951`. The `try/catch` around
  `createWorkOrderFromEstimate` only `console.error`s on failure;
  the estimate is still flipped to `approved`. A retried approve
  click runs into the "estimate must be approved" guard the
  second time (passes) and the "work order already exists" guard
  (which may or may not be tripped depending on whether the
  previous insert failed before or after the row landed).
- **Why it's risky:** Approve-without-WO is invisible to the
  manager — the response says `workOrderCreated: false` but the
  UI doesn't surface that meaningfully today.
- **Recommended fix:** Either fail the request (`500` with a
  re-approve hint) or schedule a retry; surface the failure on
  the frontend so it doesn't silently drop. The right answer is
  "wrap approve + WO creation in one DB transaction with a
  partial unique index on `work_orders.estimate_id`" so the
  retry semantics are obvious.

### F-14 — Pricing-visibility strip is NOT applied to estimate endpoints
- **Severity:** Medium — Security (defense in depth)
- **Where:** Grep `applyPricingVisibility` (routes.ts) shows
  applications on billing-sheets, work-orders, parts, and missing-
  photos. **Zero applications on `/api/estimates*`.**
- **Current:** A field_tech who knows an estimate id (or fetches
  the list) sees `totalAmount`, `partsSubtotal`, `laborSubtotal`,
  `laborRate`, and per-line `partPrice` / `totalPrice`. The
  policy in `routes.ts:74-77` says field techs must NEVER see
  pricing values.
- **Why it's risky:** Pricing leakage on the very record that
  exists to price the job. Compounded by F-01 (unauth read).
- **Recommended fix:** Wrap every estimate response with
  `applyPricingVisibility(req, …)` once F-01 is fixed so the
  authenticated role is reliable. Apply to: list, detail,
  pending-approval, transition response, send response, approval-
  token public page response (the public token page should also
  strip pricing for non-customer roles).

### F-15 — `POST /api/estimates/:id/email` is a stub
- **Severity:** Medium — UX
- **Where:** `routes.ts:7475-7491`. Returns
  `{ message: "Estimate email sent successfully" }` without
  sending anything. No frontend caller found.
- **Recommended fix:** Delete the route; the real send is via
  `/send-approval-email` and `/transition?action=send_to_customer`.

### F-16 — Resend doesn't bump `estimateDate` everywhere it should
- **Severity:** Medium — UX
- **Where:** `routes.ts:9180-9189` (`action === 'resend'`).
  Resets `estimateDate` so the expiration recomputes. The
  separate `POST /send-approval-email` path does **not** reset
  `estimateDate`, so if a billing manager hits the "Send" button
  again on an estimate whose first send was 28 days ago, the
  customer link will expire in 2 days. The only path that resets
  is the explicit `resend` transition.
- **Recommended fix:** Either funnel both paths through the same
  helper with `resetEstimateDate: true` whenever a token is
  re-minted, or document the distinction in the UI.

### F-17 — `internalStatus = 'expired'` is set when a customer clicks an expired link, but isn't surfaced via lifecycle
- **Severity:** Medium — UX / Data Integrity
- **Where:** `routes.ts:9221`. On expired token click, the
  handler writes `status: 'expired'` (note: the customer-facing
  enum `status` is `pending|approved|rejected`; `expired` is not
  in `LIFECYCLE_STATUSES` mapping for `status`). The lifecycle
  computer in `lifecycle.ts:33-58` does not check `status ===
  'expired'`; it derives expiry from
  `internalStatus === 'sent_to_customer' && estimateDate > 30d`.
- **Why it's risky:** Two sources of truth for expiry that can
  disagree. After the customer clicks, the row has
  `status='expired'` but `internalStatus='sent_to_customer'` and
  `lifecycleStatus` would still be `expired` only because of the
  date check. If a manager later resets `estimateDate` without
  resetting `status`, the lifecycle says `sent` but the public
  page says expired.
- **Recommended fix:** Pick one: keep `lifecycleStatus` as the
  computed source of truth and stop writing `status='expired'`,
  or add `'expired'` to the `status` enum and route the
  lifecycle computer through that.

### F-18 — `internal-approve` is one-way
- **Severity:** Low — UX
- **Where:** `routes.ts:8870-8898`.
- **Current:** Only `pending_approval → approved_internal`. No
  endpoint exists to demote `approved_internal` back to
  `pending_approval` (e.g. on a "wait, I want to re-review"
  click). Same for `sent_to_customer` — no path back to a draft
  for editing after send (this also feeds F-06).
- **Recommended fix:** Add `revert_internal_approve` and decide
  whether `sent_to_customer` can be reopened (with token
  invalidation). Document the legal edges in `lifecycle.ts`.

### F-19 — Frontend role-guard vs. server-guard drift
- **Severity:** Low — Auditability
- **Where:** `estimates-pending-approval.tsx` only renders the
  "Approve / Send / Reject" buttons because the page is gated
  client-side, but the server middleware
  (`requireEstimateApprovalAccess`) allows `billing_manager |
  company_admin | super_admin`. Field techs and irrigation
  managers cannot trigger the action server-side, which matches
  policy. **However,** the "Edit" / "Delete" buttons on the
  estimate detail modal are gated client-side only, and the
  matching server routes (F-02 / F-03) have no role enforcement
  at all.
- **Recommended fix:** Once F-02 / F-03 land, this becomes a
  no-op. Until then, log the drift.

### F-20 — `audit-inconsistent-estimate-drafts.ts` references a fixed bug but heuristics still useful
- **Severity:** Low — Auditability
- **Where:** `artifacts/api-server/src/scripts/audit-inconsistent-estimate-drafts.ts`.
- **Current:** The script was written for Task #606 to find
  drafts left in a half-submitted state by the old
  PUT-then-/transition wizard flow. The atomic
  `/submit-for-review` endpoint (`estimate-routes.ts:319-322`)
  fixes the root cause for new traffic, but no scheduled job
  runs the script, no follow-up cleared the historical suspects,
  and no monitor alerts on the same pattern from other writers.
- **Recommended fix:** Run the script once at the next
  deploy window; if the count is non-trivial, expose it on the
  App Health page as a known-bad rollup so we don't have to
  remember to grep.

### F-21 — Email/PDF regenerate from live data, not a snapshot
- **Severity:** Low — UX
- **Where:** `_sendEstimateApprovalEmailFlow` (`routes.ts:9019-
  9061`) reads `getEstimate(id)` and serializes line items
  live; the customer-facing approval link also reads live data.
  Already covered by F-06 from the security angle; calling out
  separately because the UX impact is its own bullet ("manager
  edits silently change the price the customer sees on next
  click").
- **Recommended fix:** See F-06. Snapshot at send-time.

### F-22 — Token uniqueness relies on randomness alone
- **Severity:** Low — Data Integrity
- **Where:** `estimates.approval_token` is declared `text` with
  no unique index. Collisions are astronomically unlikely with
  32 random bytes, but the lookup-by-find pattern in F-06 means
  a duplicated token would silently approve the wrong estimate.
- **Recommended fix:** Add a unique partial index on
  `approval_token WHERE approval_token IS NOT NULL`, and use
  `getEstimateByApprovalToken` (single indexed lookup) instead of
  the in-memory scan.

---

## 3. Appendix — Estimate surface area

### Routes
| Method | Path                                                  | Auth                                         | Role gate                                       | Notes |
|--------|-------------------------------------------------------|----------------------------------------------|-------------------------------------------------|-------|
| GET    | `/api/estimates`                                      | **none** (F-01)                              | none                                            | Returns approvalToken |
| GET    | `/api/estimates/pending-approval`                     | `requireAuthentication` + approval          | billing_manager / company_admin / super_admin   | Company-scoped ok |
| GET    | `/api/estimates/:id`                                  | **none** (F-01)                              | none                                            | |
| POST   | `/api/estimates`                                      | `requireAuthentication`                      | any role                                        | Stamps companyId/createdBy from auth |
| PUT    | `/api/estimates/:id`                                  | `requireAuthentication`                      | **none** (F-02, F-09)                           | |
| POST   | `/api/estimates/:id/submit-for-review`                | `requireAuthentication`                      | none (any same-company user)                    | Atomic transition (Task #606) |
| DELETE | `/api/estimates/:id`                                  | `requireAuthentication`                      | **none** (F-03)                                 | |
| POST   | `/api/estimates/:id/email`                            | `requireAuthentication`                      | none                                            | Stub (F-15) |
| POST   | `/api/estimates/:id/approve` (legacy)                 | `requireAuthentication` + approval          | bill / admin                                    | Skips status guard (F-04) |
| POST   | `/api/estimates/:id/reject` (legacy)                  | `requireAuthentication` + approval          | bill / admin                                    | Skips status guard (F-04) |
| PATCH  | `/api/estimates/:id/internal-approve`                 | `requireAuthentication` + approval          | bill / admin                                    | One-way (F-18) |
| PATCH  | `/api/estimates/:id/approve`                          | `requireAuthentication` + approval          | bill / admin                                    | Auto-creates WO, best-effort (F-13) |
| PATCH  | `/api/estimates/:id/reject`                           | `requireAuthentication` + approval          | bill / admin                                    | |
| POST   | `/api/estimates/:id/send-approval-email`              | `requireAuthentication` + approval          | bill / admin                                    | Re-mints token without revoking (F-06) |
| POST   | `/api/estimates/:id/transition`                       | `requireAuthentication`                      | Inline check (irrigation_manager / billing / admin per action) | |
| GET    | `/api/estimates/approve-via-token/:token`             | token only                                   | n/a                                             | F-06, F-07 |
| GET    | `/api/estimates/reject-via-token/:token`              | token only                                   | n/a                                             | No expiry enforcement (F-06) |
| POST   | `/api/estimates/:id/convert-to-work-order`            | `requireAuthentication`                      | **none** (F-05)                                 | Races on duplicate insert |
| POST   | `/api/quickbooks/sync-estimate/:id`                   | `requireQuickBooksAccess`                    | bill / admin                                    | Out of scope |
| GET/POST | `/api/estimates/:id/pdf`                            | `requireAuthentication` + approval          | bill / admin                                    | |

### Middleware
- `requireAuthentication` — `routes.ts:761-919`. Bearer token /
  session / (dev-only) header / (dev-only) query param. Sets
  `req.authenticatedUserId/Role/CompanyId`.
- `requireEstimateApprovalAccess` — `routes.ts:535-547`. Allow-list
  `company_admin | billing_manager | super_admin`.
- `estimateOwnershipMatches(req, estimate.companyId)` —
  `routes.ts:549-557`. Used on approve / reject / internal-approve
  / send-approval-email / transition. **Not** used on PUT, DELETE,
  convert, GET, or POST.

### Storage methods that mutate estimates
- `createEstimate`, `createEstimateFromPayload`
- `updateEstimate` (partial), `updateEstimateWithItems` (full)
- `deleteEstimate`
- `createWorkOrderFromEstimate` — also writes `estimates.workOrderId`
- `getEstimatesPendingApproval(companyId)` — read; correctly scoped.

### Frontend components
- `pages/estimates.tsx`, `pages/estimates-pending-approval.tsx`,
  `components/estimates/board/*`, `components/estimates/list/*`,
  `components/estimates/estimate-wizard.tsx`,
  `components/estimates/estimate-detail-modal.tsx`,
  `lib/lifecycle.ts` (UI tints).

---

## 4. Proposed follow-up tasks

Each item below is one finding (or a tightly-scoped cluster) shaped
into a discrete task. They are listed roughly in priority order; the
critical-security items should land first.

1. **Lock down public estimate read endpoints** — Add
   `requireAuthentication`, scope `GET /api/estimates` to the
   caller's company, strip `approvalToken` / `tokenExpiresAt` from
   every serializer (F-01).
2. **Company- and role-scope `PUT` / `DELETE /api/estimates/:id`** —
   Use `estimateOwnershipMatches`, add a role allow-list, write an
   `audit_log` row on each mutate (F-02, F-03).
3. **Collapse the duplicate approve/reject endpoints** — Deprecate
   then delete `POST /api/estimates/:id/approve` and
   `POST /api/estimates/:id/reject`; back-port the `pending`
   precondition; update any remaining callers (F-04, F-10).
4. **Role-gate and de-race convert-to-work-order** — Role allow-list,
   ownership check, partial unique index on
   `work_orders(estimate_id) WHERE estimate_id IS NOT NULL`, wrap
   approve + convert in a single transaction (F-05, F-13).
5. **Harden the customer approval token** — sha256 at rest +
   indexed lookup, revoke on use, enforce expiry on the reject path,
   invalidate on edit-after-send, single-use, snapshot the PDF /
   email body at send time (F-06, F-07, F-21, F-22).
6. **Add optimistic locking to all estimate mutators** — `version`
   column, If-Match precondition, 409 on mismatch (F-08).
7. **Define and enforce draft ownership** — Decide per-creator vs.
   per-company drafts; enforce on PUT and on the read paths; update
   `replit.md` (F-09).
8. **Audit-log every estimate transition** — Add a
   `recordEstimateAudit` helper and wire it into create / edit /
   submit / internal-approve / send / resend / approve / reject /
   token-approve / token-reject / convert / delete (F-11, F-12).
9. **Apply pricing-visibility strip to estimate responses** — list,
   detail, transition, send, and the public token page (F-14).
10. **Tidy up small UX issues** — Delete the
    `/api/estimates/:id/email` stub; collapse `estimateDate` reset
    logic across send/resend; reconcile `internalStatus='expired'`
    with the lifecycle computer; add an `internal-approve` undo;
    schedule the inconsistent-drafts audit (F-15, F-16, F-17, F-18,
    F-20).
