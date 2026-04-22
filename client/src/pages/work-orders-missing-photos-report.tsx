import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { PageContainer, PageContent, PageHeader } from "@/components/ui/page-header";
import { WorkOrderDetails } from "@/components/work-orders/work-order-details";
import { Camera, Download, Search, User, Building2, Calendar, ChevronDown, ChevronRight, ArrowLeft } from "lucide-react";
import { Link } from "wouter";
import type { WorkOrder } from "@shared/schema";

interface MissingPhotosResponse {
  cutoff: string;
  count: number;
  workOrders: WorkOrder[];
}

type GroupBy = "technician" | "customer";

export default function WorkOrdersMissingPhotosReport() {
  const [groupBy, setGroupBy] = useState<GroupBy>("technician");
  const [searchQuery, setSearchQuery] = useState("");
  const [viewingWorkOrder, setViewingWorkOrder] = useState<WorkOrder | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<MissingPhotosResponse>({
    queryKey: ["/api/work-orders/missing-photos"],
  });

  const workOrders = data?.workOrders ?? [];

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return workOrders;
    return workOrders.filter(wo =>
      (wo.customerName ?? "").toLowerCase().includes(q) ||
      (wo.assignedTechnicianName ?? "").toLowerCase().includes(q) ||
      (wo.workOrderNumber ?? "").toLowerCase().includes(q) ||
      (wo.projectAddress ?? "").toLowerCase().includes(q) ||
      (wo.projectName ?? "").toLowerCase().includes(q)
    );
  }, [workOrders, searchQuery]);

  const groups = useMemo(() => {
    const map = new Map<string, WorkOrder[]>();
    for (const wo of filtered) {
      const key = groupBy === "technician"
        ? (wo.assignedTechnicianName || "Unassigned")
        : (wo.customerName || "Unknown customer");
      const arr = map.get(key) ?? [];
      arr.push(wo);
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

  const formatDate = (date: string | Date | null) => {
    if (!date) return "—";
    return new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };

  return (
    <PageContainer>
      <PageHeader
        title="Work Orders Missing Photos"
        subtitle="Past work orders with no photos attached. Open one and use Add Photos to re-attach them."
        actions={
          <Button asChild variant="outline" size="sm">
            <a href="/api/work-orders/missing-photos?format=csv" data-testid="button-download-csv">
              <Download className="w-4 h-4 mr-2" />
              Download CSV
            </a>
          </Button>
        }
      />

      <PageContent className="space-y-5">
        <div className="flex items-center justify-between">
          <Link href="/work-orders">
            <Button variant="ghost" size="sm" data-testid="link-back">
              <ArrowLeft className="w-4 h-4 mr-1" /> Back to Work Orders
            </Button>
          </Link>
          <div className="text-sm text-gray-500">
            {data ? (
              <>Cutoff: work orders created before <strong>{new Date(data.cutoff).toLocaleString()}</strong></>
            ) : null}
          </div>
        </div>

        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <Camera className="w-5 h-5 text-amber-700 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-amber-900">
                <p className="font-semibold mb-1">{isLoading ? "Loading…" : `${data?.count ?? 0} work order${(data?.count ?? 0) === 1 ? "" : "s"} are missing photos`}</p>
                <p>
                  Until the photo-save fix was deployed, photos uploaded on work orders may have been silently dropped.
                  Ask the listed technicians to open each work order and tap <strong>Add Photos</strong> to re-attach what they still have on their phones.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400" />
            <Input
              placeholder="Search by technician, customer, address or work order #"
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
                {searchQuery ? "No matching work orders" : "All caught up"}
              </h3>
              <p className="text-gray-600">
                {searchQuery
                  ? "No work orders match your search."
                  : "No past work orders are missing photos."}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {groups.map(([groupName, items]) => {
              const isCollapsed = collapsed.has(groupName);
              return (
                <div key={groupName}>
                  <button
                    onClick={() => toggleGroup(groupName)}
                    className="w-full flex items-center justify-between px-4 py-3 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors"
                    data-testid={`group-toggle-${groupName}`}
                  >
                    <div className="flex items-center gap-2">
                      {isCollapsed ? <ChevronRight className="w-5 h-5 text-blue-700" /> : <ChevronDown className="w-5 h-5 text-blue-700" />}
                      <span className="text-base font-semibold text-blue-900">{groupName}</span>
                      <Badge className="bg-blue-200 text-blue-900 hover:bg-blue-200">{items.length}</Badge>
                    </div>
                  </button>
                  {!isCollapsed && (
                    <div className="mt-3 space-y-3">
                      {items.map(wo => (
                        <Card key={wo.id} className="hover:shadow-md transition-shadow">
                          <CardContent className="p-4">
                            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                              <div className="min-w-0 flex-1 space-y-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-semibold text-gray-900">{wo.workOrderNumber}</span>
                                  <Badge variant="outline" className="text-xs">{wo.status}</Badge>
                                </div>
                                <p className="text-sm text-gray-700 truncate">
                                  <Building2 className="inline w-3.5 h-3.5 mr-1 text-gray-400" />
                                  {wo.customerName}
                                  {wo.branchName ? ` — ${wo.branchName}` : ""}
                                </p>
                                {wo.projectName && (
                                  <p className="text-xs text-gray-600 truncate">{wo.projectName}</p>
                                )}
                                {wo.projectAddress && (
                                  <p className="text-xs text-gray-500 truncate">{wo.projectAddress}</p>
                                )}
                                <div className="flex items-center gap-4 text-xs text-gray-500 flex-wrap">
                                  <span className="flex items-center gap-1">
                                    <User className="w-3.5 h-3.5" />{wo.assignedTechnicianName || "Unassigned"}
                                  </span>
                                  {wo.scheduledDate && (
                                    <span className="flex items-center gap-1">
                                      <Calendar className="w-3.5 h-3.5" />Scheduled {formatDate(wo.scheduledDate)}
                                    </span>
                                  )}
                                  <span className="flex items-center gap-1">
                                    <Calendar className="w-3.5 h-3.5" />Created {formatDate(wo.createdAt)}
                                  </span>
                                </div>
                              </div>
                              <Button
                                size="sm"
                                onClick={() => setViewingWorkOrder(wo)}
                                className="bg-blue-600 hover:bg-blue-700 text-white w-full sm:w-auto"
                                data-testid={`button-open-work-order-${wo.id}`}
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
      </PageContent>

      {viewingWorkOrder && (
        <WorkOrderDetails
          workOrder={viewingWorkOrder}
          onClose={() => {
            setViewingWorkOrder(null);
            // Refetch so any work order that just had photos re-attached drops
            // off this report immediately.
            queryClient.invalidateQueries({ queryKey: ["/api/work-orders/missing-photos"] });
          }}
          onUpdate={() => {
            queryClient.invalidateQueries({ queryKey: ["/api/work-orders/missing-photos"] });
            queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
          }}
        />
      )}
    </PageContainer>
  );
}
