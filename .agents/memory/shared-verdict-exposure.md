---
name: Exposing a shared verdict to every surface
description: How to consolidate a signal that several screens each derive for themselves, and the two traps that make the consolidated version still disagree.
---

When several screens each answer the same question ("is the integration healthy?", "is this
stale?") with a derivation of their own, consolidating is not just picking the richest one. Two
things decide whether the screens actually agree afterwards.

**1. Expose the verdict on a request each page already makes, not on the endpoint that owns the
concept.** The natural home for an integration's health is that integration's own endpoint — and
that endpoint is usually gated on a *management* capability. Any page that admits a broader
audience then gets a 403, the client swallows it into `{}`, and the surface silently shows
nothing: a fourth answer, "no answer", which is worse than disagreeing because nobody notices.
Attach the verdict to each page's existing payload instead. No second network call, no widening
of the management capability, no cross-importing another page's component.

**Why:** the hole is invisible in testing — the page renders, the query "succeeds", the warning
is simply absent. Verify it with a freshly seeded account of the affected role and a listener
that collects 403s, not with a screenshot.

**2. A rank table must be in severity order and must not fall back to zero.** A status the table
does not list ranks as "best" under a `?? 0` default, so the worst-wins rollup silently drops it,
and a rank order that disagrees with the state mapping (a status that ranks milder but maps to a
worse state) reports the wrong tenant as worst. Rank unknown statuses as *degraded*, and keep the
rank order and the state mapping derived from one list.

**How to apply:** when consolidating, write the agreement itself as the test — one fixture, all
surfaces, deep-equal payloads — rather than testing each surface against an expected value.
Expected values drift apart one edit at a time; an equality assertion cannot.

**Wording is the part that stays per-surface.** A consolidated verdict carries a *reason*, and
each surface renders it in its own words. Keep the reason coarse enough to be a closed set and
specific enough that the copy can differ: a broken connection, a backlog, and a stale read are
three different problems and should never share one sentence. A warning that is on permanently —
including for a tenant that simply never connected the integration — carries no information, so
map "never configured" to a neutral state, not a fault.
