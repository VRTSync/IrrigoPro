---
name: Crash report access
description: Platform crash report viewing and crash submission intentionally have different role boundaries.
---

Crash reports are platform-level and super admin only. Company admins do not have a company-scoped crash report view.

**Why:** The report intentionally aggregates across companies and can include URLs with record IDs and stack traces.

**How to apply:** Keep the report API, page, and navigation restricted together. Do not apply the viewing restriction to submitting crash reports.
