import { useState, useEffect } from "react";
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
import { Plus, Trash2, Search, User, FileText, Image, Paperclip, Edit2 } from "lucide-react";
import { PartsSearchModal } from "./parts-search-modal";
import { EstimateSummary } from "./estimate-summary";
import { FileUpload, type UploadedFile } from "@/components/ui/file-upload";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { Part, Customer, EstimateWithZones } from "@shared/schema";

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
  controllerId: string;
  zoneNumber: string;
  zoneName: string;
  workDescription: string;
  clockInTime: string;
  items: EstimateItem[];
}

interface EditEstimateModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  estimateId: number | null;
}

export function EditEstimateModal({ open, onOpenChange, estimateId }: EditEstimateModalProps) {
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
      estimateDate: new Date().toISOString().split('T')[0],
      createdBy: "Irrigation Manager",
      laborRate: 80,
      markupPercent: 35,
      taxPercent: 8.25,
    }
  });

  // Fetch estimate data when modal opens
  const { data: estimate, isLoading: isLoadingEstimate } = useQuery<EstimateWithZones>({
    queryKey: ["/api/estimates", estimateId],
    enabled: open && estimateId !== null,
  });

  const { data: customers } = useQuery<Customer[]>({
    queryKey: ["/api/customers"],
    enabled: open,
  });

  // Update form when estimate data is loaded
  useEffect(() => {
    if (estimate) {
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
      if (customers) {
        const customer = customers.find(c => c.id === estimate.customerId);
        setSelectedCustomer(customer || null);
      }
    }
  }, [estimate, customers, form]);

  const updateEstimateMutation = useMutation({
    mutationFn: async (data: { estimate: EstimateFormValues; zones: EstimateZone[] }) => {
      return apiRequest(`/api/estimates/${estimateId}`, {
        method: "PUT",
        body: JSON.stringify({
          estimate: {
            ...data.estimate,
            photos: photos.map(p => p.url),
            attachments: attachments.map(a => a.url)
          },
          zones: data.zones
        })
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/estimates"] });
      queryClient.invalidateQueries({ queryKey: ["/api/estimates", estimateId] });
      toast({
        title: "Success",
        description: "Estimate updated successfully",
      });
      onOpenChange(false);
      resetForm();
    },
    onError: (error) => {
      console.error("Error updating estimate:", error);
      toast({
        title: "Error",
        description: "Failed to update estimate. Please try again.",
        variant: "destructive",
      });
    }
  });

  const resetForm = () => {
    form.reset();
    setZones([]);
    setSelectedCustomer(null);
    setPhotos([]);
    setAttachments([]);
    setShowPartsModal(false);
    setSelectedZoneId(null);
  };

  const addZone = () => {
    const newZone: EstimateZone = {
      id: `zone-${Date.now()}`,
      controllerId: "A",
      zoneNumber: "1",
      zoneName: "Controller A Zone 1",
      workDescription: "",
      clockInTime: "",
      items: []
    };
    setZones([...zones, newZone]);
  };

  const removeZone = (zoneId: string) => {
    setZones(zones.filter(zone => zone.id !== zoneId));
  };

  const updateZone = (zoneId: string, updates: Partial<EstimateZone>) => {
    setZones(zones.map(zone => 
      zone.id === zoneId 
        ? { ...zone, ...updates, zoneName: `Controller ${updates.controllerId || zone.controllerId} Zone ${updates.zoneNumber || zone.zoneNumber}` }
        : zone
    ));
  };

  const addPartsToZone = (zoneId: string, selectedParts: Array<{ part: Part; quantity: number }>) => {
    setZones(zones.map(zone => {
      if (zone.id !== zoneId) return zone;

      const newItems: EstimateItem[] = selectedParts.map(({ part, quantity }) => ({
        part,
        quantity,
        totalPrice: parseFloat(part.price) * quantity,
        totalLaborHours: parseFloat(part.laborHours) * quantity
      }));

      return {
        ...zone,
        items: [...zone.items, ...newItems]
      };
    }));
  };

  const removeItemFromZone = (zoneId: string, itemIndex: number) => {
    setZones(zones.map(zone => 
      zone.id === zoneId 
        ? { ...zone, items: zone.items.filter((_, index) => index !== itemIndex) }
        : zone
    ));
  };

  const updateItemQuantity = (zoneId: string, itemIndex: number, quantity: number) => {
    setZones(zones.map(zone => {
      if (zone.id !== zoneId) return zone;
      
      return {
        ...zone,
        items: zone.items.map((item, index) => {
          if (index !== itemIndex) return item;
          return {
            ...item,
            quantity,
            totalPrice: parseFloat(item.part.price) * quantity,
            totalLaborHours: parseFloat(item.part.laborHours) * quantity
          };
        })
      };
    }));
  };

  const onSubmit = (data: EstimateFormValues) => {
    if (zones.length === 0) {
      toast({
        title: "Error",
        description: "Please add at least one zone to the estimate.",
        variant: "destructive",
      });
      return;
    }

    updateEstimateMutation.mutate({ estimate: data, zones });
  };

  const handleCustomerSelect = (customer: Customer) => {
    setSelectedCustomer(customer);
    form.setValue("customerId", customer.id);
    form.setValue("customerName", customer.name);
    form.setValue("customerEmail", customer.email);
    form.setValue("customerPhone", customer.phone || "");
  };

  if (!open) return null;

  if (isLoadingEstimate) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-6xl h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Loading estimate...</DialogTitle>
          </DialogHeader>
          <div className="flex items-center justify-center h-40">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-6xl h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Edit2 className="w-5 h-5" />
              Edit Estimate
            </DialogTitle>
            <DialogDescription>
              Modify the estimate details and zones before converting to work order.
            </DialogDescription>
          </DialogHeader>
          
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              {/* Customer Information */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <User className="w-5 h-5" />
                    Customer Information
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <CustomerSelector
                    selectedCustomer={selectedCustomer}
                    onSelect={handleCustomerSelect}
                  />
                  
                  {selectedCustomer && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="customerEmail"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Email</FormLabel>
                            <FormControl>
                              <Input {...field} />
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
                            <FormLabel>Phone</FormLabel>
                            <FormControl>
                              <Input {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Project Information */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <FileText className="w-5 h-5" />
                    Project Information
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="projectName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Project Name</FormLabel>
                          <FormControl>
                            <Input {...field} placeholder="e.g., Sprinkler System Installation" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="estimateDate"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Estimate Date</FormLabel>
                          <FormControl>
                            <Input type="date" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  
                  <FormField
                    control={form.control}
                    name="projectAddress"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Project Address</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="Property address (if different from customer)" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <FormField
                      control={form.control}
                      name="laborRate"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Labor Rate ($/hour)</FormLabel>
                          <FormControl>
                            <Input type="number" step="0.01" {...field} />
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
                            <Input type="number" step="0.01" {...field} />
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
                            <Input type="number" step="0.01" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </CardContent>
              </Card>

              {/* Zones */}
              <Card>
                <CardHeader>
                  <CardTitle>Project Zones</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {zones.map((zone, zoneIndex) => (
                    <Card key={zone.id} className="border-l-4 border-l-primary">
                      <CardHeader>
                        <CardTitle className="text-lg flex items-center justify-between">
                          <span>{zone.zoneName}</span>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => removeZone(zone.id)}
                            className="text-red-600 hover:text-red-700"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          <div>
                            <label className="block text-sm font-medium mb-1">Controller</label>
                            <Select
                              value={zone.controllerId}
                              onValueChange={(value) => updateZone(zone.id, { controllerId: value })}
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {["A", "B", "C", "D"].map((controller) => (
                                  <SelectItem key={controller} value={controller}>
                                    Controller {controller}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            <label className="block text-sm font-medium mb-1">Zone Number</label>
                            <Input
                              value={zone.zoneNumber}
                              onChange={(e) => updateZone(zone.id, { zoneNumber: e.target.value })}
                              placeholder="e.g., 1, 2, 3..."
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium mb-1">Work Description</label>
                            <Input
                              value={zone.workDescription}
                              onChange={(e) => updateZone(zone.id, { workDescription: e.target.value })}
                              placeholder="e.g., Install, Replace, Repair"
                            />
                          </div>
                        </div>

                        {/* Zone Items */}
                        <div className="space-y-2">
                          <div className="flex justify-between items-center">
                            <h4 className="font-medium">Parts & Materials</h4>
                            <Button
                              type="button"
                              variant="outline"
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

                          {zone.items.length > 0 ? (
                            <div className="space-y-2">
                              {zone.items.map((item, itemIndex) => (
                                <div key={itemIndex} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                                  <div className="flex-1">
                                    <p className="font-medium">{item.part.name}</p>
                                    <p className="text-sm text-gray-600">
                                      ${item.part.price} × {item.quantity} = ${item.totalPrice.toFixed(2)}
                                    </p>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <Input
                                      type="number"
                                      min="1"
                                      value={item.quantity}
                                      onChange={(e) => updateItemQuantity(zone.id, itemIndex, parseInt(e.target.value) || 1)}
                                      className="w-20"
                                    />
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      onClick={() => removeItemFromZone(zone.id, itemIndex)}
                                      className="text-red-600 hover:text-red-700"
                                    >
                                      <Trash2 className="w-4 h-4" />
                                    </Button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-gray-500 text-center py-4">No parts added to this zone yet.</p>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  ))}

                  <Button
                    type="button"
                    variant="outline"
                    onClick={addZone}
                    className="w-full"
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    Add Zone
                  </Button>
                </CardContent>
              </Card>

              {/* Estimate Summary */}
              {zones.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle>Estimate Summary</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-gray-600">Summary will be calculated when estimate is saved.</p>
                  </CardContent>
                </Card>
              )}

              {/* File Attachments */}
              <Card>
                <CardHeader>
                  <CardTitle>Attachments</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-2">Photos</label>
                    <div className="border-2 border-dashed border-gray-300 rounded-lg p-4 text-center">
                      <p className="text-sm text-gray-500">Photo upload will be implemented</p>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-2">Documents</label>
                    <div className="border-2 border-dashed border-gray-300 rounded-lg p-4 text-center">
                      <p className="text-sm text-gray-500">Document upload will be implemented</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Separator />

              <div className="flex justify-end space-x-2">
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={updateEstimateMutation.isPending}>
                  {updateEstimateMutation.isPending ? "Updating..." : "Update Estimate"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <PartsSearchModal
        open={showPartsModal}
        onOpenChange={setShowPartsModal}
        onSelectPart={(part, quantity) => {
          if (selectedZoneId) {
            addPartsToZone(selectedZoneId, [{ part, quantity }]);
          }
          setShowPartsModal(false);
        }}
      />
    </>
  );
}