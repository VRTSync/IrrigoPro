---
name: Baseline comparison environments
description: Match source isolation and runtime dependencies before attributing broad validation failures.
---

A clean baseline checkout can lack untracked test dependencies present in the active workspace. Collection failures from missing dependencies are not assertion failures and must not be used to classify a product regression.

**Why:** A frozen-lockfile installation omitted an undeclared IndexedDB test shim; the suite passed once its dependency environment matched the workspace. Separately, suites that failed during the broad completion run passed when replayed in isolation on both baseline and changed code.

**How to apply:** Pin the requested commit in an isolated worktree, ensure workspace package links resolve to that worktree, and match only missing runtime dependencies without changing source or assertions. Report collection/setup errors separately. Reproduce a baseline-pass/current-fail result under comparable execution conditions before assigning causality.

Keep the existing validation gate unchanged when presenting baseline evidence. Baseline failures are not permission to bypass checks, change assertions, or start repairs before the user has reviewed the requested drafts.

**Why:** The user explicitly required keeping the gate unchanged and reviewing cleanup scope before implementation.

**How to apply:** Report the exact named failures and distinguish reproduced baseline failures from isolated passes, collection errors, and missing evidence. Seek explicit authorization before any validation-configuration change or cleanup build.

When an unrelated suite times out again in the broad completion run, replay that suite alone with the candidate changes applied. A baseline-only isolated pass does not resolve whether the candidate caused the timeout. Do not increase timeouts merely to make checks pass.

**Why:** The user specified this diagnostic sequence after invoice and Command Center tests timed out in a broad run but passed alone on the baseline.

**How to apply:** If the candidate's suite passes alone, track overloaded-run behavior separately from the feature slice. If it fails alone, fix the reproduced failure within the feature slice before completing it.

Artifact typechecks may consume stale declarations from referenced workspace libraries, even when the source schema already contains the reported missing fields. Rebuild those libraries before attributing the errors to source changes.

**Why:** An isolated checkout reported missing retirement fields across both API and web while those fields already existed in the schema. Refreshing the library declarations eliminated the errors without changing source.

**How to apply:** Inspect source first, rebuild the referenced libraries with the workspace TypeScript build, then run the requested leaf-package typechecks. Do not repair correct schema code to match stale generated output.
