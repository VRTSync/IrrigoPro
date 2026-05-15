import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Plus, Eye, ArrowRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, useArrayQuery } from "@/lib/queryClient";
import { EstimateWizard } from "@/components/estimates/estimate-wizard";
import type { Estimate } from "@workspace/db/schema";
import {
  LIFECYCLE_TINTS,
  isApproved,
  isConvertedToWorkOrder,
  lifecycleOf,
  type LifecycleStatus,
} from "@/lib/lifecycle";

interface EstimatesManagerProps {
  onBack: () => void;
}

export function EstimatesManager({ onBack }: EstimatesManagerProps) {
  const [showEstimateWizard, setShowEstimateWizard] = useState(false);
  const [editEstimateId, setEditEstimateId] = useState<number | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: estimates = [], isLoading } = useArrayQuery<Estimate>({
    queryKey: ["/api/estimates"],
  });

  const convertToWorkOrder = useMutation({
    mutationFn: async (estimateId: number) => {
      return await apiRequest(`/api/estimates/${estimateId}/convert-to-work-order`, "POST");
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Estimate converted to work order successfully",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/estimates"] });
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to convert estimate to work order",
        variant: "destructive",
      });
    },
  });

  // Task #638 — color + label both derive from the canonical lifecycle
  // bucket so this card stays in lockstep with the board / list / detail
  // modal. Raw status enum values never reach the screen.
  const getStatusColor = (lc: LifecycleStatus): string => {
    const tint = LIFECYCLE_TINTS[lc];
    return `${tint.bg} ${tint.text}`;
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
  };



  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <Button variant="outline" onClick={onBack}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Dashboard
          </Button>
          <h1 className="text-3xl font-bold text-gray-900">Estimates</h1>
        </div>
        <Button onClick={() => setShowEstimateWizard(true)} className="bg-blue-600 hover:bg-blue-700">
          <Plus className="w-4 h-4 mr-2" />
          New Estimate
        </Button>
      </div>

      {/* Estimates List */}
      <div className="space-y-4">
        {isLoading ? (
          <div className="text-center py-8">
            <p className="text-gray-500">Loading estimates...</p>
          </div>
        ) : estimates?.length === 0 ? (
          <Card>
            <CardContent className="text-center py-8">
              <p className="text-gray-500 mb-4">No estimates found</p>
              <Button onClick={() => setShowEstimateWizard(true)}>
                <Plus className="w-4 h-4 mr-2" />
                Create First Estimate
              </Button>
            </CardContent>
          </Card>
        ) : (
          estimates?.map((estimate) => {
            const lc = lifecycleOf(estimate);
            return (
            <Card key={estimate.id} className="hover:shadow-md transition-shadow">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="text-lg font-semibold">Estimate #{estimate.id}</h3>
                      <Badge className={getStatusColor(lc)}>
                        {LIFECYCLE_TINTS[lc].label}
                      </Badge>
                    </div>
                    <p className="text-gray-600 mb-1">Customer: {estimate.customerName}</p>
                    <p className="text-gray-600 mb-1">Property: {estimate.projectAddress}</p>
                    <p className="text-sm text-gray-500">
                      Created: {new Date(estimate.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <p className="text-2xl font-bold text-gray-900">
                        {formatCurrency(parseFloat(estimate.totalAmount))}
                      </p>
                      <p className="text-sm text-gray-500">Total Amount</p>
                    </div>
                    
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => { setEditEstimateId(estimate.id); setShowEstimateWizard(true); }}>
                        <Eye className="w-4 h-4 mr-2" />
                        View
                      </Button>
                      
                      {isApproved(lc) && !isConvertedToWorkOrder(estimate) && (
                        <Button 
                          size="sm"
                          onClick={() => convertToWorkOrder.mutate(estimate.id)}
                          disabled={convertToWorkOrder.isPending}
                          className="bg-green-600 hover:bg-green-700"
                        >
                          <ArrowRight className="w-4 h-4 mr-2" />
                          Convert to Work Order
                        </Button>
                      )}
                      {isConvertedToWorkOrder(estimate) && (
                        <span className="text-sm text-gray-500 italic">Converted to Work Order</span>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
            );
          })
        )}
      </div>

      {/* Estimate Wizard */}
      <EstimateWizard
        open={showEstimateWizard}
        onOpenChange={(open) => {
          setShowEstimateWizard(open);
          if (!open) setEditEstimateId(null);
        }}
        estimateId={editEstimateId}
      />
    </div>
  );
}