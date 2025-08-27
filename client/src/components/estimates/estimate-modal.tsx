import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { CustomerSelector } from "@/components/ui/customer-selector";
import { LocationFields } from "@/components/location/location-fields";
import { Plus, Trash2, Search, User, FileText, Image, Paperclip } from "lucide-react";
import { PartsSearchModal } from "./parts-search-modal";
import { EstimateSummary } from "./estimate-summary";
import { FileUpload, type UploadedFile } from "@/components/ui/file-upload";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { Part, Customer } from "@shared/schema";

const estimateFormSchema = z.object({
  customerId: z.number().min(1, "Customer is required"),
  customerName: z.string().min(1, "Customer name is required"),
  customerEmail: z.string().email("Valid email is required"),
  customerPhone: z.string().optional(),
  projectName: z.string().min(1, "Project name is required"),
  projectAddress: z.string().optional(),
  locationNotes: z.string().optional(),
  accessInstructions: z.string().optional(),
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

interface EstimateModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EstimateModal({ open, onOpenChange }: EstimateModalProps) {
  const [zones, setZones] = useState<EstimateZone[]>([]);
  const [showPartsModal, setShowPartsModal] = useState(false);
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [photos, setPhotos] = useState<UploadedFile[]>([]);
  const [attachments, setAttachments] = useState<UploadedFile[]>([]);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const form = useForm<EstimateFormValues>({
    resolver: zodResolver(estimateFormSchema),
    defaultValues: {
      customerId: 0,
      customerName: "",
      customerEmail: "",
      customerPhone: "",
      projectName: "",
      projectAddress: "",
      locationNotes: "",
      accessInstructions: "",
      estimateDate: new Date().toISOString().split('T')[0],
      createdBy: "Irrigation Manager",
      laborRate: 45,
      markupPercent: 20,
      taxPercent: 8.25,
    },
  });

  // Helper function to generate controller options based on customer's total controllers
  const getControllerOptions = (totalControllers: number) => {
    const options = [];
    for (let i = 0; i < totalControllers; i++) {
      const letter = String.fromCharCode(65 + i); // A, B, C, D, etc.
      options.push({ value: letter, label: `Controller ${letter}` });
    }
    return options;
  };

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
    
    // Clear validation errors for auto-populated fields
    form.clearErrors("customerName");
    form.clearErrors("customerEmail");
  };

  const addZone = (controllerId: string, zoneNumber: string, workDescription: string) => {
    const newZone: EstimateZone = {
      id: Date.now().toString(),
      controllerId,
      zoneNumber,
      zoneName: `Controller ${controllerId} Zone ${zoneNumber}`,
      workDescription,
      clockInTime: "",
      items: [],
    };
    setZones([...zones, newZone]);
  };

  const createEstimateMutation = useMutation({
    mutationFn: async (data: { estimate: any; zones: any[] }) => {
      return await apiRequest("/api/estimates", "POST", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/estimates"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      toast({
        title: "Success",
        description: "Estimate created successfully",
      });
      onOpenChange(false);
      form.reset();
      setZones([]);
      setSelectedCustomer(null);
      setPhotos([]);
      setAttachments([]);
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: "Failed to create estimate",
        variant: "destructive",
      });
    },
  });

  const addZoneSimple = () => {
    const newZone: EstimateZone = {
      id: Date.now().toString(),
      controllerId: "A",
      zoneNumber: "1",
      zoneName: `Controller A Zone 1`,
      workDescription: "",
      clockInTime: "",
      items: [],
    };
    setZones([...zones, newZone]);
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
      const updatedItems = [...zone.items];
      updatedItems[existingIndex].quantity += quantity;
      updatedItems[existingIndex].totalPrice = parseFloat(part.price) * updatedItems[existingIndex].quantity;
      updatedItems[existingIndex].totalLaborHours = parseFloat(part.laborHours) * updatedItems[existingIndex].quantity;
      updateZone(selectedZoneId, { items: updatedItems });
    } else {
      const newItem: EstimateItem = {
        part,
        quantity,
        totalPrice: parseFloat(part.price) * quantity,
        totalLaborHours: parseFloat(part.laborHours) * quantity,
      };
      updateZone(selectedZoneId, { items: [...zone.items, newItem] });
    }
  };

  const updateQuantity = (zoneId: string, partId: number, quantity: number) => {
    const zone = zones.find(z => z.id === zoneId);
    if (!zone) return;

    const updatedItems = zone.items.map(item => {
      if (item.part.id === partId) {
        return {
          ...item,
          quantity: Math.max(0, quantity),
          totalPrice: parseFloat(item.part.price) * Math.max(0, quantity),
          totalLaborHours: parseFloat(item.part.laborHours) * Math.max(0, quantity),
        };
      }
      return item;
    }).filter(item => item.quantity > 0);
    
    updateZone(zoneId, { items: updatedItems });
  };

  const removePart = (zoneId: string, partId: number) => {
    const zone = zones.find(z => z.id === zoneId);
    if (!zone) return;
    
    const updatedItems = zone.items.filter(item => item.part.id !== partId);
    updateZone(zoneId, { items: updatedItems });
  };

  const calculateTotals = () => {
    const allItems = zones.flatMap(zone => zone.items);
    const partsSubtotal = allItems.reduce((sum, item) => sum + item.totalPrice, 0);
    const totalLaborHours = allItems.reduce((sum, item) => sum + item.totalLaborHours, 0);
    const laborRate = form.getValues("laborRate") || 75;
    const markupPercent = form.getValues("markupPercent") || 20;
    const taxPercent = form.getValues("taxPercent") || 8.25;
    
    const laborSubtotal = totalLaborHours * laborRate;
    const subtotal = partsSubtotal + laborSubtotal;
    const markupAmount = subtotal * (markupPercent / 100);
    const taxAmount = (subtotal + markupAmount) * (taxPercent / 100);
    const totalAmount = subtotal + markupAmount + taxAmount;

    return {
      partsSubtotal,
      laborSubtotal,
      subtotal,
      markupAmount,
      taxAmount,
      totalAmount,
      totalLaborHours,
    };
  };

  const onSubmit = async (data: EstimateFormValues) => {
    if (!selectedCustomer) {
      toast({
        title: "Customer Required",
        description: "Please select a customer before creating the estimate.",
        variant: "destructive",
      });
      return;
    }

    if (zones.length === 0) {
      toast({
        title: "Error",
        description: "Please add at least one zone to the estimate",
        variant: "destructive",
      });
      return;
    }

    const totals = calculateTotals();
    
    const estimate = {
      customerId: data.customerId,
      customerName: data.customerName,
      customerEmail: data.customerEmail,
      customerPhone: data.customerPhone || "",
      projectName: data.projectName,
      projectAddress: data.projectAddress || "",
      locationNotes: data.locationNotes || "",
      accessInstructions: data.accessInstructions || "",
      status: "pending",
      partsSubtotal: totals.partsSubtotal.toFixed(2),
      laborSubtotal: totals.laborSubtotal.toFixed(2),
      markupAmount: totals.markupAmount.toFixed(2),
      taxAmount: totals.taxAmount.toFixed(2),
      totalAmount: totals.totalAmount.toFixed(2),
      laborRate: data.laborRate.toFixed(2),
      markupPercent: data.markupPercent.toFixed(2),
      taxPercent: data.taxPercent.toFixed(2),
      photos: photos.map(photo => photo.url),
      attachments: attachments.map(attachment => attachment.url),
    };

    const estimateZones = zones.map(zone => ({
      zoneName: zone.zoneName,
      workDescription: zone.workDescription,
      clockInTime: zone.clockInTime,
      items: zone.items.map(item => ({
        partId: item.part.id,
        partName: item.part.name,
        partPrice: item.part.price,
        quantity: item.quantity,
        laborHours: item.totalLaborHours.toFixed(2),
        totalPrice: item.totalPrice.toFixed(2),
      }))
    }));

    createEstimateMutation.mutate({ estimate, zones: estimateZones });
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="w-[95vw] max-w-[95vw] sm:max-w-3xl md:max-w-4xl lg:max-w-6xl max-h-[95vh] overflow-y-auto p-3 sm:p-4 lg:p-6 border-4 border-red-500">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-blue-600" />
              Create New Estimate
            </DialogTitle>
            <DialogDescription>
              Create a new estimate by selecting a customer and adding work zones
            </DialogDescription>
          </DialogHeader>

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
                <CardContent className="space-y-4">
                  <CustomerSelector
                    selectedCustomer={selectedCustomer}
                    onSelectCustomer={handleCustomerSelect}
                    placeholder="Search and select a customer for this estimate..."
                  />
                </CardContent>
              </Card>

              {/* Step 2: Project Information */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Project Information</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                    <FormField
                      control={form.control}
                      name="projectName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Project Name *</FormLabel>
                          <FormControl>
                            <Input 
                              {...field} 
                              placeholder="e.g., Backyard Irrigation System" 
                              className="text-sm w-full min-w-0" 
                            />
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
                            <Input 
                              {...field} 
                              placeholder="123 Oak Street, Springfield, IL" 
                              value={field.value || ""} 
                              className="text-sm w-full min-w-0" 
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  
                  <Separator />
                  
                  {/* Location Fields */}
                  <LocationFields control={form.control} />
                </CardContent>
              </Card>

              {/* Step 3: Contract Terms */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Contract Terms</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
                    <FormField
                      control={form.control}
                      name="laborRate"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Labor Rate ($/hour)</FormLabel>
                          <FormControl>
                            <Input 
                              type="number" 
                              step="0.01" 
                              min="0" 
                              {...field} 
                              readOnly={!!selectedCustomer}
                              className={`text-sm w-full min-w-0 ${selectedCustomer ? "bg-gray-50" : ""}`}
                            />
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
                            <Input 
                              type="number" 
                              step="0.01" 
                              min="0" 
                              {...field} 
                              readOnly={!!selectedCustomer}
                              className={`text-sm w-full min-w-0 ${selectedCustomer ? "bg-gray-50" : ""}`}
                            />
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
                          <FormLabel>Tax Rate (%)</FormLabel>
                          <FormControl>
                            <Input 
                              type="number" 
                              step="0.01" 
                              min="0" 
                              {...field} 
                              readOnly={!!selectedCustomer}
                              className={`text-sm w-full min-w-0 ${selectedCustomer ? "bg-gray-50" : ""}`}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  {selectedCustomer && (
                    <div className="text-sm text-gray-600 bg-blue-50 p-3 rounded-md">
                      <p>These rates are automatically set based on the customer's contract terms.</p>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Step 4: Work Zones */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Work Zones</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 sm:space-y-4">
                  {/* Zones Section */}
                  <div>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-medium text-gray-900">Work Zones</h3>
                  <Button
                    type="button"
                    onClick={addZoneSimple}
                    className="bg-primary text-white hover:bg-blue-700"
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    Add Zone
                  </Button>
                </div>

                {zones.length > 0 ? (
                  <div className="w-full space-y-4">
                    {zones.map((zone) => (
                      <Card key={zone.id} className="bg-gray-50">
                        <CardHeader className="pb-3">
                          <div className="flex items-center justify-between">
                            <div className="flex-1 space-y-2">
                              <Input
                                placeholder="Zone name"
                                value={zone.zoneName}
                                onChange={(e) => updateZone(zone.id, { zoneName: e.target.value })}
                                className="font-medium"
                              />
                              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-3">
                                <Select 
                                  value={zone.controllerId} 
                                  onValueChange={(value) => updateZone(zone.id, { controllerId: value })}
                                >
                                  <SelectTrigger>
                                    <SelectValue placeholder="Controller" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {getControllerOptions(selectedCustomer?.totalControllers || 1).map((option) => (
                                      <SelectItem key={option.value} value={option.value}>
                                        {option.label}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                <Input
                                  placeholder="Zone #"
                                  value={zone.zoneNumber}
                                  onChange={(e) => updateZone(zone.id, { zoneNumber: e.target.value })}
                                />
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() => {
                                    setSelectedZoneId(zone.id);
                                    setShowPartsModal(true);
                                  }}
                                  className="text-blue-600 hover:text-blue-700 w-full sm:w-auto"
                                >
                                  <Plus className="w-4 h-4 mr-1" />
                                  Add Parts
                                </Button>
                              </div>
                              <Textarea
                                placeholder="Work description"
                                value={zone.workDescription}
                                onChange={(e) => updateZone(zone.id, { workDescription: e.target.value })}
                                className="min-h-16"
                              />
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => removeZone(zone.id)}
                              className="text-red-600 hover:text-red-700 ml-2"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </CardHeader>
                        {zone.items.length > 0 && (
                          <CardContent className="pt-0">
                            <div className="w-full space-y-3">
                              {zone.items.map((item) => (
                                <div key={item.part.id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between p-3 bg-gray-50 rounded-lg gap-3">
                                  <div className="flex-1 min-w-0">
                                    <p className="font-medium truncate">{item.part.name}</p>
                                    <p className="text-sm text-gray-600">{item.totalLaborHours.toFixed(2)}h labor</p>
                                  </div>
                                  <div className="flex items-center gap-2 flex-shrink-0">
                                    <div className="flex items-center gap-2">
                                      <label className="text-sm font-medium text-gray-600 sm:hidden">Qty:</label>
                                      <Input
                                        type="number"
                                        min="1"
                                        value={item.quantity}
                                        onChange={(e) => updateQuantity(zone.id, item.part.id, parseInt(e.target.value) || 0)}
                                        className="w-16 text-center"
                                      />
                                    </div>
                                    <span className="font-medium min-w-[60px] text-right">{formatCurrency(item.totalPrice)}</span>
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => removePart(zone.id, item.part.id)}
                                      className="text-red-600 hover:text-red-700"
                                    >
                                      <Trash2 className="w-4 h-4" />
                                    </Button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </CardContent>
                        )}
                      </Card>
                    ))}
                  </div>
                ) : (
                  <div className="bg-gray-50 rounded-lg p-8 text-center">
                    <p className="text-gray-500">No zones added yet. Click "Add Zone" to get started.</p>
                  </div>
                )}
                  </div>
                </CardContent>
              </Card>

              {/* Step 5: Photos and Attachments */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Image className="w-5 h-5 text-blue-600" />
                    Photos & Attachments
                  </CardTitle>
                </CardHeader>
                <CardContent className="w-[98%] mx-auto space-y-4 sm:space-y-6">
                  <div>
                    <h4 className="font-medium text-gray-900 mb-3 flex items-center gap-2">
                      <Image className="w-4 h-4" />
                      Site Photos
                    </h4>
                    <div className="text-sm text-gray-600 mb-2">Add Photos</div>
                    <div className="text-xs text-gray-500 mb-3">Accepted: JPG, PNG, GIF</div>
                    <FileUpload
                      type="photo"
                      label="Photos"
                      accept="image/*"
                      multiple={true}
                      files={photos}
                      onFilesChange={setPhotos}
                    />
                  </div>
                  
                  <div>
                    <h4 className="font-medium text-gray-900 mb-3 flex items-center gap-2">
                      <Paperclip className="w-4 h-4" />
                      Landscape Plans & Documents
                    </h4>
                    <div className="text-sm text-gray-600 mb-2">Add Attachments</div>
                    <div className="text-xs text-gray-500 mb-3">Landscape plans, documents, etc.</div>
                    <FileUpload
                      type="attachment"
                      label="Attachments"
                      accept="*/*"
                      multiple={true}
                      files={attachments}
                      onFilesChange={setAttachments}
                    />
                  </div>
                </CardContent>
              </Card>

              {/* Step 6: Estimate Summary */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Estimate Summary</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="w-[98%] mx-auto">
                    <EstimateSummary
                      items={zones.flatMap(zone => zone.items)}
                      laborRate={form.watch("laborRate")}
                      markupPercent={form.watch("markupPercent")}
                      taxPercent={form.watch("taxPercent")}
                    />
                  </div>
                </CardContent>
              </Card>

              {/* Action Buttons */}
              <Separator />
              <div className="flex flex-col-reverse sm:flex-row gap-3 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  className="w-full sm:flex-1"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={createEstimateMutation.isPending}
                  className="w-full sm:flex-1 bg-primary text-white hover:bg-blue-700"
                >
                  {createEstimateMutation.isPending ? "Creating..." : "Create Estimate"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <PartsSearchModal
        open={showPartsModal}
        onOpenChange={setShowPartsModal}
        onSelectPart={addPart}
      />
    </>
  );
}
