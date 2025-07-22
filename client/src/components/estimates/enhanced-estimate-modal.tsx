import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { CustomerSelector } from "@/components/ui/customer-selector";
import { Plus, Trash2, Search, User, FileText, Image, Paperclip, Calendar } from "lucide-react";
import { PartsSearchModal } from "./parts-search-modal";
import { FileUpload, type UploadedFile } from "@/components/ui/file-upload";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { Part, Customer, EstimateWithZones } from "@shared/schema";
import { useEffect } from "react";

const estimateFormSchema = z.object({
  customerId: z.number().min(1, "Customer is required"),
  customerName: z.string().min(1, "Customer name is required"),
  customerEmail: z.string().email("Valid email is required"),
  customerPhone: z.string().optional(),
  projectName: z.string().min(1, "Project name is required"),
  projectAddress: z.string().optional(),
  estimateDate: z.string().default(() => new Date().toISOString().split('T')[0]),
  createdBy: z.string().default("Irrigation Manager"),
  laborRate: z.coerce.number().min(0, "Labor rate must be positive"),
  markupPercent: z.coerce.number().min(0, "Markup percentage must be positive"),
  taxPercent: z.coerce.number().min(0, "Tax percentage must be positive"),
});

type EstimateFormValues = z.infer<typeof estimateFormSchema>;

interface EstimateItem {
  part: Part;
  quantity: number;
  totalPrice: number;
  totalLaborHours: number;
}

interface EstimateZone {
  id: string;
  controllerId: string; // A, B, C, D, etc.
  zoneNumber: string;
  zoneName: string; // Full zone name like "Controller B Zone 21"
  workDescription: string;
  clockInTime: string;
  items: EstimateItem[];
}

interface NewZoneFormData {
  controllerId: string;
  zoneNumber: string;
  workDescription: string;
}

interface EnhancedEstimateModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  estimateId?: number | null; // For editing existing estimates
}

export function EnhancedEstimateModal({ open, onOpenChange, estimateId }: EnhancedEstimateModalProps) {
  const [zones, setZones] = useState<EstimateZone[]>([]);
  const [showPartsModal, setShowPartsModal] = useState(false);
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [photos, setPhotos] = useState<UploadedFile[]>([]);
  const [attachments, setAttachments] = useState<UploadedFile[]>([]);
  const [newZoneForm, setNewZoneForm] = useState<NewZoneFormData>({
    controllerId: "",
    zoneNumber: "",
    workDescription: ""
  });
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Fetch estimate data for editing
  const { data: estimate, isLoading: isLoadingEstimate } = useQuery<EstimateWithZones>({
    queryKey: ["/api/estimates", estimateId],
    enabled: open && estimateId !== null,
  });

  // Fetch customers for selector
  const { data: customers } = useQuery<Customer[]>({
    queryKey: ["/api/customers"],
    enabled: open,
  });

  const form = useForm<EstimateFormValues>({
    resolver: zodResolver(estimateFormSchema),
    defaultValues: {
      customerId: 0,
      customerName: "",
      customerEmail: "",
      customerPhone: "",
      projectName: "",
      projectAddress: "",
      estimateDate: new Date().toISOString().split('T')[0],
      createdBy: "Irrigation Manager",
      laborRate: 45,
      markupPercent: 20,
      taxPercent: 8.25,
    },
  });

  // Helper function to generate controller options based on customer's total controllers
  const getControllerOptions = (totalControllers: number) => {
    console.log("Creating controller options for", totalControllers, "controllers");
    console.log("Selected customer:", selectedCustomer);
    const options = [];
    for (let i = 0; i < totalControllers; i++) {
      const letter = String.fromCharCode(65 + i); // A, B, C, D, etc.
      options.push({ value: letter, label: `Controller ${letter}` });
    }
    return options;
  };

  // Load estimate data when editing
  useEffect(() => {
    if (estimate && customers) {
      // Reset form with estimate data
      form.reset({
        customerId: estimate.customerId,
        customerName: estimate.customerName,
        customerEmail: estimate.customerEmail,
        customerPhone: estimate.customerPhone || "",
        projectName: estimate.projectName,
        projectAddress: estimate.projectAddress || "",
        estimateDate: new Date(estimate.estimateDate).toISOString().split('T')[0],
        createdBy: estimate.createdBy,
        laborRate: parseFloat(estimate.laborRate),
        markupPercent: parseFloat(estimate.markupPercent),
        taxPercent: parseFloat(estimate.taxPercent),
      });

      // Convert estimate zones to our zone format
      const estimateZones: EstimateZone[] = estimate.zones.map((zone, index) => ({
        id: `zone-${index}`,
        controllerId: zone.controllerId,
        zoneNumber: zone.zoneNumber,
        zoneName: zone.zoneName,
        workDescription: zone.workDescription,
        clockInTime: zone.clockInTime || "",
        items: zone.items.map(item => ({
          part: {
            id: item.partId,
            name: item.partName,
            description: "",
            price: item.partPrice,
            laborHours: item.laborHours,
            sku: "",
            category: ""
          } as Part,
          quantity: item.quantity,
          totalPrice: parseFloat(item.totalPrice),
          totalLaborHours: parseFloat(item.laborHours) * item.quantity
        }))
      }));

      setZones(estimateZones);

      // Set selected customer
      const customer = customers.find(c => c.id === estimate.customerId);
      setSelectedCustomer(customer || null);
    }
  }, [estimate, customers, form]);

  const handleCustomerSelect = (customer: Customer) => {
    setSelectedCustomer(customer);
    form.setValue("customerId", customer.id);
    form.setValue("customerName", customer.name);
    form.setValue("customerEmail", customer.email);
    form.setValue("customerPhone", customer.phone || "");
    // Use customer's contract rates
    form.setValue("laborRate", parseFloat(customer.laborRate || "45"));
    form.setValue("markupPercent", parseFloat(customer.markupPercent || "20"));
    form.setValue("taxPercent", parseFloat(customer.taxPercent || "8.25"));
  };

  const addZone = () => {
    if (!newZoneForm.controllerId || !newZoneForm.zoneNumber || !newZoneForm.workDescription) {
      toast({
        title: "Error",
        description: "Please fill in all zone details",
        variant: "destructive",
      });
      return;
    }

    const newZone: EstimateZone = {
      id: Date.now().toString(),
      controllerId: newZoneForm.controllerId,
      zoneNumber: newZoneForm.zoneNumber,
      zoneName: `Controller ${newZoneForm.controllerId} Zone ${newZoneForm.zoneNumber}`,
      workDescription: newZoneForm.workDescription,
      clockInTime: "",
      items: [],
    };
    
    setZones([...zones, newZone]);
    setNewZoneForm({
      controllerId: "",
      zoneNumber: "",
      workDescription: ""
    });
  };

  const updateZone = (zoneId: string, updates: Partial<EstimateZone>) => {
    setZones(zones.map(zone => 
      zone.id === zoneId ? { ...zone, ...updates } : zone
    ));
  };

  const removeZone = (zoneId: string) => {
    setZones(zones.filter(zone => zone.id !== zoneId));
  };

  const addPart = (part: Part, quantity: number = 1) => {
    if (!selectedZoneId) {
      toast({
        title: "Error",
        description: "Please select a zone first",
        variant: "destructive",
      });
      return;
    }

    const zone = zones.find(z => z.id === selectedZoneId);
    if (!zone) return;

    const existingIndex = zone.items.findIndex(item => item.part.id === part.id);
    
    if (existingIndex >= 0) {
      // Update existing item quantity
      const updatedItems = [...zone.items];
      updatedItems[existingIndex].quantity += quantity;
      updatedItems[existingIndex].totalPrice = updatedItems[existingIndex].quantity * parseFloat(part.price);
      updatedItems[existingIndex].totalLaborHours = updatedItems[existingIndex].quantity * parseFloat(part.laborHours);
      
      updateZone(selectedZoneId, { items: updatedItems });
    } else {
      // Add new item
      const newItem: EstimateItem = {
        part,
        quantity,
        totalPrice: quantity * parseFloat(part.price),
        totalLaborHours: quantity * parseFloat(part.laborHours),
      };
      
      updateZone(selectedZoneId, { items: [...zone.items, newItem] });
    }
    
    setShowPartsModal(false);
  };

  const removePart = (zoneId: string, partId: number) => {
    const zone = zones.find(z => z.id === zoneId);
    if (!zone) return;
    
    const updatedItems = zone.items.filter(item => item.part.id !== partId);
    updateZone(zoneId, { items: updatedItems });
  };

  const updatePartQuantity = (zoneId: string, partId: number, newQuantity: number) => {
    const zone = zones.find(z => z.id === zoneId);
    if (!zone) return;
    
    const updatedItems = zone.items.map(item => {
      if (item.part.id === partId) {
        return {
          ...item,
          quantity: newQuantity,
          totalPrice: newQuantity * parseFloat(item.part.price),
          totalLaborHours: newQuantity * parseFloat(item.part.laborHours),
        };
      }
      return item;
    });
    
    updateZone(zoneId, { items: updatedItems });
  };

  const createEstimateMutation = useMutation({
    mutationFn: async (data: { estimate: any; zones: any[] }) => {
      if (estimateId) {
        // Update existing estimate
        return await apiRequest(`/api/estimates/${estimateId}`, "PUT", data);
      } else {
        // Create new estimate
        return await apiRequest("/api/estimates", "POST", data);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/estimates"] });
      queryClient.invalidateQueries({ queryKey: ["/api/estimates", estimateId] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      toast({
        title: "Success",
        description: estimateId ? "Estimate updated successfully" : "Estimate created successfully",
      });
      onOpenChange(false);
      resetForm();
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: estimateId ? "Failed to update estimate" : "Failed to create estimate",
        variant: "destructive",
      });
    },
  });

  const resetForm = () => {
    form.reset();
    setZones([]);
    setSelectedCustomer(null);
    setPhotos([]);
    setAttachments([]);
    setNewZoneForm({
      controllerId: "",
      zoneNumber: "",
      workDescription: ""
    });
  };

  const onSubmit = async (values: EstimateFormValues) => {
    if (zones.length === 0) {
      toast({
        title: "Error",
        description: "Please add at least one zone to the estimate",
        variant: "destructive",
      });
      return;
    }

    const estimate = {
      ...values,
      photos: photos.map(p => p.url),
      attachments: attachments.map(a => a.url),
    };

    await createEstimateMutation.mutateAsync({
      estimate,
      zones: zones.map(zone => ({
        controllerId: zone.controllerId,
        zoneNumber: zone.zoneNumber,
        zoneName: zone.zoneName,
        workDescription: zone.workDescription,
        clockInTime: zone.clockInTime,
        items: zone.items,
      })),
    });
  };

  // Calculate totals
  const calculateTotals = () => {
    const partsSubtotal = zones.reduce((total, zone) => 
      total + zone.items.reduce((zoneTotal, item) => zoneTotal + item.totalPrice, 0), 0
    );
    
    const laborRate = form.getValues("laborRate") || 45;
    const totalLaborHours = zones.reduce((total, zone) => 
      total + zone.items.reduce((zoneTotal, item) => zoneTotal + item.totalLaborHours, 0), 0
    );
    const laborSubtotal = totalLaborHours * laborRate;
    
    const markupPercent = form.getValues("markupPercent") || 0;
    const markupAmount = (partsSubtotal + laborSubtotal) * (markupPercent / 100);
    
    const subtotalWithMarkup = partsSubtotal + laborSubtotal + markupAmount;
    const taxPercent = form.getValues("taxPercent") || 0;
    const taxAmount = subtotalWithMarkup * (taxPercent / 100);
    
    const totalAmount = subtotalWithMarkup + taxAmount;

    return {
      partsSubtotal,
      laborSubtotal,
      markupAmount,
      taxAmount,
      totalAmount,
      totalLaborHours,
    };
  };

  const totals = calculateTotals();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {estimateId ? "Edit Estimate" : "Create New Estimate"}
          </DialogTitle>
          <DialogDescription>
            {estimateId 
              ? "Modify estimate details and adjust zones with required parts" 
              : "Create a comprehensive estimate with zone-based work descriptions and parts selection"
            }
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            {/* Customer Selection */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <User className="w-5 h-5" />
                  Customer Information
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <CustomerSelector 
                  onSelectCustomer={handleCustomerSelect}
                  selectedCustomer={selectedCustomer}
                />
                
                {selectedCustomer && (
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="customerName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Customer Name</FormLabel>
                          <FormControl>
                            <Input {...field} readOnly />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    
                    <FormField
                      control={form.control}
                      name="customerEmail"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Email</FormLabel>
                          <FormControl>
                            <Input {...field} readOnly />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Project Details */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="w-5 h-5" />
                  Project Details
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="projectName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Project Name</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="e.g., Backyard Irrigation System" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <FormField
                    control={form.control}
                    name="projectAddress"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Project Address</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="Project location" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="estimateDate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Estimate Date</FormLabel>
                        <FormControl>
                          <Input {...field} type="date" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <FormField
                    control={form.control}
                    name="createdBy"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Created By</FormLabel>
                        <FormControl>
                          <Input {...field} readOnly />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </CardContent>
            </Card>

            {/* Zone Management */}
            {selectedCustomer && (
              <Card>
                <CardHeader>
                  <CardTitle>Zone Selection & Work Description</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Add New Zone Form */}
                  <div className="grid grid-cols-4 gap-4 p-4 bg-gray-50 rounded-lg">
                    <Select
                      value={newZoneForm.controllerId}
                      onValueChange={(value) => setNewZoneForm(prev => ({ ...prev, controllerId: value }))}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select Controller" />
                      </SelectTrigger>
                      <SelectContent>
                        {getControllerOptions(selectedCustomer?.totalControllers || 1).map(option => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    <Input
                      placeholder="Zone Number"
                      value={newZoneForm.zoneNumber}
                      onChange={(e) => setNewZoneForm(prev => ({ ...prev, zoneNumber: e.target.value }))}
                    />

                    <Input
                      placeholder="Work Description"
                      value={newZoneForm.workDescription}
                      onChange={(e) => setNewZoneForm(prev => ({ ...prev, workDescription: e.target.value }))}
                      className="col-span-1"
                    />

                    <Button
                      type="button"
                      onClick={addZone}
                      className="flex items-center gap-2"
                    >
                      <Plus className="w-4 h-4" />
                      Add Zone
                    </Button>
                  </div>

                  {/* Existing Zones */}
                  {zones.map((zone) => (
                    <Card key={zone.id} className="border-l-4 border-l-blue-500">
                      <CardHeader>
                        <div className="flex items-center justify-between">
                          <CardTitle className="text-lg">{zone.zoneName}</CardTitle>
                          <Button
                            type="button"
                            variant="destructive"
                            size="sm"
                            onClick={() => removeZone(zone.id)}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                        <p className="text-sm text-gray-600">{zone.workDescription}</p>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <h4 className="font-medium">Parts Required</h4>
                            <Button
                              type="button"
                              size="sm"
                              onClick={() => {
                                setSelectedZoneId(zone.id);
                                setShowPartsModal(true);
                              }}
                            >
                              <Plus className="w-4 h-4 mr-1" />
                              Add Parts
                            </Button>
                          </div>

                          {zone.items.length === 0 ? (
                            <p className="text-gray-500 text-center py-4">No parts selected</p>
                          ) : (
                            <div className="space-y-2">
                              {zone.items.map((item) => (
                                <div key={item.part.id} className="flex items-center justify-between p-3 bg-gray-50 rounded">
                                  <div className="flex-1">
                                    <p className="font-medium">{item.part.name}</p>
                                    <p className="text-sm text-gray-600">{item.part.description}</p>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <Input
                                      type="number"
                                      min="1"
                                      value={item.quantity}
                                      onChange={(e) => updatePartQuantity(zone.id, item.part.id, parseInt(e.target.value) || 1)}
                                      className="w-20"
                                    />
                                    <span className="text-sm text-gray-600 w-16">${item.totalPrice.toFixed(2)}</span>
                                    <Button
                                      type="button"
                                      variant="destructive"
                                      size="sm"
                                      onClick={() => removePart(zone.id, item.part.id)}
                                    >
                                      <Trash2 className="w-4 h-4" />
                                    </Button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </CardContent>
              </Card>
            )}

            {/* Pricing */}
            <Card>
              <CardHeader>
                <CardTitle>Pricing Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-3 gap-4">
                  <FormField
                    control={form.control}
                    name="laborRate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Labor Rate ($/hour)</FormLabel>
                        <FormControl>
                          <Input {...field} type="number" step="0.01" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <FormField
                    control={form.control}
                    name="markupPercent"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Markup (%)</FormLabel>
                        <FormControl>
                          <Input {...field} type="number" step="0.01" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <FormField
                    control={form.control}
                    name="taxPercent"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Tax (%)</FormLabel>
                        <FormControl>
                          <Input {...field} type="number" step="0.01" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                {/* Estimate Summary */}
                <div className="bg-gray-50 p-4 rounded-lg space-y-2">
                  <h4 className="font-medium text-gray-900">Estimate Summary</h4>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Parts Subtotal:</span>
                    <span className="font-medium">${totals.partsSubtotal.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">
                      Labor ({totals.totalLaborHours.toFixed(1)} hours @ ${form.getValues("laborRate")}/hr):
                    </span>
                    <span className="font-medium">${totals.laborSubtotal.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Markup ({form.getValues("markupPercent")}%):</span>
                    <span className="font-medium">${totals.markupAmount.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Tax ({form.getValues("taxPercent")}%):</span>
                    <span className="font-medium">${totals.taxAmount.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between pt-2 border-t border-gray-300">
                    <span className="font-semibold text-gray-900">Total:</span>
                    <span className="font-semibold text-gray-900">${totals.totalAmount.toFixed(2)}</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Action Buttons */}
            <div className="flex gap-3 justify-end">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={createEstimateMutation.isPending}
              >
                {createEstimateMutation.isPending 
                  ? (estimateId ? "Updating..." : "Creating...") 
                  : (estimateId ? "Update Estimate" : "Create Estimate")
                }
              </Button>
            </div>
          </form>
        </Form>

        {/* Parts Search Modal */}
        <PartsSearchModal
          open={showPartsModal}
          onOpenChange={setShowPartsModal}
          onSelectPart={addPart}
        />
      </DialogContent>
    </Dialog>
  );
}