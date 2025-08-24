import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EnhancedEstimateModal } from "@/components/estimates/enhanced-estimate-modal";
import { EstimateDetailModal } from "@/components/estimates/estimate-detail-modal";
import { QuickBooksIntegration } from "@/components/quickbooks/quickbooks-integration";
import { Plus, FileText, Mail, Download, Eye, Edit2, RefreshCw } from "lucide-react";
import { useState, useEffect } from "react";
import type { Estimate } from "@shared/schema";

export default function Estimates() {
  const [showEstimateModal, setShowEstimateModal] = useState(false);
  const [selectedEstimateId, setSelectedEstimateId] = useState<number | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [editEstimateId, setEditEstimateId] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const queryClient = useQueryClient();

  // Get current user role
  const getCurrentUser = () => {
    const savedUser = localStorage.getItem("user");
    return savedUser ? JSON.parse(savedUser) : null;
  };

  const currentUser = getCurrentUser();
  const isIrrigationManager = currentUser?.role === 'irrigation_manager';
  const isFieldTech = currentUser?.role === 'field_tech';

  // Check for create parameter in URL
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('create') === 'true') {
      setShowEstimateModal(true);
      // Clean up URL
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const { data: estimates, isLoading } = useQuery<Estimate[]>({
    queryKey: ["/api/estimates"],
  });

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await queryClient.invalidateQueries({ queryKey: ["/api/estimates"] });
      await queryClient.refetchQueries({ queryKey: ["/api/estimates"] });
    } finally {
      setRefreshing(false);
    }
  };

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
      case 'converted_to_work_order':
        return <Badge className="bg-purple-100 text-purple-800 border-purple-200">Converted to Work Order</Badge>;
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

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* Header */}
      <div className="mb-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Estimates</h1>
            <p className="text-gray-600 mt-1">Manage and track your irrigation estimates</p>
          </div>
          <div className="mt-4 sm:mt-0 flex gap-2">
            <Button 
              onClick={handleRefresh}
              disabled={refreshing}
              variant="outline"
              className="flex items-center gap-2"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
              {refreshing ? 'Checking...' : 'Check Status'}
            </Button>
            <Button onClick={() => setShowEstimateModal(true)} className="bg-primary text-white hover:bg-blue-700">
              <Plus className="w-4 h-4 mr-2" />
              New Estimate
            </Button>
          </div>
        </div>
      </div>

      <Tabs defaultValue="estimates" className="space-y-6">
        <TabsList className={`grid w-full ${isIrrigationManager || isFieldTech ? 'grid-cols-1' : 'grid-cols-2'}`}>
          <TabsTrigger value="estimates">Estimates</TabsTrigger>
          {!isIrrigationManager && !isFieldTech && (
            <TabsTrigger value="quickbooks">QuickBooks</TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="estimates">

        {/* Estimates List - Responsive Design */}
        {/* Desktop Table View */}
        <div className="hidden lg:block">
          <Card className="bg-white shadow-sm border border-gray-200">
            <CardHeader className="px-6 py-4 border-b border-gray-200">
              <CardTitle className="text-lg font-semibold text-gray-900">All Estimates</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Estimate
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Customer
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Project
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Amount
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Status
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Date
                      </th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {isLoading ? (
                      Array.from({ length: 5 }).map((_, i) => (
                        <tr key={i}>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="flex items-center">
                              <Skeleton className="h-8 w-8 rounded-lg mr-3" />
                              <Skeleton className="h-4 w-24" />
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <Skeleton className="h-4 w-32" />
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <Skeleton className="h-4 w-40" />
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <Skeleton className="h-4 w-16" />
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <Skeleton className="h-5 w-16 rounded-full" />
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <Skeleton className="h-4 w-20" />
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-right">
                            <Skeleton className="h-8 w-24" />
                          </td>
                        </tr>
                      ))
                    ) : (
                      estimates?.map((estimate) => (
                        <tr key={estimate.id} className="hover:bg-gray-50">
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="flex items-center">
                              <div className="bg-blue-50 p-2 rounded-lg mr-3">
                                <FileText className="w-4 h-4 text-blue-600" />
                              </div>
                              <div>
                                <div className="text-sm font-medium text-gray-900">{estimate.estimateNumber}</div>
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm text-gray-900">{estimate.customerName}</div>
                            <div className="text-sm text-gray-500">{estimate.customerEmail}</div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm text-gray-900">{estimate.projectName}</div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm font-medium text-gray-900">
                              {formatCurrency(parseFloat(estimate.totalAmount))}
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            {getStatusBadge(estimate.status)}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                            {formatDate(estimate.createdAt)}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                            <div className="flex items-center space-x-2 justify-end">
                              <Button 
                                variant="outline" 
                                size="sm" 
                                className="text-blue-600 hover:text-blue-800"
                                onClick={() => {
                                  setSelectedEstimateId(estimate.id);
                                  setShowDetailModal(true);
                                }}
                              >
                                <Eye className="w-4 h-4 mr-1" />
                                View Details
                              </Button>
                              {estimate.status !== 'converted_to_work_order' && (
                                <>
                                  <Button 
                                    variant="ghost" 
                                    size="sm" 
                                    className="text-blue-600 hover:text-blue-800"
                                    onClick={() => {
                                      setEditEstimateId(estimate.id);
                                      setShowEstimateModal(true);
                                    }}
                                  >
                                    <Edit2 className="w-4 h-4" />
                                  </Button>
                                  <Button variant="ghost" size="sm" className="text-gray-600 hover:text-gray-900">
                                    <Mail className="w-4 h-4" />
                                  </Button>
                                  <Button variant="ghost" size="sm" className="text-gray-600 hover:text-gray-900">
                                    <Download className="w-4 h-4" />
                                  </Button>
                                </>
                              )}
                              {estimate.status === 'converted_to_work_order' && (
                                <span className="text-sm text-gray-500 italic">Cannot edit - Converted</span>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Mobile Card View */}
        <div className="lg:hidden space-y-4">
          {isLoading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <Card key={i} className="bg-white shadow-sm border border-gray-200">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center">
                      <Skeleton className="h-10 w-10 rounded-lg mr-3" />
                      <div>
                        <Skeleton className="h-4 w-24 mb-1" />
                        <Skeleton className="h-3 w-16" />
                      </div>
                    </div>
                    <Skeleton className="h-6 w-16 rounded-full" />
                  </div>
                  <div className="space-y-2">
                    <Skeleton className="h-3 w-32" />
                    <Skeleton className="h-3 w-40" />
                    <div className="flex justify-between items-center pt-2">
                      <Skeleton className="h-4 w-20" />
                      <Skeleton className="h-3 w-16" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          ) : (
            estimates?.map((estimate) => (
              <Card key={estimate.id} className="bg-white shadow-sm border border-gray-200 hover:shadow-md transition-shadow">
                <CardContent className="p-4">
                  {/* Header */}
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center">
                      <div className="bg-blue-50 p-2 rounded-lg mr-3">
                        <FileText className="w-5 h-5 text-blue-600" />
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-gray-900">{estimate.estimateNumber}</div>
                      </div>
                    </div>
                    {getStatusBadge(estimate.status)}
                  </div>

                  {/* Content */}
                  <div className="space-y-2">
                    <div>
                      <div className="text-sm font-medium text-gray-900">{estimate.customerName}</div>
                      <div className="text-xs text-gray-500">{estimate.customerEmail}</div>
                    </div>
                    <div className="text-sm text-gray-700">{estimate.projectName}</div>
                    
                    {/* Bottom Row */}
                    <div className="flex justify-between items-center pt-2 border-t border-gray-100">
                      <div className="text-lg font-bold text-gray-900">
                        {formatCurrency(parseFloat(estimate.totalAmount))}
                      </div>
                      <div className="text-xs text-gray-500">
                        {formatDate(estimate.createdAt)}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center space-x-2 pt-3 border-t border-gray-100">
                      <Button 
                        variant="outline" 
                        size="sm" 
                        className="flex-1"
                        onClick={() => {
                          setSelectedEstimateId(estimate.id);
                          setShowDetailModal(true);
                        }}
                      >
                        <Eye className="w-4 h-4 mr-2" />
                        View Details
                      </Button>
                      {estimate.status !== 'converted_to_work_order' && (
                        <>
                          <Button 
                            variant="outline" 
                            size="sm"
                            onClick={() => {
                              setEditEstimateId(estimate.id);
                              setShowEstimateModal(true);
                            }}
                          >
                            <Edit2 className="w-4 h-4" />
                          </Button>
                          <Button variant="outline" size="sm">
                            <Mail className="w-4 h-4" />
                          </Button>
                          <Button variant="outline" size="sm">
                            <Download className="w-4 h-4" />
                          </Button>
                        </>
                      )}
                    </div>
                    {estimate.status === 'converted_to_work_order' && (
                      <div className="pt-3 border-t border-gray-100">
                        <span className="text-sm text-gray-500 italic">Converted to Work Order</span>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
        </TabsContent>

        {!isIrrigationManager && !isFieldTech && (
          <TabsContent value="quickbooks">
            <QuickBooksIntegration />
          </TabsContent>
        )}
      </Tabs>

      {/* Estimate Modal */}
      <EnhancedEstimateModal
        open={showEstimateModal}
        onOpenChange={(open) => {
          setShowEstimateModal(open);
          if (!open) {
            setEditEstimateId(null);
          }
        }}
        estimateId={editEstimateId}
      />

      {/* Estimate Detail Modal */}
      <EstimateDetailModal
        open={showDetailModal}
        onOpenChange={setShowDetailModal}
        estimateId={selectedEstimateId}
        onEdit={(estimateId) => {
          setEditEstimateId(estimateId);
          setShowDetailModal(false);
          setShowEstimateModal(true);
        }}
      />
    </div>
  );
}
