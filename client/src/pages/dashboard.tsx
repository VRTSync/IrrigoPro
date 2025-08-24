import { useQuery } from "@tanstack/react-query";
import { DashboardSkeleton } from "@/components/ui/loading-skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EstimateModal } from "@/components/estimates/estimate-modal";
import { CompanyLogoBanner } from "@/components/ui/company-logo-banner";
import { Plus, Settings, Clock, CheckCircle, DollarSign, Package, FileText, TrendingUp, Wrench, Users, UserCheck, FolderOpen } from "lucide-react";
import { useState } from "react";
import { Link } from "wouter";

interface DashboardStats {
  pendingEstimates: number;
  approvedThisMonth: number;
  totalRevenue: number;
  activeUsers: number;
  openWorkOrders: number;
  activeCustomers: number;
  workOrderStats: {
    pending: number;
    inProgress: number;
    completed: number;
  };
  recentEstimates: Array<{
    id: number;
    estimateNumber: string;
    customerName: string;
    totalAmount: string;
    status: string;
    createdAt: string;
  }>;
  topParts: Array<{
    id: number;
    name: string;
    usage: number;
  }>;
}

export default function Dashboard() {
  const [showEstimateModal, setShowEstimateModal] = useState(false);

  const { data: stats, isLoading } = useQuery<DashboardStats>({
    queryKey: ["/api/dashboard/stats"],
  });

  // Get current user info from session API (production-safe)
  const { data: user } = useQuery<{ companyId: number }>({
    queryKey: ["/api/auth/user"],
    retry: false,
  });

  // Fetch company profile to get company info
  const { data: company } = useQuery({
    queryKey: [`/api/company/${user?.companyId}/profile`],
    enabled: !!user?.companyId,
    retry: false,
  });

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
        return <Badge className="status-pending">Pending</Badge>;
      case 'approved':
        return <Badge className="status-approved">Approved</Badge>;
      case 'rejected':
        return <Badge className="status-rejected">Rejected</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const formatDate = (date: string | Date) => {
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  const getTimeAgo = (date: string | Date) => {
    const now = new Date();
    const past = new Date(date);
    const diffInDays = Math.floor((now.getTime() - past.getTime()) / (1000 * 60 * 60 * 24));
    
    if (diffInDays === 0) return 'Today';
    if (diffInDays === 1) return '1 day ago';
    if (diffInDays < 7) return `${diffInDays} days ago`;
    if (diffInDays < 14) return '1 week ago';
    return formatDate(date);
  };

  // Show full page skeleton while loading (after all hooks)
  if (isLoading) {
    return <DashboardSkeleton />;
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* Company Logo Banner */}
      <CompanyLogoBanner className="mb-6" />

      {/* Header */}
      <div className="mb-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
            <p className="text-gray-600 mt-1">Manage your irrigation estimates and track your business</p>
          </div>
          <div className="mt-4 sm:mt-0 flex space-x-3">
            <Button onClick={() => setShowEstimateModal(true)} className="bg-primary text-white hover:bg-blue-700">
              <Plus className="w-4 h-4 mr-2" />
              New Estimate
            </Button>
            <Button variant="outline" className="border-gray-300 text-gray-700 hover:bg-gray-50">
              <Settings className="w-4 h-4 mr-2" />
              Settings
            </Button>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
          {/* Active Users Card */}
          <Link href="/company-user-management">
            <Card className="bg-white shadow-sm border border-gray-200 hover:shadow-md transition-shadow cursor-pointer">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-600">Active Users</p>
                    {isLoading ? (
                      <Skeleton className="h-8 w-12 mt-2" />
                    ) : (
                      <p className="text-2xl font-bold text-gray-900">{stats?.activeUsers || 0}</p>
                    )}
                  </div>
                  <div className="bg-blue-50 p-3 rounded-lg">
                    <Users className="w-5 h-5 text-blue-600" />
                  </div>
                </div>
                <div className="mt-4 flex items-center text-sm">
                  <UserCheck className="w-4 h-4 text-blue-600 mr-1" />
                  <span className="text-blue-600 font-medium">Click to manage users</span>
                </div>
              </CardContent>
            </Card>
          </Link>

          {/* Open Work Orders Card */}
          <Link href="/work-orders">
            <Card className="bg-white shadow-sm border border-gray-200 hover:shadow-md transition-shadow cursor-pointer">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-600">Open Work Orders</p>
                    {isLoading ? (
                      <Skeleton className="h-8 w-12 mt-2" />
                    ) : (
                      <p className="text-2xl font-bold text-gray-900">{stats?.openWorkOrders || 0}</p>
                    )}
                  </div>
                  <div className="bg-orange-50 p-3 rounded-lg">
                    <Wrench className="w-5 h-5 text-orange-600" />
                  </div>
                </div>
                <div className="mt-4 flex items-center text-sm">
                  <FolderOpen className="w-4 h-4 text-orange-600 mr-1" />
                  <span className="text-orange-600 font-medium">View all work orders</span>
                </div>
              </CardContent>
            </Card>
          </Link>

          {/* Active Customers Card */}
          <Link href="/customers">
            <Card className="bg-white shadow-sm border border-gray-200 hover:shadow-md transition-shadow cursor-pointer">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-600">Active Customers</p>
                    {isLoading ? (
                      <Skeleton className="h-8 w-12 mt-2" />
                    ) : (
                      <p className="text-2xl font-bold text-gray-900">{stats?.activeCustomers || 0}</p>
                    )}
                  </div>
                  <div className="bg-green-50 p-3 rounded-lg">
                    <Users className="w-5 h-5 text-green-600" />
                  </div>
                </div>
                <div className="mt-4 flex items-center text-sm">
                  <CheckCircle className="w-4 h-4 text-green-600 mr-1" />
                  <span className="text-green-600 font-medium">Manage customers</span>
                </div>
              </CardContent>
            </Card>
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Recent Estimates */}
        <div className="lg:col-span-2">
          <Card className="bg-white shadow-sm border border-gray-200">
            <CardHeader className="px-6 py-4 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg font-semibold text-gray-900">Recent Estimates</CardTitle>
                <Link href="/estimates">
                  <Button variant="ghost" size="sm" className="text-primary hover:text-blue-700">
                    View All
                  </Button>
                </Link>
              </div>
            </CardHeader>
            <CardContent className="p-6">
              <div className="space-y-4">
                {isLoading ? (
                  // Loading skeletons
                  Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                      <div className="flex items-center space-x-4">
                        <Skeleton className="h-10 w-10 rounded-lg" />
                        <div className="space-y-2">
                          <Skeleton className="h-4 w-32" />
                          <Skeleton className="h-3 w-48" />
                          <Skeleton className="h-3 w-24" />
                        </div>
                      </div>
                      <div className="text-right space-y-2">
                        <Skeleton className="h-4 w-16" />
                        <Skeleton className="h-5 w-16" />
                      </div>
                    </div>
                  ))
                ) : (
                  stats?.recentEstimates?.map((estimate: any) => (
                    <div key={estimate.id} className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                      <div className="flex items-center space-x-4">
                        <div className="bg-blue-50 p-2 rounded-lg">
                          <FileText className="w-5 h-5 text-blue-600" />
                        </div>
                        <div>
                          <p className="font-medium text-gray-900">{estimate.estimateNumber}</p>
                          <p className="text-sm text-gray-600">{estimate.customerName}</p>
                          <p className="text-xs text-gray-500">Created {getTimeAgo(estimate.createdAt)}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        {getStatusBadge(estimate.status)}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Quick Actions */}
          <Card className="bg-white shadow-sm border border-gray-200">
            <CardHeader className="px-6 py-4 border-b border-gray-200">
              <CardTitle className="text-lg font-semibold text-gray-900">Quick Actions</CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              <div className="space-y-3">
                <Button
                  onClick={() => setShowEstimateModal(true)}
                  className="w-full justify-between bg-blue-50 text-blue-700 hover:bg-blue-100 border-0"
                  variant="outline"
                >
                  <div className="flex items-center space-x-3">
                    <div className="bg-blue-100 p-2 rounded-lg">
                      <Plus className="w-4 h-4 text-blue-600" />
                    </div>
                    <span className="font-medium">Create New Estimate</span>
                  </div>
                </Button>

                <Link href="/parts">
                  <Button
                    className="w-full justify-between bg-gray-50 text-gray-700 hover:bg-gray-100 border-0"
                    variant="outline"
                  >
                    <div className="flex items-center space-x-3">
                      <div className="bg-gray-100 p-2 rounded-lg">
                        <Package className="w-4 h-4 text-gray-600" />
                      </div>
                      <span className="font-medium">Manage Parts Catalog</span>
                    </div>
                  </Button>
                </Link>

                <Link href="/customers">
                  <Button
                    className="w-full justify-between bg-gray-50 text-gray-700 hover:bg-gray-100 border-0"
                    variant="outline"
                  >
                    <div className="flex items-center space-x-3">
                      <div className="bg-gray-100 p-2 rounded-lg">
                        <Package className="w-4 h-4 text-gray-600" />
                      </div>
                      <span className="font-medium">Customer Database</span>
                    </div>
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>

          {/* Top Parts */}
          <Card className="bg-white shadow-sm border border-gray-200">
            <CardHeader className="px-6 py-4 border-b border-gray-200">
              <CardTitle className="text-lg font-semibold text-gray-900">Top Parts This Month</CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              <div className="space-y-4">
                {isLoading ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        <Skeleton className="h-8 w-8 rounded-lg" />
                        <div className="space-y-1">
                          <Skeleton className="h-4 w-32" />
                          <Skeleton className="h-3 w-16" />
                        </div>
                      </div>
                      <Skeleton className="h-4 w-12" />
                    </div>
                  ))
                ) : (
                  stats?.topParts?.map((part: any) => (
                    <div key={part.id} className="flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        <div className="bg-blue-50 p-2 rounded-lg">
                          <Package className="w-4 h-4 text-blue-600" />
                        </div>
                        <div>
                          <p className="font-medium text-gray-900">{part.name}</p>
                          <p className="text-sm text-gray-600">{part.usage} used</p>
                        </div>
                      </div>
                      <span className="text-sm font-medium text-gray-900">{part.usage}</span>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Estimate Modal */}
      <EstimateModal
        open={showEstimateModal}
        onOpenChange={setShowEstimateModal}
      />
    </div>
  );
}
