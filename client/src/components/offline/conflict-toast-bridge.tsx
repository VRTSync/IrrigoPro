// Slice 4B — Surface engine conflict (409) and persistent error (4xx)
// events as toasts + console logs. Mounted once near the app root so
// conflicts triggered on any page are visible to the field tech without
// the page having to subscribe.
import { useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { getSyncEngine, isOfflineQueueEnabled } from "@/lib/offline/engine";
import type { EngineEvent } from "@/lib/offline/types";

export function ConflictToastBridge() {
  const { toast } = useToast();
  useEffect(() => {
    if (!isOfflineQueueEnabled()) return;
    const engine = getSyncEngine();
    const off = engine.on((e: EngineEvent) => {
      if (e.type === "conflict") {
        console.warn(
          "[offline-engine] conflict",
          { mutationId: e.mutationId, kind: e.kind, wetCheckId: e.wetCheckId, message: e.message },
        );
        toast({
          title: "Sync conflict — server kept its version",
          description: e.message
            ? `${e.kind}: ${e.message.slice(0, 200)}`
            : `${e.kind}: a newer change exists on the server.`,
          variant: "destructive",
        });
      } else if (e.type === "error") {
        console.warn(
          "[offline-engine] mutation failed",
          { mutationId: e.mutationId, kind: e.kind, status: e.status, message: e.message },
        );
        toast({
          title: "Sync failed",
          description: `${e.kind} (${e.status ?? "?"}): ${(e.message ?? "").slice(0, 200)}`,
          variant: "destructive",
        });
      }
    });
    return () => { off(); };
  }, [toast]);
  return null;
}
