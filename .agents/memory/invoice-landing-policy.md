---
name: Invoice landing policy
description: Product decision superseding the former automatic collections view for invoice-reading roles.
---

Opening the invoices page without URL filters must show the unfiltered,
newest-first, billing-month-grouped list for every invoice-reading role.
Clear all must return to that same clean URL. Collections filters and sorts
remain available through deliberate navigation and shared deep links.

**Why:** The user explicitly superseded the previously shipped automatic
collections landing behavior because it applied unwanted filters and
prevented Clear all from actually clearing them. This does not retire the
A/R layout, server filtering, or overdue deep links.

**How to apply:** Do not reintroduce role-based landing filters, automatic
sorts, or preference-based defaults in invoice work unless the user changes
this product decision explicitly.
