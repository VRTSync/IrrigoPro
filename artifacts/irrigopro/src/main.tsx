import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { notificationService } from "./lib/notifications";
import { getSyncEngine, isOfflineQueueEnabled } from "./lib/offline/engine";
import { setApiHeartbeat } from "./lib/queryClient";

// Slice 4B (Task #298): boot the offline mutation queue replay engine.
// Behind the OFFLINE_QUEUE feature flag (VITE_OFFLINE_QUEUE, default on).
if (isOfflineQueueEnabled()) {
  const engine = getSyncEngine();
  // Feed every apiRequest outcome into the engine so non-queue API
  // activity also updates online state, per spec.
  setApiHeartbeat((ok) => engine.setOnline(ok));
  void engine.start().catch((err) => {
    console.warn("[offline] sync engine failed to start:", err);
  });
}

// Initialize notification service with error handling
notificationService.initialize().then((initialized) => {
  if (initialized) {
    console.log('Notification service initialized');
  }
}).catch((error) => {
  console.error('Failed to initialize notification service:', error);
});

createRoot(document.getElementById("root")!).render(<App />);
