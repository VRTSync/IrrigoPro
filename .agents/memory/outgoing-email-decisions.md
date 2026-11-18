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
