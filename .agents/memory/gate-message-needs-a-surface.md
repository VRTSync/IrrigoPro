---
name: A guard's message needs a surface that renders it
description: Server-side validation wording is only real if the calling UI displays it; hardcoded error toasts silently discard it.
---

A guard that returns tailored, actionable wording is only as good as the surface
that displays it. Mutation handlers commonly hardcode their failure toast and
throw the server's message away. When the guard's whole purpose is to say *what
to do instead*, that generic copy turns a solvable error into a dead end: the
user retries an action that can never pass, and the message reaches nobody.

**Why:** A gate shipped with two carefully chosen message variants, one aimed at
users on a list or detail surface telling them where to go to fix the problem.
Every route returned it correctly and the API tests passed, but the calling
surface replaced it with "please try again", so the variant was dead on arrival.
The feature looked complete at the API and was useless in the product.

**How to apply:** Adding advisory wording to a guard is not done until a surface
renders it. Grep the calling UI's error handlers for hardcoded strings before
declaring the work complete, and confirm by triggering the failure in the
running app and reading what the user actually sees — not by re-reading the
route handler. Prefer the codebase's existing error-message extractor over
writing a new one; the raw thrown error is usually a `"<status>: <json body>"`
string rather than the bare message, which is why teams reach for a fallback
constant and lose the message in the first place.

The same trap applies in reverse: a guard placed in front of an authorization
check will answer callers who should have been refused earlier, so its message
leaks state. Order guards least-privileged first.
