import { useMemo, useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
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
import { PageContainer, PageContent, PageHeader } from "@/components/ui/page-header";
import { BillingSheetViewModal } from "@/components/billing/billing-sheet-view-modal";
import { Camera, Download, Search, User, Building2, Calendar, ChevronDown, ChevronRight, ArrowLeft, Send, Mail, MessageSquare, Clock } from "lucide-react";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { BillingSheet } from "@shared/schema";

interface NotificationInfo {
  lastSentAt: string;
  sheetCount: number;
  lastEmailAt: string | null;
  lastSmsAt: string | null;
  emailSheetCount: number | null;
  smsSheetCount: number | null;
  lastSmsStatus: string | null;
  lastSmsStatusAt: string | null;
  lastSmsErrorCode: string | null;
}

interface MissingPhotosResponse {
  cutoff: string;
  count: number;
  sheets: BillingSheet[];
  notifications: Record<string, NotificationInfo>;
}

type ChannelOutcome =
  | { channel: 'email' | 'sms'; status: 'sent'; lastSentAt: string }
  | { channel: 'email' | 'sms'; status: 'skipped_already_notified'; lastSentAt: string }
  | { channel: 'email'; status: 'skipped_no_email' }
  | { channel: 'sms'; status: 'skipped_no_phone' }
  | { channel: 'email' | 'sms'; status: 'failed'; error?: string };

interface NotifyResultRow {
  technicianId: number;
  technicianName: string;
  sheetCount: number;
  skippedNoUser?: boolean;
  channels: ChannelOutcome[];
}

interface NotifyResponse {
  channel: 'email' | 'sms' | 'both';
  summary: {
    sent: number;
    skippedAlreadyNotified: number;
    skippedNoEmail: number;
    skippedNoPhone: number;
    skippedNoUser: number;
    failed: number;
  };
  results: NotifyResultRow[];
}

type GroupBy = "technician" | "customer";
type ChannelChoice = "email" | "sms" | "both";

function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "never";
  const t = new Date(iso).getTime();
  const diffMs = Date.now() - t;
  if (diffMs < 60_000) return "just now";
  const m = Math.floor(diffMs / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

// Map a Twilio MessageStatus to a colored badge style + label so managers
// can see whether the SMS actually reached the technician's phone.
function smsStatusBadge(status: string | null, errorCode: string | null): {
  className: string;
  label: string;
  title?: string;
} | null {
  if (!status) return null;
  const s = status.toLowerCase();
  const errSuffix = errorCode ? ` (Twilio error ${errorCode})` : '';
  if (s === 'delivered' || s === 'received') {
    return { className: 'border-emerald-300 text-emerald-800 bg-emerald-50', label: 'Delivered' };
  }
  if (s === 'sent') {
    return { className: 'border-blue-300 text-blue-800 bg-blue-50', label: 'Sent' };
  }
  if (s === 'queued' || s === 'accepted' || s === 'scheduled' || s === 'sending') {
    return { className: 'border-gray-300 text-gray-700 bg-gray-50', label: status[0].toUpperCase() + status.slice(1) };
  }
  if (s === 'failed') {
    return { className: 'border-red-300 text-red-800 bg-red-50', label: 'Failed', title: `Carrier reported failed${errSuffix}` };
  }
  if (s === 'undelivered') {
    return { className: 'border-red-300 text-red-800 bg-red-50', label: 'Undelivered', title: `Could not reach phone${errSuffix}` };
  }
  return { className: 'border-gray-300 text-gray-700 bg-gray-50', label: status };
}

export default function MissingPhotosReport() {
  const [groupBy, setGroupBy] = useState<GroupBy>("technician");
  const [searchQuery, setSearchQuery] = useState("");
  const [viewingSheet, setViewingSheet] = useState<BillingSheet | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [forceResend, setForceResend] = useState(false);
  const [channelChoice, setChannelChoice] = useState<ChannelChoice>("email");
  const [lastSummary, setLastSummary] = useState<NotifyResponse | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading } = useQuery<MissingPhotosResponse>({
    queryKey: ["/api/billing-sheets/missing-photos"],
  });

  const notifyMutation = useMutation<NotifyResponse, Error, { force: boolean; channel: ChannelChoice }>({
    mutationFn: (vars) => apiRequest("/api/billing-sheets/missing-photos/notify", "POST", vars),
    onSuccess: (resp) => {
      setLastSummary(resp);
      const { sent, skippedAlreadyNotified, skippedNoEmail, skippedNoPhone, failed } = resp.summary;
      // `sent` is a count of channel deliveries (a single tech in `both` mode
      // can contribute up to 2). Compute unique technicians who received at
      // least one successful delivery for accurate copy.
      const technicianReached = new Set(
        resp.results
          .filter(r => r.channels.some(c => c.status === 'sent'))
          .map(r => r.technicianId),
      ).size;
      toast({
        title: technicianReached > 0
          ? `Notified ${technicianReached} technician${technicianReached === 1 ? "" : "s"}`
          : "Nothing sent",
        description: [
          sent > 0 ? `${sent} message${sent === 1 ? "" : "s"} sent` : null,
          skippedAlreadyNotified > 0 ? `${skippedAlreadyNotified} skipped (recently notified — use Force re-send)` : null,
          skippedNoEmail > 0 ? `${skippedNoEmail} skipped (no email on file)` : null,
          skippedNoPhone > 0 ? `${skippedNoPhone} skipped (no phone on file)` : null,
          failed > 0 ? `${failed} failed` : null,
        ].filter(Boolean).join(" • ") || "No deliveries.",
        variant: failed > 0 ? "destructive" : "default",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/billing-sheets/missing-photos"] });
    },
    onError: (err) => {
      toast({ title: "Failed to send notifications", description: err.message, variant: "destructive" });
    },
  });

  const sheets = data?.sheets ?? [];
  const notifications = data?.notifications ?? {};

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return sheets;
    return sheets.filter(s =>
      (s.customerName ?? "").toLowerCase().includes(q) ||
      (s.technicianName ?? "").toLowerCase().includes(q) ||
      (s.billingNumber ?? "").toLowerCase().includes(q) ||
      (s.propertyAddress ?? "").toLowerCase().includes(q)
    );
  }, [sheets, searchQuery]);

  const groups = useMemo(() => {
    const map = new Map<string, BillingSheet[]>();
    for (const s of filtered) {
      const key = groupBy === "technician"
        ? (s.technicianName || "Unknown technician")
        : (s.customerName || "Unknown customer");
      const arr = map.get(key) ?? [];
      arr.push(s);
      map.set(key, arr);
    }
    return Array.from(map.entries()).sort((a, b) => b[1].length - a[1].length);
  }, [filtered, groupBy]);

  const toggleGroup = (key: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const formatDate = (date: string | Date) =>
    new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  const channelIcon = (c: 'email' | 'sms') => c === 'email' ? <Mail className="w-3 h-3" /> : <MessageSquare className="w-3 h-3" />;
  const channelLabel = (c: 'email' | 'sms') => c === 'email' ? 'Email' : 'SMS';

  return (
    <PageContainer>
      <PageHeader
        title="Missing Photos Report"
        subtitle="Past billing sheets with no photos attached. Open a sheet and use Add Photos to re-attach them."
        actions={
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <a href="/api/billing-sheets/missing-photos?format=csv" data-testid="button-download-csv">
                <Download className="w-4 h-4 mr-2" />
                Download CSV
              </a>
            </Button>
            <Button
              size="sm"
              onClick={() => { setForceResend(false); setConfirmOpen(true); }}
              disabled={isLoading || (data?.count ?? 0) === 0 || notifyMutation.isPending}
              data-testid="button-notify-techs"
            >
              <Send className="w-4 h-4 mr-2" />
              {notifyMutation.isPending ? "Sending…" : "Notify technicians"}
            </Button>
          </div>
        }
      />

      <PageContent className="space-y-5">
        <div className="flex items-center justify-between">
          <Link href="/billing-sheets">
            <Button variant="ghost" size="sm" data-testid="link-back">
              <ArrowLeft className="w-4 h-4 mr-1" /> Back to Billing Sheets
            </Button>
          </Link>
          <div className="text-sm text-gray-500">
            {data ? (
              <>Cutoff: sheets created before <strong>{new Date(data.cutoff).toLocaleString()}</strong></>
            ) : null}
          </div>
        </div>

        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <Camera className="w-5 h-5 text-amber-700 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-amber-900">
                <p className="font-semibold mb-1">{isLoading ? "Loading…" : `${data?.count ?? 0} billing sheet${(data?.count ?? 0) === 1 ? "" : "s"} are missing photos`}</p>
                <p>
                  Until the photo-save fix was deployed, photos uploaded during billing sheet creation were silently dropped.
                  Ask the listed technicians to open each sheet and tap <strong>Add Photos</strong> to re-attach what they still have on their phones.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400" />
            <Input
              placeholder="Search by technician, customer, address or sheet #"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-12"
              data-testid="input-search-missing-photos"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600">Group by:</span>
            <Button
              variant={groupBy === "technician" ? "default" : "outline"}
              size="sm"
              onClick={() => setGroupBy("technician")}
              data-testid="button-group-technician"
            >
              <User className="w-4 h-4 mr-1" /> Technician
            </Button>
            <Button
              variant={groupBy === "customer" ? "default" : "outline"}
              size="sm"
              onClick={() => setGroupBy("customer")}
              data-testid="button-group-customer"
            >
              <Building2 className="w-4 h-4 mr-1" /> Customer
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-24 w-full" />
            ))}
          </div>
        ) : groups.length === 0 ? (
          <Card>
            <CardContent className="text-center py-12">
              <Camera className="w-16 h-16 text-gray-400 mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-gray-900 mb-2">
                {searchQuery ? "No matching sheets" : "All caught up"}
              </h3>
              <p className="text-gray-600">
                {searchQuery
                  ? "No sheets match your search."
                  : "No past billing sheets are missing photos."}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {groups.map(([groupName, items]) => {
              const isCollapsed = collapsed.has(groupName);
              const techId = groupBy === "technician" ? items[0]?.technicianId : null;
              const notif = techId != null ? notifications[String(techId)] : undefined;
              return (
                <div key={groupName}>
                  <button
                    onClick={() => toggleGroup(groupName)}
                    className="w-full flex items-center justify-between px-4 py-3 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors"
                    data-testid={`group-toggle-${groupName}`}
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      {isCollapsed ? <ChevronRight className="w-5 h-5 text-blue-700" /> : <ChevronDown className="w-5 h-5 text-blue-700" />}
                      <span className="text-base font-semibold text-blue-900">{groupName}</span>
                      <Badge className="bg-blue-200 text-blue-900 hover:bg-blue-200">{items.length}</Badge>
                      {groupBy === 'technician' && techId != null && (
                        <>
                          <Badge
                            variant="outline"
                            className={`gap-1 ${notif?.lastEmailAt ? 'border-emerald-300 text-emerald-800 bg-emerald-50' : 'border-gray-300 text-gray-500 bg-white'}`}
                            data-testid={`badge-last-email-${techId}`}
                          >
                            <Mail className="w-3 h-3" />
                            Email {formatRelative(notif?.lastEmailAt ?? null)}
                          </Badge>
                          <Badge
                            variant="outline"
                            className={`gap-1 ${notif?.lastSmsAt ? 'border-emerald-300 text-emerald-800 bg-emerald-50' : 'border-gray-300 text-gray-500 bg-white'}`}
                            data-testid={`badge-last-sms-${techId}`}
                          >
                            <MessageSquare className="w-3 h-3" />
                            SMS {formatRelative(notif?.lastSmsAt ?? null)}
                          </Badge>
                          {notif?.lastSmsAt && (() => {
                            const badge = smsStatusBadge(notif.lastSmsStatus, notif.lastSmsErrorCode);
                            if (!badge) return null;
                            return (
                              <Badge
                                variant="outline"
                                className={`gap-1 ${badge.className}`}
                                title={badge.title}
                                data-testid={`badge-sms-status-${techId}`}
                              >
                                {badge.label}
                              </Badge>
                            );
                          })()}
                        </>
                      )}
                    </div>
                  </button>
                  {!isCollapsed && (
                    <div className="mt-3 space-y-3">
                      {items.map(sheet => (
                        <Card key={sheet.id} className="hover:shadow-md transition-shadow">
                          <CardContent className="p-4">
                            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                              <div className="min-w-0 flex-1 space-y-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-semibold text-gray-900">{sheet.billingNumber}</span>
                                  <Badge variant="outline" className="text-xs">{sheet.status}</Badge>
                                </div>
                                <p className="text-sm text-gray-700 truncate">
                                  <Building2 className="inline w-3.5 h-3.5 mr-1 text-gray-400" />
                                  {sheet.customerName}
                                  {sheet.branchName ? ` — ${sheet.branchName}` : ""}
                                </p>
                                {sheet.propertyAddress && (
                                  <p className="text-xs text-gray-500 truncate">{sheet.propertyAddress}</p>
                                )}
                                <div className="flex items-center gap-4 text-xs text-gray-500 flex-wrap">
                                  <span className="flex items-center gap-1">
                                    <User className="w-3.5 h-3.5" />{sheet.technicianName}
                                  </span>
                                  <span className="flex items-center gap-1">
                                    <Calendar className="w-3.5 h-3.5" />Worked {formatDate(sheet.workDate)}
                                  </span>
                                  <span className="flex items-center gap-1">
                                    <Calendar className="w-3.5 h-3.5" />Created {formatDate(sheet.createdAt)}
                                  </span>
                                </div>
                              </div>
                              <Button
                                size="sm"
                                onClick={() => setViewingSheet(sheet)}
                                className="bg-blue-600 hover:bg-blue-700 text-white w-full sm:w-auto"
                                data-testid={`button-open-sheet-${sheet.id}`}
                              >
                                <Camera className="w-4 h-4 mr-1" /> Add Photos
                              </Button>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {lastSummary && lastSummary.results.length > 0 && (
          <Card data-testid="card-notify-summary">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-3">
                <p className="font-semibold text-gray-900">Last outreach result ({lastSummary.channel === 'both' ? 'Email + SMS' : lastSummary.channel === 'sms' ? 'SMS' : 'Email'})</p>
                <Button variant="ghost" size="sm" onClick={() => setLastSummary(null)}>Dismiss</Button>
              </div>
              <ul className="space-y-2 text-sm">
                {lastSummary.results.map(r => (
                  <li key={r.technicianId} className="flex items-start justify-between gap-3">
                    <span className="text-gray-800 min-w-0">
                      <span className="font-medium">{r.technicianName}</span>{' '}
                      <span className="text-gray-500">({r.sheetCount} sheet{r.sheetCount === 1 ? "" : "s"})</span>
                    </span>
                    <span className="flex flex-wrap gap-1 justify-end">
                      {r.skippedNoUser && <Badge variant="outline" className="border-amber-300 text-amber-800">User not found</Badge>}
                      {r.channels.map((c, i) => {
                        const icon = channelIcon(c.channel);
                        const label = channelLabel(c.channel);
                        if (c.status === 'sent') return <Badge key={i} className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100 gap-1">{icon}{label} sent</Badge>;
                        if (c.status === 'skipped_already_notified') return <Badge key={i} variant="outline" className="gap-1" title={`Last sent ${new Date(c.lastSentAt).toLocaleString()}`}>{icon}{label} skipped — recently notified</Badge>;
                        if (c.status === 'skipped_no_email') return <Badge key={i} variant="outline" className="border-amber-300 text-amber-800 gap-1">{icon}No email on file</Badge>;
                        if (c.status === 'skipped_no_phone') return <Badge key={i} variant="outline" className="border-amber-300 text-amber-800 gap-1">{icon}No phone on file</Badge>;
                        if (c.status === 'failed') return <Badge key={i} variant="destructive" className="gap-1">{icon}{label} failed{c.error ? `: ${c.error}` : ''}</Badge>;
                        return null;
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </PageContent>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Notify technicians about missing photos</AlertDialogTitle>
            <AlertDialogDescription>
              Pick how to reach each technician. They will receive a list of only their own affected sheets, with a link back into the app.
              By default, anyone notified on the chosen channel within the last 24 hours is skipped.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3">
            <RadioGroup value={channelChoice} onValueChange={(v) => setChannelChoice(v as ChannelChoice)}>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="email" id="ch-email" data-testid="radio-channel-email" />
                <Label htmlFor="ch-email" className="flex items-center gap-2 cursor-pointer">
                  <Mail className="w-4 h-4 text-gray-600" /> Email
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="sms" id="ch-sms" data-testid="radio-channel-sms" />
                <Label htmlFor="ch-sms" className="flex items-center gap-2 cursor-pointer">
                  <MessageSquare className="w-4 h-4 text-gray-600" /> SMS (text message)
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="both" id="ch-both" data-testid="radio-channel-both" />
                <Label htmlFor="ch-both" className="flex items-center gap-2 cursor-pointer">
                  <Mail className="w-4 h-4 text-gray-600" /> + <MessageSquare className="w-4 h-4 text-gray-600" /> Both
                </Label>
              </div>
            </RadioGroup>
            <label className="flex items-center gap-2 text-sm text-gray-700 pt-2 border-t">
              <input
                type="checkbox"
                checked={forceResend}
                onChange={(e) => setForceResend(e.target.checked)}
                data-testid="checkbox-force-resend"
              />
              Re-send even to technicians notified within the last 24 hours
            </label>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-notify">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { setConfirmOpen(false); notifyMutation.mutate({ force: forceResend, channel: channelChoice }); }}
              data-testid="button-confirm-notify"
            >
              {channelChoice === 'both' ? 'Send email + SMS' : channelChoice === 'sms' ? 'Send SMS' : 'Send emails'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {viewingSheet && (
        <BillingSheetViewModal
          sheet={viewingSheet}
          open={!!viewingSheet}
          onOpenChange={(open) => {
            if (!open) {
              setViewingSheet(null);
              queryClient.invalidateQueries({ queryKey: ["/api/billing-sheets/missing-photos"] });
            }
          }}
        />
      )}
    </PageContainer>
  );
}
