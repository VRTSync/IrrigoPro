// Shared helper for the heal-at-invoice-generation step (Slice 2, Task #1752).
//
// Extracts the canonical-total computation so it can be unit-tested without
// a DB connection or an Express route. The production caller in routes.ts uses
// this function and then attempts a best-effort DB persist.

import { money } from './money';

const DEFAULT_TOLERANCE = 0.01;

export type HealableTicket = {
  id: number;
  partsSubtotal?: string | null;
  laborSubtotal?: string | null;
  totalAmount?: string | null;
};

export type HealOutcome = {
  /** The canonical total (partsSubtotal + laborSubtotal). */
  healedTotal: string;
  /** The stored totalAmount before healing. */
  storedTotal: string;
  /** True when the stored total was too low and the in-memory value was updated. */
  wasDrifted: boolean;
  /** The positive delta that was missing. 0 when not drifted. */
  delta: number;
};

/**
 * Compute the canonical total for a ticket and determine if it is drifted
 * (i.e. stored total < parts + labor by more than the tolerance).
 *
 * Add-parts-only semantics: returns wasDrifted=true ONLY when
 * parts + labor > stored + tolerance. Tickets where the stored total is
 * already >= canonical are not considered drifted and are left untouched.
 *
 * This is a pure function — no DB calls, no side effects.
 */
export function computeHealedTotal(
  ticket: HealableTicket,
  tolerance = DEFAULT_TOLERANCE,
): HealOutcome {
  const parts = money(ticket.partsSubtotal);
  const labor = money(ticket.laborSubtotal);
  const stored = money(ticket.totalAmount);
  const healed = parts + labor;
  const delta = healed - stored;
  const wasDrifted = delta > tolerance;
  return {
    healedTotal: healed.toFixed(2),
    storedTotal: stored.toFixed(2),
    wasDrifted,
    delta: wasDrifted ? delta : 0,
  };
}
