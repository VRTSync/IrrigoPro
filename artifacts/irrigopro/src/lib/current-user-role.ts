import { safeGet } from "@/utils/safeStorage";

/** The signed-in user's role, or null. Single source for estimate UI gates. */
export function readCurrentUserRole(): string | null {
  try {
    const raw = safeGet("user");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { role?: string };
    return typeof parsed?.role === "string" ? parsed.role : null;
  } catch {
    return null;
  }
}