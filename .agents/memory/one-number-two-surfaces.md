---
name: One number on two surfaces
description: When a figure appears on two surfaces from two endpoints, share the call — and never extrapolate a point-in-time balance by day-of-month.
---

When the same named figure is rendered on two surfaces fed by two endpoints, the
two handlers must make the *identical* helper call with the *identical* input.
Agreement reached by "both endpoints happen to compute the same thing" is not a
contract and separates on the next edit.

Pin it with a drift-guard test: hit both endpoints against one fixture at one
frozen instant and assert the two values are equal. Choose the fixture so the
two plausible bases produce different numbers, otherwise the guard passes even
when one endpoint is still on the wrong base.

**Second rule, learned from the same defect:** a run-rate extrapolation
(`value / daysElapsed * daysInMonth`) is only valid on a flow measured
month-to-date. Applying it to a point-in-time *balance* — an outstanding
pipeline, an A/R total, any standing amount that spans all time — is a category
error, not a tuning problem. The output collapses as the month runs with nothing
about the business having changed, and on the last day it silently restates the
balance itself.

**Why:** the Accounting tab carried the month-end projection twice, ~2x apart,
because one surface extrapolated billed MTD and the other extrapolated the
uninvoiced pipeline. Both self-reported `method: "runRate"`; only one was one.
The tile's own tooltip and helper line disagreed with each other on screen.

**How to apply:** before adding a second reader of a metric, check whether it
already has an endpoint and reuse that call rather than recomputing. When a
label, tooltip and badge describe a formula, re-read all three against the code
after changing the formula — a stale tooltip is how the mismatch stayed
invisible. If a merged task left a regression test asserting the defective
behaviour, invert it rather than working around it.
