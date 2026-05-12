import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Task #539 — regression guard for the cold-load "null is not an object
// (evaluating 'i.some')" crash. The workspace `getQueryFn` default
// returns `null` on a 401 (unauthenticated probe), which means a
// `data: notifications = []` destructure default DOES NOT kick in. If
// any render-time call site does `notifications.some(...)` /
// `notifications.length` / `notifications.map(...)` directly on that
// null value, React will throw and the AppErrorBoundary takes over —
// exactly the production symptom this task fixes. This test mounts
// NotificationSystem with a queryFn that returns `null` (as the 401
// path does) and asserts the component renders without throwing.

// Stub push notifications so the test doesn't need the browser SW APIs.
vi.mock("@/hooks/use-push-notifications", () => ({
  usePushNotifications: () => ({
    notificationCount: 0,
    isSupported: false,
    permission: "default" as NotificationPermission,
  }),
}));

// Stub the apiRequest so neither the count nor the list query touches
// the network. Both return `null` to mirror the 401 returnNull path.
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>(
    "@/lib/queryClient",
  );
  return {
    ...actual,
    apiRequest: vi.fn(async () => null),
    adaptiveRefetchInterval: () => false as const,
  };
});

import { NotificationSystem } from "./notification-system";

describe("NotificationSystem (Task #539 null-safety)", () => {
  it("renders without throwing when the notifications query resolves to null", async () => {
    const client = new QueryClient({
      defaultOptions: {
        queries: {
          // Force the 401-returnNull path: every query resolves to null.
          queryFn: async () => null,
          retry: false,
          refetchOnWindowFocus: false,
        },
      },
    });

    expect(() =>
      render(
        <QueryClientProvider client={client}>
          <NotificationSystem userId={42} />
        </QueryClientProvider>,
      ),
    ).not.toThrow();
  });
});
