---
name: Closed-period tiles and their empty state
description: A "last period" tile must exclude the in-progress period, and "no period yet" must travel as null plus a flag, never 0.
---

A tile that reports the most recent *closed* period (last billing cycle, last
month, last quarter) must exclude the current, in-progress period at the
selection step, not rely on how rows happen to be stamped. Absence of a closed
period is then a real state and must reach the frontend as a null value plus an
explicit boolean, so the tile can render "—" with a helper line.

**Why:** selecting `max(period)` reads correct only while every row is stamped
in arrears. One row stamped with the current period silently turns the tile
into a partial period compared against a whole one, and the two deltas beside
each other then contradict with no explanation. Collapsing "no closed period"
to 0 is the same class of lie: the reader cannot tell "we billed nothing" from
"there is nothing to show yet".

**How to apply:** put the exclusion in the shared period-selection helper as an
opt-in bound (`closedAsOf`), pass it from every route that renders the tile,
and keep the comparator comparing the selected closed period against the one
before it. Any count shown beside the figure must be derived from the same
selection, or the count and the dollars describe different rows.
