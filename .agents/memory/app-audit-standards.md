---
name: App audit standards
description: Locked app-wide layout, navigation, and page-open rules from the Audit Fix design.
---

Pages must fit without horizontal window or inner scrolling at browser widths of 360, 390, 820, 1024, 1366, and 1920 px. Office pages use the available width; phone-first field flows and long-form legal pages keep readable caps. Wide tables use one shared stacked mode below 820 px of **container** width, not viewport width.

**Why:** The expanded sidebar makes the content area significantly narrower than the window, and even a wide window can contain a narrow table.

**How to apply:** Measure both window and inner scrolling in a real browser; don't hide overflow or drop columns to pass. Use the same role navigation tree on desktop and in the phone menu, and keep legacy redirects for bookmarks rather than linking to them.

Opening a page must not write data. The throttled invoice payment-status refresh is the explicit exception. Estimate pages stay separate; Customers becomes one page with distinct Billable and All views.

**Why:** Viewing a record is not consent to change it, and the separate billing view is part of the office workflow.

**How to apply:** Keep inspection estimate creation behind its explicit manager action. Follow the assigned slice and its embedded Design Context, preserving newer Bookkeeper layout and role-visibility fixes. Command Center and site maps remain out of scope.

**Rule:** Web account switching signs out for every role. Only the super-admin App Health flow is real impersonation.

**Why:** Rewriting the browser's stored role changes the visible shell but not the identity the server uses, so the screens and data can disagree.

**How to apply:** Keep the “Switch User” label and use the normal logout flow, never a local identity picker. Exercise the actual role routers in tests: a shared menu can link to a page that a role-specific router does not mount.
