import { useState, useEffect } from 'react';
import { Bell, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { notificationService } from '@/lib/notifications';

export function NotificationPermissionBanner() {
  const [show, setShow] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>('default');

  useEffect(() => {
    // Check if we should show the banner
    const checkPermission = () => {
      const currentPermission = notificationService.getPermissionStatus();
      setPermission(currentPermission);
      
      // Show banner if permission is default and we haven't asked before
      const hasAskedBefore = localStorage.getItem('notification-permission-asked');
      if (currentPermission === 'default' && !hasAskedBefore && notificationService.isSupported()) {
        setShow(true);
      }
    };

    checkPermission();
  }, []);

  const handleEnable = async () => {
    const newPermission = await notificationService.requestPermission();
    setPermission(newPermission);
    localStorage.setItem('notification-permission-asked', 'true');
    setShow(false);
  };

  const handleDismiss = () => {
    localStorage.setItem('notification-permission-asked', 'true');
    setShow(false);
  };

  if (!show || permission !== 'default') {
    return null;
  }

  return (
    <Card className="fixed top-4 right-4 z-50 max-w-sm bg-white border border-blue-200 shadow-lg">
      <div className="p-4">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0">
            <Bell className="h-6 w-6 text-blue-600" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-gray-900">
              Enable Notifications
            </h3>
            <p className="text-sm text-gray-600 mt-1">
              Get instant notifications for new work assignments and updates, even when the app is closed.
            </p>
            <div className="flex gap-2 mt-3">
              <Button
                size="sm"
                onClick={handleEnable}
                className="bg-blue-600 hover:bg-blue-700"
              >
                Enable
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleDismiss}
              >
                Not now
              </Button>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDismiss}
            className="flex-shrink-0 h-6 w-6 p-0"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </Card>
  );
}