---
name: Invoice line items are two shapes
description: Why a per-part figure must be derived from the source ticket, not from an invoice line
---

An invoice line is either a real part line or a whole ticket collapsed into one
row. Generation writes the collapsed shape — one row per work order, billing
sheet or wet-check billing, no part reference, the entire ticket total in the
line total — so on most real invoices the collapsed shape is the only one
present. The correction/reissue path writes it too and keeps even less: do not
assume the line states how much of its total was labor.

**Rule:** derive any per-part figure — cost, margin, parts-only dollars — from
the source ticket's own item rows, reached through the line's source type and
id. The ticket's rows are authoritative, including when it has none, which
means the ticket billed no parts. Only when the ticket cannot be resolved may
you use the line's own numbers, and then the parts portion is the total less
the labor it states, never the total.

**Why:** the collapsed line has neither a part to look up nor a trustworthy
labor split. A percentage-of-price estimate taken on it charges labor a second
time whenever the labor figure is missing, and even when present the estimate
replaces a real answer the ticket already holds. The error scales with how much
volume is invoiced from tickets, which is nearly all of it.

**How to apply:** whenever you join invoice line items for a per-part figure.
Expect the real part-line population to be far smaller than the row count
suggests, and expect whole invoices whose only rows are collapsed ones — a
parts figure of zero there is the shape of the data, not a bug in the query.
