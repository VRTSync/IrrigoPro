// Task #556 — global re-login affordance for the field-tech shell.
//
// When `useUnauthenticatedReads()` flips true (any default-loaded
// /api/* read came back 401 with a saved user in localStorage), this
// banner appears at the top of the screen with a single "Sign in
// again" button. The 401 storm in the deployment logs (~10 reads per
// page load) collapses to one banner because `markUnauthenticatedRead`
// debounces internally — listeners only fire when the boolean
// transitions.
//
// The button clears the stale `user` blob and routes to /login. We
// also call `clearUnauthenticatedRead()` so the next session probe
// starts from a clean slate.

import { AlertTriangle } from "lucide-react";
import {
  clearUnauthenticatedRead,
  useUnauthenticatedReads,
} from "@/lib/queryClient";
import { safeRemove } from "@/utils/safeStorage";

export function SessionExpiredBanner() {
  const unauth = useUnauthenticatedReads();
  if (!unauth) return null;
  const handleSignIn = () => {
    try { safeRemove("user"); } catch { /* ignore */ }
    clearUnauthenticatedRead();
    window.location.href = "/login";
  };
  return (
    <div
      className="sticky top-0 z-40 -mx-4 mb-2 flex items-center justify-between gap-3 bg-amber-100 text-amber-900 text-sm font-medium px-4 py-2 border-y border-amber-300"
      role="alert"
      data-testid="session-expired-banner"
    >
      <div className="flex items-center gap-2 min-w-0">
        <AlertTriangle className="w-4 h-4 shrink-0" />
        <span className="truncate">
          Your session expired — please sign in again.
        </span>
      </div>
      <button
        type="button"
        onClick={handleSignIn}
        className="shrink-0 rounded bg-amber-900 text-amber-50 px-3 py-1 text-xs font-semibold hover:bg-amber-800"
        data-testid="btn-sign-in-again"
      >
        Sign in
      </button>
    </div>
  );
}

// Inline variant for empty-state cards (e.g. "In progress & recent"
// on the wet checks list). Uses the same hook so a list page can
// swap its empty copy for the re-login affordance whenever the
// global signal is set.
export function SessionExpiredEmptyState({
  message = "Your session expired — sign in to load this list.",
}: { message?: string }) {
  const handleSignIn = () => {
    try { safeRemove("user"); } catch { /* ignore */ }
    clearUnauthenticatedRead();
    window.location.href = "/login";
  };
  return (
    <div
      className="rounded border border-amber-300 bg-amber-50 px-4 py-4 text-sm text-amber-900 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2"
      data-testid="session-expired-empty"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
        <span>{message}</span>
      </div>
      <button
        type="button"
        onClick={handleSignIn}
        className="self-start sm:self-auto shrink-0 rounded bg-amber-900 text-amber-50 px-3 py-1 text-xs font-semibold hover:bg-amber-800"
        data-testid="btn-sign-in-again-inline"
      >
        Sign in
      </button>
    </div>
  );
}
