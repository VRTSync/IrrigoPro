import { useEffect, useRef, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { initServiceWorker, isOfflineServiceWorkerEnabled } from "@/lib/registerSW";

// Mounted at App root for every role so push delivery keeps working.
// Defer until after first paint so a slow SW registration cannot block
// React rendering.
export function ServiceWorkerRegistration() {
  const startedRef = useRef(false);
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    const run = () => {
      void initServiceWorker().catch((err) => {
        console.warn("[boot] service worker init failed:", err);
      });
    };
    if (typeof window !== "undefined" && document.readyState !== "complete") {
      window.addEventListener("load", () => setTimeout(run, 0), { once: true });
    } else {
      setTimeout(run, 0);
    }
  }, []);
  return null;
}

// Visible "Updating app…" splash so the brief blank moment between the
// SW skipWaiting() and the new shell loading isn't indistinguishable
// from a white-screen failure on a slow connection.
function UpdatingSplash() {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 99999,
        background: "rgba(249,250,251,0.98)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      }}
    >
      <div style={{ textAlign: "center" }}>
        <div
          style={{
            width: 48,
            height: 48,
            margin: "0 auto 16px",
            border: "4px solid #e5e7eb",
            borderTopColor: "#1E5A99",
            borderRadius: "50%",
            animation: "irrigo-spin 1s linear infinite",
          }}
        />
        <p style={{ color: "#374151", fontSize: 15, margin: 0 }}>Updating app…</p>
        <style>{`@keyframes irrigo-spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    </div>
  );
}

// Mounted only inside the field-tech layout — installs the update toast.
//
// Field techs were getting stranded on a blank shell when the SW would
// silently auto-reload them on a slow connection. We now (a) require an
// explicit user tap on "Reload", (b) only proceed when navigator.onLine,
// and (c) show a visible "Updating app…" splash so a failed shell fetch
// isn't indistinguishable from a white screen.
export function ServiceWorkerUpdatePrompt() {
  const { toast } = useToast();
  const startedRef = useRef(false);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    if (!isOfflineServiceWorkerEnabled()) return;
    void initServiceWorker({
      onNeedRefresh: (acceptUpdate) => {
        const triggerUpdate = () => {
          if (typeof navigator !== "undefined" && navigator.onLine === false) {
            console.warn("[sw] update declined — offline; will retry next time");
            toast({
              title: "You're offline",
              description: "Reconnect, then tap Reload to update.",
              duration: 6_000,
            });
            return;
          }
          console.log("[sw] update accepted by user");
          setUpdating(true);
          // Safety net: if the new shell never loads (slow/dropped
          // connection), drop the splash so the user can retry rather
          // than staring at it forever.
          window.setTimeout(() => setUpdating(false), 15_000);
          void acceptUpdate().catch((err) => {
            console.warn("[sw] update failed to apply:", err);
            setUpdating(false);
          });
        };
        toast({
          title: "New version available",
          description: "Reload to get the latest field tools.",
          duration: 30_000,
          action: (
            <ToastAction altText="Reload to update" onClick={triggerUpdate}>
              Reload
            </ToastAction>
          ),
        });
      },
    });
  }, [toast]);

  return updating ? <UpdatingSplash /> : null;
}
