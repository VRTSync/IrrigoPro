import { useState } from "react";
import { QueueView } from "@/components/offline/sync-ui";
import { useDocOffline } from "./doc-offline-context";

export function DocSyncStatus() {
  const { online, queuedCount, failedCount } = useDocOffline();
  const [open, setOpen] = useState(false);
  return <>
    {!online ? <div className="rounded-xl border border-amber-300 bg-amber-100 p-3 text-sm text-amber-900" data-testid="strip-doc-offline">
      You're offline. Changes are saved on this phone and will sync when you're back in service.
    </div> : queuedCount > 0 ? <div className="rounded-xl bg-blue-50 p-3 text-sm text-blue-900" data-testid="strip-doc-syncing">Syncing {queuedCount} change{queuedCount === 1 ? "" : "s"}…</div> : null}
    {failedCount > 0 && <button className="min-h-11 text-left text-sm text-red-700 underline" onClick={() => setOpen(true)}>{failedCount} change{failedCount === 1 ? "" : "s"} didn't sync</button>}
    <QueueView open={open} onOpenChange={setOpen} />
  </>;
}
