import { useEffect, useState } from "react";

import { subscribeConflict } from "./engine";
import { isOnline, subscribeOnline } from "./network";
import {
  type QueueEntry,
  ensureLoaded,
  snapshotEntries,
  subscribe as subscribeQueue,
} from "./queue";

export type SyncStatusSummary = {
  online: boolean;
  pending: number;
  failed: number;
  conflict: number;
  total: number;
  entries: QueueEntry[];
};

function summarize(entries: QueueEntry[], online: boolean): SyncStatusSummary {
  let pending = 0;
  let failed = 0;
  let conflict = 0;
  for (const e of entries) {
    if (e.status === "pending") pending++;
    else if (e.status === "failed") failed++;
    else if (e.status === "conflict") conflict++;
  }
  return {
    online,
    pending,
    failed,
    conflict,
    total: entries.length,
    entries,
  };
}

export function useSyncStatus(): SyncStatusSummary {
  const [entries, setEntries] = useState<QueueEntry[]>(() => snapshotEntries());
  const [online, setOnline] = useState<boolean>(() => isOnline());

  useEffect(() => {
    let active = true;
    ensureLoaded().then(() => {
      if (active) setEntries(snapshotEntries());
    });
    const unsubQueue = subscribeQueue((next) => {
      if (active) setEntries(next);
    });
    const unsubOnline = subscribeOnline((next) => {
      if (active) setOnline(next);
    });
    return () => {
      active = false;
      unsubQueue();
      unsubOnline();
    };
  }, []);

  return summarize(entries, online);
}

/**
 * Tick whenever the engine surfaces a 409 conflict for a queue entry
 * matching `scope`. Screens use this to flip their "edited in office —
 * refresh" banner when a background drain encounters the conflict
 * (their inline mutation handler covers the foreground path).
 *
 * `scope` is the same string the helpers pass as `scopeKey` to
 * `enqueue` (e.g. `wc:123`, `bs:45`). Pass `null` to disable.
 */
export function useScopeConflictTick(scope: string | null): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (scope == null) return;
    return subscribeConflict((entry) => {
      if (entry.scopeKey === scope) {
        setTick((n) => n + 1);
      }
    });
  }, [scope]);
  return tick;
}
