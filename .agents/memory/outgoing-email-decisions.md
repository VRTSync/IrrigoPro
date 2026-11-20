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
