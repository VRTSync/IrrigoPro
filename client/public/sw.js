// Service Worker for Push Notifications
const CACHE_NAME = 'irrigation-app-v1';

// Install event
self.addEventListener('install', (event) => {
  console.log('Service Worker installing');
  self.skipWaiting();
});

// Activate event
self.addEventListener('activate', (event) => {
  console.log('Service Worker activating');
  event.waitUntil(clients.claim());
});

// Push event - handle incoming push notifications
self.addEventListener('push', (event) => {
  console.log('Push event received:', event);
  
  const options = {
    body: 'You have new updates',
    icon: '/LOGO - SPREAD-05_1752764989944.png',
    badge: '/LOGO - SPREAD-05_1752764989944.png',
    vibrate: [200, 100, 200],
    data: {
      dateOfArrival: Date.now(),
      primaryKey: 1
    },
    actions: [
      {
        action: 'explore',
        title: 'View Details',
        icon: '/LOGO - SPREAD-05_1752764989944.png'
      },
      {
        action: 'close',
        title: 'Close',
        icon: '/LOGO - SPREAD-05_1752764989944.png'
      }
    ]
  };

  let notificationData = {
    title: 'Irrigation Management',
    ...options
  };

  if (event.data) {
    try {
      const payload = event.data.json();
      notificationData = {
        title: payload.title || 'Irrigation Management',
        body: payload.message || payload.body || 'You have new updates',
        icon: '/LOGO - SPREAD-05_1752764989944.png',
        badge: '/LOGO - SPREAD-05_1752764989944.png',
        vibrate: [200, 100, 200],
        data: {
          ...payload,
          dateOfArrival: Date.now()
        },
        actions: [
          {
            action: 'view',
            title: 'View',
            icon: '/LOGO - SPREAD-05_1752764989944.png'
          }
        ]
      };
    } catch (e) {
      console.error('Error parsing push data:', e);
    }
  }

  event.waitUntil(
    self.registration.showNotification(notificationData.title, notificationData)
  );
});

// Notification click event
self.addEventListener('notificationclick', (event) => {
  console.log('Notification clicked:', event);
  
  event.notification.close();

  if (event.action === 'close') {
    return;
  }

  // Open or focus the app
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // If app is already open, focus it
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      
      // Otherwise open a new window
      if (clients.openWindow) {
        return clients.openWindow('/');
      }
    })
  );
});

// Background sync for offline notifications
self.addEventListener('sync', (event) => {
  console.log('Background sync:', event.tag);
  
  if (event.tag === 'notification-sync') {
    event.waitUntil(syncNotifications());
  }
});

async function syncNotifications() {
  try {
    // Fetch pending notifications when back online
    const response = await fetch('/api/notifications/pending');
    const notifications = await response.json();
    
    notifications.forEach(notification => {
      self.registration.showNotification(notification.title, {
        body: notification.message,
        icon: '/LOGO - SPREAD-05_1752764989944.png',
        badge: '/LOGO - SPREAD-05_1752764989944.png',
        data: notification
      });
    });
  } catch (error) {
    console.error('Error syncing notifications:', error);
  }
}