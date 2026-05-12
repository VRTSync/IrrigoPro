export class OfflineQueuedError extends Error {
  readonly offlineQueued = true;
  constructor(message = "Saved locally — will sync when back online") {
    super(message);
    this.name = "OfflineQueuedError";
  }
}

export function isOfflineQueuedResult(value: unknown): boolean {
  return (
    value != null &&
    typeof value === "object" &&
    (value as { _offlineQueued?: unknown })._offlineQueued === true
  );
}
