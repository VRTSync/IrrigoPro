---
name: Bounded validation policy
description: New suites join serial lanes rather than expanding completion-gate concurrency.
---

New suites must join the lane manifest, never receive a separate validation
registration. Explicit test-file lists must include the intended new coverage;
an existing package-wide test glob does not establish completion-gate coverage.
Keep intentional overlap and mixed-package commands intact.

**Why:** Per-suite registrations caused excessive concurrent process trees and
resource failures. Four serial lanes bound top-level suite concurrency, not
Node or Vitest worker threads. This policy is deliberate, not a temporary
workaround for the workflow limit.

**How to apply:** Add Node API suites to the field lane, Vitest suites to the
web lane, and typecheck/mobile suites to the types lane. Run the manifest guard
to detect missing named paths and inspect uncovered-test warnings. Reserve
service workflows for long-running processes; do not remove someone else's
checks to create space.
