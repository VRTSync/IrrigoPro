---
name: Hidden figures leak through aria
description: A surface that deliberately hides a number must hide it from the accessibility layer too — and a ratio-only caller needs a real input mode, not a faked denominator.
---

## Rule — hide the figure everywhere, not just visibly

When a surface is specified to show no figure, the suppression must cover
`aria-valuenow`, `aria-valuetext`, `title`, and every other attribute a screen
reader or tooltip reads. Omit the attribute; never pass a rounded or clamped
value. Assert its absence on rendered output — a test that checks visible text
only will pass while the number is still announced.

**Why:** a percentage of a deliberately hidden number reveals the number by
inference, so "no dollars" without "no percentage" is not a real restriction.

## Rule — a ratio caller gets an input mode, not a fake denominator

A shared meter fed a ratio must accept a proportion as a first-class input.
Faking the denominator — the percentage as the amount, `100` as the scale —
computes the right width and lies in every other prop, so the first tooltip,
export or percentage added to that surface prints nonsense. Make the modes
explicit and fail loudly in development when a caller passes more than one.

**How to apply:** the client-side hiding is a convenience, never the guard —
the endpoint must still omit the field.
