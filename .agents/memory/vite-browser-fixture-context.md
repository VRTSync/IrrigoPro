---
name: Vite browser fixture context
description: Avoid duplicated provider contexts in isolated browser evidence harnesses.
---

An isolated browser harness importing Vite's optimized dependencies must use the
same versioned module URLs as the real component imports, not bare optimized URLs.

**Why:** A query provider imported without Vite's `?v=` suffix and a component
imported with it are distinct browser module instances. The rendered component
then throws “No QueryClient set” even though the harness has a provider.

**How to apply:** For browser-only component evidence, read a transformed source
module and reuse its dependency URLs. Label intercepted fixture evidence clearly;
it is neither authenticated app acceptance nor physical-device verification.
