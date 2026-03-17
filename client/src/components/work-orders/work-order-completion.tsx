import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { FileUpload } from "@/components/ui/file-upload";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  CheckCircle,
  Plus,
  Minus,
  Camera,
  FileText,
  AlertCircle,
  Wrench,
  Edit,
  Search,
  Check,
  ShoppingCart,
  Activity
} from "lucide-react";
import type { WorkOrder, Part } from "@shared/schema";

const workOrderCompletionSchema = z.object({
  workSummary: z.string().min(10, "Work summary must be at least 10 characters"),
  customerNotes: z.string().min(5, "Customer notes must be at least 5 characters"),
  totalHours: z.number().min(0.1, "Total hours must be at least 0.1"),
});

type WorkOrderCompletionData = z.infer<typeof workOrderCompletionSchema>;

interface CompletionUploadedFile {
  url: string;
  fileName: string;
  originalName: string;
}

interface UsedPart {
  id: number;
  partId: number;
  partName: string;
  partPrice: string;
  quantity: number;
  totalCost: number;
  source: 'estimate' | 'field_added';
}

interface WorkOrderCompletionProps {
  workOrder: WorkOrder;
  open: boolean;
  onClose: () => void;
  onComplete: () => void;
}

export function WorkOrderCompletion({ 
  workOrder, 
  open, 
  onClose, 
  onComplete 
}: WorkOrderCompletionProps) {
  const [usedParts, setUsedParts] = useState<UsedPart[]>([]);
  const [photos, setPhotos] = useState<CompletionUploadedFile[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [completionData, setCompletionData] = useState<WorkOrderCompletionData | null>(null);
  const [partsSearchQuery, setPartsSearchQuery] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Get user from localStorage (production-compatible)
  const [currentUser, setCurrentUser] = useState<any>(null);
  
  useEffect(() => {
    const savedUser = localStorage.getItem("user");
    if (savedUser) {
      try {
        setCurrentUser(JSON.parse(savedUser));
      } catch (error) {
        console.error("Error parsing user data:", error);
      }
    }
  }, []);

  const { data: parts } = useQuery<Part[]>({
    queryKey: ["/api/parts"],
  });

  // Get work order items and estimate zones for prefilling
  const { data: workOrderItems } = useQuery({
    queryKey: ["/api/work-orders", workOrder.id, "items"],
  });

  const { data: estimateZones } = useQuery({
    queryKey: ["/api/estimates", workOrder.estimateId, "zones"],
    enabled: !!workOrder.estimateId,
  });

  const form = useForm<WorkOrderCompletionData>({
    resolver: zodResolver(workOrderCompletionSchema),
    defaultValues: {
      workSummary: "",
      customerNotes: "",
      totalHours: 1,
    },
  });

  // Pre-fill form with estimate data when available
  useEffect(() => {
    if (Array.isArray(workOrderItems) && Array.isArray(estimateZones) && workOrder.estimateId && usedParts.length === 0) {
      // Pre-fill used parts from work order items
      const prefilledParts: UsedPart[] = workOrderItems.map((item: any) => ({
        id: Date.now() + Math.random(), // Unique ID for state management
        partId: item.partId,
        partName: item.partName,
        partPrice: item.partPrice,
        quantity: item.quantity,
        totalCost: parseFloat(item.totalPrice),
        source: 'estimate' as const,
      }));
      
      setUsedParts(prefilledParts);

      // Calculate estimated total hours from all items
      const estimatedHours = workOrderItems.reduce((total: number, item: any) => 
        total + (parseFloat(item.laborHours) * item.quantity), 0
      );

      // Create work summary from zone descriptions
      const workDescriptions = estimateZones
        .filter((zone: any) => zone.workDescription)
        .map((zone: any) => `${zone.zoneName}: ${zone.workDescription}`)
        .join('\n');

      // Pre-fill form fields
      form.reset({
        workSummary: workDescriptions || "Work completed as per estimate",
        customerNotes: "Work completed according to estimate specifications",
        totalHours: Math.max(estimatedHours, 0.1), // Ensure minimum 0.1 hours
      });
    }
  }, [workOrderItems, estimateZones, workOrder.estimateId, form, usedParts.length]);

  const completeWorkOrderMutation = useMutation({
    mutationFn: async (data: any) => {
      return apiRequest("/api/work-orders/complete", "POST", data);
    },
    onSuccess: () => {
      toast({
        title: "Work Order Completed",
        description: "Work order has been successfully completed with all documentation.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
      onComplete();
      onClose();
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: "Failed to complete work order. Please try again.",
        variant: "destructive",
      });
    },
  });

  const addUsedPart = (part: Part) => {
    const existingPart = usedParts.find(up => up.partId === part.id);
    
    if (existingPart) {
      setUsedParts(prev => prev.map(up => 
        up.partId === part.id 
          ? { 
              ...up, 
              quantity: up.quantity + 1,
              totalCost: (up.quantity + 1) * parseFloat(part.price)
            }
          : up
      ));
    } else {
      const newUsedPart: UsedPart = {
        id: Date.now(),
        partId: part.id,
        partName: part.name,
        partPrice: part.price,
        quantity: 1,
        totalCost: parseFloat(part.price),
        source: 'field_added',
      };
      setUsedParts(prev => [...prev, newUsedPart]);
    }
  };



  const filteredParts = parts?.filter(part =>
    part.name.toLowerCase().includes(partsSearchQuery.toLowerCase())
  ) || [];

  const updatePartQuantity = (id: number, quantity: number) => {
    if (quantity <= 0) {
      setUsedParts(prev => prev.filter(up => up.id !== id));
      return;
    }
    
    setUsedParts(prev => prev.map(up => 
      up.id === id 
        ? { 
            ...up, 
            quantity,
            totalCost: quantity * parseFloat(up.partPrice)
          }
        : up
    ));
  };

  const getTotalPartsCost = () => {
    return usedParts.reduce((sum, part) => sum + part.totalCost, 0);
  };

  const onSubmit = async (data: WorkOrderCompletionData) => {
    if (usedParts.length === 0) {
      toast({
        title: "Parts Required",
        description: "Please add at least one part used during the repair, or add a 'No Parts' entry.",
        variant: "destructive",
      });
      return;
    }

    // Store the form data and show summary
    setCompletionData(data);
    setShowSummary(true);
  };

  const onFinalSubmit = async () => {
    if (!completionData) return;

    setIsSubmitting(true);
    
    try {
      // If work order hasn't been started yet, start it first
      if (workOrder.status === 'assigned' || workOrder.status === 'pending') {
        await apiRequest(`/api/work-orders/${workOrder.id}`, "PATCH", { 
          status: 'in_progress',
          startedAt: new Date().toISOString()
        });
      }
      
      // Now complete the work order
      const finalData = {
        workOrderId: workOrder.id,
        workSummary: completionData.workSummary,
        customerNotes: completionData.customerNotes,
        completedAt: new Date().toISOString(),
        totalHours: completionData.totalHours,
        usedParts: usedParts.map(up => ({
          partId: up.partId,
          quantity: up.quantity,
          totalCost: up.totalCost.toFixed(2),
        })),
        photos: photos.map(photo => photo.url),
        totalPartsCost: getTotalPartsCost().toFixed(2),
      };

      await completeWorkOrderMutation.mutateAsync(finalData);
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to complete work order",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const onEditClick = () => {
    setShowSummary(false);
  };

  // Reset states when modal closes
  const handleClose = () => {
    setShowSummary(false);
    setCompletionData(null);
    setPartsSearchQuery("");
    form.reset();
    setUsedParts([]);
    setPhotos([]);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="w-screen h-screen sm:w-[95vw] sm:max-w-4xl sm:h-[95vh] sm:max-h-[95vh] sm:rounded-lg overflow-hidden p-0 flex flex-col">
        <DialogHeader className="p-3 sm:p-6 border-b border-gray-200 flex-shrink-0">
          <DialogTitle className="flex items-center gap-3 text-lg sm:text-xl">
            <div className="bg-green-50 p-2 rounded-lg">
              <CheckCircle className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <span className="text-xl font-semibold">
                {showSummary ? "Review Work Order Summary" : "Complete Work Order"}
              </span>
              <p className="text-sm text-gray-600 font-normal mt-1">
                {workOrder.workOrderNumber} - {workOrder.projectName}
              </p>
            </div>
          </DialogTitle>
          <DialogDescription>
            {showSummary 
              ? "Review the work order details before final submission."
              : "Document the completed work, parts used, and provide customer notes before marking as complete."
            }
          </DialogDescription>
        </DialogHeader>

        {/* Work Plan Reference Section - Shows estimated work for field techs */}
        {workOrder.estimateId && Array.isArray(estimateZones) && estimateZones.length > 0 && !showSummary && (
          <div className="border-b border-gray-200 bg-blue-50 p-4">
            <h3 className="text-sm font-semibold text-blue-900 mb-2 flex items-center gap-2">
              <Activity className="w-4 h-4" />
              Planned Work (Based on Estimate #{workOrder.estimateId})
            </h3>
            <div className="space-y-2">
              {estimateZones.slice(0, 3).map((zone: any) => (
                <div key={zone.id} className="text-xs text-blue-800">
                  <span className="font-medium">{zone.zoneName}:</span> {zone.workDescription || "Work as estimated"}
                </div>
              ))}
              {estimateZones.length > 3 && (
                <div className="text-xs text-blue-600 italic">
                  +{estimateZones.length - 3} more zones...
                </div>
              )}
            </div>
            <div className="text-xs text-blue-700 mt-2 italic">
              Parts and hours below are pre-filled from estimate. Adjust as needed for actual work performed.
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto overflow-x-hidden overscroll-contain p-3 sm:p-6 min-w-0">
          {showSummary ? (
            // Summary View
            <div className="space-y-6">
            {/* Work Summary Card */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Wrench className="w-5 h-5 text-blue-600" />
                  Work Completed Summary
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <span className="font-medium text-gray-700">Work Summary:</span>
                  <p className="text-gray-900 mt-1 p-3 bg-gray-50 rounded-lg">{completionData?.workSummary}</p>
                </div>
                <div>
                  <span className="font-medium text-gray-700">Customer Notes:</span>
                  <p className="text-gray-900 mt-1 p-3 bg-gray-50 rounded-lg">{completionData?.customerNotes}</p>
                </div>
                <div>
                  <span className="font-medium text-gray-700">Total Hours Worked:</span>
                  <p className="text-gray-900 mt-1 text-xl font-bold text-blue-600">{completionData?.totalHours} hours</p>
                </div>
              </CardContent>
            </Card>

            {/* Parts Used Summary */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <FileText className="w-5 h-5 text-blue-600" />
                    Parts Used Summary
                  </span>
                  {currentUser?.role !== 'field_tech' && (
                    <div className="text-sm font-normal text-gray-600">
                      Total: ${getTotalPartsCost().toFixed(2)}
                    </div>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {usedParts.map((part) => (
                    <div key={part.id} className="flex items-center justify-between p-3 border rounded-lg bg-gray-50 min-w-0">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium">{part.partName}</div>
                        {currentUser?.role !== 'field_tech' ? (
                          <div className="text-sm text-gray-500">
                            ${part.partPrice} each × {part.quantity}
                          </div>
                        ) : (
                          <div className="text-sm text-gray-500">
                            Quantity: {part.quantity}
                          </div>
                        )}
                      </div>
                      {currentUser?.role !== 'field_tech' && (
                        <div className="text-lg font-bold text-blue-600">
                          ${part.totalCost.toFixed(2)}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Photos Summary */}
            {photos.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Camera className="w-5 h-5 text-blue-600" />
                    Completion Photos ({photos.length})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 min-w-0">
                    {photos.map((photo, index) => (
                      <div key={index} className="aspect-square bg-gray-100 rounded-lg overflow-hidden">
                        <img 
                          src={photo.url} 
                          alt={`Completion photo ${index + 1}`}
                          className="w-full h-full object-cover"
                        />
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            <Separator />

            {/* Action Buttons for Summary */}
            <div className="flex flex-col sm:flex-row justify-end gap-3">
              <Button 
                type="button" 
                variant="outline" 
                onClick={onEditClick}
                className="px-6 w-full sm:w-auto min-h-[44px]"
              >
                <Edit className="w-4 h-4 mr-2" />
                Edit Details
              </Button>
              <Button 
                onClick={onFinalSubmit}
                disabled={isSubmitting}
                className="bg-green-600 hover:bg-green-700 text-white px-6 w-full sm:w-auto min-h-[44px]"
              >
                {isSubmitting ? "Submitting..." : "Submit Work Order"}
              </Button>
            </div>
          </div>
        ) : (
          // Form View (existing form code)

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            {/* Work Summary */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Wrench className="w-5 h-5 text-blue-600" />
                  Work Completed
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField
                  control={form.control}
                  name="workSummary"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Work Summary *</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="Describe the work that was completed, repairs made, issues resolved..."
                          className="min-h-[100px]"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="totalHours"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Total Hours Worked *</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          inputMode="decimal"
                          step="0.1"
                          min="0.1"
                          placeholder="Enter hours (e.g., 2.5)"
                          {...field}
                          onChange={e => field.onChange(parseFloat(e.target.value))}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            {/* Parts Used */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <FileText className="w-5 h-5 text-blue-600" />
                    Parts Used
                  </span>
                  {currentUser?.role !== 'field_tech' && (
                    <div className="text-sm font-normal text-gray-600">
                      Total: ${getTotalPartsCost().toFixed(2)}
                    </div>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Redesigned Parts Selection */}
                <div className="space-y-4">
                  {/* Search Bar */}
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                    <Input
                      placeholder="Search parts by name..."
                      value={partsSearchQuery}
                      onChange={(e) => setPartsSearchQuery(e.target.value)}
                      className="pl-10"
                    />
                  </div>

                  {/* Quick Add Parts - Simple List */}
                  <div className="border rounded-lg bg-white">
                    <div className="p-3 border-b bg-gray-50">
                      <h4 className="font-medium text-gray-900">Quick Add Parts</h4>
                      <p className="text-sm text-gray-600">Tap + to add parts</p>
                    </div>
                    
                    <div>
                      {filteredParts.length > 0 ? (
                        <div className="divide-y">
                          {filteredParts.map((part) => {
                            const isAlreadyUsed = usedParts.some(up => up.partId === part.id);
                            
                            return (
                              <div
                                key={part.id}
                                className={`
                                  flex items-center justify-between p-3 hover:bg-gray-50 transition-colors
                                  ${isAlreadyUsed ? 'bg-green-50' : ''}
                                `}
                              >
                                <div className="flex-1 min-w-0">
                                  <div className="font-medium text-sm text-gray-900">{part.name}</div>
                                  {currentUser?.role !== 'field_tech' && (
                                    <div className="text-xs text-gray-500">${part.price}</div>
                                  )}
                                </div>
                                
                                <div className="flex items-center gap-2">
                                  {isAlreadyUsed && (
                                    <div className="flex items-center gap-1 text-xs text-green-600">
                                      <Check className="w-3 h-3" />
                                      <span>Added</span>
                                    </div>
                                  )}
                                  
                                  <Button
                                    type="button"
                                    onClick={() => addUsedPart(part)}
                                    className="bg-blue-600 hover:bg-blue-700 text-white h-11 w-11 p-0 flex-shrink-0"
                                    title="Add part"
                                  >
                                    <Plus className="w-5 h-5" />
                                  </Button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : partsSearchQuery ? (
                        <div className="p-6 text-center text-gray-500">
                          <p>No parts found matching "{partsSearchQuery}"</p>
                        </div>
                      ) : (
                        <div className="p-6 text-center text-gray-500">
                          <p>Start typing to search for parts</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Used Parts List */}
                {usedParts.length > 0 ? (
                  <div className="space-y-4">
                    {/* Estimate Parts Section */}
                    {usedParts.filter(part => part.source === 'estimate').length > 0 && (
                      <div>
                        <div className="flex items-center gap-2 mb-3 pb-2 border-b border-blue-200">
                          <div className="w-3 h-3 bg-blue-100 border border-blue-300 rounded"></div>
                          <h4 className="font-medium text-blue-800">Planned Parts (From Estimate)</h4>
                        </div>
                        <div className="space-y-2">
                          {usedParts.filter(part => part.source === 'estimate').map((usedPart) => (
                            <div key={usedPart.id} className="flex items-center justify-between p-3 border border-blue-200 rounded-lg bg-blue-50 min-w-0">
                              <div className="flex-1 min-w-0">
                                <div className="font-medium flex items-center gap-2">
                                  {usedPart.partName}
                                  <span className="text-xs bg-blue-200 text-blue-800 px-2 py-1 rounded">Estimate</span>
                                </div>
                                {currentUser?.role !== 'field_tech' ? (
                                  <div className="text-sm text-blue-600">
                                    ${usedPart.partPrice} each × {usedPart.quantity} = ${usedPart.totalCost.toFixed(2)}
                                  </div>
                                ) : (
                                  <div className="text-sm text-blue-600">
                                    Quantity: {usedPart.quantity}
                                  </div>
                                )}
                              </div>
                              <div className="flex items-center gap-2">
                                <Button
                                  type="button"
                                  variant="outline"
                                  onClick={() => updatePartQuantity(usedPart.id, usedPart.quantity - 1)}
                                  className="border-blue-300 hover:bg-blue-100 h-11 w-11 p-0"
                                >
                                  <Minus className="w-4 h-4" />
                                </Button>
                                <span className="w-8 text-center font-medium text-blue-800">{usedPart.quantity}</span>
                                <Button
                                  type="button"
                                  variant="outline"
                                  onClick={() => updatePartQuantity(usedPart.id, usedPart.quantity + 1)}
                                  className="border-blue-300 hover:bg-blue-100 h-11 w-11 p-0"
                                >
                                  <Plus className="w-4 h-4" />
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Field Added Parts Section */}
                    {usedParts.filter(part => part.source === 'field_added').length > 0 && (
                      <div>
                        <div className="flex items-center gap-2 mb-3 pb-2 border-b border-orange-200">
                          <div className="w-3 h-3 bg-orange-100 border border-orange-300 rounded"></div>
                          <h4 className="font-medium text-orange-800">Additional Parts (Field Added)</h4>
                        </div>
                        <div className="space-y-2">
                          {usedParts.filter(part => part.source === 'field_added').map((usedPart) => (
                            <div key={usedPart.id} className="flex items-center justify-between p-3 border border-orange-200 rounded-lg bg-orange-50 min-w-0">
                              <div className="flex-1 min-w-0">
                                <div className="font-medium flex items-center gap-2">
                                  {usedPart.partName}
                                  <span className="text-xs bg-orange-200 text-orange-800 px-2 py-1 rounded">Field Added</span>
                                </div>
                                {currentUser?.role !== 'field_tech' ? (
                                  <div className="text-sm text-orange-600">
                                    ${usedPart.partPrice} each × {usedPart.quantity} = ${usedPart.totalCost.toFixed(2)}
                                  </div>
                                ) : (
                                  <div className="text-sm text-orange-600">
                                    Quantity: {usedPart.quantity}
                                  </div>
                                )}
                              </div>
                              <div className="flex items-center gap-2">
                                <Button
                                  type="button"
                                  variant="outline"
                                  onClick={() => updatePartQuantity(usedPart.id, usedPart.quantity - 1)}
                                  className="border-orange-300 hover:bg-orange-100 h-11 w-11 p-0"
                                >
                                  <Minus className="w-4 h-4" />
                                </Button>
                                <span className="w-8 text-center font-medium text-orange-800">{usedPart.quantity}</span>
                                <Button
                                  type="button"
                                  variant="outline"
                                  onClick={() => updatePartQuantity(usedPart.id, usedPart.quantity + 1)}
                                  className="border-orange-300 hover:bg-orange-100 h-11 w-11 p-0"
                                >
                                  <Plus className="w-4 h-4" />
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-8 text-gray-500">
                    <AlertCircle className="w-12 h-12 mx-auto mb-2 text-gray-300" />
                    <p>No parts added yet. Add parts used during the repair.</p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Customer Notes */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Customer Communication</CardTitle>
              </CardHeader>
              <CardContent>
                <FormField
                  control={form.control}
                  name="customerNotes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Customer Notes *</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="Notes to share with the customer about the repair, recommendations, follow-up needed..."
                          className="min-h-[80px]"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            {/* Photos */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Camera className="w-5 h-5 text-blue-600" />
                  Completion Photos
                </CardTitle>
              </CardHeader>
              <CardContent>
                <FileUpload
                  type="photo"
                  label="Photos"
                  accept="image/*"
                  multiple={true}
                  files={photos.map(p => ({ url: p.url, fileName: p.fileName, originalName: p.originalName }))}
                  onFilesChange={(files) => setPhotos(files.map(f => ({ url: f.url, fileName: f.fileName, originalName: f.originalName })))}
                />
              </CardContent>
            </Card>

            <Separator />

            {/* Submit Button */}
            <div className="flex flex-col sm:flex-row justify-end gap-3">
              {currentUser?.role !== 'field_tech' && (
                <Button type="button" variant="outline" onClick={handleClose} className="w-full sm:w-auto min-h-[44px]">
                  Cancel
                </Button>
              )}
              <Button 
                type="submit" 
                disabled={isSubmitting}
                className="bg-green-600 hover:bg-green-700 text-white w-full sm:w-auto min-h-[44px]"
              >
                {isSubmitting ? "Reviewing..." : "Review Work Order"}
              </Button>
            </div>
          </form>
        </Form>
        )}
        </div>
      </DialogContent>
    </Dialog>
  );
}