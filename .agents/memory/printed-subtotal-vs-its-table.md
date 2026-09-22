---
name: Printed subtotal vs the table beneath it
description: When a PDF/report page prints both a stored header figure and the line-item table it summarizes, the items are authoritative for that page.
---

A ticket/section header that prints a money figure while the same page renders
the line items beneath it must not be allowed to disagree with them. Stored
header columns are a cache; the items are the record. Resolve the header from
the items whenever items exist, fall back to the stored column only when the
page has no items to sum, and count how often the two disagreed so the size of
the stored-data problem is measurable.

**Why:** a customer checks exactly that one number by hand against the table
printed directly below it. A stale cache column there reads as a billing error
and gets the whole invoice rejected, even when every other total is correct.

**How to apply:**
- One shared resolver for every ticket type on the page, never per-branch logic.
- Read candidate columns with `??`, not `||` / truthiness — a genuine stored
  `0.00` must stay distinguishable from an absent value, and a legacy column
  that parses to `0` will silently defeat a "fallback" written as a default
  argument to a null-coalescing number helper.
- Compare in `Number` space against the module's single currency tolerance;
  never compare formatted strings, and never add a second tolerance constant.
- Repairing the read path is a separate slice from repairing the stored rows;
  emit an audit count in the read slice so the write slice can be sized and
  verified.
