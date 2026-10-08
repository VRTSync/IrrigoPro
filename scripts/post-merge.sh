#!/bin/bash
set -euo pipefail
pnpm install --frozen-lockfile
# Never approve destructive changes in unattended setup. Drizzle can exit 0
# at a confirmation prompt without applying anything, so require its explicit
# completion message as well as a successful exit. Keep stdin closed and echo
# all output (including any prompt) into the setup logs for human review.
push_log=$(mktemp)
trap 'rm -f "$push_log"' EXIT
pnpm --filter @workspace/db push </dev/null 2>&1 | tee "$push_log"
if ! grep -Eq '(Changes applied|No changes detected)[[:space:]]*$' "$push_log"; then
  echo "Schema push did not confirm completion. Setup stopped; review the output above. No prompt was answered." >&2
  exit 1
fi
# Regression check: fail the merge loudly if the push left the dev database
# missing any table/column defined in the Drizzle schema (guards against the
# silent-abort failure mode above ever recurring).
pnpm --filter @workspace/db verify
# The third drift direction: code referencing what the schema does NOT define.
# The push completion check covers a schema diff silently not applying and `db verify`
# covers the database missing what the schema defines; neither sees a query
# selecting a column that was never in the schema (the #1885 phantom-column
# outage). The compiler does. Runs last on purpose: `typecheck:libs` builds
# lib/db, and the artifact projects read its emitted declarations, so the
# schema has to be settled before this step.
# Coverage, timings and known gaps: docs/merge-gate-drift-checks.md
pnpm run typecheck
