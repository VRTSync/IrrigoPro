import { safeGet } from "@/utils/safeStorage";

// Shared helper used by every App Health subview to attach the
// header-auth identity expected by the API server's super_admin guard.
export function buildAuthHeaders(): Record<string, string> {
  try {
    const raw = safeGet("user");
    if (!raw) return {};
    const u = JSON.parse(raw) as { id?: number; role?: string; companyId?: number; name?: string };
    const headers: Record<string, string> = {};
    if (u?.role) headers["x-user-role"] = u.role;
    if (u?.id != null) headers["x-user-id"] = String(u.id);
    if (u?.companyId != null) headers["x-user-company-id"] = String(u.companyId);
    if (u?.name) headers["x-user-name"] = u.name;
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
