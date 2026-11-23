const MS_PER_DAY = 86_400_000;

/** Local calendar date projected onto UTC midnight, so DST never shifts a day count. */
export function localDayNumber(d: Date): number {
  return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / MS_PER_DAY);
}

export function relativeDays(at: string, now: Date): string {
  const then = new Date(at);
  if (Number.isNaN(then.getTime())) return "";
  const diff = localDayNumber(now) - localDayNumber(then);
  if (diff === 0) return "today";
  if (diff < 0) return diff === -1 ? "in 1 day" : `in ${-diff} days`;
  return diff === 1 ? "1 day ago" : `${diff} days ago`;
}
