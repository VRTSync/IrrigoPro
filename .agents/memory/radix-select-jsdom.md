---
name: Driving a Radix Select in jsdom
description: The pointer-capture shim needed before a Radix Select can be opened in a component test.
---

Radix's Select opens on pointer events and calls pointer-capture methods that
jsdom does not implement. Clicking the trigger throws
`target.hasPointerCapture is not a function`, which surfaces as an *unhandled
error* beside a failing `waitFor`, not as an obvious cause.

**Why:** jsdom implements the pointer *events* but not the capture API, and
Radix uses capture to decide whether a press became a drag.

**How to apply:** In the test file (or a shared setup), no-op
`hasPointerCapture`, `setPointerCapture`, `releasePointerCapture` and
`scrollIntoView` on `Element.prototype` before rendering, then open the
trigger with `fireEvent.pointerDown` followed by `fireEvent.click` —
`userEvent.click` alone does not open it. Note that jsdom applies no media
queries, so a page rendering both a desktop table and a mobile card list will
have two of every control; take the first match.

For a DropdownMenu file picker whose `onSelect` prevents default, send Escape
after selecting the picker in a jsdom test before querying the surrounding page.

**Why:** The menu remains open and Radix marks the rest of the page aria-hidden.
A successfully updated image can then appear missing to `getByRole`.

**How to apply:** Exercise the menu item and file input, then dismiss the menu
explicitly rather than weakening the image assertion with hidden-role queries.
