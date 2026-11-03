# AMENDMENT to #2010 — Close the Approve and Send Paths

**Source:** Review of #2010 against the merged code, 2026-09-11.
**Status:** One addition. Nothing in #2010 changes — every decision, file citation and step in it stands, and this does not touch any of them. It closes the one door #2010 leaves open.

---

## The gap

#2010 gates the three **write** routes: `POST /api/estimates`, `PUT /api/estimates/:id` and `POST /api/estimates/:id/submit-for-review`. Its forcing function for legacy rows is "a branch-less estimate 400s on its next save."

An estimate does not have to be saved to leave. Seven other authenticated routes send it to the customer or push it forward into a work order, and none of them check the branch:

- `POST /api/estimates/:id/email` — `estimate-routes.ts:927`
- `POST /api/estimates/:id/approve` (legacy) — `:1025`
- `PATCH /api/estimates/:id/internal-approve` — `:1323`
- `PATCH /api/estimates/:id/approve` — `:1378`
- `POST /api/estimates/:id/send-approval-email` — `:1735`
- `POST /api/estimates/:id/resend` — `:1807`
- `POST /api/estimates/:id/convert-to-work-order` — `:2831`

So a legacy branch-less estimate for a multi-branch customer sits in the queue, a manager approves it without ever opening the wizard, and `storage.ts:4142` carries `branchName ?? null` into a work order with no branch. The tech is then asked to pick one at completion time — `work-order-completion.tsx:308`. That is the exact failure #2010 was written to close, still open for every pre-#2010 row.

**The customer path auto-converts.** `POST /api/estimates/approve-via-token/:token` (`:2207`) calls `storage.createWorkOrderFromEstimate` inside a try/catch and then auto-assigns the new work order to the company's irrigation manager (`:2377` and following). A branch-less estimate already sitting in a customer's inbox therefore produces a branch-less, auto-assigned work order with no human in the loop at all.

**Scope of the exposure.** Only estimates created before #2010 ships. Once #2010 is merged the wizard cannot produce a branch-less estimate for a multi-branch customer, so this is a finite, shrinking population — which is why Addition 2 below is a tripwire and not a hard block.

---

## Addition 1 — One guard on every authenticated door

**Decided 2026-09-11.**

### The change

Export a middleware factory from `artifacts/api-server/src/routes/estimate-role-guards.ts`:

```
export function requireEstimateBranchSelected(storage): RequestHandler
```

It loads the estimate by `req.params.id`, loads that estimate's customer, and calls **`resolveBranchGateError` from `estimate-payload.ts`** — the helper #2010 creates. On a non-null return it responds `400` with that message and does not call `next()`. On a missing estimate it calls `next()` and lets the handler's own 404 stand, so this guard never changes which requests 404.

It must **reuse** `resolveBranchGateError`, not re-implement the check. #2010's Definition of Done greps for exactly one branch-gate helper on the estimate paths; that grep has to keep passing after this amendment.

Register it immediately after `requireEstimateApprovalAccess` on the six routes that carry that guard — `:927`, `:1025`, `:1323`, `:1378`, `:1735`, `:2831` — and immediately after `requireAuthentication` on `:1807` (`resend`, whose single-line registration has no approval guard today; do not add one, that is a separate question).

### The error message differs from the write-path message

On the write paths the user is already in the wizard with the branch card in front of them, so #2010's wording is right there. Here they are on a list or a detail modal and the fix is elsewhere, so the message must name it:

> `Branch is required for this customer. Open the estimate and choose a branch before sending or approving it.`

Put this second string next to the first in `estimate-payload.ts` and have `resolveBranchGateError` take which one to return, so both still come from one module and one grep still finds one implementation.

### No branch picker on the approve action

**Decided.** The obvious alternative is a small branch select inside the approve confirmation. Rejected: the estimate wizard is the estimate's only editor, and adding a second place that writes `branch_name` is exactly the duplicate-editor problem the project already refuses elsewhere. The manager's path is open the estimate, pick the branch the wizard now demands, save, approve — three clicks, no new surface, and the value is written through the one path that already audits it.

### `mark-sent` is deliberately not gated

**Decided.** `POST /api/estimates/:id/mark-sent` (`:1903`) records that a manual send already happened. Blocking it would not stop the send — it would only make the record wrong. Gate the doors that cause an estimate to leave, never the ones that record that it left.

---

## Addition 2 — The customer token path becomes an audited tripwire

**Decided 2026-09-11.**

### The change

`POST /api/estimates/approve-via-token/:token` (`:2207`) must **not** be gated. Refusing a customer's approval over an internal data field is not acceptable, and the customer cannot supply a branch. The approval succeeds exactly as it does today.

What changes is the auto-convert block at `:2377`. After the work order is created and assigned, when the source estimate's `branchName` is null **and** the customer has branches configured:

- Create a notification for the same irrigation manager the work order was assigned to, with a new type `work_order_missing_branch`, message naming the work order number, the customer and the estimate number, and saying the branch must be set before the work order is scheduled.
- Write an audit event against the work order via `recordAuditEvent` (`routes/audit-log.ts:42`) recording that it was created from a branch-less estimate on the customer approval path.

Both go inside the existing try/catch so a notification failure can never fail the customer's approval.

This is a tripwire in the Rule 4 sense: it catches legacy and edge-case data, every firing is audited, and each one is drift to fix rather than a normal path. Once Addition 1 ships nothing new can enter this state — it only catches estimates already in customers' inboxes.

---

## Done looks like

- All seven authenticated routes listed above return `400` with the open-the-estimate message when the estimate has no branch and its customer has branches, and behave exactly as before once a branch is set.
- A single-location customer is unaffected on all seven.
- `mark-sent` is unchanged and still succeeds on a branch-less estimate.
- A manager cannot approve, convert, send, resend or email a branch-less estimate for a multi-branch customer from any surface in the app.
- A customer approving an already-sent branch-less estimate still succeeds, still gets their work order, and still triggers the auto-assignment — and the assigned irrigation manager receives a `work_order_missing_branch` notification, with a matching audit event on the work order.
- A missing estimate id still returns the handler's 404, not a 400 from the new guard.
- **Still exactly one branch-gate helper**, now with two message variants, called by the three write paths from #2010 and by the new middleware. The #2010 grep still passes.

## Out of scope

- Every step in #2010 — this adds to that ticket, it does not revise it.
- Any new branch-picker UI on the approve, send or convert actions.
- Adding an approval-role guard to `resend`.
- Gating `mark-sent`.
- Back-filling `branch_name` on existing estimates, still refused for the reason given in #2010.
- Any change to the schema, the PDF template or the billing-sheet wizard.

## Tests

Extend `artifacts/api-server/src/routes/estimate-branch-gate.test.ts` — the file #2010 creates — rather than adding a new one; the repo is past its workflow cap and a second new test file means a second registration. Import the same helper and the same middleware the routes use so drift is a compile error.

- Each of the seven routes: branch-less multi-branch estimate → 400 with the open-the-estimate message; with a branch → the handler's normal success.
- Single-location customer → normal success on all seven.
- `mark-sent` on a branch-less estimate → still succeeds.
- Unknown estimate id on a gated route → 404 from the handler, not 400 from the guard.
- `approve-via-token` with a branch-less estimate → 200, work order created, notification of type `work_order_missing_branch` written for the assigned manager, audit event written against the work order.
- `approve-via-token` with a branch → 200, no notification of that type.
- Tenancy: a company-A user hitting a company-B estimate on any gated route gets 404, never a 400 that would confirm the row exists.

## Implementation notes

- The guard is async and needs storage, unlike the synchronous role guards already in `estimate-role-guards.ts`. Export it as a factory taking storage rather than importing storage into that file, so the module stays dependency-free.
- Order matters: the new guard goes **after** `requireEstimateApprovalAccess`, so a user without approval rights still gets 403 rather than a 400 that leaks whether the estimate has a branch.
- Register the extended test file as a validation command, not a workflow — the repo is past the workflow cap.
- `work_order_missing_branch` is a new notification type; add it wherever the existing types are enumerated and make sure the manager's notification surface renders it rather than falling through to a default.

## Proof to attach

- `file:line` for each of the seven guard registrations and for the token-path tripwire.
- Grep output proving one branch-gate helper, its two message variants, and all call sites — the three #2010 write paths plus the new middleware.
- Screenshot of a manager attempting to approve a legacy branch-less estimate and getting the open-the-estimate message, then the same estimate approving cleanly after a branch is set in the wizard.
- Screenshot of the `work_order_missing_branch` notification in the irrigation manager's notification list, and the matching audit entry on that work order.
- Passing output for the extended test file, including the tenancy assertion.
- A commit message matching the diff, and a diff containing no migration.

## Relevant files

- `artifacts/api-server/src/routes/estimate-role-guards.ts:103-118` — where the new factory goes, beside `requireEstimateApprovalAccess`
- `artifacts/api-server/src/estimate-payload.ts` — `resolveBranchGateError` from #2010; add the second message variant here
- `artifacts/api-server/src/routes/estimate-routes.ts:927, 1025, 1323, 1378, 1735, 1807, 2831` — the seven registrations
- `artifacts/api-server/src/routes/estimate-routes.ts:1903` — `mark-sent`, deliberately untouched
- `artifacts/api-server/src/routes/estimate-routes.ts:2207` and the auto-convert block at `:2377` — the tripwire
- `artifacts/api-server/src/routes/audit-log.ts:42` — `recordAuditEvent`
- `artifacts/api-server/src/storage.ts:4140-4142` — where the null branch reaches the work order
- `artifacts/irrigopro/src/components/work-orders/work-order-completion.tsx:308` — the completion-time rescue this stops relying on
- `artifacts/api-server/src/routes/estimate-branch-gate.test.ts` — created by #2010, extended here
