import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { notificationService } from "./lib/notifications";

// Initialize notification service
notificationService.initialize().then((initialized) => {
  if (initialized) {
    console.log('Notification service initialized');
  }
});

createRoot(document.getElementById("root")!).render(<App />);
