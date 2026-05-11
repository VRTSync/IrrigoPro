import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@/lib/zod-resolver";
import { z } from "zod/v4";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { FileUpload } from "@/components/ui/file-upload";
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
  User
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { WorkOrder, WorkOrderItem, Customer } from "@shared/schema";
import { buildMapsUrl } from "@/lib/maps-url";
import logoPath from "@assets/IrrigoPro_2026-05_1778193170303.png";

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
  const [selectedBranch, setSelectedBranch] = useState<string>(workOrder.branchName || "");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: customer, isLoading: isCustomerLoading } = useQuery<Customer>({
    queryKey: ["/api/customers", workOrder.customerId],
    enabled: !!workOrder.customerId,
  });

  const customerBranches: string[] = Array.isArray(customer?.branches) ? customer.branches : [];
  const needsBranchSelection = customerBranches.length > 0 && !workOrder.branchName;
  // Block save while customer data is still being fetched (prevents timing-window bypass of branch check)
  const isBranchCheckPending = !!workOrder.customerId && isCustomerLoading;

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
        branchName: selectedBranch || workOrder.branchName || undefined,
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
    if (needsBranchSelection && !selectedBranch) {
      toast({
        title: "Branch Required",
        description: "Please select a branch location before saving the billing sheet.",
        variant: "destructive",
      });
      return;
    }
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

              {/* Branch selector — shown when the customer has branches but the work order has no branch set */}
              {needsBranchSelection && (
                <Card className="border-2 border-orange-300 bg-orange-50">
                  <CardContent className="p-4">
                    <div className="space-y-2">
                      <label className="font-semibold text-sm text-orange-800 flex items-center gap-1">
                        <User className="w-4 h-4" />
                        Branch Location *
                      </label>
                      <p className="text-xs text-orange-700">This customer has multiple branch locations. Please select the branch for this billing sheet.</p>
                      <Select value={selectedBranch} onValueChange={setSelectedBranch}>
                        <SelectTrigger className="bg-white border-orange-300">
                          <SelectValue placeholder="Select branch location..." />
                        </SelectTrigger>
                        <SelectContent>
                          {customerBranches.map((branch) => (
                            <SelectItem key={branch} value={branch}>{branch}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {!selectedBranch && (
                        <p className="text-xs text-red-600 font-medium">Branch selection is required before saving.</p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Inherited Pinned Location (from parent work order) */}
              {(workOrder.workLocationLat != null && workOrder.workLocationLng != null) ||
              workOrder.workLocationAddress ||
              workOrder.controllerLetter ||
              workOrder.zoneNumber != null ? (
                <Card className="border-l-4 border-l-blue-500 bg-blue-50/40">
                  <CardContent className="p-4 space-y-2">
                    {(workOrder.workLocationLat != null && workOrder.workLocationLng != null) ||
                    workOrder.workLocationAddress ? (
                      <div className="space-y-1">
                        <p className="text-sm font-semibold text-blue-900">Pinned Location</p>
                        <p className="text-sm text-blue-800">
                          {workOrder.workLocationAddress ||
                            (workOrder.workLocationLat != null && workOrder.workLocationLng != null
                              ? `${Number(workOrder.workLocationLat).toFixed(6)}, ${Number(
                                  workOrder.workLocationLng,
                                ).toFixed(6)}`
                              : "")}
                        </p>
                        {(() => {
                          const url = buildMapsUrl({
                            lat:
                              workOrder.workLocationLat != null
                                ? Number(workOrder.workLocationLat)
                                : null,
                            lng:
                              workOrder.workLocationLng != null
                                ? Number(workOrder.workLocationLng)
                                : null,
                            address: workOrder.workLocationAddress ?? null,
                          });
                          return url ? (
                            <a
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-blue-700 underline hover:text-blue-900"
                            >
                              Open in Maps
                            </a>
                          ) : null;
                        })()}
                      </div>
                    ) : null}
                    {(workOrder.controllerLetter || workOrder.zoneNumber != null) && (
                      <div className="flex flex-wrap gap-2 text-xs text-blue-900">
                        {workOrder.controllerLetter && (
                          <span className="px-2 py-0.5 rounded bg-blue-100 border border-blue-200">
                            Controller {workOrder.controllerLetter}
                          </span>
                        )}
                        {workOrder.zoneNumber != null && (
                          <span className="px-2 py-0.5 rounded bg-blue-100 border border-blue-200">
                            Zone {workOrder.zoneNumber}
                          </span>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ) : null}

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
                              <FileUpload
                                type="photo"
                                label="Arrival Picture"
                                accept="image/*"
                                multiple={false}
                                files={field.value
                                  ? [{ url: field.value, fileName: field.value, originalName: 'Arrival Picture' }]
                                  : []}
                                onFilesChange={(files) => field.onChange(files[0]?.url || '')}
                              />
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
                              <FileUpload
                                type="photo"
                                label="Finished Photo"
                                accept="image/*"
                                multiple={false}
                                files={field.value
                                  ? [{ url: field.value, fileName: field.value, originalName: 'Finished Photo' }]
                                  : []}
                                onFilesChange={(files) => field.onChange(files[0]?.url || '')}
                              />
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

              {/* Submit Button */}
              <div className="flex justify-end space-x-4">
                <Button
                  type="submit"
                  disabled={isSubmitting || saveBillingSheet.isPending || isBranchCheckPending}
                  className="bg-primary text-white hover:bg-blue-700 min-h-[44px] px-6"
                >
                  {isSubmitting || saveBillingSheet.isPending ? (
                    <>
                      <Save className="w-4 h-4 mr-2 animate-spin" />
                      Saving...
                    </>
                  ) : isBranchCheckPending ? (
                    <>
                      <Save className="w-4 h-4 mr-2 animate-spin" />
                      Loading...
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