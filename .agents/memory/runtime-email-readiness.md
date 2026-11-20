---
name: Runtime email readiness
description: Distinguish the workspace secret listing from evidence that the running mail service can reach SendGrid.
---

Do not declare SendGrid unavailable based solely on a secret-existence listing. Use the running domain-check endpoint's result as evidence of the actual service's readiness, without inspecting credential values.

**Why:** The secret listing reported the API key absent while the running API reached SendGrid and returned a domain-not-authenticated response. Treating the listing as definitive incorrectly blocked live verification.

**How to apply:** Distinguish missing-key, insufficient-permission, and unauthenticated-domain results. Use a disposable tenant for acceptance, leave existing tenants untouched, and obtain an approved test inbox before sending real mail.

A successful SendGrid send and an empty Activity API lookup can coexist with confirmed inbox delivery.

**Why:** The app recorded two accepted synthetic messages and read back their PDFs. Scoped Activity lookups returned no matches, but the test inbox owner confirmed receipt.

**How to apply:** Report provider acceptance, Activity results, and inbox confirmation as separate evidence. Do not send again just because an Activity lookup has no matches.
