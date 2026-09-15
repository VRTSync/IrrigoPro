---
name: A tile and its breakdown
description: Rules for keeping a headline money figure and the buckets/rows that decompose it in agreement.
---

A headline figure and the breakdown beneath it must resolve each row's amount through
**one shared helper**, and each bucket's `count` must increment only for the rows whose
dollars that bucket reports.

**Why:** Two surfaces showing "money owed" drifted because one read a synced balance only
for a `partially_paid` invoice while the other read it whenever a payment sync had run.
Separately, the breakdown silently `continue`d on a row it could not date — that row was in
the headline and in no bucket — and it incremented a bucket's count for rows contributing
zero dollars. The symptoms were a small dollar gap and buckets reporting more invoices than
their dollars represented, which reads as a rounding bug and is not one.

**How to apply:** When adding or auditing an aggregate that decomposes a total:
- Extract the per-row amount into one exported helper and call it from both the total and
  the breakdown. Clamp at zero there, once, so an overpayment never subtracts from a peer.
- Never `continue` in the breakdown on a condition the total does not also apply. If a row
  cannot be classified, it still has to land somewhere.
- Write the sum-to-the-tile invariant as an assertion test over a mixed fixture, not as a
  runtime check.
- If the amount rule reads an optional field, a caller that forgets to project it degrades
  silently to the wrong number with no type error. Pin the projection with a test.
