import { Badge } from "@/components/ui/badge";

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  draft: { label: "Draft", className: "bg-gray-100 text-gray-800 border-gray-200" },
  submitted: { label: "Submitted", className: "bg-blue-100 text-blue-800 border-blue-200" },
  pending_manager_review: { label: "Pending Review", className: "bg-orange-100 text-orange-800 border-orange-200" },
  approved_passed_to_billing: { label: "Approved", className: "bg-teal-100 text-teal-800 border-teal-200" },
  billed: { label: "Billed", className: "bg-purple-100 text-purple-800 border-purple-200" },
};

interface WetCheckBillingStatusBadgeProps {
  status: string;
}

export function WetCheckBillingStatusBadge({ status }: WetCheckBillingStatusBadgeProps) {
  const config = STATUS_CONFIG[status];
  if (!config) {
    return <Badge variant="outline" data-testid="status-badge">{status}</Badge>;
  }
  return <Badge className={config.className} data-testid="status-badge">{config.label}</Badge>;
}
