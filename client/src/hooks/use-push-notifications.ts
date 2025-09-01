import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { notificationService } from '@/lib/notifications';

interface NotificationData {
  id: number;
  type: string;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
}

export function usePushNotifications(userId: number | undefined) {
  // Get notification count
  const { data: notificationCount } = useQuery<{ count: number }>({
    queryKey: ["/api/notifications", userId, "count"],
    enabled: !!userId,
    refetchInterval: 60000, // Check every 60 seconds
  });

  // Get all notifications to check for new ones
  const { data: notifications, dataUpdatedAt } = useQuery<NotificationData[]>({
    queryKey: ["/api/notifications", userId],
    enabled: !!userId,
    refetchInterval: 120000, // Check every 2 minutes
  });

  // Update badge count when notification count changes
  useEffect(() => {
    if (notificationCount?.count !== undefined) {
      notificationService.updateBadgeCount(notificationCount.count);
    }
  }, [notificationCount?.count]);

  // Check for new notifications and show push notifications
  useEffect(() => {
    if (!notifications || !userId) return;

    // Get the most recent unread notification
    const recentNotifications = notifications
      .filter(n => !n.isRead)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 3); // Only check the 3 most recent

    // Check if we have permission and if the app is in background
    if (document.hidden || !document.hasFocus()) {
      recentNotifications.forEach(notification => {
        // Show push notification for work order assignments
        if (notification.type === 'work_order_assigned') {
          notificationService.showWorkOrderNotification(
            notification.title,
            notification.message,
            'assigned'
          );
        }
        // Show push notification for work order completions
        else if (notification.type === 'work_order_completed') {
          notificationService.showWorkOrderNotification(
            notification.title,
            notification.message,
            'completed'
          );
        }
        // Show generic notification for other types
        else {
          notificationService.showNotification(notification.title, {
            body: notification.message,
            tag: `notification-${notification.id}`,
            data: {
              notificationId: notification.id,
              type: notification.type
            }
          });
        }
      });
    }
  }, [notifications, dataUpdatedAt, userId]);

  // Request permission on first use
  useEffect(() => {
    if (userId && notificationService.isSupported()) {
      notificationService.requestPermission().then(permission => {
        console.log('Push notification permission:', permission);
      }).catch(error => {
        console.log('Failed to request notification permission:', error);
      });
    }
  }, [userId]);

  return {
    notificationCount: notificationCount?.count || 0,
    hasNotifications: (notificationCount?.count || 0) > 0,
    isSupported: notificationService.isSupported(),
    permission: notificationService.getPermissionStatus()
  };
}