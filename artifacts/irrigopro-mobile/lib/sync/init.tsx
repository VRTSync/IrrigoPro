// Wires the sync engine into the React tree (Task #493 / M8).
//
// On mount:
//   * Hydrates the React Query cache from AsyncStorage so the app
//     opens with last-known data offline.
//   * Attaches the query-cache persister so subsequent fetches re-write
//     the persisted snapshot.
//   * Registers AppState + interval triggers that drain the offline
//     mutation queue.

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { AppState } from "react-native";

import { useAuth } from "../auth-context";
import {
  attachQueryPersistence,
  clearPersistedCache,
  hydrateQueryClient,
  setActiveCacheSession,
} from "./cache-persistence";
import { drainQueue, setEngineQueryClient } from "./engine";
import { startNetworkTracking, subscribeReconnect } from "./network";
import { ensureLoaded, setActiveSession } from "./queue";

const DRAIN_INTERVAL_MS = 30_000;

/**
 * Hydrates persisted query cache, attaches the persister, and starts
 * AppState + interval drain triggers. Returns `true` once the
 * persisted cache has been loaded so the caller can hold splash until
 * we have offline data ready.
 */
export function useSyncEngine(): boolean {
  const qc = useQueryClient();
  const { user } = useAuth();
  const sessionId = user ? `u${user.id}` : null;
  const [hydrated, setHydrated] = useState(false);

  // Rebind queue + persisted cache to the current authenticated user.
  // Runs on every sign-in / sign-out / account-swap so no mutation is
  // ever drained against the wrong principal's token, and no stale
  // cached read leaks across users on a shared device.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await setActiveSession(sessionId);
      if (cancelled) return;
      if (sessionId == null) {
        // Sign-out: drop the old user's persisted reads from disk.
        await clearPersistedCache();
        qc.clear();
      } else {
        await setActiveCacheSession(qc, sessionId);
      }
      if (!cancelled) {
        // Drain immediately in case there are persisted entries waiting
        // for this session.
        drainQueue().catch(() => undefined);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [qc, sessionId]);

  useEffect(() => {
    let cancelled = false;
    setEngineQueryClient(qc);

    (async () => {
      await Promise.all([hydrateQueryClient(qc), ensureLoaded()]);
      if (!cancelled) setHydrated(true);
      // Best-effort drain on cold start.
      drainQueue().catch(() => undefined);
    })();

    const detachPersistence = attachQueryPersistence(qc);
    const detachNetwork = startNetworkTracking();
    const detachReconnect = subscribeReconnect(() => {
      // Service just came back — flush the queue immediately rather
      // than waiting for the next AppState wake or the 30s interval.
      drainQueue().catch(() => undefined);
    });

    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        drainQueue().catch(() => undefined);
      }
    });

    const interval = setInterval(() => {
      drainQueue().catch(() => undefined);
    }, DRAIN_INTERVAL_MS);

    return () => {
      cancelled = true;
      detachPersistence();
      detachReconnect();
      detachNetwork();
      sub.remove();
      clearInterval(interval);
      setEngineQueryClient(null);
    };
  }, [qc]);

  return hydrated;
}
