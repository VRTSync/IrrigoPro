import { Card, CardContent } from "@/components/ui/card";
import { Link } from "wouter";
import { FileText, UserCheck } from "lucide-react";

export function QuickActions() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <Link href="/operations">
        <Card className="cursor-pointer hover:shadow-md transition-shadow h-full" data-testid="card-quick-operations">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="bg-green-100 p-2.5 rounded-lg shrink-0">
              <FileText className="h-6 w-6 text-green-600" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-gray-900">Operations Management</h3>
              <p className="text-xs text-gray-500 truncate">Estimates, work orders & billing sheets</p>
            </div>
          </CardContent>
        </Card>
      </Link>
      <Link href="/customers">
        <Card className="cursor-pointer hover:shadow-md transition-shadow h-full" data-testid="card-quick-customers">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="bg-purple-100 p-2.5 rounded-lg shrink-0">
              <UserCheck className="h-6 w-6 text-purple-600" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-gray-900">Customer Management</h3>
              <p className="text-xs text-gray-500 truncate">Manage customer info & relationships</p>
            </div>
          </CardContent>
        </Card>
      </Link>
    </div>
  );
}
