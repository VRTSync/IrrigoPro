import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { FileText, Wrench, ClipboardList, Receipt, ChevronRight, Workflow } from "lucide-react";

interface PipelineStage {
  key: string;
  label: string;
  count: number;
  href: string;
  icon: typeof FileText;
  accent: string;
}

interface OperationsPipelineProps {
  estimates: number;
  workOrdersOpen: number;
  workOrdersInProgress: number;
  workOrdersCompleted: number;
  billingSheets: number;
  invoicesThisMonth: number;
  isLoading: boolean;
}

export function OperationsPipeline(props: OperationsPipelineProps) {
  const stages: PipelineStage[] = [
    { key: "estimates",    label: "Estimates",         count: props.estimates,           href: "/operations",       icon: FileText,      accent: "text-blue-600 bg-blue-50" },
    { key: "wo-open",      label: "Open Work Orders",  count: props.workOrdersOpen,      href: "/work-orders",      icon: Wrench,        accent: "text-amber-600 bg-amber-50" },
    { key: "wo-progress",  label: "In Progress",       count: props.workOrdersInProgress,href: "/work-orders",      icon: Wrench,        accent: "text-orange-600 bg-orange-50" },
    { key: "wo-completed", label: "Completed",         count: props.workOrdersCompleted, href: "/work-orders",      icon: Wrench,        accent: "text-green-600 bg-green-50" },
    { key: "billing",      label: "Billing Sheets",    count: props.billingSheets,       href: "/billing-sheets",   icon: ClipboardList, accent: "text-teal-600 bg-teal-50" },
    { key: "invoices",     label: "Invoices (Month)",  count: props.invoicesThisMonth,   href: "/invoices",         icon: Receipt,       accent: "text-purple-600 bg-purple-50" },
  ];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold text-gray-800 flex items-center gap-2">
          <Workflow className="w-4 h-4 text-gray-500" />
          Operations Pipeline
        </CardTitle>
      </CardHeader>
      <CardContent>
        {props.isLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {stages.map((_, i) => <Skeleton key={i} className="h-24" />)}
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 items-stretch">
            {stages.map((s, i) => {
              const Icon = s.icon;
              return (
                <div key={s.key} className="flex items-center">
                  <Link href={s.href}>
                    <div
                      className="flex-1 border border-gray-100 rounded-lg p-3 hover:bg-gray-50 transition-colors cursor-pointer h-full min-w-0"
                      data-testid={`pipeline-${s.key}`}
                    >
                      <div className={`inline-flex items-center justify-center rounded-md ${s.accent} p-1.5 mb-2`}>
                        <Icon className="w-3.5 h-3.5" />
                      </div>
                      <p className="text-xl font-bold text-gray-900 leading-tight">{s.count}</p>
                      <p className="text-xs text-gray-500 mt-0.5 leading-tight">{s.label}</p>
                    </div>
                  </Link>
                  {i < stages.length - 1 && (
                    <ChevronRight className="w-4 h-4 text-gray-300 mx-1 hidden lg:block shrink-0" />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
