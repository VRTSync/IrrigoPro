---
name: Merged prerequisites in isolated branches
description: How to handle a prerequisite marked merged while an isolated task checkout still lacks its code.
---

A task marked merged in the tracker does not guarantee the current isolated branch or its local main reference has the new files. Confirm by searching the checkout and comparing the remote heads before assuming the prerequisite is present.

**Why:** A merged prerequisite remained absent from this branch and the main-workspace SSH remote denied access. An existing GitHub remote later advanced and exposed the missing commit; the task could then integrate it without recreating the prerequisite.

**How to apply:** When dependent work is missing, inspect existing remote refs read-only and fetch an accessible one. Bring in the specific prerequisite commit, preserve both sides of any conflicts, and test the combined behavior. Do not treat task metadata alone as proof of code availability.

For file-based transfers between isolated task workspaces, require the actual complete mbox attachment, not an editor URL or only the first message in a series. An editor link does not transfer file bytes or grant another workspace access.

**Why:** Repeated handoffs supplied only a shared specification/publication patch or a private editor link. The implementation commits became available only after the complete exported mbox was attached.

**How to apply:** Inspect every message's subject and changed paths before applying the series in the requested order. Skip a shared prerequisite only after verifying it is already an ancestor; never treat specification-only content as the implementation repair.