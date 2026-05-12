import { useEffect, useState } from "react";
import { ShieldAlert, Loader2 } from "lucide-react";
import { buildAuthHeaders } from "./shared";
import {
  getCurrentUser,
  getImpersonator,
  isImpersonating,
  restoreImpersonator,
} from "@/lib/impersonation";

// Task #554 — global banner pinned to the top of every screen while a
// super_admin is impersonating another user. Reads localStorage on
// mount and on `storage` events so it stays in sync across tabs.
export function ImpersonationBanner() {
  const [active, setActive] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return isImpersonating();
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const sync = () => setActive(isImpersonating());
    window.addEventListener("storage", sync);
    // Some flows (begin/end on the same tab) don't fire `storage`, so
    // re-sync on focus too.
    window.addEventListener("focus", sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("focus", sync);
    };
  }, []);

  if (!active) return null;
  const target = getCurrentUser();
  const original = getImpersonator();

  const onEnd = async () => {
    if (busy) return;
    setBusy(true);
    const previousUserId = target?.id ?? null;
    // Restore the super-admin headers BEFORE the audit POST so the
    // server's super-admin guard passes for the end-of-impersonation
    // audit row. `restoreImpersonator()` returns the just-revoked
    // token so the server can mark its jti as revoked (defense in
    // depth — also expires naturally after the TTL).
    const { impersonationToken } = restoreImpersonator();
    try {
      await fetch("/api/admin/app-health/impersonate/end", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...buildAuthHeaders() },
        body: JSON.stringify({ previousUserId, impersonationToken }),
      });
    } catch { /* best-effort audit */ }
    // Hard reload so every screen re-reads localStorage.user.
    window.location.href = "/super-admin/app-health";
  };

  return (
    <div
      role="alert"
      data-testid="impersonation-banner"
      className="sticky top-0 z-50 w-full bg-amber-500 text-amber-950 border-b border-amber-700 shadow-sm"
    >
      <div className="max-w-7xl mx-auto px-4 py-2 flex items-center justify-between gap-3 text-sm">
        <div className="flex items-center gap-2 min-w-0">
          <ShieldAlert className="h-4 w-4 shrink-0" />
          <span className="font-semibold">Impersonating</span>
          <span className="truncate">
            {target?.name ?? target?.username ?? `user #${target?.id ?? "?"}`}
            {target?.role ? ` (${target.role.replace(/_/g, " ")})` : ""}
          </span>
          {original ? (
            <span className="hidden sm:inline text-amber-900/80">
              · as {original.username}
            </span>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onEnd}
          disabled={busy}
          data-testid="end-impersonation"
          className="shrink-0 inline-flex items-center gap-1.5 rounded-md bg-amber-950 text-amber-50 hover:bg-amber-900 disabled:opacity-60 px-3 py-1 text-xs font-medium"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
          Return to {original?.username ?? "super admin"}
        </button>
      </div>
    </div>
  );
}
