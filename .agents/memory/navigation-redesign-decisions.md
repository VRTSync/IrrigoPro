---
name: Navigation Redesign scope
description: Precedence of the locked design over the earlier options audit and the boundaries of the first release.
---

Use the locked Navigation Redesign overview and the assigned slice as the build authority, not the earlier Navigation Audit and Redesign Options memo. In particular, the rail and in-page panel start at 1024 px, and super admin gets a plain rail and keeps App Health as its landing page.

**Why:** The options memo describes the pre-audit code and contains superseded choices about the breakpoint, super admin, and which role destinations to show.

**How to apply:** Share the role-filtered navigation across desktop, phone, breadcrumbs, and Jump To. Preserve the existing role routes and the merged audit fixes. Use the locked role table for routes and visibility, and the B2 mockup for the approved wording and visual treatment.

Jump To is pages-only in this release. Record search, a "Needs you" summary, and creating records from Jump To are deferred. The role dashboards replace the old company dashboard content rather than relocating it; pins stay device-local per user.

**Why:** This release reorganizes navigation without taking on record-search permissions, new deep links, or a new pin data model.

**How to apply:** Do not pull the broader record-search proposal into Jump To or bring the retired dashboard widgets into another section. Super admin, field tech, and system documenter do not get the new role dashboard.
