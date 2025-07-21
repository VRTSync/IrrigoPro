import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { CheckCircle, XCircle, FileText, Users, Calendar, DollarSign, Wrench } from "lucide-react";
import type { Estimate } from "@shared/schema";

interface EstimateDetailModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  estimateId: number | null;
}

export function EstimateDetailModal({ open, onOpenChange, estimateId }: EstimateDetailModalProps) {
  const { toast } = useToast();
  const [isConverting, setIsConverting] = useState(false);

  const { data: estimate, isLoading } = useQuery<any>({
    queryKey: ["/api/estimates", estimateId],
    enabled: !!estimateId && open,
  });

  const { data: estimateZones } = useQuery<any[]>({
    queryKey: ["/api/estimates", estimateId, "zones"],
    enabled: !!estimateId && open,
  });

  const convertToWorkOrderMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/estimates/${estimateId}/convert-to-work-order`, {
        method: 'POST',
      });
      if (!response.ok) {
        throw new Error('Failed to convert estimate to work order');
      }
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Estimate converted to work order successfully",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/estimates"] });
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
      onOpenChange(false);
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: "Failed to convert estimate to work order",
        variant: "destructive",
      });
    },
  });

  const handleConvertToWorkOrder = async () => {
    if (!estimateId) return;
    setIsConverting(true);
    try {
      await convertToWorkOrderMutation.mutateAsync();
    } finally {
      setIsConverting(false);
    }
  };

  const formatCurrency = (amount: number | string) => {
    const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(numAmount);
  };

  const formatDate = (date: string | Date) => {
    return new Date(date).toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
        return <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200">Pending Review</Badge>;
      case 'approved':
        return <Badge className="bg-green-100 text-green-800 border-green-200">Approved</Badge>;
      case 'rejected':
        return <Badge className="bg-red-100 text-red-800 border-red-200">Rejected</Badge>;
      case 'converted_to_work_order':
        return <Badge className="bg-purple-100 text-purple-800 border-purple-200">Converted to Work Order</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  if (!estimateId) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center space-x-2">
            <FileText className="w-5 h-5" />
            <span>Estimate Details</span>
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-4">
            <div className="animate-pulse">
              <div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
              <div className="h-4 bg-gray-200 rounded w-1/2"></div>
            </div>
          </div>
        ) : estimate ? (
          <div className="space-y-6">
            {/* Header Information */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg flex items-center space-x-2">
                    <FileText className="w-5 h-5" />
                    <span>Estimate Information</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <span className="font-medium text-gray-700">Estimate Number:</span>
                    <p className="text-lg font-semibold text-gray-900">{estimate.estimateNumber}</p>
                  </div>
                  <div>
                    <span className="font-medium text-gray-700">Project Name:</span>
                    <p className="text-gray-900">{estimate.projectName}</p>
                  </div>
                  <div>
                    <span className="font-medium text-gray-700">Status:</span>
                    <div className="mt-1">{getStatusBadge(estimate.status)}</div>
                  </div>
                  <div>
                    <span className="font-medium text-gray-700">Created Date:</span>
                    <p className="text-gray-900">{formatDate(estimate.createdAt)}</p>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg flex items-center space-x-2">
                    <Users className="w-5 h-5" />
                    <span>Customer Information</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <span className="font-medium text-gray-700">Customer Name:</span>
                    <p className="text-gray-900">{estimate.customerName}</p>
                  </div>
                  <div>
                    <span className="font-medium text-gray-700">Email:</span>
                    <p className="text-gray-900">{estimate.customerEmail}</p>
                  </div>
                  <div>
                    <span className="font-medium text-gray-700">Phone:</span>
                    <p className="text-gray-900">{estimate.customerPhone || 'Not provided'}</p>
                  </div>
                  <div>
                    <span className="font-medium text-gray-700">Address:</span>
                    <p className="text-gray-900">{estimate.customerAddress || 'Not provided'}</p>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Project Details */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">Project Details</CardTitle>
              </CardHeader>
              <CardContent>
                {estimate.projectDescription && (
                  <div className="mb-4">
                    <span className="font-medium text-gray-700">Description:</span>
                    <p className="text-gray-900 mt-1">{estimate.projectDescription}</p>
                  </div>
                )}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="bg-blue-50 p-4 rounded-lg">
                    <div className="flex items-center space-x-2">
                      <DollarSign className="w-5 h-5 text-blue-600" />
                      <span className="font-medium text-blue-900">Total Amount</span>
                    </div>
                    <p className="text-2xl font-bold text-blue-900 mt-1">
                      {formatCurrency(estimate.totalAmount)}
                    </p>
                  </div>
                  <div className="bg-green-50 p-4 rounded-lg">
                    <div className="flex items-center space-x-2">
                      <Wrench className="w-5 h-5 text-green-600" />
                      <span className="font-medium text-green-900">Labor Hours</span>
                    </div>
                    <p className="text-2xl font-bold text-green-900 mt-1">
                      {estimate.totalLaborHours || 0}h
                    </p>
                  </div>
                  <div className="bg-purple-50 p-4 rounded-lg">
                    <div className="flex items-center space-x-2">
                      <Calendar className="w-5 h-5 text-purple-600" />
                      <span className="font-medium text-purple-900">Zones</span>
                    </div>
                    <p className="text-2xl font-bold text-purple-900 mt-1">
                      {estimateZones?.length || 0}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Zones */}
            {estimateZones && estimateZones.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg">Project Zones</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {estimateZones.map((zone: any, index: number) => (
                      <div key={zone.id} className="border rounded-lg p-4">
                        <div className="flex justify-between items-start mb-3">
                          <h4 className="font-medium text-gray-900">Zone {index + 1}: {zone.zoneName}</h4>
                          <Badge variant="outline">{zone.zoneType}</Badge>
                        </div>
                        {zone.description && (
                          <p className="text-gray-600 mb-3">{zone.description}</p>
                        )}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                          <div>
                            <span className="font-medium text-gray-700">Labor Hours:</span>
                            <p>{zone.laborHours}h</p>
                          </div>
                          <div>
                            <span className="font-medium text-gray-700">Labor Cost:</span>
                            <p>{formatCurrency(zone.laborCost)}</p>
                          </div>
                          <div>
                            <span className="font-medium text-gray-700">Parts Cost:</span>
                            <p>{formatCurrency(zone.partsCost)}</p>
                          </div>
                          <div>
                            <span className="font-medium text-gray-700">Zone Total:</span>
                            <p className="font-semibold">{formatCurrency(zone.zoneTotal)}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Actions */}
            <div className="flex justify-end space-x-3 pt-4 border-t">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
              {estimate.status === 'approved' && estimate.status !== 'converted_to_work_order' && (
                <Button 
                  onClick={handleConvertToWorkOrder}
                  disabled={isConverting}
                  className="bg-green-600 hover:bg-green-700"
                >
                  <CheckCircle className="w-4 h-4 mr-2" />
                  {isConverting ? 'Converting...' : 'Convert to Work Order'}
                </Button>
              )}
            </div>
          </div>
        ) : (
          <div className="text-center py-8">
            <p className="text-gray-500">Estimate not found</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}