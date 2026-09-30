---
name: Expo and shared ESM barrels
description: How Expo Metro should consume shared TypeScript packages that use NodeNext-style emitted JavaScript re-export specifiers.
---

Expose focused package subpaths that point directly at TypeScript source when an Expo artifact needs a module from a shared ESM package whose main barrel re-exports siblings with `.js` extensions.

**Why:** TypeScript and Node's TS loaders understand the source-to-emitted extension convention, but Metro tries to resolve every barrel re-export as a physical JavaScript source file and fails the bundle.

**How to apply:** Add an explicit package `exports` subpath for the needed source module and import that subpath from Expo. Prefer this over a custom Metro resolver or changing every shared ESM import specifier.