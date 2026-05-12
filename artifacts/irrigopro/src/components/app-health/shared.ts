import { safeGet } from "@/utils/safeStorage";

// Shared helper used by every App Health subview to attach the
// header-auth identity expected by the API server's super_admin guard.
// Also forwards the server-issued impersonation token whenever one is
// present so `requireAuthentication` swaps the effective identity to
// the target user (Task #554).
export function buildAuthHeaders(): Record<string, string> {
  try {
    const headers: Record<string, string> = {};
    const raw = safeGet("user");
    if (raw) {
      const u = JSON.parse(raw) as { id?: number; role?: string; companyId?: number; name?: string };
      if (u?.role) headers["x-user-role"] = u.role;
      if (u?.id != null) headers["x-user-id"] = String(u.id);
      if (u?.companyId != null) headers["x-user-company-id"] = String(u.companyId);
      if (u?.name) headers["x-user-name"] = u.name;
    }
    const tok = safeGet("irrigopro:impersonationToken");
    const expRaw = safeGet("irrigopro:impersonationTokenExpiresAt");
    if (tok) {
      let expired = false;
      if (expRaw) {
        const t = new Date(expRaw).getTime();
        if (Number.isFinite(t) && t <= Date.now()) expired = true;
      }
      if (!expired) headers["x-impersonation-token"] = tok;
    }
    return headers;
  } catch {
    return {};
  }
}

export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "—";
  const diffMs = Date.now() - t;
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}
