---
name: Migration registry count test coupling
description: Registering a new Super Admin DB migration breaks an exact-count assertion in the registry test.
---

# Migration registry exact-count test

The Super Admin DB migration registry (`lib/migrations/registry.ts`) has a
companion test (`registry.test.ts`) whose "static shape" block historically
asserted the registry contained **exactly one** entry.

**Rule:** when you register a new `MigrationDefinition` in the `REGISTRY` map,
update the registry static-shape test in lockstep, or it fails with
`actual: N, expected: 1`.

**Why:** the count assertion is a tripwire that intentionally fails on any
registry change so a human reviews the new migration. It is not a bug.

**How to apply:** prefer membership checks (`ids.includes("...")`) over an
exact `length` assertion so each migration is verified by id and the test
doesn't need editing every time the registry grows. The behavioral
check/preview/run blocks in that file hit the real shared dev DB, so they run
only in the slow full suite — verify your static-shape edits with
`--test-name-pattern="static shape"`.
