---
name: Focus refetch and query freshness
description: Why a React Query focus-refetch opt-in may not make a network request.
---

When a feature promises to refresh on window focus, set a finite freshness window (zero if every focus should refresh), or explicitly opt into an unconditional focus refetch.

**Why:** The app's default query freshness is infinite. A plain focus-refetch opt-in only reloads stale data, so a successful query that uses the default never refreshes on focus even if interval polling works.

**How to apply:** Exercise the actual focus transition in tests with the application's freshness default. Interval polling and window focus are independent freshness paths.
