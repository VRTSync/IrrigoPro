---
name: Navigation Redesign scope
description: Precedence of the locked design over the earlier options audit and the boundaries of the first release.
---

Use the locked Navigation Redesign overview and the assigned slice as the build authority, not the earlier Navigation Audit and Redesign Options memo. In particular, the rail and in-page panel start at 1024 px, and super admin gets a plain rail and keeps App Health as its landing page.

**Why:** The options memo describes the pre-audit code and contains superseded choices about the breakpoint, super admin, and which role destinations to show.

**How to apply:** Share the role-filtered navigation across desktop, phone, breadcrumbs, and Jump To. Preserve the existing role routes and the merged audit fixes. Use the locked role table for routes and visibility, and the B2 mockup for the approved wording and visual treatment.

Keep the B2 page IDs stable across navigation slices. Dashboard tiles look up role-specific links by those IDs, and device-local pins can outlive a label or URL change.

**Why:** A rename can silently break a tile lookup or detach saved pins even when the page still mounts at its original route.

**How to apply:** Treat IDs as identity, labels and descriptions as copy, and hrefs as role-specific destinations.

Jump To is pages-only in this release. Record search, a "Needs you" summary, and creating records from Jump To are deferred. The role dashboards replace the old company dashboard content rather than relocating it; pins stay device-local per user.

**Why:** This release reorganizes navigation without taking on record-search permissions, new deep links, or a new pin data model.

**How to apply:** Do not pull the broader record-search proposal into Jump To or bring the retired dashboard widgets into another section. Super admin, field tech, and system documenter do not get the new role dashboard.

Gate portalled navigation overlays at the responsive breakpoint, not just their triggers.

**Why:** A desktop sidebar hidden with CSS can still open its portalled sheet from a keyboard shortcut, and a phone sheet can outlive its hidden tab bar after a resize.

**How to apply:** Unmount surfaces that can open an overlay at the wrong width, or close their overlays when crossing the desktop breakpoint. Keep a real-browser check for a resize with the sheet open.

The later [Access Hardening policy](access-hardening-policy.md) supersedes the Navigation Redesign overview only where it retains Switch User. Do not restore that entry after retirement, including in the account menus, section list, breadcrumbs, or Jump To.
