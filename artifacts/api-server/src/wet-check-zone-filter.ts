/**
 * Shared zone-filtering predicate for wet check PDF renderers.
 *
 * A zone is "empty" when it was auto-seeded at wet-check creation and the
 * technician never touched it.  Such zones carry no real data and should be
 * excluded from both the internal and customer-facing PDF reports so the
 * document doesn't show a wall of "Not Checked" rows.
 *
 * A zone is kept when ANY of the following is true:
 *  - status is something other than `not_checked` (or null/empty)
 *  - it has one or more findings
 *  - observedPressure is non-null
 *  - observedFlow is non-null
 *  - ranSuccessfully is non-null (tech explicitly set it)
 *  - notes is a non-empty string
 *  - repairLaborHours is non-null (and non-zero string)
 */

export interface ZoneLike {
  status: string | null | undefined;
  findings?: unknown[] | null;
  observedPressure?: string | number | null;
  observedFlow?: string | number | null;
  ranSuccessfully?: boolean | null;
  notes?: string | null;
  repairLaborHours?: string | number | null;
}

/**
 * Returns `true` when the zone contains no real data — i.e. it should be
 * excluded from PDF output.  Pass through `!isEmptyZone(z)` to keep zones.
 */
export function isEmptyZone(zone: ZoneLike): boolean {
  const status = zone.status ?? '';
  if (status !== '' && status !== 'not_checked') return false;

  const findings = zone.findings;
  if (findings && findings.length > 0) return false;

  if (zone.observedPressure != null) return false;
  if (zone.observedFlow != null) return false;
  if (zone.ranSuccessfully != null) return false;

  if (zone.notes && zone.notes.trim() !== '') return false;

  if (zone.repairLaborHours != null && Number(zone.repairLaborHours) !== 0) return false;

  return true;
}
