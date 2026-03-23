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
    
    // Auto-populate location with customer address
    if (customer.address) {
      form.setValue("projectAddress", customer.address);
    }
    
    // Apply customer's contract rates (without UI - these come from customer profile)
    // Helper to handle null/undefined/empty while preserving 0 values
    const safeParseFloat = (value: string | null | undefined, defaultValue: string): number => {
      if (value === null || value === undefined || value === "") {
        return parseFloat(defaultValue);
      }
      return parseFloat(value);
    };
    
    form.setValue("laborRate", safeParseFloat(customer.laborRate, "45"));
    form.setValue("taxPercent", safeParseFloat(customer.taxPercent, "8.25"));
    
    // Clear validation errors for auto-populated fields
    form.clearErrors("customerName");
    form.clearErrors("customerEmail");
    form.clearErrors("projectAddress");
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
    
    // Helper to preserve 0 values while providing defaults for null/undefined
    const getValue = (value: any, defaultValue: number): number => {
      return (value === null || value === undefined || value === "") ? defaultValue : Number(value);
    };
    
    const laborRate = getValue(form.getValues("laborRate"), 75);
    const markupPercent = getValue(form.getValues("markupPercent"), 20);
    const taxPercent = getValue(form.getValues("taxPercent"), 8.25);
    
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
        <DialogContent className="w-[95vw] max-w-[95vw] sm:max-w-2xl md:max-w-4xl lg:max-w-6xl max-h-[95vh] overflow-y-auto p-2 sm:p-4 md:p-6 overflow-x-hidden">
          <DialogHeader className="pb-4">
            <DialogTitle className="flex items-center gap-2 text-lg sm:text-xl">
              <FileText className="w-5 h-5 sm:w-6 sm:h-6 text-blue-600" />
              Create New Estimate
            </DialogTitle>
            <DialogDescription className="text-sm sm:text-base">
              Create a new estimate by selecting a customer and adding work zones
            </DialogDescription>
          </DialogHeader>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 sm:space-y-6 w-full overflow-hidden">
              {/* Step 1: Customer Selection */}
              <Card className="w-full overflow-hidden">
                <CardHeader className="pb-3 sm:pb-6">
                  <CardTitle className="text-base sm:text-lg flex items-center gap-2">
                    <User className="w-4 h-4 sm:w-5 sm:h-5 text-blue-600" />
                    Step 1: Select Customer
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 sm:space-y-4">
                  <CustomerSelector
                    selectedCustomer={selectedCustomer}
                    onSelectCustomer={handleCustomerSelect}
                    placeholder="Search and select a customer for this estimate..."
                  />
                  
                  {selectedCustomer && (
                    <div className="w-full overflow-hidden">
                      <div className="grid grid-cols-1 gap-3 sm:gap-4">
                        <FormField
                          control={form.control}
                          name="customerName"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-sm">Customer Name</FormLabel>
                              <FormControl>
                                <Input 
                                  {...field} 
                                  readOnly 
                                  className="bg-gray-50 text-sm w-full min-w-0" 
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        
                        <div className="grid grid-cols-1 gap-3 sm:gap-4">
                          <FormField
                            control={form.control}
                            name="customerEmail"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel className="text-sm">Email</FormLabel>
                                <FormControl>
                                  <Input 
                                    {...field} 
                                    readOnly 
                                    className="bg-gray-50 text-sm w-full min-w-0" 
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          
                          <FormField
                            control={form.control}
                            name="customerPhone"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel className="text-sm">Phone</FormLabel>
                                <FormControl>
                                  <Input 
                                    {...field} 
                                    readOnly 
                                    className="bg-gray-50 text-sm w-full min-w-0" 
                                    placeholder="No phone number"
                                    value={field.value || ""} 
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Step 2: Project Information */}
              <Card className="w-full overflow-hidden">
                <CardHeader className="pb-3 sm:pb-6">
                  <CardTitle className="text-base sm:text-lg">Project Information</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 sm:space-y-4 w-full overflow-hidden">
                  <div className="grid grid-cols-1 gap-3 sm:gap-4 w-full">
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
                  </div>
                  
                  <Separator />
                  
                  {/* Location Fields */}
                  <LocationFields control={form.control} readOnlyAddress={!!selectedCustomer} />
                </CardContent>
              </Card>

              {/* Step 3: Work Zones */}
              <Card className="w-full overflow-hidden">
                <CardHeader className="pb-3 sm:pb-6">
                  <CardTitle className="text-base sm:text-lg">Work Zones</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 sm:space-y-4 w-full overflow-hidden">
                  {/* Zones Section */}
                  <div className="w-full overflow-hidden">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
                  <h3 className="text-base sm:text-lg font-medium text-gray-900">Work Zones</h3>
                  <Button
                    type="button"
                    onClick={addZoneSimple}
                    className="bg-primary text-white hover:bg-blue-700 h-10 sm:h-9 w-full sm:w-auto"
                    size="sm"
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    Add Zone
                  </Button>
                </div>

                {zones.length > 0 ? (
                  <div className="w-full space-y-3 sm:space-y-4">
                    {zones.map((zone) => (
                      <Card key={zone.id} className="bg-gray-50 w-full overflow-hidden">
                        <CardHeader className="pb-2 sm:pb-3">
                          <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                            <div className="flex-1 space-y-3 w-full min-w-0 overflow-hidden">
                              <Input
                                placeholder="Zone name"
                                value={zone.zoneName}
                                onChange={(e) => updateZone(zone.id, { zoneName: e.target.value })}
                                className="font-medium text-sm sm:text-base h-10 sm:h-9"
                              />
                              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 w-full">
                                <Select 
                                  value={zone.controllerId} 
                                  onValueChange={(value) => updateZone(zone.id, { controllerId: value })}
                                >
                                  <SelectTrigger className="h-10 sm:h-9 text-sm sm:text-base">
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
                                  className="h-10 sm:h-9 text-sm sm:text-base"
                                />
                                <Button
                                  type="button"
                                  variant="outline"
                                  onClick={() => {
                                    setSelectedZoneId(zone.id);
                                    setShowPartsModal(true);
                                  }}
                                  className="text-blue-600 hover:text-blue-700 w-full h-10 sm:h-9 text-sm sm:text-base"
                                >
                                  <Plus className="w-4 h-4 mr-1" />
                                  Add Parts
                                </Button>
                              </div>
                              <Textarea
                                placeholder="Work description"
                                value={zone.workDescription}
                                onChange={(e) => updateZone(zone.id, { workDescription: e.target.value })}
                                className="min-h-16 text-sm sm:text-base"
                              />
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              onClick={() => removeZone(zone.id)}
                              className="text-red-600 hover:text-red-700 w-10 h-10 sm:w-8 sm:h-8 flex-shrink-0 self-start"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </CardHeader>
                        {zone.items.length > 0 && (
                          <CardContent className="pt-0 w-full overflow-hidden">
                            <div className="w-full space-y-2 sm:space-y-3 overflow-hidden">
                              {zone.items.map((item) => (
                                <div key={item.part.id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between p-3 sm:p-4 bg-gray-50 rounded-lg gap-3 w-full overflow-hidden">
                                  <div className="flex-1 min-w-0">
                                    <p className="font-medium truncate text-sm sm:text-base">{item.part.name}</p>
                                    <p className="text-xs sm:text-sm text-gray-600">{item.totalLaborHours.toFixed(2)}h labor</p>
                                  </div>
                                  <div className="flex items-center gap-2 flex-shrink-0">
                                    <div className="flex items-center gap-2">
                                      <label className="text-xs sm:text-sm font-medium text-gray-600 sm:hidden">Qty:</label>
                                      <Input
                                        type="number"
                                        min="1"
                                        value={item.quantity}
                                        onChange={(e) => updateQuantity(zone.id, item.part.id, parseInt(e.target.value) || 0)}
                                        className="w-16 sm:w-14 text-center text-sm h-9"
                                      />
                                    </div>
                                    <span className="font-medium min-w-[60px] sm:min-w-[70px] text-right text-sm sm:text-base">{formatCurrency(item.totalPrice)}</span>
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      onClick={() => removePart(zone.id, item.part.id)}
                                      className="text-red-600 hover:text-red-700 w-9 h-9 sm:w-8 sm:h-8"
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

              {/* Step 4: Photos and Attachments */}
              <Card className="w-full overflow-hidden">
                <CardHeader className="pb-3 sm:pb-6">
                  <CardTitle className="text-base sm:text-lg flex items-center gap-2">
                    <Image className="w-4 h-4 sm:w-5 sm:h-5 text-blue-600" />
                    Photos & Attachments
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 sm:space-y-6 w-full overflow-hidden">
                  <div className="w-full overflow-hidden">
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
                  
                  <div className="w-full overflow-hidden">
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

              {/* Step 5: Estimate Summary */}
              <Card className="w-full overflow-hidden">
                <CardHeader className="pb-3 sm:pb-6">
                  <CardTitle className="text-base sm:text-lg">Estimate Summary</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 sm:space-y-4 w-full overflow-hidden">
                  <div className="w-full overflow-hidden">
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
              <div className="flex flex-col sm:flex-row gap-3 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  className="w-full sm:w-auto sm:flex-1 h-12 sm:h-10 text-base sm:text-sm order-2 sm:order-1"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={createEstimateMutation.isPending}
                  className="w-full sm:w-auto sm:flex-1 h-12 sm:h-10 text-base sm:text-sm bg-primary text-white hover:bg-blue-700 order-1 sm:order-2"
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
