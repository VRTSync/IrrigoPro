---
name: Mutation fetch test isolation
description: Why behavioral tests for modal mutations must distinguish background reads from writes
---

When mocking responses to a UI mutation, match both the HTTP method and the target route, not merely the URL prefix.

**Why:** Mounted detail modals can issue background activity reads under the same resource prefix as the action. A sequence-based mock that matches the prefix alone lets a GET consume the intended rejection response, causing the action to receive a later success or fallback instead.

**How to apply:** In behavioral mutation tests, return harmless reads for GET requests and reserve the ordered error/success responses for the specific write method.