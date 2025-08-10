// Notification service for PWA push notifications
export class NotificationService {
  private static instance: NotificationService;
  private registration: ServiceWorkerRegistration | null = null;

  private constructor() {}

  static getInstance(): NotificationService {
    if (!NotificationService.instance) {
      NotificationService.instance = new NotificationService();
    }
    return NotificationService.instance;
  }

  // Initialize the notification service
  async initialize(): Promise<boolean> {
    if (!('serviceWorker' in navigator) || !('Notification' in window)) {
      console.log('Notifications not supported');
      return false;
    }

    try {
      this.registration = await navigator.serviceWorker.ready;
      console.log('Service Worker ready for notifications');
      return true;
    } catch (error) {
      console.error('Service Worker not ready:', error);
      return false;
    }
  }

  // Request notification permission
  async requestPermission(): Promise<NotificationPermission> {
    if (!('Notification' in window)) {
      return 'denied';
    }

    try {
      if (Notification.permission === 'granted') {
        return 'granted';
      }

      if (Notification.permission === 'denied') {
        return 'denied';
      }

      const permission = await Notification.requestPermission();
      return permission;
    } catch (error) {
      console.log('Notification permission request failed:', error);
      return 'denied';
    }
  }

  // Show a local notification
  async showNotification(title: string, options: NotificationOptions = {}): Promise<void> {
    const permission = await this.requestPermission();
    if (permission !== 'granted') {
      console.log('Notification permission denied');
      return;
    }

    if (!this.registration) {
      await this.initialize();
    }

    const defaultOptions: NotificationOptions = {
      icon: '/LOGO - SPREAD-05_1752764989944.png',
      badge: '/LOGO - SPREAD-05_1752764989944.png',
      tag: 'irrigation-notification',
      requireInteraction: false,
      ...options
    };

    if (this.registration) {
      await this.registration.showNotification(title, defaultOptions);
    } else {
      // Fallback to browser notification
      new Notification(title, defaultOptions);
    }
  }

  // Show work order notification
  async showWorkOrderNotification(workOrderNumber: string, message: string, type: 'assigned' | 'completed' | 'updated' = 'assigned'): Promise<void> {
    const icons = {
      assigned: '📋',
      completed: '✅',
      updated: '🔄'
    };

    const titles = {
      assigned: 'New Work Order Assigned',
      completed: 'Work Order Completed',
      updated: 'Work Order Updated'
    };

    await this.showNotification(titles[type], {
      body: `${icons[type]} ${workOrderNumber}: ${message}`,
      tag: `work-order-${workOrderNumber}`,
      data: {
        type: 'work_order',
        workOrderNumber,
        action: type
      }
    });
  }

  // Show billing notification
  async showBillingNotification(message: string, type: 'submitted' | 'approved' = 'submitted'): Promise<void> {
    const icons = {
      submitted: '💰',
      approved: '✅'
    };

    const titles = {
      submitted: 'Billing Sheet Submitted',
      approved: 'Billing Approved'
    };

    await this.showNotification(titles[type], {
      body: `${icons[type]} ${message}`,
      tag: 'billing-notification',
      data: {
        type: 'billing',
        action: type
      }
    });
  }

  // Update badge count (for supported browsers)
  async updateBadgeCount(count: number): Promise<void> {
    if ('setAppBadge' in navigator) {
      try {
        // @ts-ignore - setAppBadge is experimental
        await navigator.setAppBadge(count);
      } catch (error) {
        console.log('Badge API not supported:', error);
      }
    }
  }

  // Clear badge
  async clearBadge(): Promise<void> {
    if ('clearAppBadge' in navigator) {
      try {
        // @ts-ignore - clearAppBadge is experimental
        await navigator.clearAppBadge();
      } catch (error) {
        console.log('Badge API not supported:', error);
      }
    }
  }

  // Check if notifications are supported and enabled
  isSupported(): boolean {
    return 'Notification' in window && 'serviceWorker' in navigator;
  }

  // Get current permission status
  getPermissionStatus(): NotificationPermission {
    if (!('Notification' in window)) {
      return 'denied';
    }
    
    try {
      return Notification.permission;
    } catch (error) {
      return 'denied';
    }
  }
}

// Export singleton instance
export const notificationService = NotificationService.getInstance();