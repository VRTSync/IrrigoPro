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
  Edit
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
  const [currentUser, setCurrentUser] = useState<any>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Get current user to check role
  useEffect(() => {
    const savedUser = localStorage.getItem("user");
    if (savedUser) {
      setCurrentUser(JSON.parse(savedUser));
    }
  }, []);

  const { data: parts } = useQuery<Part[]>({
    queryKey: ["/api/parts"],
  });

  const form = useForm<WorkOrderCompletionData>({
    resolver: zodResolver(workOrderCompletionSchema),
    defaultValues: {
      workSummary: "",
      customerNotes: "",
      totalHours: 1,
    },
  });

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
      };
      setUsedParts(prev => [...prev, newUsedPart]);
    }
  };

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
    form.reset();
    setUsedParts([]);
    setPhotos([]);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
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
                    <div key={part.id} className="flex items-center justify-between p-3 border rounded-lg bg-gray-50">
                      <div className="flex-1">
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
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
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
            <div className="flex justify-end gap-3">
              <Button 
                type="button" 
                variant="outline" 
                onClick={onEditClick}
                className="px-6"
              >
                <Edit className="w-4 h-4 mr-2" />
                Edit Details
              </Button>
              <Button 
                onClick={onFinalSubmit}
                disabled={isSubmitting}
                className="bg-green-600 hover:bg-green-700 text-white px-6"
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
                          step="0.1"
                          min="0.1"
                          placeholder="Enter hours (e.g., 2.5)"
                          className="max-w-xs"
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
                {/* Parts Selection */}
                <div className="border rounded-lg p-4 bg-gray-50">
                  <h4 className="font-medium mb-3">Add Parts</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-40 overflow-y-auto">
                    {parts?.map((part) => (
                      <Button
                        key={part.id}
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => addUsedPart(part)}
                        className="justify-start text-left h-auto p-2"
                      >
                        <div>
                          <div className="font-medium text-sm">{part.name}</div>
                          {currentUser?.role !== 'field_tech' && (
                            <div className="text-xs text-gray-500">${part.price}</div>
                          )}
                        </div>
                      </Button>
                    ))}
                  </div>
                </div>

                {/* Used Parts List */}
                {usedParts.length > 0 ? (
                  <div className="space-y-2">
                    {usedParts.map((usedPart) => (
                      <div key={usedPart.id} className="flex items-center justify-between p-3 border rounded-lg bg-white">
                        <div className="flex-1">
                          <div className="font-medium">{usedPart.partName}</div>
                          {currentUser?.role !== 'field_tech' ? (
                            <div className="text-sm text-gray-500">
                              ${usedPart.partPrice} each × {usedPart.quantity} = ${usedPart.totalCost.toFixed(2)}
                            </div>
                          ) : (
                            <div className="text-sm text-gray-500">
                              Quantity: {usedPart.quantity}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => updatePartQuantity(usedPart.id, usedPart.quantity - 1)}
                          >
                            <Minus className="w-3 h-3" />
                          </Button>
                          <span className="w-8 text-center">{usedPart.quantity}</span>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => updatePartQuantity(usedPart.id, usedPart.quantity + 1)}
                          >
                            <Plus className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>
                    ))}
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
            <div className="flex justify-end gap-3">
              {currentUser?.role !== 'field_tech' && (
                <Button type="button" variant="outline" onClick={handleClose}>
                  Cancel
                </Button>
              )}
              <Button 
                type="submit" 
                disabled={isSubmitting}
                className="bg-green-600 hover:bg-green-700 text-white"
              >
                {isSubmitting ? "Reviewing..." : "Review Work Order"}
              </Button>
            </div>
          </form>
        </Form>
        )}
      </DialogContent>
    </Dialog>
  );
}