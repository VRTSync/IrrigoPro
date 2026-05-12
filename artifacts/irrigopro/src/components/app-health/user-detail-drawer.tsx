import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Smartphone, AlertTriangle, Activity, History, UserCog, KeyRound, Unlock } from "lucide-react";
import { buildAuthHeaders, formatRelative } from "./shared";
import { beginImpersonation } from "@/lib/impersonation";

type Device = {
  id: number;
  deviceName: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  revokedAt: string | null;
  expiresAt: string | null;
};
type Session = {
  sessionId: string;
  firstSeen: string;
  lastSeen: string;
  events: number;
};
type RecentError = {
  id: number;
  name: string;
  message: string;
  severity: string;
  type: string;
  component: string | null;
  occurredAt: string;
  fingerprint: string | null;
};
type RecentAction = {
  id: number;
  occurredAt: string;
  action: string;
  actionType: string;
  severity: string;
  summary: string | null;
  targetType: string | null;
  targetId: string | null;
};
type UserDetailResponse = {
  user: {
    id: number; name: string; username: string; email: string | null; role: string;
    companyId: number | null; companyName: string | null; isActive: boolean; createdAt: string;
  };
  devices: Device[];
  sessions: Session[];
  recentErrors: RecentError[];
  recentActions: RecentAction[];
};

type Confirm = "impersonate" | "reset-mfa" | "unlock" | null;

export function UserDetailDrawer({
  userId,
  onClose,
  onOpenCrash,
  onOpenAudit,
}: {
  userId: number | null;
  onClose: () => void;
  onOpenCrash?: (fingerprint: string) => void;
  onOpenAudit?: (actorUserId: number) => void;
}) {
  const open = userId != null;
  const { toast } = useToast();
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState<Confirm>(null);

  const { data, isLoading, isError } = useQuery<UserDetailResponse>({
    queryKey: ["/api/admin/app-health/users", userId],
    queryFn: async () => {
      const res = await fetch(`/api/admin/app-health/users/${userId}`, {
        credentials: "include",
        headers: buildAuthHeaders(),
      });
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      return res.json();
    },
    enabled: open,
    staleTime: 10_000,
    refetchInterval: open ? 15_000 : false,
  });

  const resetMfa = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/admin/app-health/users/${userId}/reset-mfa`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...buildAuthHeaders() },
      });
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "MFA reset", description: "User will be prompted to re-enroll on next sign-in." });
      qc.invalidateQueries({ queryKey: ["/api/admin/app-health/users", userId] });
    },
    onError: (e) => toast({ title: "Couldn't reset MFA", description: e instanceof Error ? e.message : "Try again", variant: "destructive" }),
  });

  const unlock = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/admin/app-health/users/${userId}/unlock`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...buildAuthHeaders() },
      });
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "User reactivated", description: "The account is unlocked." });
      qc.invalidateQueries({ queryKey: ["/api/admin/app-health/users", userId] });
    },
    onError: (e) => toast({ title: "Couldn't unlock", description: e instanceof Error ? e.message : "Try again", variant: "destructive" }),
  });

  const impersonate = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/admin/app-health/impersonate/start`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...buildAuthHeaders() },
        body: JSON.stringify({ userId }),
      });
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      return res.json() as Promise<{
        ok: boolean;
        target: { id: number; username: string; name: string; role: string; email: string | null; companyId: number | null };
        impersonationToken: string;
        expiresAt: string;
      }>;
    },
    onSuccess: (resp) => {
      try {
        if (!resp.impersonationToken) throw new Error("Server did not issue an impersonation token");
        beginImpersonation(
          {
            id: resp.target.id,
            username: resp.target.username,
            name: resp.target.name,
            role: resp.target.role,
            companyId: resp.target.companyId,
            email: resp.target.email,
          },
          resp.impersonationToken,
          resp.expiresAt,
        );
        // Hard reload at "/" so role-routed dashboards mount with the
        // target user's identity from a clean slate.
        window.location.href = "/";
      } catch (e) {
        toast({ title: "Couldn't start impersonation", description: e instanceof Error ? e.message : "Try again", variant: "destructive" });
      }
    },
    onError: (e) => toast({ title: "Couldn't start impersonation", description: e instanceof Error ? e.message : "Try again", variant: "destructive" }),
  });

  const userIsSuperAdmin = data?.user?.role === "super_admin";

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto" side="right" data-testid="user-detail-drawer">
        <SheetHeader>
          <SheetTitle className="text-base">
            {data ? (
              <div>
                <div>{data.user.name}</div>
                <div className="text-xs text-gray-500 font-normal mt-0.5">
                  {data.user.username} · {data.user.role.replace(/_/g, " ")} · {data.user.companyName ?? "no company"}
                </div>
              </div>
            ) : userId != null ? (
              <span>Loading user…</span>
            ) : null}
          </SheetTitle>
        </SheetHeader>

        {isLoading ? (
          <div className="py-16 flex items-center justify-center text-gray-400">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : isError ? (
          <div className="py-16 text-center text-sm text-red-600">Couldn't load user details.</div>
        ) : data ? (
          <div className="space-y-6 mt-4 pb-12">
            <Section title="Admin actions" icon={<UserCog className="h-4 w-4 text-blue-500" />}>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setConfirm("impersonate")}
                  disabled={userIsSuperAdmin || impersonate.isPending}
                  title={userIsSuperAdmin ? "Cannot impersonate another super admin" : "Sign in as this user"}
                  data-testid="user-action-impersonate"
                >
                  <UserCog className="h-4 w-4 mr-2" /> Impersonate
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setConfirm("reset-mfa")}
                  disabled={resetMfa.isPending}
                  data-testid="user-action-reset-mfa"
                >
                  <KeyRound className="h-4 w-4 mr-2" /> Reset MFA
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setConfirm("unlock")}
                  disabled={data.user.isActive || unlock.isPending}
                  title={data.user.isActive ? "User is active" : "Reactivate user account"}
                  data-testid="user-action-unlock"
                >
                  <Unlock className="h-4 w-4 mr-2" /> Unlock
                </Button>
              </div>
            </Section>

            <Section title="Devices" icon={<Smartphone className="h-4 w-4 text-blue-500" />}>
              {data.devices.length === 0 ? (
                <Empty text="No mobile devices linked." />
              ) : (
                <ul className="divide-y rounded-md border">
                  {data.devices.map((d) => (
                    <li key={d.id} className="px-3 py-2 flex items-center justify-between text-sm">
                      <div className="min-w-0">
                        <div className="font-medium text-gray-900 truncate">{d.deviceName ?? `Device #${d.id}`}</div>
                        <div className="text-[11px] text-gray-500">
                          last seen {formatRelative(d.lastUsedAt)} · paired {formatRelative(d.createdAt)}
                        </div>
                      </div>
                      {d.revokedAt ? (
                        <Badge variant="secondary">revoked</Badge>
                      ) : (
                        <Badge className="bg-emerald-500 hover:bg-emerald-500 text-white">active</Badge>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title="Recent sessions (7d)" icon={<Activity className="h-4 w-4 text-purple-500" />}>
              {data.sessions.length === 0 ? (
                <Empty text="No sessions logged in the last 7 days." />
              ) : (
                <ul className="divide-y rounded-md border">
                  {data.sessions.map((s) => (
                    <li key={s.sessionId} className="px-3 py-2 flex items-center justify-between text-sm">
                      <div className="min-w-0">
                        <div className="font-mono text-[11px] text-gray-700 truncate" title={s.sessionId}>
                          {s.sessionId}
                        </div>
                        <div className="text-[11px] text-gray-500">
                          first {formatRelative(s.firstSeen)} · last {formatRelative(s.lastSeen)}
                        </div>
                      </div>
                      <Badge variant="secondary" className="tabular-nums">{s.events} events</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section
              title="Recent actions (30d)"
              icon={<History className="h-4 w-4 text-indigo-500" />}
              action={onOpenAudit && data.user?.id ? (
                <button
                  type="button"
                  onClick={() => onOpenAudit(data.user.id)}
                  className="text-[11px] text-indigo-600 hover:underline"
                  data-testid="open-audit-link"
                >
                  Open in Audit Log →
                </button>
              ) : undefined}
            >
              {(data.recentActions ?? []).length === 0 ? (
                <Empty text="No audit-log entries in the last 30 days." />
              ) : (
                <ul className="divide-y rounded-md border">
                  {(data.recentActions ?? []).map((a) => (
                    <li key={a.id} className="px-3 py-2 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-medium text-gray-900 truncate" title={a.action}>{a.action}</div>
                        <Badge
                          variant={a.severity === "critical" || a.severity === "error" ? "destructive" : "secondary"}
                        >
                          {a.actionType}
                        </Badge>
                      </div>
                      {a.summary ? (
                        <div className="text-[11px] text-gray-500 truncate" title={a.summary}>{a.summary}</div>
                      ) : null}
                      <div className="text-[10px] text-gray-400 mt-0.5">
                        {formatRelative(a.occurredAt)}
                        {a.targetType ? ` · ${a.targetType}${a.targetId ? `#${a.targetId}` : ""}` : ""}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title="Recent errors (7d)" icon={<AlertTriangle className="h-4 w-4 text-amber-500" />}>
              {data.recentErrors.length === 0 ? (
                <Empty text="No errors in the last 7 days. Smooth sailing." />
              ) : (
                <ul className="divide-y rounded-md border">
                  {data.recentErrors.map((e) => {
                    const fp = e.fingerprint;
                    const canOpen = !!onOpenCrash && !!fp;
                    const body = (
                      <>
                        <div className="flex items-center justify-between gap-2">
                          <div className={`font-medium truncate ${canOpen ? "text-indigo-600" : "text-gray-900"}`} title={e.name}>
                            {e.name}
                          </div>
                          <Badge variant={e.severity === "fatal" || e.severity === "error" ? "destructive" : "secondary"}>
                            {e.severity}
                          </Badge>
                        </div>
                        <div className="text-[11px] text-gray-500 truncate" title={e.message}>{e.message}</div>
                        <div className="text-[10px] text-gray-400 mt-0.5">{formatRelative(e.occurredAt)} · {e.component ?? "—"}</div>
                      </>
                    );
                    return (
                      <li key={e.id} className="px-3 py-2 text-sm">
                        {canOpen ? (
                          <button
                            type="button"
                            onClick={() => onOpenCrash!(fp!)}
                            className="w-full text-left hover:bg-gray-50 -mx-3 px-3 py-1 rounded"
                            data-testid="open-crash-link"
                          >
                            {body}
                          </button>
                        ) : (
                          <div className="w-full">{body}</div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </Section>
          </div>
        ) : null}

        <AlertDialog open={confirm !== null} onOpenChange={(v) => !v && setConfirm(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {confirm === "impersonate" && `Impersonate ${data?.user.username ?? "user"}?`}
                {confirm === "reset-mfa" && `Reset MFA for ${data?.user.username ?? "user"}?`}
                {confirm === "unlock" && `Unlock ${data?.user.username ?? "user"}?`}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {confirm === "impersonate" && (
                  <>You'll see the app exactly as this user does. A banner will stay pinned to every screen, every action will be attributed to them in their data, and the start/end of the session is logged in the audit trail.</>
                )}
                {confirm === "reset-mfa" && (
                  <>The user's authenticator app will be unlinked and they'll be required to re-enroll on next sign-in. This is logged in the audit trail.</>
                )}
                {confirm === "unlock" && (
                  <>Reactivates the account so the user can sign in again. Logged in the audit trail.</>
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel data-testid="confirm-cancel">Cancel</AlertDialogCancel>
              <AlertDialogAction
                data-testid="confirm-go"
                onClick={() => {
                  const c = confirm;
                  setConfirm(null);
                  if (c === "impersonate") impersonate.mutate();
                  else if (c === "reset-mfa") resetMfa.mutate();
                  else if (c === "unlock") unlock.mutate();
                }}
              >
                Yes, continue
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SheetContent>
    </Sheet>
  );
}

function Section({
  title, icon, children, action,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-sm font-medium text-gray-700 mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">{icon}{title}</div>
        {action ?? null}
      </div>
      {children}
    </div>
  );
}
function Empty({ text }: { text: string }) {
  return <div className="text-xs text-gray-500 px-3 py-4 border rounded-md bg-gray-50">{text}</div>;
}
