import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EnhancedEstimateModal } from "@/components/estimates/enhanced-estimate-modal";
import { EstimateDetailModal } from "@/components/estimates/estimate-detail-modal";
import { EditEstimateModal } from "@/components/estimates/edit-estimate-modal";
import { QuickBooksIntegration } from "@/components/quickbooks/quickbooks-integration";
import { Plus, FileText, Mail, Download, Eye, Edit2 } from "lucide-react";
import { useState } from "react";
import type { Estimate } from "@shared/schema";

export default function Estimates() {
  const [showEstimateModal, setShowEstimateModal] = useState(false);
  const [selectedEstimateId, setSelectedEstimateId] = useState<number | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editEstimateId, setEditEstimateId] = useState<number | null>(null);

  const { data: estimates, isLoading } = useQuery<Estimate[]>({
    queryKey: ["/api/estimates"],
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
          <div className="mt-4 sm:mt-0">
            <Button onClick={() => setShowEstimateModal(true)} className="bg-primary text-white hover:bg-blue-700">
              <Plus className="w-4 h-4 mr-2" />
              New Estimate
            </Button>
          </div>
        </div>
      </div>

      <Tabs defaultValue="estimates" className="space-y-6">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="estimates">Estimates</TabsTrigger>
          <TabsTrigger value="quickbooks">QuickBooks</TabsTrigger>
        </TabsList>

        <TabsContent value="estimates">

        {/* Estimates List */}
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
                          <div 
                            className="bg-blue-50 p-2 rounded-lg mr-3 cursor-pointer hover:bg-blue-100 transition-colors"
                            onClick={() => {
                              setSelectedEstimateId(estimate.id);
                              setShowDetailModal(true);
                            }}
                          >
                            <FileText className="w-4 h-4 text-blue-600" />
                          </div>
                          <div>
                            <div className="text-sm font-medium text-gray-900">{estimate.estimateNumber}</div>
                            <button
                              onClick={() => {
                                setSelectedEstimateId(estimate.id);
                                setShowDetailModal(true);
                              }}
                              className="text-xs text-blue-600 hover:text-blue-800 hover:underline"
                            >
                              View
                            </button>
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
                          {estimate.status !== 'converted_to_work_order' && (
                            <>
                              <Button 
                                variant="ghost" 
                                size="sm" 
                                className="text-blue-600 hover:text-blue-800"
                                onClick={() => {
                                  setEditEstimateId(estimate.id);
                                  setShowEditModal(true);
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
        </TabsContent>

        <TabsContent value="quickbooks">
          <QuickBooksIntegration />
        </TabsContent>
      </Tabs>

      {/* Estimate Modal */}
      <EnhancedEstimateModal
        open={showEstimateModal}
        onOpenChange={setShowEstimateModal}
      />

      {/* Estimate Detail Modal */}
      <EstimateDetailModal
        open={showDetailModal}
        onOpenChange={setShowDetailModal}
        estimateId={selectedEstimateId}
      />

      {/* Edit Estimate Modal */}
      <EditEstimateModal
        open={showEditModal}
        onOpenChange={setShowEditModal}
        estimateId={editEstimateId}
      />
    </div>
  );
}
