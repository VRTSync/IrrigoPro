# Estimate wizard — internals

The wizard
(`artifacts/irrigopro/src/components/estimates/estimate-wizard.tsx`)
is a 3-step modal used for both **new** and **edit** flows. It is the
only insert/update path for estimates from the office side. This doc
captures the parts of the wizard that are non-obvious from the code
alone — the state model, the submission branches, and the autosave
contract. For the surrounding lifecycle / endpoint context, see
[`docs/estimate-system.md`](./estimate-system.md).

---

## 1. Steps

| Step | Title                  | Component                                                                 |
| ---- | ---------------------- | ------------------------------------------------------------------------- |
| 1    | Customer & Project     | `wizard/estimate-wizard-customer-step.tsx`                                |
| 2    | Line Items             | `wizard/estimate-wizard-line-items-step.tsx`                              |
| 3    | Review & Send          | `wizard/estimate-wizard-review-step.tsx`                                  |

Both new and edit flows land on Step 1 (Task #603). Step 1 owns the
scope-of-work field, so jumping to Step 2 on edit used to hide it
with no obvious way back.

---

## 2. Three state stores — and why all three exist

The wizard keeps three parallel representations of the in-progress
estimate. They serve different jobs and must not be conflated.

### 2.1 Live working copy — `useState`

Driven by `setCustomerStep`, `setItems`, `setLaborRate`, `setLaborMode`,
`setFlatTotalHours`, `setPhotos`, `setAttachments`. This is what the
user is editing right now. Every keystroke updates these.

### 2.2 Dirty-check baseline — `initialSnapshotRef.current`

A `DraftSnapshot` object captured at one of two moments:

- **New estimate**: at open, an empty snapshot.
- **Edit**: after the existing estimate (and its real customer
  record) has hydrated.

The `isDirty` `useMemo` compares the current live state to this
baseline via `JSON.stringify`. The Discard / "Are you sure?" prompt
only fires when `isDirty === true`. This baseline never moves until
the wizard re-opens; it is intentionally **not** updated by autosave
or by the restore-draft prompt.

### 2.3 Persistent autosave — `localStorage`

See §4. The autosave is keyed per estimate id (or `"new"`) and
survives full page reloads. It is also the source for the "Restore
your saved draft?" prompt on open.

**Important separation:** the dirty-check baseline is **not** read
from `localStorage`. A user who reloads mid-edit and declines the
restore prompt should see a clean wizard — the prior autosave is the
*offer*, not the baseline.

---

## 3. Submission — the 2×2 matrix

The wizard's save button has two modes:

- **`mode = 'draft'`** — save as draft, keep the wizard closeable
  without firing the review pipeline.
- **`mode = 'submit'`** — save and transition into the review queue.

And there are two row contexts:

- **New** (`isEdit === false`, no `estimateId`)
- **Edit** (`isEdit === true`, an `estimateId` is present)

The four cells route through `submitEstimate` in
`estimate-wizard-submit.ts`:

| Context          | mode = `draft`                                            | mode = `submit`                                                                 |
| ---------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------- |
| **New**          | `POST /api/estimates` *(server stamps `internalStatus = draft`)* | `POST /api/estimates` *(server stamps `internalStatus = pending_approval`)*     |
| **Edit (draft)** | `PUT /api/estimates/:id` *(content only, no transition)*  | `POST /api/estimates/:id/submit-for-review` ← **atomic update + transition**    |
| **Edit (non-draft)** | `PUT /api/estimates/:id` *(content only)*             | `PUT /api/estimates/:id` *(same content path; submit semantics don't apply once it's left draft)* |

The atomic `submit-for-review` endpoint (Task #606) exists
specifically to remove the lost-update window between
`PUT /api/estimates/:id` and `POST /api/estimates/:id/transition` —
the old two-call path could leave a draft with new content but the
old `internalStatus` if the second call failed.

`submitEstimate` throws on any leg failure. The wizard's mutation
`onError` shows a retry toast and keeps the wizard open so the user
can try again without losing in-progress work.

### Customer approval token — **untouched by the wizard**

The wizard never touches `approvalToken` or `tokenExpiresAt`. Those
are server-minted by `_sendEstimateApprovalEmailFlow`
(`routes.ts:9019-9061`) when a billing manager hits "Send" from the
pending-approval queue. **Any wizard work must leave the
`approve-via-token` and `reject-via-token` endpoints alone** — they
are the customer's only authentication.

---

## 4. Autosave contract

### Storage key

```
irrigopro:estimate-wizard-draft:v1:<estimateId | "new">
```

Defined as `DRAFT_KEY_PREFIX` and `draftKey()` in
`estimate-wizard.tsx`. The `:v1:` segment is the schema version; if
the persisted shape ever changes, bump it (and bump
`DRAFT_STORAGE_VERSION`) so old drafts are silently ignored instead
of crashing the load.

### Payload shape — `PersistedDraft`

```ts
{
  version: 1,          // === DRAFT_STORAGE_VERSION
  savedAt: number,     // Date.now() at write
  step: 1 | 2 | 3,
  customerStep: CustomerStepValue,
  items: WizardLineItem[],
  laborRate: number,
  photos: UploadedFile[],
  attachments: UploadedFile[],
}
```

Anything outside this shape (e.g. `laborMode`, `flatTotalHours`) is
*not* persisted by autosave today. If you add a new wizard-owned
field that the user can change, decide explicitly whether to add it
to `PersistedDraft` and bump the version, or leave it out.

### Read path — restore prompt

On open (after the existing estimate has hydrated, in edit mode):

1. `loadDraft(estimateId)` reads and JSON-parses the entry. A
   missing entry, a version mismatch, or a parse error all return
   `null`, and autosave can begin immediately.
2. If a draft is found, the wizard compares its snapshot to the
   current `initialSnapshotRef.current` baseline. If they're equal
   (no meaningful change), the draft is silently discarded
   (`clearDraft`).
3. Otherwise the wizard shows a Restore dialog (`restoreOpen`) with
   the draft tucked in `pendingDraft`. Confirming applies the draft
   into the live `useState` stores; declining clears it.

`hydratedRef`, `restorePromptedRef`, and `draftReadyRef` together
guarantee the restore prompt fires exactly once per open, and only
after the underlying estimate has loaded so the dirty comparison is
meaningful.

### Write path — debounced autosave

`useEffect` watches the live state and writes through `saveDraft()`
on a debounce. `saveDraft` swallows quota / serialization errors —
autosave is best-effort, never required for save to succeed.

### Clear path

`clearDraft(estimateId)` is called on:

- successful submit (any of the four cells above),
- a successful "Discard" confirmation,
- a Restore-prompt rejection,
- and when a found draft matches the current baseline (i.e. nothing
  to restore).

---

## 5. Labor rate derivation

`deriveCustomerLaborRate` in `estimate-wizard.tsx` is the single
source of truth for "what rate should this customer get". It is used
both by the effect that calls `setLaborRate` after a customer change
and by the helper text rendered to the user, so the displayed
provenance ("default" / "from customer" / "stored on this estimate")
can never drift from the value actually applied. If you need to
re-derive the rate anywhere new, call this helper — don't inline a
second `parseFloat(customer.laborRate)`.

---

## 6. Pointers

- Lifecycle / endpoint context: [`docs/estimate-system.md`](./estimate-system.md)
- Submit helper: `artifacts/irrigopro/src/components/estimates/estimate-wizard-submit.ts`
- Wizard tests:
  - `estimate-wizard-submit.test.ts` — covers the 2×2 matrix.
  - `estimate-submit-retry.e2e.test.tsx` — covers retry behavior + the
    "manager pending-review bucket" parity.
