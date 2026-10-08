---
name: Drizzle push silent abort on data-loss prompts
description: drizzle-kit push exits 0 without applying anything when the diff contains data-loss statements; dev DB drifts silently and publish then ships code without the new columns.
---

## Rule
Never trust a plain `drizzle-kit push` exit code. When the diff contains data-loss statements (table/column drops), it stops at an interactive confirmation prompt and exits **0 without applying anything** — `set -e` cannot catch it. Unattended setup must use normal push with closed stdin, require an explicit completion message, and then verify schema drift. Do not use `--force` or answer drop, rename, or truncation prompts without separate authorization.

**Why:** A retired-table drop in the diff made every automated dev push silently no-op; publish diffs dev↔prod, saw no schema gap, and production shipped code selecting columns that didn't exist (500s). The user subsequently authorized replacing automatic force-push with normal push that stops for human review of destructive prompts.

**How to apply:** If code references a column the DB says doesn't exist, suspect a swallowed data-loss prompt before suspecting the code. Run the drift check first.

## Ordering rule for retired tables
Before a schema push that drops a legacy table reaches any environment, confirm its data has been imported into the replacement table. For production this means: run the relevant idempotent Super Admin registry migration in the deployed app **before re-publishing**, because the publish-time schema diff drops the legacy table in prod.
