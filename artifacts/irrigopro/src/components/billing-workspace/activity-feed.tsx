/**
 * ActivityFeed — Task #1097
 *
 * Shared activity-log component for Command Center drawers and WCB view
 * modals. Fetches `GET {url}` (expected response: `{ events: [...] }`)
 * and renders a timestamped list.
 *
 * Props:
 *   url — when null nothing is rendered (e.g. entity type has no feed yet).
 *
 * "No activity yet." renders when the fetch returns an empty events array.
 */

import { useQuery } from "@tanstack/react-query";

interface ActivityEvent {
  id: number | string;
  occurredAt: string;
  actorLabel?: string | null;
  actorRole?: string | null;
  action: string;
  summary?: string | null;
  details?: unknown;
}

interface ActivityFeedResponse {
  events: ActivityEvent[];
}

interface ActivityFeedProps {
  url: string | null;
}

export function ActivityFeed({ url }: ActivityFeedProps) {
  const { data } = useQuery<ActivityFeedResponse | null>({
    queryKey: url ? [url] : ["__no_activity_feed__"],
    enabled: !!url,
  });

  if (!url) return null;

  const events = Array.isArray(data?.events) ? data!.events : [];

  return (
    <div className="pt-3 border-t border-gray-100" data-testid="activity-feed">
      <p className="text-xs font-medium text-gray-600 mb-2">Activity</p>
      {events.length === 0 ? (
        <p className="text-xs text-gray-400" data-testid="activity-feed-empty">
          No activity yet.
        </p>
      ) : (
        <ul className="space-y-1.5 text-xs" data-testid="activity-feed-list">
          {events.slice(0, 10).map((event) => (
            <li key={event.id} className="flex items-start gap-2">
              <span className="text-gray-400 shrink-0 tabular-nums">
                {new Date(event.occurredAt).toLocaleString()}
              </span>
              <span className="text-gray-700">
                {event.actorLabel ? (
                  <strong className="font-medium">{event.actorLabel}: </strong>
                ) : null}
                {event.summary ?? event.action}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
