// Slice 4D — Surface engine conflict (409) and persistent error (4xx)
// events as non-blocking toasts. Mounted once near the app root so
// conflicts triggered on any page are visible to the field tech without
// the page having to subscribe.
//
// Behaviour vs. the original 4B bridge:
//   • Gated behind the OFFLINE_SYNC_UI flag so flipping the UI off
//     hides the toasts (the engine still drains in the background).
//   • Conflict toast is non-blocking and includes a "View what they
//     did" action — it navigates to /wet-checks/:id and invalidates
//     the cached query so the latest server-wins data renders.
//   • Per-mutation dedupe: each mutationId only toasts once.
import { useEffect, useRef } from "react";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { queryClient } from "@/lib/queryClient";
import {
  getSyncEngine,
  isOfflineQueueEnabled,
  isOfflineSyncUIEnabled,
} from "@/lib/offline/engine";
import type { EngineEvent } from "@/lib/offline/types";

export function ConflictToastBridge() {
  const { toast } = useToast();
  const seenRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!isOfflineQueueEnabled()) return;
    if (!isOfflineSyncUIEnabled()) return;
    const engine = getSyncEngine();
    const seen = seenRef.current;
    const off = engine.on((e: EngineEvent) => {
      if (e.type === "conflict") {
        if (seen.has(e.mutationId)) return;
        seen.add(e.mutationId);
        console.warn(
          "[offline-engine] conflict",
          { mutationId: e.mutationId, kind: e.kind, wetCheckId: e.wetCheckId, message: e.message },
        );
        const wcId = e.wetCheckId;
        toast({
          title: "Someone else changed this first",
          description: e.message
            ? `${e.kind}: server kept its version. ${e.message.slice(0, 160)}`
            : `${e.kind}: server kept its version.`,
          duration: 12_000,
          action: wcId
            ? (
              <ToastAction
                altText="View what they did"
                onClick={() => {
                  // Refresh the wet check from server-wins mirror and
                  // navigate the user to it. Using window.location keeps
                  // this bridge router-agnostic.
                  queryClient.invalidateQueries({ queryKey: ["/api/wet-checks"] });
                  if (typeof window !== "undefined") {
                    const target = `/wet-checks/${wcId}`;
                    if (window.location.pathname !== target) {
                      window.location.assign(target);
                    }
                  }
                }}
              >
                View what they did
              </ToastAction>
            )
            : undefined,
        });
      } else if (e.type === "error") {
        if (seen.has(`err:${e.mutationId}`)) return;
        seen.add(`err:${e.mutationId}`);
        console.warn(
          "[offline-engine] mutation failed",
          { mutationId: e.mutationId, kind: e.kind, status: e.status, message: e.message },
        );
        toast({
          title: "Sync failed",
          description: `${e.kind} (${e.status ?? "?"}): ${(e.message ?? "").slice(0, 200)}`,
          variant: "destructive",
          duration: 12_000,
        });
      }
    });
    return () => { off(); };
  }, [toast]);
  return null;
}
