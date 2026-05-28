import { Badge } from "@/components/ui/badge";

export function WetCheckBillingStatusBadge({ status }: { status: string }) {
  switch (status) {
    case "submitted":
      return <Badge className="bg-blue-100 text-blue-800">Submitted</Badge>;
    case "pending_manager_review":
      return <Badge className="bg-orange-100 text-orange-800">Pending Review</Badge>;
    case "approved_passed_to_billing":
      return <Badge className="bg-teal-100 text-teal-800">Approved</Badge>;
    case "billed":
      return <Badge className="bg-purple-100 text-purple-800">Billed</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}
