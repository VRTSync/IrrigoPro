// Network connectivity tracker for the M8 offline queue (Task #493).
//
// Source of truth is `@react-native-community/netinfo` so the sync
// pill, drain triggers, and Force Resync UX react instantly to
// connectivity changes — even when the queue is empty and no mutation
// has been attempted recently. Reconnect events drive `drainQueue()`
// via `subscribeReconnect`.
//
// We still expose `setOnline` so the engine can fold in
// optimistic-online evidence from successful sends and
// optimistic-offline evidence from network-error throws (NetInfo on
// some platforms reports "connected" while the actual transport is
// dead, e.g. captive portals). Either source flipping the flag fans
// out to subscribers.

import NetInfo, { type NetInfoState } from "@react-native-community/netinfo";

type Listener = (online: boolean) => void;
type ReconnectListener = () => void;

let online = true;
let netInfoStarted = false;
let netInfoUnsub: (() => void) | null = null;
const listeners = new Set<Listener>();
const reconnectListeners = new Set<ReconnectListener>();

export function isOnline(): boolean {
  return online;
}

export function subscribeOnline(cb: Listener): () => void {
  listeners.add(cb);
  cb(online);
  return () => {
    listeners.delete(cb);
  };
}

/**
 * Fire `cb` whenever the device transitions from offline → online.
 * The engine uses this to drain the queue immediately when service
 * comes back, without waiting for the next AppState wake or the 30s
 * interval.
 */
export function subscribeReconnect(cb: ReconnectListener): () => void {
  reconnectListeners.add(cb);
  return () => {
    reconnectListeners.delete(cb);
  };
}

function emit(): void {
  for (const cb of listeners) {
    try {
      cb(online);
    } catch {
      /* listener errors must not break the tracker */
    }
  }
}

function fireReconnect(): void {
  for (const cb of reconnectListeners) {
    try {
      cb();
    } catch {
      /* listener errors must not break the tracker */
    }
  }
}

function applyState(next: boolean): void {
  if (online === next) return;
  const wasOffline = !online;
  online = next;
  emit();
  if (next && wasOffline) fireReconnect();
}

export function setOnline(next: boolean): void {
  applyState(next);
}

function deriveOnline(state: NetInfoState): boolean {
  // `isInternetReachable` is `null` on first event before NetInfo has
  // probed; treat unknown as "trust isConnected" so we don't flicker
  // to offline at startup. Once we have a definitive `false` we honor
  // it (captive portal / WiFi-without-internet).
  if (state.isConnected === false) return false;
  if (state.isInternetReachable === false) return false;
  return true;
}

/**
 * Subscribe to NetInfo. Idempotent — wired in `useSyncEngine`. Returns
 * a teardown so React can clean up on unmount.
 */
export function startNetworkTracking(): () => void {
  if (netInfoStarted) return () => undefined;
  netInfoStarted = true;
  // Seed with a one-shot fetch so the very first render doesn't lie.
  NetInfo.fetch()
    .then((state) => applyState(deriveOnline(state)))
    .catch(() => undefined);
  netInfoUnsub = NetInfo.addEventListener((state) => {
    applyState(deriveOnline(state));
  });
  return () => {
    netInfoStarted = false;
    if (netInfoUnsub) {
      netInfoUnsub();
      netInfoUnsub = null;
    }
  };
}

// Re-exported from the pure helper so callers that already import from
// `./network` keep working without changes.
export { isNetworkError } from "./network-error";
