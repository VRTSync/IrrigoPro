---
name: Invoice selection query scope
description: Selection resets follow filter-query identity, not retained result rows or placeholder state.
---

Invoice selection resets must key on the filter query (`arParams`), not row data or `isPlaceholderData`. Loading more rows or refreshing the same filter must not clear the selection.

**Why:** Retained placeholder rows can remain unchanged while the filters change. Waiting for the data or placeholder state to change lets selections from a previous filter survive late or indefinitely.

**How to apply:** Clear prior-filter selections when the effective filter query changes, preserve same-filter pagination behavior, and keep the existing filter-change regression assertion intact.
