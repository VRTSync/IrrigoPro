/**
 * Safe localStorage wrapper for Safari compatibility.
 *
 * Safari Private Browsing throws a QuotaExceededError on any localStorage.setItem()
 * call because the storage quota is 0. This utility falls back to sessionStorage
 * (cleared when the tab closes) so the app stays functional in private mode.
 */

export function safeGet(key: string): string | null {
  try {
    const val = localStorage.getItem(key);
    if (val !== null) return val;
    return sessionStorage.getItem(key);
  } catch {
    try {
      return sessionStorage.getItem(key);
    } catch {
      return null;
    }
  }
}

export function safeSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    try {
      sessionStorage.setItem(key, value);
    } catch {
      // Both storage methods unavailable – silently ignore
    }
  }
}

export function safeRemove(key: string): void {
  try { localStorage.removeItem(key); } catch { /* ignore */ }
  try { sessionStorage.removeItem(key); } catch { /* ignore */ }
}

/**
 * Parse a date string (YYYY-MM-DD or ISO) as local time, not UTC.
 * Safari parses "YYYY-MM-DD" as UTC midnight, causing off-by-one-day
 * errors for users in UTC- timezones. This helper forces local midnight.
 */
export function parseDateAsLocal(dateStr: string | null | undefined): Date | null {
  if (!dateStr) return null;
  // If it's a date-only string (YYYY-MM-DD), append time to force local parsing
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return new Date(dateStr + 'T00:00:00');
  }
  return new Date(dateStr);
}

/**
 * Convert a date-input value (YYYY-MM-DD) to an ISO string using LOCAL midnight.
 * Safari parses bare date strings as UTC, so we must append 'T00:00:00' first.
 */
export function dateInputToISO(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null;
  return new Date(dateStr + 'T00:00:00').toISOString();
}
