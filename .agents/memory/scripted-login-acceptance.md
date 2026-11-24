---
name: Verifying role-gated UI
description: Role-gated UI needs a real login and a 403 listener; screenshots and seeded sessions both lie.
---

Role-gated UI cannot be verified with a screenshot tool or a seeded session cookie. The
navigation resolves the current role at login rather than per request, so an authenticated API
call proves nothing about what the user actually sees.

**Two traps that produce false results:**

1. **Changing an existing user's role does not change their navigation.** Verify with a freshly
   seeded account of the target role; a role flipped under a live session shows the old nav and
   reads as a failure that is not real.
2. **A seeded user with an unverified email cannot log in.** Login has a distinct 403
   "verification required" branch, separate from the 401 credential failures, so it looks like an
   authorization bug rather than a fixture problem.

**How to apply:** drive a real browser login, one browser context per role so sessions do not
bleed, and attach a response listener that collects every 403. Judge by that list, not by the
screenshot — queries firing on mount fail invisibly, and a background 403 on a role's own landing
page is the most common way a new role ships half-broken. Separate the 403s the new role is
*supposed* to get from ones that also affect existing roles, so pre-existing gaps are reported
rather than silently "fixed" into scope creep.

**Rule:** Phone-wizard acceptance must prove that lower controls are reachable by real scrolling, not only by DOM-triggered clicks.

**Why:** A programmatic click can pass on an off-screen control while a sticky footer hides it in the captured viewport. A passing mutation alone does not prove a technician can reach it.

**How to apply:** Scroll the actual phone viewport, check target and bottom-navigation bounds, and capture both upper and lower portions of long steps. Dismiss the development preview banner before pointer checks.

**Rule:** Wait for a scrolled target to pass hit-testing before browser pointer actions.

**Why:** Smooth scrolling can leave a target under the sticky wizard footer after `scrollIntoView` returns. Likewise, a slide-in notification sheet can contain its text in the DOM while it is still off-screen. An immediate click can fail even when the control works.

**How to apply:** Wait until the target contains `document.elementFromPoint` at its center, then click. Do not substitute a DOM-triggered click, which would conceal an actual obstruction.

**Rule:** Pick the visible control when the office shell renders both responsive versions.

**Why:** The desktop and phone bells have the same accessible name and are both mounted. A browser helper that waits on the first match can time out on the CSS-hidden bell despite the other one being usable.

**How to apply:** Filter all matches to elements with a visible layout box before performing a pointer check.

**Rule:** Verify authenticated PDF bytes with a browser-page fetch, not the PDF popup's captured response buffer.

**Why:** Chromium's PDF viewer can leave Puppeteer's response buffer empty for a response that successfully delivers bytes. A popup can also steal focus and stall the next interaction on the source page.

**How to apply:** Check status, MIME, and bytes with `fetch` and `arrayBuffer` inside the signed-in page. If testing the View click itself, capture its request separately and run later interactions in the foreground or in a fresh page.

**Rule:** Confirm React-controlled edits by observing a new server response or rendered result, not by reading the input's DOM value alone.

**Why:** Browser automation could put new text in a controlled textarea without triggering the form change; the textarea looked updated while the editor kept the old validation and preview.

**How to apply:** Use real keyboard selection and Puppeteer's `keyboard.sendCharacter(text)` or `keyboard.type(text)`, then assert what changed outside the input.
