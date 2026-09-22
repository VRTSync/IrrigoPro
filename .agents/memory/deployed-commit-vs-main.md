---
name: What production is actually running
description: How to tell whether a merged change is live, before claiming a production-run or verification step is possible.
---

## Rule
`main` at HEAD is not what production is running. Before any task that says "verify X on the
deployed server" or "run this against production", establish the deployed commit first — and if
the change landed after the last publish, stop and say so rather than reporting the deployed
behaviour from the source tree.

**Why:** Publishing is a manual, user-initiated action here, and it lags merges by days. A
production-run task that assumes the feature is live will either produce a confident wrong
answer or send the operator to a page where the thing they were told to click does not exist.

**How to apply:** Three signals, cheapest first.
- The repo's own publish marker: the most recent `Published your App` commit in `git log` is the
  state that was pushed live. Commits after it are not deployed.
- `getDeploymentInfo()` for `isDeployed` / `hasSuccessfulBuild` / the real production URL — it
  says the deployment is healthy, never which commit it carries.
- A data-side tell: a marker row the new code writes (e.g. an `app_settings` key) absent in the
  production replica, or the *old* key still being the only one present.

Admin endpoints on the deployed server are session-gated, so an unauthenticated probe returns
401 and proves nothing about which code is running. Do not treat it as evidence either way.

## Corollary — read-only prep is still worth doing
`executeSql({ environment: "production" })` reads a replica and needs no session. When the run
itself is blocked on a human, the pre-run inventory (resolved ids, before-statuses, the full
population a preview would enumerate) can still be gathered and written down, so the operator's
part shrinks to clicking and confirming.
