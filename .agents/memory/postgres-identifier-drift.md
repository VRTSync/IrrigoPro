---
name: PostgreSQL constraint identifier drift
description: Why automatic long foreign-key names can cause endless Drizzle push diffs.
---

Give new foreign keys explicit names shorter than PostgreSQL's 63-byte identifier
limit when automatic table/column names would exceed it.

**Why:** PostgreSQL truncates long identifiers, while Drizzle may compare the
untruncated expected name and repeatedly propose dropping/recreating an otherwise
correct foreign key. A successful push is not proof of a globally empty diff.

**How to apply:** Check a read-only full-schema diff without applying it. Separate
new-table drift from existing identifier churn and report both honestly. Do not
apply partial-table push proposals: the introspector can include unrelated
sequences and suggest dropping them even with a table filter. Scope any actual
constraint-name repair explicitly and never broaden a feature into a global
constraint rewrite without approval.
