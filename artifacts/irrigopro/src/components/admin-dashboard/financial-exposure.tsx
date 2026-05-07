import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { CheckCircle, Clock, DollarSign, TrendingUp, ChevronRight } from "lucide-react";

interface FinancialExposureProps {
  approvedUnbilled: number;
  unapprovedUnbilled: number;
  totalUnbilled: number;
  thisMonthBilled: number;
  isLoading: boolean;
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function FinancialExposure({
  approvedUnbilled,
  unapprovedUnbilled,
  totalUnbilled,
  thisMonthBilled,
  isLoading,
}: FinancialExposureProps) {
  const tiles = [
    { key: "approved",   label: "Approved Unbilled",   value: approvedUnbilled,   icon: CheckCircle, accent: "text-green-600 bg-green-50",  border: "border-l-green-500" },
    { key: "unapproved", label: "Unapproved Unbilled", value: unapprovedUnbilled, icon: Clock,       accent: "text-amber-600 bg-amber-50",  border: "border-l-amber-500" },
    { key: "total",      label: "Total Unbilled",      value: totalUnbilled,      icon: DollarSign,  accent: "text-blue-600 bg-blue-50",    border: "border-l-blue-500" },
    { key: "month",      label: "This Month Billed",   value: thisMonthBilled,    icon: TrendingUp,  accent: "text-purple-600 bg-purple-50",border: "border-l-purple-500" },
  ];

  return (
    <Card>
      <CardHeader className="pb-3 flex flex-row items-center justify-between">
        <CardTitle className="text-base font-semibold text-gray-800 flex items-center gap-2">
          <DollarSign className="w-4 h-4 text-gray-500" />
          Financial Exposure
        </CardTitle>
        <Link href="/billing/dashboard">
          <Button variant="ghost" size="sm" className="text-xs gap-1" data-testid="link-billing-dashboard">
            Billing Dashboard <ChevronRight className="w-3.5 h-3.5" />
          </Button>
        </Link>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {tiles.map((t) => {
            const Icon = t.icon;
            return (
              <div
                key={t.key}
                className={`border-l-4 ${t.border} bg-white border border-gray-100 rounded-lg p-3`}
                data-testid={`exposure-${t.key}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-gray-500 truncate">{t.label}</p>
                    {isLoading ? (
                      <Skeleton className="h-7 w-24 mt-1" />
                    ) : (
                      <p className="text-xl font-bold text-gray-900 mt-1 truncate">{formatCurrency(t.value)}</p>
                    )}
                  </div>
                  <div className={`${t.accent} p-1.5 rounded-md shrink-0`}>
                    <Icon className="w-4 h-4" />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
