# Estimate system — orientation

A single, opinionated map of how an estimate moves through IrrigoPro
and where each piece of behavior lives. Read this **first** before
touching anything in `artifacts/api-server/src/routes/routes.ts`,
`artifacts/api-server/src/routes/estimate-routes.ts`, or
`artifacts/irrigopro/src/components/estimates/**`. The deep audit in
[`docs/audits/estimate-handoffs-2026-05.md`](audits/estimate-handoffs-2026-05.md)
covers the known gaps; this doc is just the lay of the land.

---

## 1. Two status axes plus one computed lifecycle

An estimate row carries **two** independent status fields, and the UI
shows a **third** value computed from them:

| Field             | Owned by      | Domain                                                                       | Means                                                                |
| ----------------- | ------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `status`          | Customer      | `pending` · `approved` · `rejected` · `expired` · `converted_to_work_order` | How the customer (or the system on their behalf) has responded.      |
| `internalStatus`  | Office staff  | `draft` · `pending_approval` · `approved_internal` · `sent_to_customer`     | Where the estimate is in the internal review track.                  |
| `lifecycleStatus` | **Computed**  | `draft` · `pending_review` · `sent` · `approved` · `rejected` · `expired`   | The single bucket the UI groups by. Server-stamped on every response. |

`lifecycleStatus` is derived in
[`artifacts/irrigopro/src/lib/lifecycle.ts`](../artifacts/irrigopro/src/lib/lifecycle.ts)
(`computeLifecycleStatus`, lines 33–59) from `(status, internalStatus,
estimateDate)`. The 30-day expiry window (`ESTIMATE_EXPIRATION_DAYS`,
line 23) only applies when `internalStatus === 'sent_to_customer' &&
status === 'pending'`.

**Convention:** UI groups, badges, and board columns switch on
`lifecycleStatus`. Behavior gates (e.g. "show Convert button when
approved") are still allowed to check `status` directly, but anything
the user *reads* should come from the lifecycle bucket so the two
axes can never appear to disagree.

---

## 2. Lifecycle diagram

```
                ┌──────────────────────────────────────────────────────────┐
                │ wizard ──POST /api/estimates─►                           │
                │                                                          │
                ▼                                                          │
       ┌───────────────┐  submit-for-review   ┌────────────────────────┐   │
       │     draft     │ ───────────────────► │     pending_review     │   │
       │ (internal:    │                      │ (internal:             │   │
       │  draft,       │ ◄─── PUT (edit) ──── │  pending_approval,     │   │
       │  status:      │      (no transition) │  status: pending)      │   │
       │  pending)     │                      └────────────┬───────────┘   │
       └───────┬───────┘                                   │               │
               │                                           │ PATCH         │
               │ "Save & submit" in wizard                 │ /internal-    │
               │ (POST /:id/submit-for-review              │  approve      │
               │   — atomic update + transition)           ▼               │
               │                                ┌────────────────────────┐ │
               │                                │ approved_internal      │ │
               │                                │ ("Ready to send")      │ │
               │                                │  internal:             │ │
               │                                │   approved_internal,   │ │
               │                                │  status: pending       │ │
               │                                └────────────┬───────────┘ │
               │                                             │             │
               │                                             │ POST        │
               │                                             │ /send-      │
               │                                             │  approval-  │
               │                                             │  email      │
               │                                             ▼             │
               │                                ┌────────────────────────┐ │
               │                                │         sent           │ │
               │                                │  internal:             │ │
               │                                │   sent_to_customer,    │ │
               │                                │  status: pending,      │ │
               │                                │  approvalToken minted  │ │
               │                                └─────┬─────────┬────────┘ │
               │                                      │         │          │
               │       customer clicks approve link   │         │  expiry  │
               │   GET /api/estimates/                │         │  > 30d   │
               │     approve-via-token/:token         │         │  (date-  │
               │                                      ▼         │   based, │
               │                              ┌──────────────┐  │   not a  │
               │                              │   approved   │  │   db col)│
               │                              │  status:     │  ▼          │
               │                              │   approved   │ ┌──────────┐│
               │                              └──────┬───────┘ │ expired  ││
               │                                     │         │ (lifecyc-││
               │                                     │         │  le only;││
               │                                     │         │  status  ││
               │                                     │         │  stays   ││
               │                                     │         │  pending)││
               │                              POST /:id/       └────┬─────┘│
               │                            convert-to-work-        │      │
               │                              order                 │      │
               │                                     ▼              │      │
               │                              ┌──────────────┐      │      │
               │                              │ converted_to │      │      │
               │                              │ work_order   │      │      │
               │                              │  status:     │      │      │
               │                              │  converted_  │      │      │
               │                              │  to_work_    │      │      │
               │                              │  order       │      │      │
               │                              └──────────────┘      │      │
               │                                                    │      │
               └────────── POST /:id/transition?action=resend ──────┘      │
                                  (resets estimateDate, mints new token)   │
                                                                           │
       reject is symmetric: PATCH /:id/reject (manager) or                 │
       GET /api/estimates/reject-via-token/:token (customer) →             │
       status='rejected'.                                                  │
                                                                           ┘
```

---

## 3. Endpoint table

All routes live in `routes.ts` unless noted. Line numbers are May 2026.

| Method   | Path                                                | File / Line                       | Auth                                | Notes                                                                          |
| -------- | --------------------------------------------------- | --------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------ |
| `GET`    | `/api/estimates`                                    | `routes.ts:7426`                  | **none**                            | List. ⚠ unauthenticated, leaks `approvalToken` — see audit F-01.               |
| `GET`    | `/api/estimates/pending-approval`                   | `routes.ts:7440`                  | auth + approval-access              | Powers the billing-manager queue.                                              |
| `GET`    | `/api/estimates/:id`                                | `routes.ts:7464`                  | **none**                            | Detail. ⚠ unauthenticated — see audit F-01.                                    |
| `POST`   | `/api/estimates`                                    | `estimate-routes.ts:101`          | auth                                | Create. Wizard's only insert path.                                             |
| `PUT`    | `/api/estimates/:id`                                | `estimate-routes.ts:306`          | auth                                | Content update only. ⚠ no company/role scope — audit F-02.                     |
| `POST`   | `/api/estimates/:id/submit-for-review`              | `estimate-routes.ts:319`          | auth                                | **Atomic** update + transition draft → pending_approval. Wizard "Save & submit" path. |
| `DELETE` | `/api/estimates/:id`                                | `routes.ts:7486`                  | auth                                | ⚠ no role/company scope — audit F-03.                                          |
| `PATCH`  | `/api/estimates/:id/internal-approve`               | `routes.ts:8971`                  | auth + approval-access              | pending_approval → approved_internal.                                          |
| `POST`   | `/api/estimates/:id/send-approval-email`            | `routes.ts:9259`                  | auth + approval-access              | Sends customer link, transitions to sent_to_customer, mints `approvalToken`.   |
| `POST`   | `/api/estimates/:id/transition`                     | `routes.ts:9311`                  | auth + action-specific role        | Legacy multi-action handler (`action=submit_for_review` · `send_to_customer` · `resend`). Role gate is per-action: `submit_for_review`/`resend` require irrigation_manager+, `send_to_customer` requires billing_manager+. |
| `PATCH`  | `/api/estimates/:id/approve`                        | `routes.ts:9008`                  | auth + approval-access              | Manager approve. Guards `status === pending`, creates work order.              |
| `PATCH`  | `/api/estimates/:id/reject`                         | `routes.ts:9067`                  | auth + approval-access              | Manager reject. Guards `status === pending`.                                   |
| `POST`   | `/api/estimates/:id/approve`                        | `routes.ts:8890`                  | auth + approval-access              | ⚠ Legacy duplicate of PATCH /approve. Diverges (no work-order creation, no status guard) — audit F-04. |
| `POST`   | `/api/estimates/:id/reject`                         | `routes.ts:8929`                  | auth + approval-access              | ⚠ Legacy duplicate of PATCH /reject — audit F-04.                              |
| `GET`    | `/api/estimates/approve-via-token/:token`           | `routes.ts:9405`                  | **token only**                      | Customer approval click. ⚠ token never revoked, O(N) scan — audit F-06.        |
| `GET`    | `/api/estimates/reject-via-token/:token`            | `routes.ts:9527`                  | **token only**                      | Customer reject click. ⚠ no expiry check — audit F-06.                         |
| `POST`   | `/api/estimates/:id/convert-to-work-order`          | `routes.ts:9619`                  | auth                                | Creates a work order. ⚠ no role gate, races on duplicate — audit F-05.         |
| `POST`   | `/api/estimates/:id/pdf`                            | `routes.ts:11897`                 | auth + pdf-access                   | Generate / refresh PDF.                                                        |
| `GET`    | `/api/estimates/:id/pdf`                            | `routes.ts:11898`                 | auth + pdf-access                   | Fetch latest PDF.                                                              |
| `POST`   | `/api/estimates/:id/email`                          | `routes.ts:7506`                  | auth + approval-access              | Send approval email with optional `to` / `cc` / `bcc` / `note` overrides. Funnels through `_sendEstimateApprovalEmailFlow`, so it shares token-generation + status-transition logic with `/send-approval-email` and `/transition?action=send_to_customer`. Called by `lib/email.ts:sendEstimateEmail`. (Task #616 turned the stub flagged in audit F-15 into the real path.) |

The `requireEstimateApprovalAccess` middleware allows
`billing_manager | company_admin | super_admin`.

> **Role naming note.** `replit.md` uses the shorthand "manager" in
> its product blurb, but the actual database/role enum value used by
> every estimate route is `irrigation_manager`. There is no separate
> `manager` role in this codebase — treat the two as synonyms when
> reading product copy, and use `irrigation_manager` in code.

---

## 4. Role × action matrix

What the **server** enforces. Frontend buttons are gated separately
(see Gotchas below).

| Action                                | super_admin | company_admin | billing_manager | irrigation_manager | field_tech |
| ------------------------------------- | :---------: | :-----------: | :-------------: | :----------------: | :--------: |
| Create estimate (`POST /api/estimates`) | ✓           | ✓             | ✓               | ✓                  | ✓          |
| Read list / detail                    | ✓ *(public)*| ✓ *(public)*  | ✓ *(public)*    | ✓ *(public)*       | ✓ *(public)* |
| Edit content (`PUT /:id`)             | ✓           | ✓             | ✓               | ✓                  | ✓ ⚠        |
| Submit for review                     | ✓           | ✓             | ✓               | ✓                  | ✓          |
| Internal approve                      | ✓           | ✓             | ✓               | —                  | —          |
| Send approval email                   | ✓           | ✓             | ✓               | —                  | —          |
| Manager approve / reject              | ✓           | ✓             | ✓               | —                  | —          |
| Customer approve / reject (token)     | *anyone with token*                                                          |
| Convert to work order                 | ✓           | ✓             | ✓               | ✓                  | ✓ ⚠        |
| Delete                                | ✓           | ✓             | ✓               | ✓                  | ✓ ⚠        |

✓ ⚠ entries mark the gaps the audit flagged — the server allows it,
but the frontend hides the button. Closing those gaps is the work of
the audit-log + role-gating tasks; don't widen any of them here.

---

## 5. Looks-similar-but-isn't

A short list of pairs that read alike in code and behave very
differently. Always check which one you're calling.

- **`status` vs `internalStatus` vs `lifecycleStatus`** — see §1.
  `status === 'pending'` does *not* mean "waiting for a manager"; it
  means "the customer has not yet responded". Use `lifecycleStatus`
  when you mean "where in the pipeline".
- **`POST /api/estimates/:id/approve` vs `PATCH /api/estimates/:id/approve`** —
  the POST flavor (`routes.ts:8890`) skips the `status === 'pending'`
  precondition and skips work-order creation. **Always prefer the
  PATCH variant.** The frontend already does
  (`estimates-pending-approval.tsx`, `estimate-detail-modal.tsx`).
  Same story for `/reject`.
- **`POST /:id/submit-for-review` vs `POST /:id/transition` with `action=submit_for_review`** —
  the first is the atomic content-update + transition the wizard uses
  on "Save & submit". The second is the legacy two-call path the
  wizard used before Task #606; it's still there for compatibility
  with older clients. New code should not call `/transition`.
- **`POST /:id/send-approval-email` vs `POST /:id/transition?action=send_to_customer`** —
  both transition to `sent_to_customer` and mint a token. Only the
  `transition?action=resend` path resets `estimateDate`; the other
  two paths do not, which is why a "send again" 28 days after the
  first send gives the customer a 2-day window — see audit F-16.
- **`estimateDate` vs `createdAt` vs `tokenExpiresAt`** — `createdAt`
  is the row birthday and never moves. `estimateDate` is "when this
  was last sent to the customer" and is what the 30-day expiry is
  measured from. `tokenExpiresAt` is on the row but **only checked on
  the approve-via-token path**, not the reject-via-token path (audit
  F-06).
- **Wizard's three local state stores** — see
  [`docs/estimate-wizard.md`](./estimate-wizard.md). `useState` is
  the live working copy, `initialSnapshotRef` is the dirty-check
  baseline, `localStorage` is the autosave. They drift if the
  hydration order is wrong; don't add a fourth.
- **`approvalToken` on the row vs the URL the customer got** — the
  token is **not** invalidated on approve/reject, and a resend mints
  a new one without revoking the old. Two valid URLs can coexist
  (audit F-06). Treat any change to the send/resend path as
  security-sensitive.
- **`status === 'expired'` (DB) vs `lifecycleStatus === 'expired'` (computed)** —
  the customer-token expiry handler writes `status='expired'`, but
  the lifecycle computer derives expiry from `estimateDate` age. They
  can disagree if a manager bumps `estimateDate` later (audit F-17).
  Prefer the computed value.

---

## 6. Pointers

- Wizard internals: [`docs/estimate-wizard.md`](./estimate-wizard.md)
- Full audit findings: [`docs/audits/estimate-handoffs-2026-05.md`](audits/estimate-handoffs-2026-05.md)
- Lifecycle code: `artifacts/irrigopro/src/lib/lifecycle.ts`
- Server estimate routes: `artifacts/api-server/src/routes/estimate-routes.ts`
  (the modern atomic paths) + `artifacts/api-server/src/routes/routes.ts`
  (everything else)
