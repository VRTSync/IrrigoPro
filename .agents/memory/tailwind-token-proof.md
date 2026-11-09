---
name: A colour token is two halves
description: Why a semantic colour class can silently produce no style, and what actually proves one works.
---

A colour token in the web artifact is two halves: a custom property in the stylesheet and an entry
in the Tailwind config's `colors`. Only the config half makes a utility class exist. A variable
defined with no config entry yields a class name that compiles to nothing — no error, no warning,
no style, and a component that looks unstyled for no visible reason.

**Why:** this repo shipped `--success` and `--warning` for a long time with neither registered, so
`bg-success` and `text-warning` were dead class names anyone could reach for.
Missing gradient-stop utilities can invalidate the whole background, not just change its colour;
white header text can become unreadable even though every class looks correct in source.

**Scope rule:** when existing-role appearance must remain unchanged, prefer a component-local
token-based gradient over globally activating a previously unregistered colour.

**Why:** registering a missing colour also activates matching classes already used on unrelated
screens. A local gradient preserves the requested appearance without silently restyling those screens.

**How to apply:** when adding or auditing a semantic colour, check both halves, and prove the class
generates rather than assuming. Tailwind's JIT only emits utilities it finds in scanned content, so
a token registered ahead of its first use appears in no production build — grepping the build shows
absence and proves nothing. Build with the real config and `content` pointed at a throwaway probe
file listing the classes. To prove a token change moves no pixels, build the previous stylesheet and
config against the same source tree and diff: added custom properties with no changed utility rule
means nothing on screen can differ.
