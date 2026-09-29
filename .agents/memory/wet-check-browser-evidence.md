---
name: Wet-check browser evidence and stale mirrors
description: How to avoid mistaking a reload of an offline-backed wet-check page for a fresh DB read during browser verification.
---

When collecting browser evidence for different wet-check modes after changing test fixtures directly in the database, navigate to a fresh wet-check ID instead of mutating and reloading the same one.

**Why:** A browser verification that switched a service check to inspection in SQL and deleted its finding did not expose a fresh chip selector after reload; the app's offline-capable detail path can reuse cached state. A separate inspection check in the same browser session displayed the intended inspection form immediately. The reload was not reliable evidence about the component.

**How to apply:** Prefer fresh fixtures for distinct mode screenshots. For persistence tests, go through the actual UI/API save path and then inspect the stored row, rather than modifying the row behind a live browser tab.