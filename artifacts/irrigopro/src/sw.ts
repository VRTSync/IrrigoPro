/// <reference lib="webworker" />
/* eslint-disable no-restricted-globals */

import { precacheAndRoute, cleanupOutdatedCaches } from "workbox-precaching";
import { registerRoute, setDefaultHandler } from "workbox-routing";
import { NetworkFirst, NetworkOnly } from "workbox-strategies";
import { ExpirationPlugin } from "workbox-expiration";
import { CacheableResponsePlugin } from "workbox-cacheable-response";

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

precacheAndRoute(self.__WB_MANIFEST || []);
cleanupOutdatedCaches();

// Default: pass everything not matched below straight to the network.
setDefaultHandler(new NetworkOnly());

const READ_CACHE_VERSION = "v1";

function networkFirstRead(name: string, maxEntries: number, maxAgeSeconds: number) {
  return new NetworkFirst({
    cacheName: `wc-${name}-${READ_CACHE_VERSION}`,
    networkTimeoutSeconds: 5,
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries, maxAgeSeconds, purgeOnQuotaError: true }),
    ],
  });
}

registerRoute(
  ({ url, request }) =>
    request.method === "GET" &&
    (url.pathname === "/api/parts" ||
      url.pathname === "/api/parts/field-tech" ||
      url.pathname === "/api/wet-checks/parts/by-issue"),
  networkFirstRead("parts", 50, 60 * 60 * 24 * 7),
);

registerRoute(
  ({ url, request }) =>
    request.method === "GET" && url.pathname === "/api/wet-checks/issue-types",
  networkFirstRead("issue-types", 10, 60 * 60 * 24 * 7),
);

registerRoute(
  ({ url, request }) =>
    request.method === "GET" &&
    /^\/api\/properties\/\d+\/controllers$/.test(url.pathname),
  networkFirstRead("controllers", 100, 60 * 60 * 24 * 7),
);

registerRoute(
  ({ url, request }) =>
    request.method === "GET" && /^\/api\/wet-checks\/\d+$/.test(url.pathname),
  networkFirstRead("wet-check-detail", 25, 60 * 60 * 24 * 3),
);

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

// Push handlers ported from the previous client/public/sw.js.
self.addEventListener("push", (event: PushEvent) => {
  const defaults = {
    body: "You have new updates",
    icon: "/IrrigoPro_2026-05_1778193170303.png",
    badge: "/IrrigoPro_2026-05_1778193170303.png",
    vibrate: [200, 100, 200] as number[],
    data: { dateOfArrival: Date.now(), primaryKey: 1 },
    actions: [
      { action: "view", title: "View" },
      { action: "close", title: "Close" },
    ],
  };

  let title = "Irrigation Management";
  let options: NotificationOptions = { ...defaults };

  if (event.data) {
    try {
      const payload = event.data.json();
      title = payload.title || title;
      options = {
        ...defaults,
        body: payload.message || payload.body || defaults.body,
        data: { ...payload, dateOfArrival: Date.now() },
      };
    } catch (e) {
      console.error("[sw] push payload parse failed", e);
    }
  }

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event: NotificationEvent) => {
  event.notification.close();
  if (event.action === "close") return;
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if (client.url.includes(self.location.origin) && "focus" in client) {
            return (client as WindowClient).focus();
          }
        }
        if (self.clients.openWindow) return self.clients.openWindow("/");
        return undefined;
      }),
  );
});

self.addEventListener("sync", (event: SyncEvent) => {
  if (event.tag === "notification-sync") {
    event.waitUntil(syncNotifications());
  }
});

async function syncNotifications(): Promise<void> {
  try {
    const response = await fetch("/api/notifications/pending");
    const notifications = await response.json();
    notifications.forEach((notification: { title: string; message: string }) => {
      self.registration.showNotification(notification.title, {
        body: notification.message,
        icon: "/IrrigoPro_2026-05_1778193170303.png",
        badge: "/IrrigoPro_2026-05_1778193170303.png",
        data: notification,
      });
    });
  } catch (error) {
    console.error("[sw] notification sync failed", error);
  }
}

self.addEventListener("install", () => {
  // No auto skipWaiting — wait for SKIP_WAITING from the page.
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});
