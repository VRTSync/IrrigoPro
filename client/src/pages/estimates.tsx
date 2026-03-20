import { safeGet } from "@/utils/safeStorage";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { EstimateListSkeleton } from "@/components/ui/loading-skeleton";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EstimateModal } from "@/components/estimates/estimate-modal";
import { EstimateDetailModal } from "@/components/estimates/estimate-detail-modal";
import { QuickBooksIntegration } from "@/components/quickbooks/quickbooks-integration";
import { Plus, FileText, Mail, Download, Eye, Edit2, RefreshCw, Wrench, ChevronDown, ChevronRight } from "lucide-react";
import { useState, useEffect } from "react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Estimate } from "@shared/schema";

export default function Estimates() {
  const [showEstimateModal, setShowEstimateModal] = useState(false);
  const [selectedEstimateId, setSelectedEstimateId] = useState<number | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [editEstimateId, setEditEstimateId] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [creatingWorkOrder, setCreatingWorkOrder] = useState<number | null>(null);
  const [activeExpanded, setActiveExpanded] = useState(true);
  const [completedExpanded, setCompletedExpanded] = useState(true);

  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Get current user role
  const getCurrentUser = () => {
    const savedUser = safeGet("user");
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

  const handleCheckStatus = async (estimateId: number) => {
    try {
      // Invalidate and refetch specific estimate and all estimates
      await queryClient.invalidateQueries({ queryKey: ["/api/estimates", estimateId] });
      await queryClient.invalidateQueries({ queryKey: ["/api/estimates"] });
      await queryClient.refetchQueries({ queryKey: ["/api/estimates"] });
    } catch (error) {
      console.error("Error checking estimate status:", error);
    }
  };

  const handleCreateWorkOrder = async (estimateId: number) => {
    setCreatingWorkOrder(estimateId);
    try {
      const response = await apiRequest(`/api/estimates/${estimateId}/convert-to-work-order`, "POST", {});

      toast({
        title: "Work Order Created",
        description: "The estimate has been successfully converted to a work order.",
      });
      
      // Refresh estimates list and work orders
      await queryClient.invalidateQueries({ queryKey: ["/api/estimates"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to create work order. Please try again.",
        variant: "destructive",
      });
      console.error("Error creating work order:", error);
    } finally {
      setCreatingWorkOrder(null);
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

  const activeStatuses = ['pending', 'approved'];
  const completedStatuses = ['rejected', 'converted_to_work_order'];

  const activeEstimates = estimates?.filter(e => activeStatuses.includes(e.status)) || [];
  const completedEstimates = estimates?.filter(e => completedStatuses.includes(e.status)) || [];

  // Show full page skeleton while loading (after all hooks)
  if (isLoading) {
    return <EstimateListSkeleton />;
  }

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
          <div className="space-y-4">
            {/* Active Section */}
            <div>
              <button
                onClick={() => setActiveExpanded(!activeExpanded)}
                className="w-full flex items-center justify-between px-4 py-3 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors"
              >
                <div className="flex items-center gap-2">
                  {activeExpanded ? <ChevronDown className="w-5 h-5 text-blue-700" /> : <ChevronRight className="w-5 h-5 text-blue-700" />}
                  <span className="text-base font-semibold text-blue-900">Active</span>
                  <Badge className="bg-blue-200 text-blue-900 hover:bg-blue-200">{activeEstimates.length}</Badge>
                </div>
              </button>

              {activeExpanded && (
                <>
                  {/* Desktop Table View */}
                  <div className="hidden lg:block mt-3">
                    <Card className="bg-white shadow-sm border border-gray-200">
                      <CardContent className="p-0">
                        <div className="overflow-x-auto">
                          <table className="w-full">
                            <thead className="bg-gray-50">
                              <tr>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Estimate</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Customer</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Project</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Amount</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                              </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                              {activeEstimates.length === 0 ? (
                                <tr>
                                  <td colSpan={7} className="px-6 py-8 text-center text-gray-500">No active estimates</td>
                                </tr>
                              ) : (
                                activeEstimates.map((estimate) => (
                                  <tr key={estimate.id} className="hover:bg-gray-50">
                                    <td className="px-6 py-4 whitespace-nowrap">
                                      <div className="flex items-center">
                                        <div className="bg-blue-50 p-2 rounded-lg mr-3">
                                          <FileText className="w-4 h-4 text-blue-600" />
                                        </div>
                                        <div className="text-sm font-medium text-gray-900">{estimate.estimateNumber}</div>
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
                                      <div className="text-sm font-medium text-gray-900">{formatCurrency(parseFloat(estimate.totalAmount))}</div>
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap">{getStatusBadge(estimate.status)}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{formatDate(estimate.createdAt)}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                      <div className="flex items-center space-x-2 justify-end">
                                        <Button variant="outline" size="sm" className="text-blue-600 hover:text-blue-800" onClick={() => { setSelectedEstimateId(estimate.id); setShowDetailModal(true); }}>
                                          <Eye className="w-4 h-4 mr-1" />View Details
                                        </Button>
                                        {estimate.status === 'approved' && (
                                          <Button variant="outline" size="sm" className="text-green-600 hover:text-green-800 border-green-300 hover:border-green-400" onClick={() => handleCreateWorkOrder(estimate.id)} disabled={creatingWorkOrder === estimate.id} title="Create Work Order">
                                            {creatingWorkOrder === estimate.id ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Wrench className="w-4 h-4" />}
                                          </Button>
                                        )}
                                        <Button variant="ghost" size="sm" className="text-blue-600 hover:text-blue-800" onClick={() => { setEditEstimateId(estimate.id); setShowEstimateModal(true); }}>
                                          <Edit2 className="w-4 h-4" />
                                        </Button>
                                        <Button variant="ghost" size="sm" className="text-green-600 hover:text-green-800" onClick={() => handleCheckStatus(estimate.id)} title="Check Status">
                                          <RefreshCw className="w-4 h-4" />
                                        </Button>
                                        <Button variant="ghost" size="sm" className="text-gray-600 hover:text-gray-900"><Mail className="w-4 h-4" /></Button>
                                        <Button variant="ghost" size="sm" className="text-gray-600 hover:text-gray-900"><Download className="w-4 h-4" /></Button>
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
                  <div className="lg:hidden mt-3 space-y-4">
                    {activeEstimates.length === 0 ? (
                      <p className="text-center text-gray-500 py-6">No active estimates</p>
                    ) : (
                      activeEstimates.map((estimate) => (
                        <Card key={estimate.id} className="bg-white shadow-sm border border-gray-200 hover:shadow-md transition-shadow">
                          <CardContent className="p-4">
                            <div className="flex items-start justify-between mb-3">
                              <div className="flex items-center">
                                <div className="bg-blue-50 p-2 rounded-lg mr-3"><FileText className="w-5 h-5 text-blue-600" /></div>
                                <div className="text-sm font-semibold text-gray-900">{estimate.estimateNumber}</div>
                              </div>
                              {getStatusBadge(estimate.status)}
                            </div>
                            <div className="space-y-2">
                              <div>
                                <div className="text-sm font-medium text-gray-900">{estimate.customerName}</div>
                                <div className="text-xs text-gray-500">{estimate.customerEmail}</div>
                              </div>
                              <div className="text-sm text-gray-700">{estimate.projectName}</div>
                              <div className="flex justify-between items-center pt-2 border-t border-gray-100">
                                <div className="text-lg font-bold text-gray-900">{formatCurrency(parseFloat(estimate.totalAmount))}</div>
                                <div className="text-xs text-gray-500">{formatDate(estimate.createdAt)}</div>
                              </div>
                              <div className="pt-3 border-t border-gray-100 space-y-2">
                                <div className="flex items-center gap-2">
                                  <Button variant="outline" size="sm" className="flex-1" onClick={() => { setSelectedEstimateId(estimate.id); setShowDetailModal(true); }}>
                                    <Eye className="w-4 h-4 mr-2" />View Details
                                  </Button>
                                  {estimate.status === 'approved' && (
                                    <Button variant="outline" size="sm" className="text-green-600 hover:text-green-800 border-green-300 hover:border-green-400 flex-1" onClick={() => handleCreateWorkOrder(estimate.id)} disabled={creatingWorkOrder === estimate.id}>
                                      {creatingWorkOrder === estimate.id ? <RefreshCw className="w-4 h-4 animate-spin mr-2" /> : <Wrench className="w-4 h-4 mr-2" />}
                                      <span className="truncate">Create Work Order</span>
                                    </Button>
                                  )}
                                </div>
                                <div className="flex items-center justify-center gap-2">
                                  <Button variant="outline" size="sm" className="flex-1" onClick={() => { setEditEstimateId(estimate.id); setShowEstimateModal(true); }}>
                                    <Edit2 className="w-4 h-4 mr-1" />Edit
                                  </Button>
                                  <Button variant="outline" size="sm" className="text-green-600 hover:text-green-800 flex-1" onClick={() => handleCheckStatus(estimate.id)}>
                                    <RefreshCw className="w-4 h-4 mr-1" />Status
                                  </Button>
                                  <Button variant="outline" size="sm" className="flex-1"><Mail className="w-4 h-4 mr-1" />Email</Button>
                                  <Button variant="outline" size="sm" className="flex-1"><Download className="w-4 h-4 mr-1" />PDF</Button>
                                </div>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      ))
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Completed Section */}
            <div>
              <button
                onClick={() => setCompletedExpanded(!completedExpanded)}
                className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 border border-gray-200 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <div className="flex items-center gap-2">
                  {completedExpanded ? <ChevronDown className="w-5 h-5 text-gray-600" /> : <ChevronRight className="w-5 h-5 text-gray-600" />}
                  <span className="text-base font-semibold text-gray-700">Completed</span>
                  <Badge variant="secondary">{completedEstimates.length}</Badge>
                </div>
              </button>

              {completedExpanded && (
                <>
                  {/* Desktop Table View */}
                  <div className="hidden lg:block mt-3">
                    <Card className="bg-white shadow-sm border border-gray-200">
                      <CardContent className="p-0">
                        <div className="overflow-x-auto">
                          <table className="w-full">
                            <thead className="bg-gray-50">
                              <tr>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Estimate</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Customer</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Project</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Amount</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                              </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                              {completedEstimates.length === 0 ? (
                                <tr>
                                  <td colSpan={7} className="px-6 py-8 text-center text-gray-500">No completed estimates</td>
                                </tr>
                              ) : (
                                completedEstimates.map((estimate) => (
                                  <tr key={estimate.id} className="hover:bg-gray-50">
                                    <td className="px-6 py-4 whitespace-nowrap">
                                      <div className="flex items-center">
                                        <div className="bg-gray-100 p-2 rounded-lg mr-3">
                                          <FileText className="w-4 h-4 text-gray-500" />
                                        </div>
                                        <div className="text-sm font-medium text-gray-900">{estimate.estimateNumber}</div>
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
                                      <div className="text-sm font-medium text-gray-900">{formatCurrency(parseFloat(estimate.totalAmount))}</div>
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap">{getStatusBadge(estimate.status)}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{formatDate(estimate.createdAt)}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                      <div className="flex items-center space-x-2 justify-end">
                                        <Button variant="outline" size="sm" className="text-blue-600 hover:text-blue-800" onClick={() => { setSelectedEstimateId(estimate.id); setShowDetailModal(true); }}>
                                          <Eye className="w-4 h-4 mr-1" />View Details
                                        </Button>
                                        {estimate.status !== 'converted_to_work_order' ? (
                                          <>
                                            <Button variant="ghost" size="sm" className="text-blue-600 hover:text-blue-800" onClick={() => { setEditEstimateId(estimate.id); setShowEstimateModal(true); }}>
                                              <Edit2 className="w-4 h-4" />
                                            </Button>
                                            <Button variant="ghost" size="sm" className="text-green-600 hover:text-green-800" onClick={() => handleCheckStatus(estimate.id)} title="Check Status">
                                              <RefreshCw className="w-4 h-4" />
                                            </Button>
                                            <Button variant="ghost" size="sm" className="text-gray-600 hover:text-gray-900"><Mail className="w-4 h-4" /></Button>
                                            <Button variant="ghost" size="sm" className="text-gray-600 hover:text-gray-900"><Download className="w-4 h-4" /></Button>
                                          </>
                                        ) : (
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
                  <div className="lg:hidden mt-3 space-y-4">
                    {completedEstimates.length === 0 ? (
                      <p className="text-center text-gray-500 py-6">No completed estimates</p>
                    ) : (
                      completedEstimates.map((estimate) => (
                        <Card key={estimate.id} className="bg-gray-50 shadow-sm border border-gray-200 hover:shadow-md transition-shadow">
                          <CardContent className="p-4">
                            <div className="flex items-start justify-between mb-3">
                              <div className="flex items-center">
                                <div className="bg-gray-100 p-2 rounded-lg mr-3"><FileText className="w-5 h-5 text-gray-500" /></div>
                                <div className="text-sm font-semibold text-gray-900">{estimate.estimateNumber}</div>
                              </div>
                              {getStatusBadge(estimate.status)}
                            </div>
                            <div className="space-y-2">
                              <div>
                                <div className="text-sm font-medium text-gray-900">{estimate.customerName}</div>
                                <div className="text-xs text-gray-500">{estimate.customerEmail}</div>
                              </div>
                              <div className="text-sm text-gray-700">{estimate.projectName}</div>
                              <div className="flex justify-between items-center pt-2 border-t border-gray-100">
                                <div className="text-lg font-bold text-gray-900">{formatCurrency(parseFloat(estimate.totalAmount))}</div>
                                <div className="text-xs text-gray-500">{formatDate(estimate.createdAt)}</div>
                              </div>
                              <div className="pt-3 border-t border-gray-100 space-y-2">
                                <div className="flex items-center gap-2">
                                  <Button variant="outline" size="sm" className="flex-1" onClick={() => { setSelectedEstimateId(estimate.id); setShowDetailModal(true); }}>
                                    <Eye className="w-4 h-4 mr-2" />View Details
                                  </Button>
                                </div>
                                {estimate.status !== 'converted_to_work_order' ? (
                                  <div className="flex items-center justify-center gap-2">
                                    <Button variant="outline" size="sm" className="flex-1" onClick={() => { setEditEstimateId(estimate.id); setShowEstimateModal(true); }}>
                                      <Edit2 className="w-4 h-4 mr-1" />Edit
                                    </Button>
                                    <Button variant="outline" size="sm" className="text-green-600 hover:text-green-800 flex-1" onClick={() => handleCheckStatus(estimate.id)}>
                                      <RefreshCw className="w-4 h-4 mr-1" />Status
                                    </Button>
                                    <Button variant="outline" size="sm" className="flex-1"><Mail className="w-4 h-4 mr-1" />Email</Button>
                                    <Button variant="outline" size="sm" className="flex-1"><Download className="w-4 h-4 mr-1" />PDF</Button>
                                  </div>
                                ) : (
                                  <p className="text-sm text-gray-500 italic">Converted to Work Order</p>
                                )}
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      ))
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </TabsContent>

        {!isIrrigationManager && !isFieldTech && (
          <TabsContent value="quickbooks">
            <QuickBooksIntegration />
          </TabsContent>
        )}
      </Tabs>

      {/* Estimate Modal */}
      <EstimateModal
        open={showEstimateModal}
        onOpenChange={(open) => {
          setShowEstimateModal(open);
          if (!open) {
            setEditEstimateId(null);
          }
        }}
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
