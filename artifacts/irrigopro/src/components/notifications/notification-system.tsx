import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Bell, X, CheckCircle, Clock, FileText, XCircle, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Sheet, SheetContent, SheetTrigger, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { apiRequest, adaptiveRefetchInterval } from "@/lib/queryClient";
import { formatDistanceToNow } from "date-fns";
import { usePushNotifications } from "@/hooks/use-push-notifications";

interface Notification {
  id: number;
  userId: number;
  type: string;
  title: string;
  message: string;
  relatedEntityType?: string;
  relatedEntityId?: number;
  isRead: boolean;
  createdAt: string;
}

interface NotificationSystemProps {
  userId: number;
}

export function NotificationSystem({ userId }: NotificationSystemProps) {
  const [isOpen, setIsOpen] = useState(false);
  const queryClient = useQueryClient();
  
  // Initialize push notifications
  const { notificationCount, isSupported, permission } = usePushNotifications(userId);

  // Task #532 — connection-aware polling so techs on bad cell signal don't
  // pay a 30s notification poll on top of whatever they're actually doing.
  const notifyPollMs = adaptiveRefetchInterval(30_000);

  // Fetch notifications.
  //
  // Task #539 — the workspace `getQueryFn` default returns `null` on a
  // 401 response (so logged-out probes don't throw), which means the
  // `data: notifications = []` destructure default DOES NOT kick in for
  // an unauthenticated session — `notifications` would be `null`, not
  // `[]`. Calling `.some(...)` / `.map(...)` / `.length` on that null
  // is exactly the "null is not an object (evaluating 'i.some')" cold-
  // load crash captured by the new error boundary. Coerce to a real
  // array here before any render-time array method touches it.
  const { data: notificationsRaw } = useQuery<Notification[] | null>({
    queryKey: ["/api/notifications", userId],
    queryFn: () => apiRequest(`/api/notifications/${userId}`, "GET"),
    refetchInterval: notifyPollMs,
  });
  const notifications: Notification[] = Array.isArray(notificationsRaw)
    ? notificationsRaw
    : [];

  // Fetch unread count
  const { data: countData } = useQuery<{ count: number }>({
    queryKey: ["/api/notifications/count", userId],
    queryFn: () => apiRequest(`/api/notifications/${userId}/count`, "GET"),
    refetchInterval: notifyPollMs,
  });

  const unreadCount = countData?.count || 0;

  // Mark notification as read
  const markAsReadMutation = useMutation({
    mutationFn: (notificationId: number) =>
      apiRequest(`/api/notifications/${notificationId}/read`, "PUT"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications", userId] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications/count", userId] });
    },
  });

  // Mark all as read
  const markAllAsReadMutation = useMutation({
    mutationFn: () =>
      apiRequest(`/api/notifications/${userId}/read-all`, "PUT"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications", userId] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications/count", userId] });
    },
  });

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case "work_order_assigned":
        return <Clock className="h-4 w-4 text-blue-600" />;
      case "work_order_completed":
        return <CheckCircle className="h-4 w-4 text-green-600" />;
      case "estimate_approved":
        return <CheckCircle className="h-4 w-4 text-green-600" />;
      case "estimate_rejected":
        return <XCircle className="h-4 w-4 text-red-500" />;
      case "billing_sheet_submitted":
        return <Receipt className="h-4 w-4 text-orange-600" />;
      case "estimate_pending_approval":
        return <FileText className="h-4 w-4 text-orange-600" />;
      case "part_pending_approval":
      case "manual_part_pending_review":
        return <Receipt className="h-4 w-4 text-amber-600" />;
      default:
        return <Bell className="h-4 w-4 text-gray-600" />;
    }
  };

  const getNotificationColor = (type: string) => {
    switch (type) {
      case "work_order_assigned":
        return "bg-blue-50 border-blue-200";
      case "work_order_completed":
        return "bg-green-50 border-green-200";
      case "estimate_approved":
        return "bg-green-50 border-green-200";
      case "estimate_rejected":
        return "bg-red-50 border-red-200";
      case "billing_sheet_submitted":
        return "bg-orange-50 border-orange-200";
      case "estimate_pending_approval":
        return "bg-orange-50 border-orange-200";
      case "part_pending_approval":
      case "manual_part_pending_review":
        return "bg-amber-50 border-amber-200";
      default:
        return "bg-gray-50 border-gray-200";
    }
  };

  const handleNotificationClick = (notification: Notification) => {
    if (!notification.isRead) {
      markAsReadMutation.mutate(notification.id);
    }
    
    // Navigate to related entity if available
    if (notification.type === "part_pending_approval" || notification.type === "manual_part_pending_review") {
      setIsOpen(false);
      window.location.href = "/parts-pending-approval";
      return;
    }

    if (notification.relatedEntityType && notification.relatedEntityId) {
      let path = "";
      switch (notification.relatedEntityType) {
        case "work_order":
          path = "/work-orders";
          break;
        case "estimate":
          path = "/estimates";
          break;
        case "billing_sheet":
          path = "/billing-sheets";
          break;
      }
      
      if (path) {
        setIsOpen(false);
        window.location.href = path;
      }
    }
  };

  return (
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="sm" className="relative p-2">
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <Badge 
              variant="destructive" 
              className="absolute -top-1 -right-1 h-5 w-5 p-0 flex items-center justify-center text-xs"
            >
              {unreadCount > 99 ? "99+" : unreadCount}
            </Badge>
          )}
        </Button>
      </SheetTrigger>
      
      <SheetContent side="right" className="w-96">
        <SheetHeader className="pb-4">
          <div className="flex items-center justify-between">
            <SheetTitle>Notifications</SheetTitle>
            {notifications.some(n => !n.isRead) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => markAllAsReadMutation.mutate()}
                disabled={markAllAsReadMutation.isPending}
              >
                Mark all read
              </Button>
            )}
          </div>
        </SheetHeader>

        <ScrollArea className="h-[calc(100vh-8rem)]">
          {notifications.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <Bell className="h-8 w-8 mx-auto mb-2 text-gray-300" />
              <p>No notifications yet</p>
            </div>
          ) : (
            <div className="space-y-2">
              {notifications.map((notification) => (
                <Card
                  key={notification.id}
                  className={`cursor-pointer transition-colors hover:bg-gray-50 ${
                    !notification.isRead 
                      ? getNotificationColor(notification.type)
                      : "bg-white border-gray-200"
                  }`}
                  onClick={() => handleNotificationClick(notification)}
                >
                  <CardContent className="p-3">
                    <div className="flex items-start space-x-3">
                      <div className="flex-shrink-0 mt-0.5">
                        {getNotificationIcon(notification.type)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <p className={`text-sm font-medium truncate ${
                            !notification.isRead ? "text-gray-900" : "text-gray-700"
                          }`}>
                            {notification.title}
                          </p>
                          {!notification.isRead && (
                            <div className="w-2 h-2 bg-blue-600 rounded-full flex-shrink-0 ml-2" />
                          )}
                        </div>
                        <p className={`text-sm mb-2 ${
                          !notification.isRead ? "text-gray-700" : "text-gray-500"
                        }`}>
                          {notification.message}
                        </p>
                        <p className="text-xs text-gray-400">
                          {formatDistanceToNow(new Date(notification.createdAt), { addSuffix: true })}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}