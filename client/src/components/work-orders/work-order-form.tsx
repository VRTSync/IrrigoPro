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
import type { Customer } from "@shared/schema";

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
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Get field technicians for assignment
  const { data: fieldTechs } = useQuery<any[]>({
    queryKey: ["/api/users/field-techs"],
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

  const handleCustomerSelect = (customer: Customer) => {
    setSelectedCustomer(customer);
    form.setValue("customerId", customer.id);
    form.setValue("customerName", customer.name);
    form.setValue("customerEmail", customer.email);
    form.setValue("customerPhone", customer.phone || "");
    
    // Reset location picker when customer changes
    setShowLocationPicker(false);
    setSelectedLocation(null);
    form.setValue("workLocationLat", undefined);
    form.setValue("workLocationLng", undefined);
    form.setValue("workLocationAddress", "");
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
      <DialogContent className="w-screen h-screen sm:w-[95vw] sm:max-w-4xl sm:h-[95vh] sm:max-h-[95vh] sm:rounded-lg overflow-hidden p-0 flex flex-col m-0 sm:m-auto">
        <DialogHeader className="p-3 sm:p-6 border-b border-gray-200 flex-shrink-0">
          <DialogTitle className="flex items-center gap-2 text-lg sm:text-xl">
            <FileText className="w-5 h-5 text-blue-600" />
            Create New Work Order
          </DialogTitle>
          <DialogDescription>
            Create a new work order by selecting a customer and entering project details
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-3 sm:p-6">
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



            {/* Step 2: Work Location (Optional) */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <MapPin className="w-5 h-5 text-blue-600" />
                    Work Location
                  </span>
                  {selectedCustomer && (
                    <Button
                      type="button"
                      variant={showLocationPicker ? "default" : "outline"}
                      size="sm"
                      onClick={() => setShowLocationPicker(!showLocationPicker)}
                    >
                      {showLocationPicker ? "Hide Map" : "Select Location on Map"}
                    </Button>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {!selectedCustomer && (
                  <div className="text-sm text-gray-500">
                    <p>Please select a customer first to set work location.</p>
                  </div>
                )}

                {selectedCustomer && !showLocationPicker && (
                  <div className="text-sm text-gray-600">
                    <p><strong>Default Location:</strong> {selectedCustomer.address || "No address on file"}</p>
                    <p className="mt-2">Click "Select Location on Map" to choose a specific work location different from the customer's address.</p>
                  </div>
                )}
                
                {selectedCustomer && showLocationPicker && (
                  <div className="mt-4">
                    <LocationPicker
                      key={selectedCustomer.id} // Force re-render when customer changes
                      defaultAddress={selectedCustomer.address || ""}
                      onLocationSelect={(location) => {
                        setSelectedLocation(location);
                        form.setValue("workLocationLat", location.lat);
                        form.setValue("workLocationLng", location.lng);
                        form.setValue("workLocationAddress", location.address || "");
                      }}
                      selectedLocation={selectedLocation}
                    />
                  </div>
                )}

                {selectedLocation && (
                  <div className="bg-green-50 border border-green-200 rounded-lg p-3 mt-4">
                    <p className="text-sm font-medium text-green-900">Custom Location Selected:</p>
                    <p className="text-sm text-green-800 mt-1">
                      {selectedLocation.address || `${selectedLocation.lat.toFixed(6)}, ${selectedLocation.lng.toFixed(6)}`}
                    </p>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setSelectedLocation(null);
                        form.setValue("workLocationLat", undefined);
                        form.setValue("workLocationLng", undefined);
                        form.setValue("workLocationAddress", "");
                      }}
                      className="mt-2 text-green-700 hover:text-green-900"
                    >
                      Clear Custom Location
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Step 3: Work Description */}
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

            {/* Step 4: Scheduling and Assignment */}
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
                    name="assignedTechnicianId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Assigned Technician</FormLabel>
                        <Select 
                          onValueChange={(value) => {
                            const techId = value ? parseInt(value) : null;
                            field.onChange(techId);
                            // Auto-fill technician name
                            const selectedTech = fieldTechs?.find(tech => tech.id === techId);
                            if (selectedTech) {
                              form.setValue("assignedTechnicianName", selectedTech.name);
                            } else {
                              form.setValue("assignedTechnicianName", "");
                            }
                          }}
                          value={field.value?.toString() || ""}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select technician (optional)" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {fieldTechs?.map((tech) => (
                              <SelectItem key={tech.id} value={tech.id.toString()}>
                                {tech.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
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