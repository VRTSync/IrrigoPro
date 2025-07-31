import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CustomerSelector } from "@/components/ui/customer-selector";
import { LocationPicker } from "@/components/ui/location-picker";
import { Calendar, User, AlertCircle, FileText, Target, MapPin } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { insertWorkOrderSchema } from "@shared/schema";
import type { Customer, Estimate } from "@shared/schema";

const workOrderFormSchema = insertWorkOrderSchema.extend({
  scheduledDate: z.string().optional(),
  workLocationLat: z.number().optional(),
  workLocationLng: z.number().optional(),
  workLocationAddress: z.string().optional(),
});

type WorkOrderFormData = z.infer<typeof workOrderFormSchema>;

interface WorkOrderFormProps {
  onClose: () => void;
  onSuccess: () => void;
}

export function WorkOrderForm({ onClose, onSuccess }: WorkOrderFormProps) {
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [selectedLocation, setSelectedLocation] = useState<{lat: number; lng: number; address?: string} | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: estimates } = useQuery<Estimate[]>({
    queryKey: ["/api/estimates"],
  });

  const form = useForm<WorkOrderFormData>({
    resolver: zodResolver(workOrderFormSchema),
    defaultValues: {
      estimateId: null,
      customerId: 0,
      customerName: "",
      customerEmail: "",
      customerPhone: "",
      projectName: "Work Order",
      projectAddress: "",
      locationNotes: "",
      workLocationLat: undefined,
      workLocationLng: undefined,
      workLocationAddress: "",
      workType: "direct_billing",
      status: "pending",
      priority: "medium", // Default to standard for direct work orders
      scheduledDate: "",
      assignedTechnicianId: null,
      assignedTechnicianName: "",
      description: "",
      specialInstructions: "",
      notes: "",
    },
  });

  const watchedEstimateId = form.watch("estimateId");

  // Auto-fill estimate info when estimate is selected
  const selectedEstimate = estimates?.find(e => e.id === watchedEstimateId);
  if (selectedEstimate && form.getValues("projectName") !== selectedEstimate.projectName) {
    // Find the customer for this estimate and set it
    if (selectedEstimate.customerId) {
      // We'll need to fetch the customer details based on the estimate
      const estimateCustomer: Customer = {
        id: selectedEstimate.customerId,
        companyId: 1,
        name: selectedEstimate.customerName,
        email: selectedEstimate.customerEmail,
        phone: selectedEstimate.customerPhone || "",
        address: selectedEstimate.projectAddress || "",
        totalControllers: 1,
        contractType: "standard",
        laborRate: "45.00",
        markupPercent: "20.00",
        taxPercent: "8.25",
        discountPercent: "0.00",
        contractStartDate: null,
        contractEndDate: null,
        paymentTerms: "net_30",
        notes: null,
        propertyNotes: null,
      };
      setSelectedCustomer(estimateCustomer);
    }
    
    form.setValue("customerId", selectedEstimate.customerId || 0);
    form.setValue("customerName", selectedEstimate.customerName);
    form.setValue("customerEmail", selectedEstimate.customerEmail);
    form.setValue("customerPhone", selectedEstimate.customerPhone || "");
    form.setValue("projectName", selectedEstimate.projectName || "Work Order");
    form.setValue("projectAddress", selectedEstimate.projectAddress || "");
    form.setValue("locationNotes", selectedEstimate.locationNotes || "");
    form.setValue("workType", "estimate_based");
  }

  const handleCustomerSelect = (customer: Customer) => {
    setSelectedCustomer(customer);
    form.setValue("customerId", customer.id);
    form.setValue("customerName", customer.name);
    form.setValue("customerEmail", customer.email);
    form.setValue("customerPhone", customer.phone || "");
    // Don't auto-fill project address since it might be different from customer address
  };

  const createWorkOrder = useMutation({
    mutationFn: async (data: WorkOrderFormData) => {
      const submitData = {
        ...data,
        customerId: Number(data.customerId),
        estimateId: data.estimateId ? Number(data.estimateId) : null,
        assignedTechnicianId: data.assignedTechnicianId ? Number(data.assignedTechnicianId) : null,
        scheduledDate: data.scheduledDate ? new Date(data.scheduledDate).toISOString() : null,
      };
      
      return await apiRequest("/api/work-orders", "POST", submitData);
    },
    onSuccess: () => {
      toast({
        title: "Work Order Created",
        description: "New work order has been created successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
      onSuccess();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create work order",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: WorkOrderFormData) => {
    if (!selectedCustomer) {
      toast({
        title: "Customer Required",
        description: "Please select a customer before creating the work order.",
        variant: "destructive",
      });
      return;
    }

    // Ensure we have location data
    const finalData = {
      ...data,
      projectName: data.projectName || "Work Order",
      projectAddress: selectedLocation?.address || data.projectAddress || selectedCustomer.address || "",
    };

    createWorkOrder.mutate(finalData);
  };

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="w-[95vw] max-w-4xl h-[95vh] max-h-[95vh] overflow-hidden p-0 flex flex-col">
        <DialogHeader className="p-4 sm:p-6 border-b border-gray-200 flex-shrink-0">
          <DialogTitle className="flex items-center gap-2 text-lg sm:text-xl">
            <FileText className="w-5 h-5 text-blue-600" />
            Create New Work Order
          </DialogTitle>
          <DialogDescription>
            Create a new work order by selecting a customer and entering project details
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            
            {/* Step 1: Customer Selection */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <User className="w-5 h-5 text-blue-600" />
                  Step 1: Select Customer
                </CardTitle>
              </CardHeader>
              <CardContent>
                <CustomerSelector
                  selectedCustomer={selectedCustomer}
                  onSelectCustomer={handleCustomerSelect}
                  placeholder="Select customer for work order..."
                />
              </CardContent>
            </Card>

            {/* Step 2: Source Estimate (Optional) */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Target className="w-5 h-5 text-blue-600" />
                  Step 2: Source Estimate (Optional)
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="estimateId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Link to Approved Estimate</FormLabel>
                        <Select onValueChange={(value) => {
                          const estimateId = value ? parseInt(value) : null;
                          field.onChange(estimateId);
                          // Auto-set work type based on whether estimate is selected
                          form.setValue("workType", estimateId ? "estimate_based" : "direct_billing");
                        }}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select estimate (leave blank for direct work order)" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {estimates?.filter(est => est.status === 'approved').map((estimate) => (
                              <SelectItem key={estimate.id} value={estimate.id.toString()}>
                                {estimate.estimateNumber} - {estimate.projectName}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="priority"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Priority Level</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select priority" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="low">Low Priority</SelectItem>
                            <SelectItem value="medium">Standard</SelectItem>
                            <SelectItem value="high">High Priority</SelectItem>
                            <SelectItem value="urgent">Emergency</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                {watchedEstimateId && (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800">
                    <p><strong>Linked to Estimate:</strong> {selectedEstimate?.estimateNumber} - {selectedEstimate?.projectName}</p>
                    <p className="text-xs text-blue-600 mt-1">Customer and project details will be auto-filled from the estimate</p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Step 3: Work Location */}
            {selectedCustomer && (
              <LocationPicker
                defaultAddress={selectedCustomer.address || ""}
                onLocationSelect={(location) => {
                  setSelectedLocation(location);
                  form.setValue("workLocationLat", location.lat);
                  form.setValue("workLocationLng", location.lng);
                  form.setValue("workLocationAddress", location.address || "");
                }}
                selectedLocation={selectedLocation}
              />
            )}

            {/* Step 4: Work Description */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <FileText className="w-5 h-5 text-blue-600" />
                  Work Description
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Description *</FormLabel>
                      <FormControl>
                        <Textarea 
                          placeholder="Describe the work to be performed..." 
                          className="min-h-[100px]"
                          {...field} 
                          value={field.value || ""}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="locationNotes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Location Notes</FormLabel>
                      <FormControl>
                        <Textarea 
                          placeholder="Additional notes about the work location..." 
                          className="min-h-[80px]"
                          {...field} 
                          value={field.value || ""}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            {/* Step 5: Scheduling and Assignment */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Calendar className="w-5 h-5 text-blue-600" />
                  Scheduling & Assignment
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <FormField
                    control={form.control}
                    name="priority"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Priority</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select priority" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="low">Low</SelectItem>
                            <SelectItem value="medium">Medium</SelectItem>
                            <SelectItem value="high">High</SelectItem>
                            <SelectItem value="urgent">Urgent</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="scheduledDate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Scheduled Date</FormLabel>
                        <FormControl>
                          <Input type="datetime-local" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="assignedTechnicianName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Assigned Technician</FormLabel>
                        <FormControl>
                          <Input 
                            placeholder="Technician name" 
                            {...field} 
                            value={field.value || ""}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </CardContent>
            </Card>

            {/* Step 5: Additional Information */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Additional Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField
                  control={form.control}
                  name="specialInstructions"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Special Instructions</FormLabel>
                      <FormControl>
                        <Textarea 
                          placeholder="Any special instructions for the technician..." 
                          className="min-h-[60px]"
                          {...field}
                          value={field.value || ""}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="notes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Internal Notes</FormLabel>
                      <FormControl>
                        <Textarea 
                          placeholder="Internal notes (not visible to customer)..." 
                          className="min-h-[60px]"
                          {...field}
                          value={field.value || ""}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            {/* Action Buttons */}
            <div className="flex gap-4 pt-6">
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={createWorkOrder.isPending || !selectedCustomer}
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
              >
                {createWorkOrder.isPending ? "Creating..." : "Create Work Order"}
              </Button>
            </div>
          </form>
        </Form>
        </div>
      </DialogContent>
    </Dialog>
  );
}