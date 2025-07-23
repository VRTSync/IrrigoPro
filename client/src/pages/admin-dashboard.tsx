import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Shield, FileText, UserCheck } from "lucide-react";
import { Link } from "wouter";

export default function AdminDashboard() {
  return (
    <div className="pb-4 px-4 sm:p-6 max-w-7xl mx-auto space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Admin Dashboard</h1>
          <p className="text-gray-600 mt-1">System administration and oversight</p>
        </div>
        <Badge variant="outline" className="text-sm">
          <Shield className="w-4 h-4 mr-1" />
          Administrator Access
        </Badge>
      </div>

      {/* Main Admin Actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        <Link href="/operations">
          <Card className="cursor-pointer hover:shadow-lg transition-shadow h-full">
            <CardContent className="p-6 text-center">
              <FileText className="h-12 w-12 text-green-600 mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">Operations Management</h3>
              <p className="text-gray-600 text-sm mb-4">View and manage estimates, work orders, and billing sheets</p>
              <Badge className="bg-green-100 text-green-800">All Operations</Badge>
            </CardContent>
          </Card>
        </Link>

        <Link href="/customers">
          <Card className="cursor-pointer hover:shadow-lg transition-shadow h-full">
            <CardContent className="p-6 text-center">
              <UserCheck className="h-12 w-12 text-purple-600 mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">Customer Management</h3>
              <p className="text-gray-600 text-sm mb-4">Manage customer information and relationships</p>
              <Badge className="bg-purple-100 text-purple-800">Customer Data</Badge>
            </CardContent>
          </Card>
        </Link>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold text-blue-600">4</div>
            <div className="text-sm text-gray-600">Active Users</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold text-green-600">12</div>
            <div className="text-sm text-gray-600">Open Work Orders</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold text-purple-600">8</div>
            <div className="text-sm text-gray-600">Active Customers</div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}