import { useArrayQuery } from "@/lib/queryClient";
import { Loader2 } from "lucide-react";

export type ActivityEvent = {
  id: number;
  occurredAt: string;
  actorUserId: number | null;
  actorLabel: string | null;
  actorRole: string | null;
  action: string;
  summary: string | null;
  details: unknown;
};

type Resource = "estimates" | "wet-checks" | "work-orders";

interface ActivityTabProps {
  resource: Resource;
  id: number | string | null | undefined;
}

function formatActor(ev: ActivityEvent): string {
  if (ev.actorRole === "customer") {
    return ev.actorLabel?.replace(/^customer:/, "") || "Customer";
  }
  if (ev.actorLabel) return ev.actorLabel;
  if (ev.actorUserId != null) return `User #${ev.actorUserId}`;
  return "System";
}

function formatAction(action: string): string {
  const parts = action.split(".");
  const tail = parts[parts.length - 1] ?? action;
  return tail.replace(/_/g, " ");
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString();
  } catch {
    return iso;
  }
}

function describeTransition(details: unknown): string | null {
  if (!details || typeof details !== "object") return null;
  const d = details as Record<string, unknown>;
  const before = d.before as Record<string, unknown> | null | undefined;
  const after = d.after as Record<string, unknown> | null | undefined;
  if (!before && !after) return null;
  const bStatus =
    (before?.internalStatus as string | undefined) ??
    (before?.status as string | undefined);
  const aStatus =
    (after?.internalStatus as string | undefined) ??
    (after?.status as string | undefined);
  if (bStatus && aStatus && bStatus !== aStatus) return `${bStatus} → ${aStatus}`;
  if (aStatus) return aStatus;
  return null;
}

function extractNote(details: unknown): string | null {
  if (!details || typeof details !== "object") return null;
  const note = (details as Record<string, unknown>).note;
  return typeof note === "string" && note.trim() !== "" ? note : null;
}

export function ActivityTab({ resource, id }: ActivityTabProps) {
  const enabled = id != null && id !== "" && !Number.isNaN(Number(id));
  const { data: events = [], isLoading, isError, error } = useArrayQuery<ActivityEvent>({
    queryKey: [`/api/${resource}/${id}/activity`],
    queryFn: async () => {
      const res = await fetch(`/api/${resource}/${id}/activity`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Failed to load activity (${res.status})`);
      const body = (await res.json()) as { events?: ActivityEvent[] };
      return body?.events ?? [];
    },
    enabled,
    staleTime: 10_000,
  });

  if (!enabled) {
    return (
      <div className="p-4 text-sm text-muted-foreground" data-testid="activity-empty">
        Save this record to view its activity history.
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground" data-testid="activity-loading">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading activity…
      </div>
    );
  }

  if (isError) {
    return (
      <div className="p-4 text-sm text-destructive" data-testid="activity-error">
        Couldn't load activity: {error instanceof Error ? error.message : String(error)}
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="p-4 text-sm text-muted-foreground" data-testid="activity-empty">
        No activity recorded yet.
      </div>
    );
  }

  return (
    <ol
      className="divide-y divide-border"
      data-testid="activity-list"
      aria-label="Activity history"
    >
      {events.map((ev) => {
        const transition = describeTransition(ev.details);
        const note = extractNote(ev.details);
        return (
          <li
            key={ev.id}
            className="px-4 py-3"
            data-testid={`activity-row-${ev.id}`}
          >
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm font-medium" data-testid={`activity-action-${ev.id}`}>
                {formatAction(ev.action)}
              </span>
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                {formatTime(ev.occurredAt)}
              </span>
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground" data-testid={`activity-actor-${ev.id}`}>
              {formatActor(ev)}
              {ev.actorRole && ev.actorRole !== "customer" ? ` · ${ev.actorRole}` : null}
            </div>
            {transition ? (
              <div className="mt-1 text-xs text-muted-foreground" data-testid={`activity-transition-${ev.id}`}>
                {transition}
              </div>
            ) : null}
            {ev.summary ? (
              <div className="mt-1 text-sm" data-testid={`activity-summary-${ev.id}`}>
                {ev.summary}
              </div>
            ) : null}
            {note ? (
              <div className="mt-1 text-sm italic text-muted-foreground" data-testid={`activity-note-${ev.id}`}>
                "{note}"
              </div>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

export default ActivityTab;
