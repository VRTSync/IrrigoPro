import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";

export const WC_STATUS_OPTIONS = [
  { value: "all", label: "All statuses" },
  { value: "submitted,pending_manager_review", label: "Needs Review" },
  { value: "approved_passed_to_billing,billed", label: "Ready to Bill / Billed" },
  { value: "in_progress", label: "In progress" },
  { value: "submitted", label: "Submitted" },
  { value: "pending_manager_review", label: "Pending manager review" },
  { value: "approved", label: "Approved" },
  { value: "approved_passed_to_billing", label: "Approved (passed to billing)" },
  { value: "partially_converted", label: "Partially converted" },
  { value: "converted", label: "Converted" },
  { value: "billed", label: "Billed" },
] as const;

export interface WetCheckFilterBarProps {
  status: string;
  onStatusChange: (v: string) => void;
  customer: string;
  onCustomerChange: (v: string) => void;
  tech: string;
  onTechChange: (v: string) => void;
  company?: string;
  onCompanyChange?: (v: string) => void;
  companies?: Array<{ id: number; name: string }>;
}

export function WetCheckFilterBar({
  status,
  onStatusChange,
  customer,
  onCustomerChange,
  tech,
  onTechChange,
  company,
  onCompanyChange,
  companies = [],
}: WetCheckFilterBarProps) {
  return (
    <Card data-testid="wc-filter-bar">
      <CardContent className="pt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
          <Input
            placeholder="Customer, address, or id…"
            value={customer}
            onChange={(e) => onCustomerChange(e.target.value)}
            className="pl-8"
            data-testid="input-wc-customer-filter"
          />
        </div>

        <div className="relative flex-1 min-w-[160px]">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
          <Input
            placeholder="Technician…"
            value={tech}
            onChange={(e) => onTechChange(e.target.value)}
            className="pl-8"
            data-testid="input-wc-tech-filter"
          />
        </div>

        <Select value={status} onValueChange={onStatusChange}>
          <SelectTrigger className="w-full sm:w-52" data-testid="select-wc-status-filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {WC_STATUS_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {onCompanyChange !== undefined && (
          <Select value={company ?? "all"} onValueChange={onCompanyChange}>
            <SelectTrigger className="w-full sm:w-52" data-testid="select-wc-company-filter">
              <SelectValue placeholder="All companies" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All companies</SelectItem>
              {companies.map((c) => (
                <SelectItem key={c.id} value={c.name}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </CardContent>
    </Card>
  );
}
