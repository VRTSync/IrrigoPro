import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { History, Layers, Plus, Power, RotateCcw, Save } from "lucide-react";
import {
  useActivateMarkupSchedule,
  useCreateMarkupSchedule,
  useDeactivateMarkupSchedule,
  useGetActiveMarkupSchedule,
  useGetMarkupSchedule,
  useListMarkupSchedules,
  useUpdateMarkupSchedule,
  getGetActiveMarkupScheduleQueryKey,
  getListMarkupSchedulesQueryKey,
  getGetMarkupScheduleQueryKey,
  type MarkupSchedule,
} from "@workspace/api-client-react";
import { CAN_MANAGE_MARKUP_SCHEDULES, DEFAULT_MARKUP_TIERS, hasCapability } from "@workspace/shared";
import { useAuth } from "@/lib/auth-context";
import { useArrayQuery } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MarkupExamples, MinimumMarkupInput, TierEditor } from "@/components/markup/tier-editor";
import { RecalculatePrices } from "@/components/markup/recalculate-prices";
import { draftsToTiers, errorMessage, isNotFoundError, minimumMarkupError, tiersToDrafts, type TierDraft } from "@/lib/markup-tier-form";

const fmtDate = (s: string) => {
  try {
    return format(new Date(s.length === 10 ? `${s}T00:00:00` : s), "MMM d, yyyy");
  } catch {
    return s;
  }
};

function useInvalidateMarkup() {
  const qc = useQueryClient();
  return () =>
    qc.invalidateQueries({
      predicate: (q) => typeof q.queryKey[0] === "string" && (q.queryKey[0] as string).startsWith("/api/markup-schedules"),
    });
}

export default function MarkupSchedulePage() {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === "super_admin";
  const allowed = hasCapability(user?.role, CAN_MANAGE_MARKUP_SCHEDULES);
  const [selectedCompanyId, setSelectedCompanyId] = useState<number | null>(null);

  const { data: companies = [] } = useArrayQuery<{ id: number; name: string }>({
    queryKey: ["/api/companies"],
    enabled: isSuperAdmin,
  });

  if (!allowed) {
    return (
      <div className="mx-auto max-w-xl py-16 text-center" data-testid="status-markup-forbidden">
        <h1 className="text-xl font-semibold text-gray-900">Access restricted</h1>
        <p className="mt-2 text-sm text-gray-600">Only company administrators can manage material markup schedules.</p>
      </div>
    );
  }

  const companyId = isSuperAdmin ? selectedCompanyId : null;
  const ready = !isSuperAdmin || companyId !== null;

  return (
    <div className="w-full space-y-6 py-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Material Markup</h1>
          <p className="mt-1 text-sm text-gray-600">
            Flat-tier pricing applies one rate to the entire cost. The minimum markup and previous-tier price floor prevent underpricing.
          </p>
        </div>
        {isSuperAdmin && (
          <div className="w-full sm:w-64">
            <Label htmlFor="markup-company">Company</Label>
            <Select
              value={companyId ? String(companyId) : ""}
              onValueChange={(v) => setSelectedCompanyId(Number(v))}
            >
              <SelectTrigger id="markup-company" data-testid="select-markup-company">
                <SelectValue placeholder="Select a company" />
              </SelectTrigger>
              <SelectContent>
                {companies.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </header>

      {ready ? (
        <MarkupScheduleManager key={companyId ?? "own"} companyId={companyId} />
      ) : (
        <Card>
          <CardContent className="py-12 text-center text-sm text-gray-600" data-testid="status-select-company">
            Choose a company to view and manage its markup schedules.
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function MarkupScheduleManager({ companyId }: { companyId: number | null }) {
  const params = companyId ? { companyId } : undefined;
  const { toast } = useToast();
  const invalidate = useInvalidateMarkup();
  const [createOpen, setCreateOpen] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);

  const active = useGetActiveMarkupSchedule(params, {
    query: { queryKey: getGetActiveMarkupScheduleQueryKey(params), retry: false },
  });
  const list = useListMarkupSchedules(params, { query: { queryKey: getListMarkupSchedulesQueryKey(params) } });

  const activate = useActivateMarkupSchedule();
  const deactivate = useDeactivateMarkupSchedule();

  const noActive = active.isError && isNotFoundError(active.error);
  const history = useMemo(
    () => [...(list.data ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [list.data],
  );

  const onActivate = (s: MarkupSchedule) =>
    activate.mutate(
      { id: s.id, params },
      {
        onSuccess: () => {
          toast({ title: "Schedule activated", description: `${s.name} is now the company default.` });
          invalidate();
        },
        onError: (e) => toast({ title: "Activation failed", description: errorMessage(e, "Please try again."), variant: "destructive" }),
      },
    );

  const onDeactivate = (s: MarkupSchedule) =>
    deactivate.mutate(
      { id: s.id, params },
      {
        onSuccess: () => {
          toast({ title: "Schedule deactivated", description: "Parts will use manual pricing until a schedule is active." });
          invalidate();
        },
        onError: (e) => toast({ title: "Deactivation failed", description: errorMessage(e, "Please try again."), variant: "destructive" }),
      },
    );

  return (
    <>
      <div className="flex justify-end">
        <Button onClick={() => setCreateOpen(true)} data-testid="button-new-schedule">
          <Plus className="mr-1 h-4 w-4" /> New Schedule
        </Button>
      </div>

      {active.isLoading ? (
        <Card>
          <CardContent className="space-y-3 py-6">
            <div className="skeleton-shimmer h-6 w-48" />
            <div className="skeleton-shimmer h-40 w-full" />
          </CardContent>
        </Card>
      ) : noActive ? (
        <Card>
          <CardContent className="py-10 text-center" data-testid="status-no-active-schedule">
            <Layers className="mx-auto h-8 w-8 text-gray-400" aria-hidden />
            <p className="mt-3 font-medium text-gray-900">No active markup schedule</p>
            <p className="mt-1 text-sm text-gray-600">
              Parts use manual pricing. Activate a schedule from history or create a new one.
            </p>
          </CardContent>
        </Card>
      ) : active.isError ? (
        <Card>
          <CardContent className="py-10 text-center" data-testid="status-active-error">
            <p className="font-medium text-red-700">Could not load the current schedule.</p>
            <p className="mt-1 text-sm text-gray-600">{errorMessage(active.error, "Unexpected error")}</p>
            <Button variant="outline" className="mt-4" onClick={() => active.refetch()} data-testid="button-retry-active">
              Retry
            </Button>
          </CardContent>
        </Card>
      ) : active.data ? (
        <ActiveScheduleEditor
          key={active.data.schedule.id}
          schedule={active.data.schedule}
          initialDrafts={tiersToDrafts(active.data.tiers)}
          params={params}
          onDeactivate={() => onDeactivate(active.data!.schedule)}
          deactivating={deactivate.isPending}
        />
      ) : null}

      <RecalculatePrices params={params} hasActiveSchedule={!!active.data && !active.isError} />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center text-lg">
            <History className="mr-2 h-5 w-5 text-gray-500" aria-hidden /> Schedule History
          </CardTitle>
          <CardDescription>Previous versions are retained unchanged for audit. Reactivating one makes it the company default.</CardDescription>
        </CardHeader>
        <CardContent>
          {list.isLoading ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => <div key={i} className="skeleton-shimmer h-10 w-full" />)}
            </div>
          ) : list.isError ? (
            <div className="text-sm text-red-700" data-testid="status-history-error">
              Could not load history.{" "}
              <button type="button" className="underline" onClick={() => list.refetch()}>Retry</button>
            </div>
          ) : history.length === 0 ? (
            <p className="text-sm text-gray-600" data-testid="status-history-empty">No schedules yet.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {history.map((s) => (
                <li key={s.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between" data-testid={`row-schedule-${s.id}`}>
                  <div>
                    <div className="font-medium text-gray-900">
                      {s.name}{" "}
                      {s.isActive ? (
                        <Badge className="ml-1 bg-emerald-100 text-emerald-800 hover:bg-emerald-100">Active</Badge>
                      ) : (
                        <Badge variant="outline" className="ml-1">Inactive</Badge>
                      )}
                    </div>
                    <p className="text-xs text-gray-500">
                      Effective {fmtDate(s.effectiveDate)} · Created {fmtDate(s.createdAt)}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => setDetailId(s.id)} data-testid={`button-view-schedule-${s.id}`}>
                      View Tiers
                    </Button>
                    {!s.isActive && (
                      <Button
                        size="sm"
                        onClick={() => onActivate(s)}
                        disabled={activate.isPending}
                        data-testid={`button-activate-schedule-${s.id}`}
                      >
                        <RotateCcw className="mr-1 h-4 w-4" /> Activate
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <CreateScheduleDialog open={createOpen} onOpenChange={setCreateOpen} params={params} />
      <ScheduleDetailDialog id={detailId} params={params} onClose={() => setDetailId(null)} />
    </>
  );
}

function ActiveScheduleEditor({
  schedule,
  initialDrafts,
  params,
  onDeactivate,
  deactivating,
}: {
  schedule: MarkupSchedule;
  initialDrafts: TierDraft[];
  params: { companyId: number } | undefined;
  onDeactivate: () => void;
  deactivating: boolean;
}) {
  const { toast } = useToast();
  const invalidate = useInvalidateMarkup();
  const [name, setName] = useState(schedule.name);
  const [minimum, setMinimum] = useState(schedule.minimumMarkupDollars);
  const [drafts, setDrafts] = useState<TierDraft[]>(initialDrafts);
  const update = useUpdateMarkupSchedule();
  const { tiers, error: tierError } = useMemo(() => draftsToTiers(drafts), [drafts]);
  const error = tierError ?? minimumMarkupError(minimum);
  const nameError = name.trim() === "" ? "Name is required" : name.length > 200 ? "Name is too long" : null;

  const save = () => {
    if (error || nameError) return;
    update.mutate(
      { id: schedule.id, data: { name: name.trim(), tiers, minimumMarkupDollars: Number(minimum) }, params },
      {
        onSuccess: () => {
          toast({ title: "New version saved", description: "The previous version is kept in Schedule History. Existing catalog prices are not changed." });
          invalidate();
        },
        onError: (e) => toast({ title: "Save failed", description: errorMessage(e, "Please try again."), variant: "destructive" }),
      },
    );
  };

  return (
    <Card data-testid="card-active-schedule">
      <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:space-y-0">
        <div>
          <CardTitle className="text-lg">Current Schedule</CardTitle>
          <CardDescription data-testid="text-effective-date">Effective {fmtDate(schedule.effectiveDate)}</CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={onDeactivate} disabled={deactivating} data-testid="button-deactivate-schedule">
          <Power className="mr-1 h-4 w-4" /> Deactivate
        </Button>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="max-w-md">
          <Label htmlFor="active-name">Schedule name</Label>
          <Input
            id="active-name"
            value={name}
            maxLength={200}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={!!nameError}
            data-testid="input-active-name"
          />
          {nameError && <p className="mt-1 text-sm text-red-600">{nameError}</p>}
        </div>
        <MinimumMarkupInput idPrefix="active" value={minimum} onChange={setMinimum} />
        <TierEditor idPrefix="active" drafts={drafts} onChange={setDrafts} />
        {error && <p role="alert" className="text-sm text-red-600" data-testid="text-tier-error-active">{error}</p>}
        <MarkupExamples tiers={tiers} minimumMarkupDollars={Number(minimum)} error={error} idPrefix="active" />
        <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-gray-500">Saving creates a new active version. Catalog prices are not bulk-updated.</p>
          <Button onClick={save} disabled={!!error || !!nameError || update.isPending} data-testid="button-save-schedule">
            <Save className="mr-1 h-4 w-4" /> {update.isPending ? "Saving..." : "Save New Version"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function CreateScheduleDialog({
  open,
  onOpenChange,
  params,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  params: { companyId: number } | undefined;
}) {
  const { toast } = useToast();
  const invalidate = useInvalidateMarkup();
  const create = useCreateMarkupSchedule();
  const today = format(new Date(), "yyyy-MM-dd");
  const [name, setName] = useState("");
  const [minimum, setMinimum] = useState("2.00");
  const [effectiveDate, setEffectiveDate] = useState(today);
  const [drafts, setDrafts] = useState<TierDraft[]>(() => tiersToDrafts(DEFAULT_MARKUP_TIERS));

  useEffect(() => {
    if (open) {
      setName("");
      setMinimum("2.00");
      setEffectiveDate(today);
      setDrafts(tiersToDrafts(DEFAULT_MARKUP_TIERS));
    }
  }, [open, today]);

  const { tiers, error: tierError } = useMemo(() => draftsToTiers(drafts), [drafts]);
  const error = tierError ?? minimumMarkupError(minimum);
  const nameError = name.trim() === "" ? "Name is required" : null;
  const dateError = /^\d{4}-\d{2}-\d{2}$/.test(effectiveDate) ? null : "Choose an effective date";

  const submit = () => {
    if (error || nameError || dateError) return;
    create.mutate(
      { data: { name: name.trim(), effectiveDate, tiers, minimumMarkupDollars: Number(minimum) }, params },
      {
        onSuccess: () => {
          toast({ title: "Schedule created", description: "It is inactive until you activate it from Schedule History." });
          invalidate();
          onOpenChange(false);
        },
        onError: (e) => toast({ title: "Create failed", description: errorMessage(e, "Please try again."), variant: "destructive" }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Markup Schedule</DialogTitle>
          <DialogDescription>New schedules start inactive. Activate one from Schedule History when ready.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="new-name">Schedule name</Label>
              <Input id="new-name" value={name} maxLength={200} onChange={(e) => setName(e.target.value)} data-testid="input-new-name" />
              {nameError && name !== "" && <p className="mt-1 text-sm text-red-600">{nameError}</p>}
            </div>
            <div>
              <Label htmlFor="new-date">Effective date</Label>
              <Input id="new-date" type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} data-testid="input-new-date" />
              {dateError && <p className="mt-1 text-sm text-red-600">{dateError}</p>}
            </div>
          </div>
          <MinimumMarkupInput idPrefix="new" value={minimum} onChange={setMinimum} />
          <TierEditor idPrefix="new" drafts={drafts} onChange={setDrafts} />
          {error && <p role="alert" className="text-sm text-red-600" data-testid="text-tier-error-new">{error}</p>}
          <MarkupExamples tiers={tiers} minimumMarkupDollars={Number(minimum)} error={error} idPrefix="new" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={submit}
            disabled={!!error || !!nameError || !!dateError || create.isPending}
            data-testid="button-create-schedule"
          >
            {create.isPending ? "Creating..." : "Create Schedule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ScheduleDetailDialog({
  id,
  params,
  onClose,
}: {
  id: number | null;
  params: { companyId: number } | undefined;
  onClose: () => void;
}) {
  const detail = useGetMarkupSchedule(id ?? 0, params, {
    query: { enabled: id !== null, queryKey: getGetMarkupScheduleQueryKey(id ?? 0, params) },
  });
  const drafts = useMemo(() => (detail.data ? tiersToDrafts(detail.data.tiers) : []), [detail.data]);
  const { tiers, error } = useMemo(() => draftsToTiers(drafts), [drafts]);

  return (
    <Dialog open={id !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{detail.data?.schedule.name ?? "Schedule details"}</DialogTitle>
          <DialogDescription>
            {detail.data ? `Effective ${fmtDate(detail.data.schedule.effectiveDate)} · read-only` : "Loading tiers"}
          </DialogDescription>
        </DialogHeader>
        {detail.isLoading ? (
          <div className="skeleton-shimmer h-40 w-full" />
        ) : detail.isError ? (
          <p className="text-sm text-red-700">{errorMessage(detail.error, "Could not load this schedule.")}</p>
        ) : detail.data ? (
          <div className="space-y-4">
            <p className="text-sm" data-testid={`minimum-detail-${id}`}>Minimum markup: ${Number(detail.data.schedule.minimumMarkupDollars).toFixed(2)}</p>
            <TierEditor idPrefix={`detail-${id}`} drafts={drafts} readOnly />
            <MarkupExamples tiers={tiers} minimumMarkupDollars={Number(detail.data.schedule.minimumMarkupDollars)} error={error} idPrefix={`detail-${id}`} />
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
