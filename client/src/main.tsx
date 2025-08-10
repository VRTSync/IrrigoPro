import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { notificationService } from "./lib/notifications";


// Initialize notification service with error handling
notificationService.initialize().then((initialized) => {
  if (initialized) {
    console.log('Notification service initialized');
  }
}).catch((error) => {
  console.error('Failed to initialize notification service:', error);
});

createRoot(document.getElementById("root")!).render(<App />);
