import { useEffect, useState } from "react";
import { X, Info, AlertTriangle } from "lucide-react";

export const KEY_PREFIX = "irrigopro:help-dismissed:v1:";

function storageKey(guideId: string): string {
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem("user") : null;
    if (raw) {
      const u: unknown = JSON.parse(raw);
      if (u !== null && typeof u === "object" && "id" in u && (u as Record<string, unknown>).id != null) {
        return `${KEY_PREFIX}${(u as Record<string, unknown>).id}:${guideId}`;
      }
    }
  } catch { /* fall through */ }
  return `${KEY_PREFIX}anon:${guideId}`;
}

export function isHelpDismissed(guideId: string): boolean {
  try {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(storageKey(guideId)) === "1";
  } catch {
    return false;
  }
}

export function resetHelpDismissal(guideId: string): void {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(storageKey(guideId));
  } catch { /* ignore */ }
}

const VARIANT_CLASSES: Record<string, {
  container: string;
  iconColor: string;
  dismissColor: string;
}> = {
  info: {
    container: "bg-emerald-50 border border-emerald-200 text-emerald-800",
    iconColor: "text-emerald-600",
    dismissColor: "text-emerald-400 hover:text-emerald-700",
  },
  warning: {
    container: "bg-amber-50 border border-amber-200 text-amber-800",
    iconColor: "text-amber-600",
    dismissColor: "text-amber-400 hover:text-amber-700",
  },
};

export interface DismissibleHelpProps {
  guideId: string;
  variant?: "info" | "warning";
  persistDismissal?: boolean;
  children: React.ReactNode;
}

export function DismissibleHelp({
  guideId,
  variant = "info",
  persistDismissal = true,
  children,
}: DismissibleHelpProps) {
  const [dismissed, setDismissed] = useState(() => {
    try { return isHelpDismissed(guideId); } catch { return false; }
  });

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDismissed(true);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const handleDismiss = () => {
    setDismissed(true);
    if (persistDismissal) {
      try {
        if (typeof window !== "undefined") {
          window.localStorage.setItem(storageKey(guideId), "1");
        }
      } catch { /* ignore */ }
    }
  };

  if (dismissed) return null;

  const cls = VARIANT_CLASSES[variant] ?? VARIANT_CLASSES.info;
  const Icon = variant === "warning" ? AlertTriangle : Info;

  return (
    <div
      role="note"
      data-testid={`help-${guideId}`}
      className={`rounded-lg px-4 py-3 flex items-start gap-3 ${cls.container}`}
    >
      <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${cls.iconColor}`} aria-hidden="true" />
      <div className="flex-1 text-sm">{children}</div>
      <button
        type="button"
        data-testid={`help-dismiss-${guideId}`}
        aria-label="Dismiss"
        onClick={handleDismiss}
        className={`shrink-0 ${cls.dismissColor}`}
      >
        <X className="w-4 h-4" aria-hidden="true" />
      </button>
    </div>
  );
}
