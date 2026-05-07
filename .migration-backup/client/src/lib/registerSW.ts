/// <reference types="vite-plugin-pwa/client" />

type AcceptUpdate = () => Promise<void>;
type UpdateHandler = (acceptUpdate: AcceptUpdate) => void;

const FLAG_ENABLED =
  (import.meta.env.VITE_OFFLINE_SERVICE_WORKER ?? "true") !== "false";

let initialized = false;
let activeUpdateHandler: UpdateHandler | null = null;
let pendingAcceptUpdate: AcceptUpdate | null = null;

export function isOfflineServiceWorkerEnabled(): boolean {
  return FLAG_ENABLED;
}

export function setUpdateHandler(handler: UpdateHandler | null): void {
  activeUpdateHandler = handler;
  if (handler && pendingAcceptUpdate) {
    const accept = pendingAcceptUpdate;
    pendingAcceptUpdate = null;
    handler(accept);
  }
}

type InitOptions = { onNeedRefresh?: UpdateHandler };

export async function initServiceWorker(options: InitOptions = {}): Promise<void> {
  if (options.onNeedRefresh) setUpdateHandler(options.onNeedRefresh);
  if (initialized) return;
  initialized = true;

  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

  // Rollback path when the feature flag is OFF.
  if (!FLAG_ENABLED) {
    try {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
      if (typeof caches !== "undefined") {
        const names = await caches.keys();
        await Promise.all(names.map((n) => caches.delete(n)));
      }
    } catch (err) {
      console.warn("[sw] cleanup failed while flag is off:", err);
    }
    return;
  }

  try {
    const { registerSW } = await import("virtual:pwa-register");
    const updateSW = registerSW({
      immediate: true,
      onNeedRefresh() {
        const accept: AcceptUpdate = async () => {
          await updateSW(true);
        };
        if (activeUpdateHandler) activeUpdateHandler(accept);
        else pendingAcceptUpdate = accept;
      },
      onRegisterError(err) {
        console.warn("[sw] registration failed:", err);
      },
    });
  } catch (err) {
    console.warn("[sw] register module load failed:", err);
  }
}
