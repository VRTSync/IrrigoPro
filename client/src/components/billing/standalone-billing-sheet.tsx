import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { 
  Plus, 
  Trash2, 
  Calculator, 
  Save, 
  FileText, 
  Timer,
  Package,
  User,
  MapPin,
  Calendar,
  Clock,
  Camera,
  ArrowLeft,
  Check,
  Minus
} from "lucide-react";
import { CustomerSelector } from "@/components/ui/customer-selector";
import { PartsSearchModal } from "@/components/estimates/parts-search-modal";
import { FileUpload, type UploadedFile } from "@/components/ui/file-upload";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { Customer, Part } from "@shared/schema";

const billingItemSchema = z.object({
  partId: z.number().optional(),
  partName: z.string().min(1, "Part name is required"),
  partDescription: z.string().optional(),
  quantity: z.coerce.number().min(0.01, "Quantity must be greater than 0"),
  unitPrice: z.coerce.number().min(0, "Unit price must be 0 or greater"),
  laborHours: z.coerce.number().min(0, "Labor hours must be 0 or greater"),
  notes: z.string().optional(),
});

const billingSheetSchema = z.object({
  customerId: z.number().min(1, "Customer is required"),
  customerName: z.string().min(1, "Customer name is required"),
  propertyAddress: z.string().optional(),
  workDate: z.string().min(1, "Work date is required"),
  technicianName: z.string().min(1, "Technician name is required"),
  workDescription: z.string().min(1, "Work description is required"),
  totalHours: z.coerce.number().min(0.01, "Total hours must be greater than 0"),
  laborRate: z.coerce.number().min(0, "Labor rate must be positive"),
  notes: z.string().optional(),
  items: z.array(billingItemSchema).optional().default([]),
});

type BillingSheetData = z.infer<typeof billingSheetSchema>;
type BillingItem = z.infer<typeof billingItemSchema>;

interface StandaloneBillingSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draftData?: any; // Draft data to load for editing
  prefillFromWorkOrder?: {
    customerId?: number;
    customerName?: string;
    customerEmail?: string;
    customerPhone?: string;
    projectAddress?: string;
    projectName?: string;
    workOrderNumber?: string;
  };
}

export function StandaloneBillingSheet({ open, onOpenChange, draftData, prefillFromWorkOrder }: StandaloneBillingSheetProps) {
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [showPartsModal, setShowPartsModal] = useState(false);
  const [photos, setPhotos] = useState<UploadedFile[]>([]);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Get current user role and info
  const getCurrentUser = () => {
    const savedUser = localStorage.getItem("user");
    return savedUser ? JSON.parse(savedUser) : null;
  };
  const currentUser = getCurrentUser();
  const isFieldTech = currentUser?.role === 'field_tech';

  const form = useForm<BillingSheetData>({
    resolver: zodResolver(billingSheetSchema),
    defaultValues: {
      customerId: prefillFromWorkOrder?.customerId || 0,
      customerName: prefillFromWorkOrder?.customerName || "",
      propertyAddress: prefillFromWorkOrder?.projectAddress || "",
      workDate: new Date().toISOString().split('T')[0],
      technicianName: isFieldTech ? currentUser?.name || "" : "",
      workDescription: prefillFromWorkOrder?.projectName ? `Work Order: ${prefillFromWorkOrder.workOrderNumber} - ${prefillFromWorkOrder.projectName}` : "",
      totalHours: 0,
      laborRate: 45,
      notes: "",
      items: [],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "items",
  });

  // Load draft data when editing
  useEffect(() => {
    if (draftData) {
      form.setValue("customerId", draftData.customerId);
      form.setValue("customerName", draftData.customerName);
      form.setValue("propertyAddress", draftData.propertyAddress);
      form.setValue("workDate", draftData.workDate);
      form.setValue("technicianName", draftData.technicianName);
      form.setValue("workDescription", draftData.workDescription);
      form.setValue("totalHours", draftData.totalHours);
      form.setValue("laborRate", draftData.laborRate);
      form.setValue("notes", draftData.notes || "");
      
      // Clear existing items and add draft items
      fields.forEach((_, index) => remove(index));
      
      // Add draft items
      if (draftData.items && draftData.items.length > 0) {
        draftData.items.forEach((item: any) => {
          append({
            partId: item.partId,
            partName: item.partName,
            partDescription: item.partDescription || "",
            quantity: item.quantity,
            unitPrice: isFieldTech ? 0 : item.unitPrice,
            laborHours: isFieldTech ? 0 : item.laborHours,
            notes: item.notes || "",
          });
        });
      }
    }
  }, [draftData, form, append, remove, fields, isFieldTech]);

  const handleCustomerSelect = (customer: Customer) => {
    setSelectedCustomer(customer);
    form.setValue("customerId", customer.id);
    form.setValue("customerName", customer.name);
    form.setValue("propertyAddress", customer.address || "");
    form.setValue("laborRate", parseFloat(customer.laborRate || "45"));
  };

  const addPart = (part: Part, quantity: number = 1) => {
    const newItem: BillingItem = {
      partId: part.id,
      partName: part.name,
      partDescription: part.description || "",
      quantity,
      unitPrice: isFieldTech ? 0 : parseFloat(part.price),
      laborHours: isFieldTech ? 0 : parseFloat(part.laborHours),
      notes: "",
    };
    
    append(newItem);
    setShowPartsModal(false);
  };

  const addManualItem = () => {
    const newItem: BillingItem = {
      partName: "",
      partDescription: "",
      quantity: 1,
      unitPrice: 0,
      laborHours: 0,
      notes: "",
    };
    
    append(newItem);
  };

  const calculateTotals = () => {
    const items = form.watch("items");
    const laborRate = isFieldTech ? 0 : form.watch("laborRate");
    const totalHours = isFieldTech ? 0 : form.watch("totalHours");
    
    const partsSubtotal = isFieldTech ? 0 : items.reduce((sum, item) => 
      sum + (item.quantity * (item.unitPrice || 0)), 0
    );
    
    const laborSubtotal = totalHours * laborRate;
    const subtotal = partsSubtotal + laborSubtotal;
    
    // Use customer's contract rates if available
    const markupPercent = selectedCustomer?.markupPercent ? parseFloat(selectedCustomer.markupPercent) : 20;
    const taxPercent = selectedCustomer?.taxPercent ? parseFloat(selectedCustomer.taxPercent) : 8.25;
    
    const markupAmount = isFieldTech ? 0 : subtotal * (markupPercent / 100);
    const taxAmount = isFieldTech ? 0 : (subtotal + markupAmount) * (taxPercent / 100);
    const totalAmount = isFieldTech ? 0 : subtotal + markupAmount + taxAmount;

    return {
      partsSubtotal,
      laborSubtotal,
      markupAmount,
      taxAmount,
      totalAmount,
    };
  };

  const totals = calculateTotals();

  const createBillingSheetMutation = useMutation({
    mutationFn: async (data: BillingSheetData) => {
      const billingSheetData = {
        ...data,
        ...totals,
        photos: photos.map(p => p.url),
        // Include technicianId for proper filtering
        technicianId: currentUser?.id || null,
      };
      return await apiRequest("/api/billing-sheets", "POST", billingSheetData);
    },
    onSuccess: () => {
      // Invalidate both general and technician-specific billing sheet queries
      queryClient.invalidateQueries({ queryKey: ["/api/billing-sheets"] });
      if (currentUser?.id) {
        queryClient.invalidateQueries({ queryKey: ["/api/billing-sheets", "technician", currentUser.id] });
      }
      toast({
        title: "Success",
        description: draftData ? "Draft billing sheet updated successfully" : "Billing sheet created successfully",
      });
      onOpenChange(false);
      setShowReview(false);
      resetForm();
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: "Failed to create billing sheet",
        variant: "destructive",
      });
    },
  });

  const resetForm = () => {
    form.reset({
      customerId: prefillFromWorkOrder?.customerId || draftData?.customerId || 0,
      customerName: prefillFromWorkOrder?.customerName || draftData?.customerName || "",
      propertyAddress: prefillFromWorkOrder?.projectAddress || draftData?.propertyAddress || "",
      workDate: draftData?.workDate || new Date().toISOString().split('T')[0],
      technicianName: isFieldTech ? currentUser?.name || "" : "",
      workDescription: prefillFromWorkOrder?.projectName ? `Work Order: ${prefillFromWorkOrder.workOrderNumber} - ${prefillFromWorkOrder.projectName}` : draftData?.workDescription || "",
      totalHours: isFieldTech ? 0 : draftData?.totalHours || 0,
      laborRate: isFieldTech ? 0 : draftData?.laborRate || 45,
      notes: draftData?.notes || "",
      items: [],
    });
    
    // Set selected customer if prefilled
    if (prefillFromWorkOrder?.customerId) {
      // Fetch customer data to set selected customer
      // This would ideally be done with a proper query, but for now we'll just create a basic customer object
      setSelectedCustomer({
        id: prefillFromWorkOrder.customerId,
        name: prefillFromWorkOrder.customerName || "",
        email: prefillFromWorkOrder.customerEmail || "",
        phone: prefillFromWorkOrder.customerPhone || "",
        companyId: currentUser?.companyId || 1,
        address: null,
        notes: null,
        laborRate: null,
        markupPercent: null,
        taxPercent: null,
        totalControllers: null,
        propertyNotes: null,
      } as Customer);
    } else {
      setSelectedCustomer(null);
    }
    
    setPhotos([]);
  };

  // Initialize with prefilled data when modal opens
  useEffect(() => {
    if (open && prefillFromWorkOrder?.customerId) {
      setSelectedCustomer({
        id: prefillFromWorkOrder.customerId,
        name: prefillFromWorkOrder.customerName || "",
        email: prefillFromWorkOrder.customerEmail || "",
        phone: prefillFromWorkOrder.customerPhone || "",
        companyId: currentUser?.companyId || 1,
        address: null,
        notes: null,
        laborRate: null,
        markupPercent: null,
        taxPercent: null,
        totalControllers: null,
        propertyNotes: null,
      } as Customer);
    }
  }, [open, prefillFromWorkOrder, currentUser?.companyId]);

  const [showReview, setShowReview] = useState(false);
  
  const onSubmit = async (data: BillingSheetData) => {
    console.log('Form submission triggered');
    console.log('Current showReview state:', showReview);
    console.log('Form data:', data);
    console.log('Form errors:', form.formState.errors);
    
    if (!showReview) {
      // First step: show review
      console.log('Moving to review step');
      setShowReview(true);
      return;
    }
    
    // Second step: actually submit
    console.log('Submitting to API');
    try {
      await createBillingSheetMutation.mutateAsync(data);
      console.log('Submission successful');
    } catch (error) {
      console.error('Error submitting billing sheet:', error);
      // Keep on review screen to allow retry
    }
  };

  const handleBack = () => {
    setShowReview(false);
  };

  // Save as draft mutation
  const saveDraftMutation = useMutation({
    mutationFn: async (data: BillingSheetData) => {
      const draftData = {
        ...data,
        ...totals,
        photos: photos.map(p => p.url),
        technicianId: currentUser?.id || null,
        status: 'draft'
      };
      return await apiRequest("/api/billing-sheets", "POST", draftData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/billing-sheets"] });
      if (currentUser?.id) {
        queryClient.invalidateQueries({ queryKey: ["/api/billing-sheets", "technician", currentUser.id] });
      }
      toast({
        title: "Draft Saved",
        description: "Billing sheet saved as draft successfully",
      });
      onOpenChange(false);
      setShowReview(false);
      resetForm();
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to save draft",
        variant: "destructive",
      });
    },
  });

  // Check if form has data worth saving
  const hasFormData = () => {
    const formData = form.getValues();
    return formData.customerId > 0 || 
           formData.workDescription.trim().length > 0 || 
           formData.items.length > 0 ||
           formData.notes?.trim().length > 0;
  };

  // Handle cancel button click
  const handleCancel = () => {
    if (hasFormData()) {
      setShowCancelDialog(true);
    } else {
      handleOpenChange(false);
    }
  };

  // Save as draft and close
  const handleSaveAsDraft = async () => {
    try {
      const formData = form.getValues();
      await saveDraftMutation.mutateAsync(formData);
      setShowCancelDialog(false);
    } catch (error) {
      // Error handled by mutation
    }
  };

  // Discard and close
  const handleDiscard = () => {
    setShowCancelDialog(false);
    handleOpenChange(false);
  };

  // Reset review state when modal closes
  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      setShowReview(false);
      resetForm();
      setSelectedCustomer(null);
      setPhotos([]);
    }
    onOpenChange(newOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent 
        className="w-[95vw] max-w-4xl h-[95vh] max-h-[95vh] overflow-hidden p-0 flex flex-col"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader className="p-4 sm:p-6 border-b border-gray-200 flex-shrink-0">
          <DialogTitle className="flex items-center gap-3 text-lg sm:text-xl">
            <div className="bg-orange-50 p-2 rounded-lg">
              <FileText className="w-5 h-5 text-orange-600" />
            </div>
            <div>
              <span className="text-xl font-semibold">
                {showReview ? 'Review Billing Sheet' : 'Create Billing Sheet'}
              </span>
              <p className="text-sm text-gray-600 font-normal mt-1">
                {showReview 
                  ? 'Review your details before submitting'
                  : 'Document standalone work and materials'
                }
              </p>
            </div>
          </DialogTitle>
          <DialogDescription>
            {showReview
              ? 'Please review all information before final submission'
              : 'Create a billing sheet for work performed without a work order'
            }
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6">

          <Form {...form}>
            <form id="billing-form" onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 sm:space-y-6">
            {showReview ? (
              // Review Screen
              <div className="space-y-4 sm:space-y-6">
                {/* Customer & Location Review */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base sm:text-lg flex items-center gap-2">
                      <User className="w-4 h-4 sm:w-5 sm:h-5 text-blue-600" />
                      Customer & Location
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div>
                      <p className="text-sm font-medium text-gray-600">Customer</p>
                      <p className="text-gray-900">{form.watch('customerName')}</p>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-600">Property Address</p>
                      <p className="text-gray-900">{form.watch('propertyAddress') || 'No address specified'}</p>
                    </div>
                  </CardContent>
                </Card>

                {/* Work Details Review */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base sm:text-lg flex items-center gap-2">
                      <Calendar className="w-4 h-4 sm:w-5 sm:h-5 text-blue-600" />
                      Work Details
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div>
                      <p className="text-sm font-medium text-gray-600">Work Date</p>
                      <p className="text-gray-900">{new Date(form.watch('workDate')).toLocaleDateString()}</p>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-600">Technician</p>
                      <p className="text-gray-900">{form.watch('technicianName')}</p>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-600">Work Description</p>
                      <p className="text-gray-900">{form.watch('workDescription') || 'No description provided'}</p>
                    </div>
                  </CardContent>
                </Card>

                {/* Parts & Materials Review */}
                {form.watch('items').length > 0 && (
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base sm:text-lg flex items-center gap-2">
                        <Package className="w-4 h-4 sm:w-5 sm:h-5 text-blue-600" />
                        Parts & Materials ({form.watch('items').length} items)
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        {form.watch('items').map((item, index) => (
                          <div key={index} className="bg-gray-50 p-3 rounded-lg">
                            <div className="flex justify-between items-start">
                              <div>
                                <p className="font-medium text-gray-900">{item.partName}</p>
                                {item.partDescription && (
                                  <p className="text-sm text-gray-600 mt-1">{item.partDescription}</p>
                                )}
                              </div>
                              <p className="text-sm text-gray-600">Qty: {item.quantity}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Photos Review */}
                {photos.length > 0 && (
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base sm:text-lg flex items-center gap-2">
                        <Camera className="w-4 h-4 sm:w-5 sm:h-5 text-blue-600" />
                        Photos ({photos.length})
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                        {photos.map((photo, index) => (
                          <div key={index} className="aspect-square bg-gray-100 rounded-lg overflow-hidden">
                            <img 
                              src={typeof photo === 'string' ? photo : (photo as any).url || URL.createObjectURL(new File([photo], 'photo'))} 
                              alt={`Photo ${index + 1}`}
                              className="w-full h-full object-cover"
                            />
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Notes Review */}
                {form.watch('notes') && (
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base sm:text-lg">Additional Notes</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-gray-900">{form.watch('notes')}</p>
                    </CardContent>
                  </Card>
                )}
              </div>
            ) : (
              // Form Screen
              <>
            {/* Customer & Location */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base sm:text-lg flex items-center gap-2">
                  <User className="w-4 h-4 sm:w-5 sm:h-5 text-blue-600" />
                  Customer & Location
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 sm:space-y-4">
                <CustomerSelector 
                  onSelectCustomer={handleCustomerSelect}
                  selectedCustomer={selectedCustomer}
                />
                
                {selectedCustomer && (
                  <FormField
                    control={form.control}
                    name="propertyAddress"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Property Address</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="Work location address" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
              </CardContent>
            </Card>

            {/* Work Details */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base sm:text-lg flex items-center gap-2">
                  <FileText className="w-4 h-4 sm:w-5 sm:h-5 text-blue-600" />
                  Work Details
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 sm:space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="workDate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Work Date</FormLabel>
                        <FormControl>
                          <Input {...field} type="date" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <FormField
                    control={form.control}
                    name="technicianName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Technician Name</FormLabel>
                        <FormControl>
                          <Input 
                            {...field} 
                            placeholder="Who performed the work"
                            disabled={isFieldTech}
                            className={isFieldTech ? "bg-gray-50" : ""}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="workDescription"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Work Description</FormLabel>
                      <FormControl>
                        <Textarea {...field} placeholder="Describe the work performed" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Hide labor rate for field techs */}
                {!isFieldTech && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Parts & Materials */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base sm:text-lg flex items-center gap-2">
                  <Package className="w-4 h-4 sm:w-5 sm:h-5 text-blue-600" />
                  Parts & Materials Used
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 sm:space-y-4">
                <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
                  <Button
                    type="button"
                    onClick={() => setShowPartsModal(true)}
                    variant="outline"
                    className="w-full sm:w-auto"
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    Add from Catalog
                  </Button>
                  <Button
                    type="button"
                    onClick={addManualItem}
                    variant="outline"
                    className="w-full sm:w-auto"
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    Add Manual Item
                  </Button>
                </div>

                {fields.length === 0 ? (
                  <p className="text-gray-500 text-center py-4">No items added yet</p>
                ) : (
                  <div className="space-y-3 sm:space-y-4">
                    {fields.map((field, index) => (
                      <Card key={field.id} className="border-l-4 border-l-blue-500">
                        <CardContent className="pt-3 sm:pt-4">
                          <div className={`grid gap-2 sm:gap-4 items-end ${isFieldTech ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-5 sm:grid-cols-6'}`}>
                            <div className={`${isFieldTech ? 'col-span-1 sm:col-span-2' : 'col-span-2 sm:col-span-2'}`}>
                              <FormField
                                control={form.control}
                                name={`items.${index}.partName`}
                                render={({ field }) => (
                                  <FormItem>
                                    <FormLabel className="text-xs sm:text-sm">Item Name</FormLabel>
                                    <FormControl>
                                      <Input 
                                        {...field} 
                                        placeholder="Part/Material name" 
                                        className="text-sm" 
                                        readOnly={!!form.watch(`items.${index}.partId`)}
                                        disabled={!!form.watch(`items.${index}.partId`)}
                                      />
                                    </FormControl>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />
                            </div>
                            
                            <div className="col-span-1 sm:col-span-1">
                              <FormField
                                control={form.control}
                                name={`items.${index}.quantity`}
                                render={({ field }) => (
                                  <FormItem>
                                    <FormLabel className="text-xs sm:text-sm">Qty</FormLabel>
                                    <FormControl>
                                      <div className="flex items-center gap-1">
                                        <Button
                                          type="button"
                                          variant="outline"
                                          size="sm"
                                          className="h-8 w-8 p-0"
                                          onClick={() => {
                                            const currentValue = parseFloat(field.value) || 0;
                                            if (currentValue > 0) {
                                              field.onChange(Math.max(0, currentValue - 1));
                                            }
                                          }}
                                        >
                                          -
                                        </Button>
                                        <Input 
                                          {...field} 
                                          type="number" 
                                          step="0.01" 
                                          min="0"
                                          className="text-sm text-center h-8 w-16" 
                                        />
                                        <Button
                                          type="button"
                                          variant="outline"
                                          size="sm"
                                          className="h-8 w-8 p-0"
                                          onClick={() => {
                                            const currentValue = parseFloat(field.value) || 0;
                                            field.onChange(currentValue + 1);
                                          }}
                                        >
                                          +
                                        </Button>
                                      </div>
                                    </FormControl>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />
                            </div>
                            
                            {/* Hide pricing for field techs */}
                            {!isFieldTech && (
                              <>
                                <div className="col-span-1 sm:col-span-1">
                                  <FormField
                                    control={form.control}
                                    name={`items.${index}.unitPrice`}
                                    render={({ field }) => (
                                      <FormItem>
                                        <FormLabel className="text-xs sm:text-sm">Price</FormLabel>
                                        <FormControl>
                                          <Input {...field} type="number" step="0.01" className="text-sm" />
                                        </FormControl>
                                        <FormMessage />
                                      </FormItem>
                                    )}
                                  />
                                </div>
                                
                                <div className="col-span-1 sm:col-span-1">
                                  <FormField
                                    control={form.control}
                                    name={`items.${index}.laborHours`}
                                    render={({ field }) => (
                                      <FormItem>
                                        <FormLabel className="text-xs sm:text-sm">Hours</FormLabel>
                                        <FormControl>
                                          <Input {...field} type="number" step="0.25" className="text-sm" />
                                        </FormControl>
                                        <FormMessage />
                                      </FormItem>
                                    )}
                                  />
                                </div>
                              </>
                            )}
                            
                            <div className="col-span-1 sm:col-span-1 flex items-end">
                              <Button
                                type="button"
                                variant="destructive"
                                size="sm"
                                onClick={() => remove(index)}
                                className="w-full sm:w-auto"
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </div>
                          </div>
                          
                          <div className="mt-4">
                            <FormField
                              control={form.control}
                              name={`items.${index}.partDescription`}
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>Description (Optional)</FormLabel>
                                  <FormControl>
                                    <Input {...field} placeholder="Additional details" />
                                  </FormControl>
                                </FormItem>
                              )}
                            />
                          </div>
                          
                          {/* Hide pricing totals for field techs */}
                          {!isFieldTech && (
                            <div className="mt-2 text-right">
                              <span className="text-sm text-gray-600">
                                Total: ${(form.watch(`items.${index}.quantity`) * form.watch(`items.${index}.unitPrice`)).toFixed(2)}
                              </span>
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Labor Hours - Only visible to non-field techs */}
            {!isFieldTech && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base sm:text-lg flex items-center gap-2">
                    <Timer className="w-4 h-4 sm:w-5 sm:h-5 text-blue-600" />
                    Labor Hours
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <FormField
                    control={form.control}
                    name="totalHours"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Total Hours Worked</FormLabel>
                        <FormControl>
                          <Input {...field} type="number" step="0.25" placeholder="Total hours worked on this job" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </CardContent>
              </Card>
            )}

            {/* Photo Upload */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base sm:text-lg flex items-center gap-2">
                  <Camera className="w-4 h-4 sm:w-5 sm:h-5 text-blue-600" />
                  Photos
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <FileUpload
                    type="photo"
                    label="Photos"
                    files={photos}
                    onFilesChange={setPhotos}
                    accept="image/*"
                    multiple
                  />
                  <p className="text-sm text-gray-500">
                    Upload photos of the work performed (up to 5 images)
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Additional Notes */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base sm:text-lg">Additional Notes</CardTitle>
              </CardHeader>
              <CardContent>
                <FormField
                  control={form.control}
                  name="notes"
                  render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <Textarea {...field} placeholder="Any additional notes or observations" />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            {/* Billing Summary - Hidden from field techs */}
            {!isFieldTech && (
              <Card className="bg-gray-50">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base sm:text-lg flex items-center gap-2">
                    <Calculator className="w-4 h-4 sm:w-5 sm:h-5 text-blue-600" />
                    Billing Summary
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Parts Subtotal:</span>
                    <span className="font-medium">${totals.partsSubtotal.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">
                      Labor ({form.watch("totalHours")} hours @ ${form.watch("laborRate")}/hr):
                    </span>
                    <span className="font-medium">${totals.laborSubtotal.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Markup:</span>
                    <span className="font-medium">${totals.markupAmount.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Tax:</span>
                    <span className="font-medium">${totals.taxAmount.toFixed(2)}</span>
                  </div>
                  <Separator />
                  <div className="flex justify-between text-lg font-semibold">
                    <span>Total:</span>
                    <span>${totals.totalAmount.toFixed(2)}</span>
                  </div>
                </CardContent>
              </Card>
            )}
            </>
            )}
            </form>
          </Form>
        </div>

        {/* Action Buttons - Fixed Bottom */}
        <div className="border-t border-gray-200 p-4 sm:p-6 flex-shrink-0">
          <div className="flex flex-col sm:flex-row gap-3 sm:justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={handleCancel}
              className="w-full sm:w-auto"
            >
              Cancel
            </Button>
            {showReview ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleBack}
                  className="w-full sm:w-auto"
                >
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Back to Edit
                </Button>
                <Button
                  type="submit"
                  form="billing-form"
                  disabled={createBillingSheetMutation.isPending}
                  className="bg-green-600 hover:bg-green-700 w-full sm:w-auto"
                >
                  <Check className="w-4 h-4 mr-2" />
                  {createBillingSheetMutation.isPending ? "Submitting..." : "Submit Billing Sheet"}
                </Button>
              </>
            ) : (
              <>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    console.log('Current form values:', form.getValues());
                    console.log('Form errors:', form.formState.errors);
                    console.log('Form is valid:', form.formState.isValid);
                  }}
                  className="w-full sm:w-auto"
                >
                  Debug Form
                </Button>
                <Button
                  type="submit"
                  form="billing-form"
                  disabled={createBillingSheetMutation.isPending}
                  className="bg-blue-600 hover:bg-blue-700 w-full sm:w-auto"
                >
                  <Save className="w-4 h-4 mr-2" />
                  {createBillingSheetMutation.isPending ? "Creating..." : "Review & Submit"}
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Parts Search Modal */}
        <PartsSearchModal
          open={showPartsModal}
          onOpenChange={setShowPartsModal}
          onSelectPart={addPart}
        />
      </DialogContent>

      {/* Save Draft Confirmation Dialog */}
      <AlertDialog open={showCancelDialog} onOpenChange={setShowCancelDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Save as Draft?</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved changes. Would you like to save this billing sheet as a draft before closing?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleDiscard}>
              Discard Changes
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleSaveAsDraft}
              disabled={saveDraftMutation.isPending}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {saveDraftMutation.isPending ? "Saving..." : "Save as Draft"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}