---
name: Outgoing Email decisions
description: User-approved email delivery contract and scope boundaries for the six-slice feature family.
---

Every customer-facing email must be reviewed before sending, using the same server-built content and a single-use confirmation tied to the reviewed values. Each company owns its sender identity; only super admins assign exclusive sending domains, and unauthenticated domains use the platform sender with company Reply-To. Internal staff notifications retain the platform sender.

**Why:** The user supplied locked decisions on 2026-11-18 to fix invoice delivery, preserve evidence of sent documents, prevent tenant impersonation, and ensure customer emails are seen before sending.

**How to apply:** Preserve each slice's full specification and embedded Design Context in its task description. Follow that assigned slice exactly; ask about ambiguities rather than inventing behavior. Treat moved lines as normal, but report materially changed source before implementing around it.

Invoice sent-copy records must represent the exact bytes emailed. Batch invoice delivery is one separate email per invoice; previously sent invoices are skipped, and uncertain sends after a restart are flagged rather than automatically retried.

**Why:** The office must be able to show what customers received, and automatic retries of uncertain delivery could send duplicates.

**How to apply:** Keep reply capture, QuickBooks invoice email, reminder wording, Command Center, and site maps outside this feature family. Acceptance evidence includes the specified grep results, live screenshots, and test results, not merely a passing-test summary. New tests use validation commands, never new workflows.

Merging invoices must preserve the prior emailed PDFs and delivery metadata. Retire pre-merge copies from reminder selection without deleting the evidence. The merged invoice needs a fresh send before reminders resume.

**Why:** The user approved retaining the audit trail rather than following the original deletion instruction; a merged invoice is still a different document.

**How to apply:** Keep historical copies available for auditing only. A reminder for the survivor must use a copy sent for the merged document.

A review of a live attachment binds the data the renderer consumes, not just the document header.

**Why:** An equal-price ticket swap or a source detail edit can change a PDF without changing the invoice total or timestamp.

**How to apply:** Compare the reviewed source version to the version actually rendered and to the current data before delivery. Review need not render a PDF.

An attachment shown in Review and Send is a delivery commitment.

**Why:** Sending after a PDF render failure would deliver a different email from the one the user approved.

**How to apply:** Fail before sending or recording delivery. Let the user retry, or explicitly remove the attachment and review the new draft.

Background delivery must carry the approved draft across the durable queue, not just verify it at enqueue time. Recovery must distinguish an abandoned worker from a worker still running in another replica.

**Why:** A recipient or sender can change while the batch is queued, and a rolling restart can overlap processes. Neither should cause new, unreviewed mail or retry an uncertain send. A process-local consumed-token map alone cannot protect a durable action across replicas.

**How to apply:** Store a review fingerprint and a durable confirmation digest, recheck the draft before each send, and let recovery mark only running work that no worker still owns.

For direct estimate delivery, an unconfirmed claim is not a timed lock. Keep it until non-delivery is verified; lost provider responses and failed post-acceptance database writes are not safe retry signals.

**Why:** A timeout or process restart says nothing about whether SendGrid accepted the email. Letting the claim expire can silently send a second approval link.

**How to apply:** Require a new review once a delivery has been recorded, even when a re-delivery kept the approval token and estimate date. Use provider delivery evidence, not elapsed time, when designing recovery.

A refused preview and a stale confirmed send are different outcomes. A fresh reminder preview must explain its refusal and offer the invoice action when available. A valid, unused review whose invoice has since become ineligible needs a conflict; a spent review stays spent even when its own send caused the change.

**Why:** A successful reminder starts the throttle. Rechecking eligibility before authenticating the review can disguise a replay as a fresh refusal and obscure what happened.

**How to apply:** Authenticate the submitted review before rebuilding the draft, then check and consume it again at the point of delivery because rebuilding it can await storage.

The Email Template family uses one shared, email-safe layout with company branding, not staff names. The layout and palette are locked; companies may customize wording, not HTML. Only estimates get action buttons. The versioned invoice guide is platform-owned and attached only to single and batch invoice emails, after the billing detail report, unless a company opts out. Internal messages are outside the family.

**Why:** The user locked these design decisions on 2026-11-20 so customer emails have a consistent company identity and the office can audit which guide was sent.

**How to apply:** Use the assigned slice and its embedded Design Context as the source of truth. Keep the invoice guide, wording overrides and other email migrations in their ordered slices. Send live tests only from development to an approved test inbox. Before any Publish, list the database changes and wait for approval.

An invoice guide replacement is a version change even if its filename and copy are unchanged.

**Why:** A content fingerprint can reject a stale review but cannot explain which component changed. A filename is editable metadata, not the identity of the reviewed file.

**How to apply:** When a stale-review message must name the changed component, carry its identity in the authenticated review claims. Bind each batch review to one guide snapshot and check the current version again before delivering; never substitute the latest guide for the one that was reviewed.
