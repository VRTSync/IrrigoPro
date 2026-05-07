import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import { Building2, User } from "lucide-react";

export interface TopCustomer {
  id: number;
  name: string;
  unbilledTotal: number;
}

export interface TopTechnician {
  id: number;
  name: string;
  openTickets: number;
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

interface TopListsProps {
  customers: TopCustomer[];
  technicians: TopTechnician[];
  isLoading: boolean;
}

export function TopLists({ customers, technicians, isLoading }: TopListsProps) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold text-gray-800 flex items-center gap-2">
            <Building2 className="w-4 h-4 text-gray-500" />
            Top Customers by Unbilled Balance
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-8" />)}
            </div>
          ) : customers.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-4">No unbilled balances</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {customers.map((c, idx) => (
                <li key={c.id} className="flex items-center justify-between py-2">
                  <Link href={`/customers/${c.id}/profile`}>
                    <div className="flex items-center gap-2 min-w-0 cursor-pointer hover:underline" data-testid={`top-customer-${c.id}`}>
                      <span className="text-xs font-bold text-gray-400 w-4 shrink-0">{idx + 1}</span>
                      <span className="text-sm font-medium text-gray-800 truncate">{c.name}</span>
                    </div>
                  </Link>
                  <Badge variant="outline" className="shrink-0 ml-2 text-blue-700 border-blue-200 bg-blue-50 font-semibold">
                    {formatCurrency(c.unbilledTotal)}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold text-gray-800 flex items-center gap-2">
            <User className="w-4 h-4 text-gray-500" />
            Top Technicians by Open Tickets
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-8" />)}
            </div>
          ) : technicians.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-4">No active technicians</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {technicians.map((t, idx) => (
                <li key={t.id} className="flex items-center justify-between py-2" data-testid={`top-tech-${t.id}`}>
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs font-bold text-gray-400 w-4 shrink-0">{idx + 1}</span>
                    <span className="text-sm font-medium text-gray-800 truncate">{t.name}</span>
                  </div>
                  <Badge variant="outline" className="shrink-0 ml-2 text-amber-700 border-amber-200 bg-amber-50 font-semibold">
                    {t.openTickets} open
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
