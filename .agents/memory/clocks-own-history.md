---
name: Clocks own their history
description: Locked clock identity, historical labels, binding and rename ledger decisions.
---

Clock objects own their zones and billing permanently. A letter is only a name; renaming must never move or detach history. Stored ticket letters remain frozen, including on printed tickets. Current-letter annotations belong on screen only.

**Why:** The user needs to add missing clocks and re-letter an entire location in walking order without transferring any season history between physical clocks.

**How to apply:** Use controller IDs for identity. Bind unbound tickets within company/customer/branch before every rename in the same transaction: choose the unique active holder, otherwise the unique holder of any status, otherwise leave unbound and report. Preserve existing binding on edits unless letter, customer or branch actually changes. Record renames in a dedicated ledger; office-only location re-lettering is atomic and records only each clock's final change, not intermediate swap chains.

The Clocks Own Their History family supersedes Billed Clock Protection's letter-change guard and the former Controller Letters display slice. Order: billed zone-count protection, history binding, ledger/location re-lettering, then display-only current-letter annotations. Do not touch stored ticket letters, printed PDFs/invoices, site maps or customer-billing.tsx. Use the current slice's build specification for implementation scope; the design context alone is not a request to build all slices.

The billed zone-count guard is queue ordering, not a code dependency for history binding. Proceed with binding even if that separate guard is absent.

**Why:** The user explicitly clarified that the guard remains its own queued task and must not block this slice.

**How to apply:** Do not implement the billed zone-count guard as part of history binding or stop binding for its absence.
