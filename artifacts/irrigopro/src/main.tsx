import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { AppErrorBoundary } from "./components/error-boundary";

// Render React first. Anything that touches IndexedDB, the service worker,
// notifications, or the network must NOT run at module scope — a thrown
// error here yields a permanent white screen on field-tech phones.
function mount() {
  const root = document.getElementById("root");
  if (!root) {
    console.error("[boot] #root element missing from index.html");
    return;
  }
  try {
    createRoot(root).render(
      <AppErrorBoundary>
        <App />
      </AppErrorBoundary>,
    );
  } catch (err) {
    console.error("[boot] React mount failed:", err);
    root.innerHTML =
      '<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:sans-serif;padding:24px;text-align:center;color:#111">' +
      "<div><h1 style=\"font-size:18px;margin-bottom:12px\">Something went wrong loading the app</h1>" +
      '<button onclick="window.location.reload()" style="background:#1E5A99;color:white;border:none;border-radius:8px;padding:10px 20px;font-size:15px;cursor:pointer">Reload</button></div></div>';
  }
}

mount();

// Defer all heavy / failure-prone bootstrapping until after first paint so a
// thrown IndexedDB / dynamic-import / notification error cannot strand the
// page on a blank shell. Each side-effect is independently guarded.
function deferredBoot() {
  // Offline mutation queue replay engine (Slice 4B / Task #298). Behind the
  // OFFLINE_QUEUE feature flag (VITE_OFFLINE_QUEUE, default on).
  void (async () => {
    try {
      const { getSyncEngine, isOfflineQueueEnabled } = await import(
        "./lib/offline/engine"
      );
      const { setApiHeartbeat } = await import("./lib/queryClient");
      if (!isOfflineQueueEnabled()) return;
      const engine = getSyncEngine();
      setApiHeartbeat((ok) => engine.setOnline(ok));
      await engine.start();
    } catch (err) {
      console.warn("[boot] offline sync engine failed to start:", err);
    }
  })();

  // Push-notification service registration — purely opportunistic; failures
  // here must never block app render.
  void (async () => {
    try {
      const { notificationService } = await import("./lib/notifications");
      const ok = await notificationService.initialize();
      if (ok) console.log("[boot] notification service initialized");
    } catch (err) {
      console.warn("[boot] notification service init failed:", err);
    }
  })();
}

if (typeof window !== "undefined") {
  if (document.readyState === "complete") {
    setTimeout(deferredBoot, 0);
  } else {
    window.addEventListener("load", () => setTimeout(deferredBoot, 0), {
      once: true,
    });
  }
}
