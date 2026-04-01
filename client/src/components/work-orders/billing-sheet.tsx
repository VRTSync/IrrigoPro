import { useState, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { 
  Clock, 
  Plus, 
  Minus, 
  Calculator, 
  Save, 
  FileText, 
  Timer,
  Package,
  Wrench,
  AlertCircle,
  Camera,
  Upload,
  User
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { WorkOrder, WorkOrderItem } from "@shared/schema";
import logoPath from "@assets/irrigopro - logo - BLUE - FINAL_1756061385150.png";
import { GenerateDescriptionPanel, type AiOutputs, type AiInputs } from "./generate-description-panel";

const billingItemSchema = z.object({
  description: z.string().min(1, "Description is required"),
  quantity: z.number().min(0.01, "Quantity must be greater than 0"),
  unitPrice: z.number().min(0, "Unit price must be 0 or greater"),
  laborHours: z.number().min(0, "Labor hours must be 0 or greater"),
  notes: z.string().optional(),
});

const billingSheetSchema = z.object({
  workOrderId: z.number(),
  techName: z.string().min(1, "Technician name is required"),
  workPerformed: z.string().min(1, "Work performed description is required"),
  additionalNotes: z.string().optional(),
  totalPartsCost: z.number().min(0, "Total parts cost must be 0 or greater"),
  arrivalPhoto: z.string().optional(),
  finishedPhoto: z.string().optional(),
  actualStartTime: z.string(),
  actualEndTime: z.string(),
  laborRate: z.number().min(0, "Labor rate must be 0 or greater").default(0),
  materialItems: z.array(billingItemSchema),
  laborItems: z.array(billingItemSchema),
  additionalCharges: z.array(billingItemSchema),
  technicianNotes: z.string().optional(),
});

type BillingSheetData = z.infer<typeof billingSheetSchema>;

interface BillingSheetProps {
  workOrder: WorkOrder;
  existingItems?: WorkOrderItem[];
  onSave: () => void;
}

export function BillingSheet({ workOrder, existingItems, onSave }: BillingSheetProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [aiOutputs, setAiOutputs] = useState<AiOutputs>({ shortDescription: "", detailedDescription: "" });
  const [aiInputs, setAiInputs] = useState<AiInputs | null>(null);
  const arrivalPhotoRef = useRef<HTMLInputElement>(null);
  const finishedPhotoRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const form = useForm<BillingSheetData>({
    resolver: zodResolver(billingSheetSchema),
    defaultValues: {
      workOrderId: workOrder.id,
      techName: workOrder.assignedTechnicianName || "",
      workPerformed: "",
      additionalNotes: "",
      totalPartsCost: 0,
      arrivalPhoto: "",
      finishedPhoto: "",
      actualStartTime: workOrder.startedAt ? new Date(workOrder.startedAt).toISOString().slice(0, 16) : "",
      actualEndTime: workOrder.completedAt ? new Date(workOrder.completedAt).toISOString().slice(0, 16) : "",
      laborRate: 0,
      materialItems: [{ description: "", quantity: 1, unitPrice: 0, laborHours: 0, notes: "" }],
      laborItems: [{ description: "", quantity: 1, unitPrice: 0, laborHours: 0, notes: "" }],
      additionalCharges: [],
      technicianNotes: "",
    },
  });

  const { fields: materialFields, append: appendMaterial, remove: removeMaterial } = useFieldArray({
    control: form.control,
    name: "materialItems",
  });

  const { fields: laborFields, append: appendLabor, remove: removeLabor } = useFieldArray({
    control: form.control,
    name: "laborItems",
  });

  const { fields: additionalFields, append: appendAdditional, remove: removeAdditional } = useFieldArray({
    control: form.control,
    name: "additionalCharges",
  });

  const watchedData = form.watch();

  // Calculate totals
  const calculateTotals = () => {
    const materialTotal = watchedData.materialItems.reduce(
      (sum, item) => sum + (item.quantity * item.unitPrice), 0
    );
    const laborTotal = watchedData.laborItems.reduce(
      (sum, item) => sum + (item.quantity * item.unitPrice), 0
    );
    const additionalTotal = watchedData.additionalCharges.reduce(
      (sum, item) => sum + (item.quantity * item.unitPrice), 0
    );
    const totalLaborHours = watchedData.materialItems.reduce(
      (sum, item) => sum + item.laborHours, 0
    ) + watchedData.laborItems.reduce(
      (sum, item) => sum + item.laborHours, 0
    );
    const laborCharges = totalLaborHours * watchedData.laborRate;
    
    return {
      materialTotal,
      laborTotal,
      additionalTotal,
      totalLaborHours,
      laborCharges,
      grandTotal: materialTotal + laborTotal + additionalTotal + laborCharges,
    };
  };

  const totals = calculateTotals();

  const calculateTimeDifference = () => {
    if (watchedData.actualStartTime && watchedData.actualEndTime) {
      const start = new Date(watchedData.actualStartTime);
      const end = new Date(watchedData.actualEndTime);
      const diffMs = end.getTime() - start.getTime();
      const diffHours = diffMs / (1000 * 60 * 60);
      return Math.max(0, Math.round(diffHours * 100) / 100);
    }
    return 0;
  };

  const timeDifference = calculateTimeDifference();

  const saveBillingSheet = useMutation({
    mutationFn: async (data: BillingSheetData) => {
      return apiRequest(`/api/work-orders/${workOrder.id}/billing-sheet`, 'POST', {
        ...data,
        aiInputs: aiInputs ? JSON.stringify(aiInputs) : undefined,
        aiShortDescription: aiOutputs.shortDescription || undefined,
        aiDetailedDescription: aiOutputs.detailedDescription || undefined,
      });
    },
    onSuccess: () => {
      toast({
        title: "Billing Sheet Saved",
        description: "Work order billing information has been recorded successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
      onSave();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to save billing sheet",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: BillingSheetData) => {
    setIsSubmitting(true);
    saveBillingSheet.mutate(data);
  };

  return (
    <div className="space-y-4 sm:space-y-6 w-full overflow-x-hidden">
      {/* Header with Logo */}
      <Card className="bg-white shadow-sm">
        <CardHeader className="pb-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 min-w-0">
            <div className="flex items-center space-x-4 min-w-0">
              <img src={logoPath} alt="Company Logo" className="h-16 w-auto flex-shrink-0" />
              <div className="min-w-0">
                <h1 className="text-xl font-bold text-gray-900 truncate">High Plains Property</h1>
                <p className="text-sm text-gray-600">Maintenance</p>
                <p className="text-sm text-gray-600 truncate">14847 Madison St Brighton CO 80602</p>
              </div>
            </div>
            <div className="text-left sm:text-right flex-shrink-0">
              <h2 className="text-lg font-semibold text-blue-600">Irrigation Billing Sheet - Live</h2>
              <p className="text-sm text-gray-500">{new Date().toLocaleDateString()}</p>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              
              {/* Tech Information */}
              <Card className="border-2 border-gray-200">
                <CardContent className="p-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 min-w-0">
                    <FormField
                      control={form.control}
                      name="techName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="font-semibold">Tech Name</FormLabel>
                          <FormControl>
                            <Input {...field} className="bg-gray-50" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <div>
                      <label className="font-semibold text-sm">Work Order</label>
                      <p className="text-sm text-gray-700 mt-1">{workOrder.workOrderNumber}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Work Performed */}
              <Card className="border-2 border-gray-200">
                <CardContent className="p-4">
                  <FormField
                    control={form.control}
                    name="workPerformed"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="font-semibold">Work Performed</FormLabel>
                        <FormControl>
                          <Textarea 
                            {...field}
                            placeholder="Describe the work performed..."
                            className="min-h-[100px] bg-gray-50"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <div className="mt-4">
                    <FormField
                      control={form.control}
                      name="additionalNotes"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="font-semibold">Anything else we need to know??</FormLabel>
                          <FormControl>
                            <Textarea 
                              {...field}
                              placeholder="Additional notes..."
                              className="min-h-[60px] bg-gray-50"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <div className="mt-4">
                    <FormField
                      control={form.control}
                      name="totalPartsCost"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="font-semibold">Total Parts Cost</FormLabel>
                          <FormControl>
                            <div className="relative">
                              <span className="absolute left-3 top-3 text-gray-500">$</span>
                              <Input 
                                type="number"
                                inputMode="decimal"
                                step="0.01"
                                {...field}
                                onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                                className="pl-8 bg-gray-50"
                              />
                            </div>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </CardContent>
              </Card>

              {/* Photo Upload Section */}
              <Card className="border-2 border-gray-200">
                <CardHeader>
                  <CardTitle className="text-lg flex items-center">
                    <Camera className="w-5 h-5 mr-2" />
                    Work Documentation Photos
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 min-w-0">
                    <div>
                      <FormField
                        control={form.control}
                        name="arrivalPhoto"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="font-semibold">Arrival Picture</FormLabel>
                            <FormControl>
                              <div 
                                className="border-2 border-dashed border-gray-300 rounded-lg p-4 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-colors min-h-[80px] flex flex-col items-center justify-center"
                                onClick={() => arrivalPhotoRef.current?.click()}
                              >
                                <Camera className="w-8 h-8 text-gray-400 mb-2" />
                                <p className="text-sm text-gray-500">
                                  {field.value ? field.value : "Tap to take or upload photo"}
                                </p>
                                <input 
                                  ref={arrivalPhotoRef}
                                  type="file" 
                                  accept="image/*"
                                  capture="environment"
                                  className="hidden"
                                  onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    if (file) {
                                      field.onChange(file.name);
                                    }
                                  }}
                                />
                              </div>
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                    
                    <div>
                      <FormField
                        control={form.control}
                        name="finishedPhoto"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="font-semibold">Finished Photo</FormLabel>
                            <FormControl>
                              <div 
                                className="border-2 border-dashed border-gray-300 rounded-lg p-4 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-colors min-h-[80px] flex flex-col items-center justify-center"
                                onClick={() => finishedPhotoRef.current?.click()}
                              >
                                <Camera className="w-8 h-8 text-gray-400 mb-2" />
                                <p className="text-sm text-gray-500">
                                  {field.value ? field.value : "Tap to take or upload photo"}
                                </p>
                                <input 
                                  ref={finishedPhotoRef}
                                  type="file" 
                                  accept="image/*"
                                  capture="environment"
                                  className="hidden"
                                  onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    if (file) {
                                      field.onChange(file.name);
                                    }
                                  }}
                                />
                              </div>
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>
              
              {/* Time Tracking */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center">
                    <Timer className="w-5 h-5 mr-2" />
                    Time Tracking
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 min-w-0">
                    <FormField
                      control={form.control}
                      name="actualStartTime"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Start Time</FormLabel>
                          <FormControl>
                            <Input type="datetime-local" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="actualEndTime"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>End Time</FormLabel>
                          <FormControl>
                            <Input type="datetime-local" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  
                  {timeDifference > 0 && (
                    <div className="bg-blue-50 p-4 rounded-lg">
                      <div className="flex items-center text-blue-800">
                        <Clock className="w-4 h-4 mr-2" />
                        <span className="font-medium">
                          Total Time: {timeDifference} hours
                        </span>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Materials Used */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center">
                    <Package className="w-5 h-5 mr-2" />
                    Materials Used
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {materialFields.map((field, index) => (
                      <div key={field.id} className="p-3 bg-gray-50 rounded-lg space-y-3 border border-gray-200">
                        <div className="flex items-start justify-between gap-2">
                          <FormField
                            control={form.control}
                            name={`materialItems.${index}.description`}
                            render={({ field }) => (
                              <FormItem className="flex-1 min-w-0">
                                <FormLabel className="text-xs font-medium text-gray-600">Description</FormLabel>
                                <FormControl>
                                  <Input placeholder="Material description" {...field} />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => removeMaterial(index)}
                            className="text-red-600 hover:text-red-700 h-11 w-11 p-0 flex-shrink-0 mt-5"
                          >
                            <Minus className="w-4 h-4" />
                          </Button>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 min-w-0">
                          <FormField
                            control={form.control}
                            name={`materialItems.${index}.quantity`}
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel className="text-xs font-medium text-gray-600">Qty</FormLabel>
                                <FormControl>
                                  <Input 
                                    type="number"
                                    inputMode="decimal"
                                    step="0.01" 
                                    {...field}
                                    onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={form.control}
                            name={`materialItems.${index}.unitPrice`}
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel className="text-xs font-medium text-gray-600">Unit Price</FormLabel>
                                <FormControl>
                                  <Input 
                                    type="number"
                                    inputMode="decimal"
                                    step="0.01" 
                                    {...field}
                                    onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={form.control}
                            name={`materialItems.${index}.laborHours`}
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel className="text-xs font-medium text-gray-600">Labor Hrs</FormLabel>
                                <FormControl>
                                  <Input 
                                    type="number"
                                    inputMode="decimal"
                                    step="0.01" 
                                    {...field}
                                    onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </div>
                      </div>
                    ))}
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => appendMaterial({ description: "", quantity: 1, unitPrice: 0, laborHours: 0, notes: "" })}
                      className="w-full"
                    >
                      <Plus className="w-4 h-4 mr-2" />
                      Add Material
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {/* Labor Services */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center">
                    <Wrench className="w-5 h-5 mr-2" />
                    Labor Services
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {laborFields.map((field, index) => (
                      <div key={field.id} className="p-3 bg-gray-50 rounded-lg space-y-3 border border-gray-200">
                        <div className="flex items-start justify-between gap-2">
                          <FormField
                            control={form.control}
                            name={`laborItems.${index}.description`}
                            render={({ field }) => (
                              <FormItem className="flex-1 min-w-0">
                                <FormLabel className="text-xs font-medium text-gray-600">Service Description</FormLabel>
                                <FormControl>
                                  <Input placeholder="Labor service description" {...field} />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => removeLabor(index)}
                            className="text-red-600 hover:text-red-700 h-11 w-11 p-0 flex-shrink-0 mt-5"
                          >
                            <Minus className="w-4 h-4" />
                          </Button>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 min-w-0">
                          <FormField
                            control={form.control}
                            name={`laborItems.${index}.quantity`}
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel className="text-xs font-medium text-gray-600">Qty</FormLabel>
                                <FormControl>
                                  <Input 
                                    type="number"
                                    inputMode="decimal"
                                    step="0.01" 
                                    {...field}
                                    onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={form.control}
                            name={`laborItems.${index}.unitPrice`}
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel className="text-xs font-medium text-gray-600">Unit Price</FormLabel>
                                <FormControl>
                                  <Input 
                                    type="number"
                                    inputMode="decimal"
                                    step="0.01" 
                                    {...field}
                                    onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={form.control}
                            name={`laborItems.${index}.laborHours`}
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel className="text-xs font-medium text-gray-600">Labor Hrs</FormLabel>
                                <FormControl>
                                  <Input 
                                    type="number"
                                    inputMode="decimal"
                                    step="0.01" 
                                    {...field}
                                    onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </div>
                      </div>
                    ))}
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => appendLabor({ description: "", quantity: 1, unitPrice: 0, laborHours: 0, notes: "" })}
                      className="w-full"
                    >
                      <Plus className="w-4 h-4 mr-2" />
                      Add Labor Service
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {/* Additional Charges */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center">
                    <Calculator className="w-5 h-5 mr-2" />
                    Additional Charges
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {additionalFields.map((field, index) => (
                      <div key={field.id} className="p-3 bg-gray-50 rounded-lg space-y-3 border border-gray-200">
                        <div className="flex items-start justify-between gap-2">
                          <FormField
                            control={form.control}
                            name={`additionalCharges.${index}.description`}
                            render={({ field }) => (
                              <FormItem className="flex-1 min-w-0">
                                <FormLabel className="text-xs font-medium text-gray-600">Description</FormLabel>
                                <FormControl>
                                  <Input placeholder="Additional charge description" {...field} />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => removeAdditional(index)}
                            className="text-red-600 hover:text-red-700 h-11 w-11 p-0 flex-shrink-0 mt-5"
                          >
                            <Minus className="w-4 h-4" />
                          </Button>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 min-w-0">
                          <FormField
                            control={form.control}
                            name={`additionalCharges.${index}.quantity`}
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel className="text-xs font-medium text-gray-600">Qty</FormLabel>
                                <FormControl>
                                  <Input 
                                    type="number"
                                    inputMode="decimal"
                                    step="0.01" 
                                    {...field}
                                    onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={form.control}
                            name={`additionalCharges.${index}.unitPrice`}
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel className="text-xs font-medium text-gray-600">Unit Price</FormLabel>
                                <FormControl>
                                  <Input 
                                    type="number"
                                    inputMode="decimal"
                                    step="0.01" 
                                    {...field}
                                    onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </div>
                      </div>
                    ))}
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => appendAdditional({ description: "", quantity: 1, unitPrice: 0, laborHours: 0, notes: "" })}
                      className="w-full"
                    >
                      <Plus className="w-4 h-4 mr-2" />
                      Add Additional Charge
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {/* Totals Summary */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center">
                    <Calculator className="w-5 h-5 mr-2" />
                    Billing Summary
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <div className="flex justify-between text-sm">
                      <span>Materials Total:</span>
                      <span>${totals.materialTotal.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span>Labor Services Total:</span>
                      <span>${totals.laborTotal.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span>Additional Charges Total:</span>
                      <span>${totals.additionalTotal.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span>Total Labor Hours:</span>
                      <span>{totals.totalLaborHours.toFixed(2)} hrs</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span>Labor Charges:</span>
                      <span>${totals.laborCharges.toFixed(2)}</span>
                    </div>
                    <Separator />
                    <div className="flex justify-between text-lg font-bold">
                      <span>Grand Total:</span>
                      <span>${totals.grandTotal.toFixed(2)}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Notes */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Technician Notes</CardTitle>
                </CardHeader>
                <CardContent>
                  <FormField
                    control={form.control}
                    name="technicianNotes"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Work Notes & Observations</FormLabel>
                        <FormControl>
                          <Textarea 
                            placeholder="Document any issues, observations, or additional notes about the work performed..."
                            className="min-h-[100px]"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </CardContent>
              </Card>

              {/* AI Description Generator */}
              <GenerateDescriptionPanel
                entityType="billing_sheet"
                entityId={workOrder.id}
                onOutputChange={(outputs, inputs) => {
                  setAiOutputs(outputs);
                  setAiInputs(inputs);
                }}
              />

              {/* Submit Button */}
              <div className="flex justify-end space-x-4">
                <Button
                  type="submit"
                  disabled={isSubmitting || saveBillingSheet.isPending}
                  className="bg-primary text-white hover:bg-blue-700 min-h-[44px] px-6"
                >
                  {isSubmitting || saveBillingSheet.isPending ? (
                    <>
                      <Save className="w-4 h-4 mr-2 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save className="w-4 h-4 mr-2" />
                      Save Billing Sheet
                    </>
                  )}
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}