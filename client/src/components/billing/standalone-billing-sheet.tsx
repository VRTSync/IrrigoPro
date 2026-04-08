import { safeGet } from "@/utils/safeStorage";
import { useState, useEffect, useRef } from "react";
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
  Minus,
  Search,
  ChevronDown,
  ChevronUp
} from "lucide-react";
import { AiExpandButton, AiSuggestionCard } from "@/components/ui/ai-expand-button";
import { CustomerSelector } from "@/components/ui/customer-selector";
import { PartsSearchModal } from "@/components/estimates/parts-search-modal";
import { FileUpload, type UploadedFile } from "@/components/ui/file-upload";
import { LocationPicker } from "@/components/ui/location-picker";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { Customer, Part } from "@shared/schema";

const billingItemSchema = z.object({
  partId: z.number().nullable().optional(),
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
  workLocationLat: z.number().nullable().optional(),
  workLocationLng: z.number().nullable().optional(),
  workLocationAddress: z.string().optional(),
  workDate: z.string().min(1, "Work date is required"),
  technicianName: z.string().min(1, "Technician name is required"),
  workDescription: z.string().min(1, "Work description is required"),
  totalHours: z.coerce.number().min(0.01, "Total hours must be greater than 0"),
  laborRate: z.coerce.number().min(0, "Labor rate must be positive"),
  notes: z.string().optional(),
  items: z.array(billingItemSchema).optional().default([]),
  branchName: z.string().optional(),
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
    propertyAddress?: string;
    workOrderId?: number;
  };
}


export function StandaloneBillingSheet({ 
  open, 
  onOpenChange, 
  draftData,
  prefillFromWorkOrder 
}: StandaloneBillingSheetProps) {
  const [showReview, setShowReview] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isSubmittingRef = useRef(false);
  const [showPartsModal, setShowPartsModal] = useState(false);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [uploadedPhotos, setUploadedPhotos] = useState<UploadedFile[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [partsSearchQuery, setPartsSearchQuery] = useState("");
  const [isFrequentPartsExpanded, setIsFrequentPartsExpanded] = useState(true);
  const [isAllPartsExpanded, setIsAllPartsExpanded] = useState(false);
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  const [selectedLocation, setSelectedLocation] = useState<{lat: number; lng: number; address?: string} | null>(null);
  const [aiSuggestion, setAiSuggestion] = useState<string | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  // Get user from localStorage (production-compatible) — initialized synchronously to avoid blank form states
  const [currentUser, setCurrentUser] = useState<any>(() => {
    const savedUser = safeGet("user");
    if (savedUser) {
      try { return JSON.parse(savedUser); } catch { return null; }
    }
    return null;
  });
  
  const isFieldTech = currentUser?.role === 'field_tech';
  const isIrrigationManager = currentUser?.role === 'irrigation_manager' || currentUser?.role === 'billing_manager';
  const fieldTechAutoName = isFieldTech ? (currentUser?.name || currentUser?.username || "") : "";

  // Get today's date in YYYY-MM-DD format
  const today = new Date().toISOString().split('T')[0];

  const form = useForm<BillingSheetData>({
    resolver: zodResolver(billingSheetSchema),
    mode: "onSubmit",
    reValidateMode: "onSubmit",
    defaultValues: {
      customerId: prefillFromWorkOrder?.customerId || 0,
      customerName: prefillFromWorkOrder?.customerName || "",
      propertyAddress: prefillFromWorkOrder?.propertyAddress || "",
      workDate: today,
      technicianName: isFieldTech ? (currentUser?.name || currentUser?.username || "") : "",
      workDescription: "",
      totalHours: 1,
      laborRate: 0,
      notes: "",
      items: [],
    },
  });

  const { fields, append, remove, replace } = useFieldArray({
    control: form.control,
    name: "items",
  });

  // Fetch customers for the CustomerSelector
  const { data: customers } = useQuery<Customer[]>({
    queryKey: ["/api/customers"],
  });

  // Fetch parts for adding to billing sheet
  const { data: parts } = useQuery<Part[]>({
    queryKey: ["/api/parts"],
  });

  // Get popular parts (most frequently used)
  const { data: popularParts } = useQuery<Part[]>({
    queryKey: ["/api/parts/popular"],
  });

  // Filter parts by search query
  const filteredParts = parts?.filter(part =>
    part.name.toLowerCase().includes(partsSearchQuery.toLowerCase()) ||
    part.description?.toLowerCase().includes(partsSearchQuery.toLowerCase())
  );

  // Create billing sheet mutation
  const createBillingSheet = useMutation({
    mutationFn: async (data: any) => {
      const payload = {
        ...data,
        status: isFieldTech ? 'submitted' : isIrrigationManager ? 'approved' : 'draft',
        technicianId: isFieldTech ? currentUser?.id : null,
        companyId: currentUser?.companyId,
        photos: uploadedPhotos.map(photo => photo.url),
      };
      
      try {
        const result = await apiRequest("/api/billing-sheets", "POST", payload);
        return result;
      } catch (error) {
        throw error;
      }
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: isFieldTech 
          ? "Billing sheet submitted successfully"
          : "Billing sheet saved successfully",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/billing-sheets"] });
      handleClose();
    },
    onError: (error: any) => {
      console.error('Mutation error:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to save billing sheet",
        variant: "destructive",
      });
    },
  });

  // Update billing sheet mutation for drafts
  const updateBillingSheet = useMutation({
    mutationFn: async (data: any) => {
      const payload = {
        ...data,
        photos: uploadedPhotos.map(photo => photo.url),
      };
      
      return apiRequest(`/api/billing-sheets/${draftData.id}`, "PATCH", payload);
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Billing sheet updated successfully",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/billing-sheets"] });
      handleClose();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update billing sheet",
        variant: "destructive",
      });
    },
  });

  // Load draft data when editing
  useEffect(() => {
    if (draftData && open) {
      const formData = {
        customerId: draftData.customerId || 0,
        customerName: draftData.customerName || "",
        propertyAddress: draftData.propertyAddress || "",
        workDate: draftData.workDate ? new Date(draftData.workDate).toISOString().split('T')[0] : today,
        technicianName: draftData.technicianName || "",
        workDescription: draftData.workDescription || "",
        totalHours: draftData.totalHours || 1,
        laborRate: draftData.laborRate || 0,
        notes: draftData.notes || "",
        items: Array.isArray(draftData.items) ? draftData.items.map((item: any) => ({
          ...item,
          partId: item.partId ?? undefined,
          quantity: item.quantity ?? undefined,
          unitPrice: item.unitPrice ?? undefined,
          laborHours: item.laborHours ?? undefined,
        })) : [],
      };
      
      form.reset(formData);
      
      // Handle photos array safely
      const photosArray = Array.isArray(draftData.photos) ? draftData.photos : [];
      setUploadedPhotos(photosArray.map((url: string) => ({ 
        url, 
        name: url.split('/').pop() || 'photo' 
      })));
      
      // Set selected customer if available
      if (customers && draftData.customerId) {
        const customer = customers.find(c => c.id === draftData.customerId);
        if (customer) {
          setSelectedCustomer(customer);
        }
      }
    }
  }, [draftData, open, form, today, customers]);

  // Auto-fill technician name for field techs and irrigation managers
  useEffect(() => {
    if (
      currentUser &&
      (currentUser.role === 'field_tech' || currentUser.role === 'irrigation_manager') &&
      !form.getValues('technicianName')
    ) {
      const autoFillName = currentUser.name || currentUser.username || "";
      if (autoFillName) {
        form.setValue('technicianName', autoFillName);
      }
    }
  }, [currentUser, open]);

  // Calculate totals
  const items = form.watch("items") || [];
  const totalHours = form.watch("totalHours") || 0;
  const laborRate = form.watch("laborRate") || 0;

  const partsSubtotal = Array.isArray(items) ? items.reduce((sum, item) => sum + (item.quantity * item.unitPrice), 0) : 0;
  const laborSubtotal = totalHours * laborRate;
  
  const markupAmount = 0;
  const subtotal = partsSubtotal + laborSubtotal;
  const taxAmount = 0;
  const totalAmount = subtotal;

  const totals = {
    partsSubtotal,
    laborSubtotal,
    markupAmount,
    subtotal,
    taxAmount,
    totalAmount,
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount);
  };

  const handleClose = () => {
    if (form.formState.isDirty) {
      setShowCancelDialog(true);
    } else {
      onOpenChange(false);
      resetForm();
    }
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      handleClose();
    } else {
      onOpenChange(open);
    }
  };

  const resetForm = () => {
    form.reset();
    setShowReview(false);
    setUploadedPhotos([]);
    setSelectedCustomer(null);
    setPartsSearchQuery("");
    setAiSuggestion(null);
  };

  const forceClose = () => {
    isSubmittingRef.current = false;
    onOpenChange(false);
    resetForm();
    setShowCancelDialog(false);
  };

  const addPart = (part: Part, quantity: number = 1) => {
    const existingItemIndex = fields.findIndex(field => field.partId === part.id);
    
    if (existingItemIndex >= 0) {
      // Update existing item quantity
      const existingItem = fields[existingItemIndex];
      const newQuantity = existingItem.quantity + quantity;
      form.setValue(`items.${existingItemIndex}.quantity`, newQuantity);
    } else {
      // Add new item
      append({
        partId: part.id,
        partName: part.name,
        partDescription: part.description || "",
        quantity,
        unitPrice: parseFloat(part.price) || 0,
        laborHours: 0,
        notes: "",
      });
    }
  };

  const addManualItem = () => {
    append({
      partName: "",
      partDescription: "",
      quantity: 1,
      unitPrice: 0,
      laborHours: 0,
      notes: "",
    });
  };

  const onValidationError = (errors: any) => {
    console.error('Billing sheet validation errors:', errors);

    const fieldLabels: Record<string, string> = {
      customerId: "Customer",
      customerName: "Customer name",
      propertyAddress: "Property address",
      workDate: "Work date",
      technicianName: "Technician name",
      workDescription: "Work description",
      totalHours: "Total hours",
      laborRate: "Labor rate",
      workLocationLat: "Work location latitude",
      workLocationLng: "Work location longitude",
      partName: "Part name",
      quantity: "Quantity",
      unitPrice: "Unit price",
      laborHours: "Labor hours",
    };

    const findFirstError = (obj: any, path: string[] = []): { message: string; path: string[] } | undefined => {
      if (!obj || typeof obj !== 'object') return undefined;
      if (typeof obj.message === 'string' && obj.message) return { message: obj.message, path };
      for (const [key, val] of Object.entries(obj)) {
        const result = findFirstError(val, [...path, key]);
        if (result) return result;
      }
      return undefined;
    };

    const found = findFirstError(errors);
    let description = "Some required information is missing";
    if (found) {
      const fieldKey = found.path[found.path.length - 1];
      const label = fieldKey && fieldLabels[fieldKey] ? fieldLabels[fieldKey] : undefined;
      description = label ? `${label}: ${found.message}` : found.message;
    }

    toast({
      title: "Please complete all required fields",
      description,
      variant: "destructive",
    });
  };

  const onSubmit = (data: BillingSheetData) => {
    // Validate branch is selected if the customer has branches
    const customerBranches = (selectedCustomer as any)?.branches;
    if (customerBranches && customerBranches.length > 0 && !data.branchName) {
      form.setError("branchName", { message: "Branch is required for this customer" });
      return;
    }

    if (showReview) {
      if (isSubmittingRef.current) return;
      isSubmittingRef.current = true;

      // Determine if this is an update or create operation
      const isUpdating = !!draftData?.id;
      const url = isUpdating ? `/api/billing-sheets/${draftData.id}` : "/api/billing-sheets";
      const method = isUpdating ? "PATCH" : "POST";

      // Field techs submitting a draft must send only { status: 'submitted' }
      // (the server enforces this restriction for security).
      // When updating an existing sheet (manager edit), preserve the existing status so we
      // don't accidentally change pending_manager_review → approved on a simple data edit.
      // All other cases (new sheet POST) assign the appropriate status for the role.
      const submissionData = (isUpdating && isFieldTech)
        ? { status: 'submitted' as const }
        : isUpdating
        ? {
            ...data,
            laborSubtotal: totals.laborSubtotal,
            partsSubtotal: totals.partsSubtotal,
            markupAmount: totals.markupAmount,
            taxAmount: totals.taxAmount,
            totalAmount: totals.totalAmount,
            technicianId: currentUser?.id,
            // Preserve the current status when editing an existing sheet
            status: draftData.status,
          }
        : {
            ...data,
            laborSubtotal: totals.laborSubtotal,
            partsSubtotal: totals.partsSubtotal,
            markupAmount: totals.markupAmount,
            taxAmount: totals.taxAmount,
            totalAmount: totals.totalAmount,
            technicianId: currentUser?.id,
            status: isFieldTech ? 'submitted' : isIrrigationManager ? 'approved' : 'draft',
          };

      setIsSubmitting(true);
      apiRequest(url, method, submissionData)
        .then(() => {
          toast({
            title: "Success",
            description: isFieldTech
              ? "Billing sheet submitted successfully"
              : "Billing sheet saved successfully",
          });
          queryClient.invalidateQueries({ queryKey: ["/api/billing-sheets"] });
          if (currentUser?.role === 'field_tech' && currentUser?.id) {
            queryClient.invalidateQueries({ queryKey: ["/api/billing-sheets", "technician", currentUser.id] });
          }
          forceClose();
        })
        .catch(error => {
          console.error('Submission error:', error);
          toast({
            title: "Error",
            description: error.message || "Failed to save billing sheet",
            variant: "destructive",
          });
        })
        .finally(() => {
          isSubmittingRef.current = false;
          setIsSubmitting(false);
        });
    } else {
      setShowReview(true);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent 
        className="w-screen h-screen sm:w-[95vw] sm:max-w-4xl sm:h-[95vh] sm:max-h-[95vh] sm:rounded-lg overflow-hidden p-0 flex flex-col m-0 sm:m-auto"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader className="p-4 sm:p-6 border-b border-gray-200 flex-shrink-0">
          <DialogTitle className="flex items-center gap-3 text-lg sm:text-xl">
            <div className="bg-orange-50 p-2 rounded-lg">
              <FileText className="w-5 h-5 text-orange-600" />
            </div>
            <div>
              <span className="text-xl font-semibold">
                {showReview ? 'Review Billing Sheet' : (draftData ? 'Edit Billing Sheet' : 'Create Billing Sheet')}
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

        <div className="flex-1 overflow-y-auto overflow-x-hidden overscroll-contain p-4 sm:p-6 min-w-0">
          <Form {...form}>
            <form id="billing-form" onSubmit={form.handleSubmit(onSubmit, onValidationError)} className="space-y-4 sm:space-y-6">
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
                      {form.watch('branchName') && (
                        <div>
                          <p className="text-sm font-medium text-gray-600">Branch</p>
                          <p className="text-gray-900">{form.watch('branchName')}</p>
                        </div>
                      )}
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
                        <p className="text-sm font-medium text-gray-600">Hours Worked</p>
                        <p className="text-gray-900">
                          {form.watch('totalHours')} hours
                        </p>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-600">Work Description</p>
                        <p className="text-gray-900">{form.watch('workDescription')}</p>
                      </div>
                      {form.watch('notes') && (
                        <div>
                          <p className="text-sm font-medium text-gray-600">Additional Notes</p>
                          <p className="text-gray-900">{form.watch('notes')}</p>
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  {/* Parts & Materials Review */}
                  {items.length > 0 && (
                    <Card>
                      <CardHeader className="pb-3">
                        <CardTitle className="text-base sm:text-lg flex items-center gap-2">
                          <Package className="w-4 h-4 sm:w-5 sm:h-5 text-blue-600" />
                          Parts & Materials ({items.length} items)
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-3">
                          {items.map((item, index) => (
                            <div key={index} className="border rounded-lg p-3">
                              <div className="flex justify-between items-start">
                                <div className="flex-1 min-w-0">
                                  <p className="font-medium">{item.partName}</p>
                                  {item.partDescription && (
                                    <p className="text-sm text-gray-600">{item.partDescription}</p>
                                  )}
                                  <p className="text-sm text-gray-500">
                                    Qty: {item.quantity}
                                    {!isFieldTech && (
                                      <> × {formatCurrency(item.unitPrice)}</>
                                    )}
                                  </p>
                                </div>
                                {!isFieldTech && (
                                  <div className="text-right">
                                    <p className="font-medium">{formatCurrency(item.quantity * item.unitPrice)}</p>
                                  </div>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {/* Photos Review */}
                  {uploadedPhotos.length > 0 && (
                    <Card>
                      <CardHeader className="pb-3">
                        <CardTitle className="text-base sm:text-lg flex items-center gap-2">
                          <Camera className="w-4 h-4 sm:w-5 sm:h-5 text-blue-600" />
                          Photos ({uploadedPhotos.length})
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                          {uploadedPhotos.map((photo, index) => {
                            const displayUrl = photo.url.startsWith('http') || photo.url.startsWith('/api/')
                              ? photo.url
                              : photo.url.startsWith('/uploads/')
                                ? `/api/photos/${photo.url.replace('/uploads/', '')}`
                                : `/api/photos/${photo.url}`;
                            return (
                              <div key={index} className="relative aspect-square">
                                <img 
                                  src={displayUrl} 
                                  alt={`Photo ${index + 1}`}
                                  className="w-full h-full object-cover rounded-lg border"
                                />
                              </div>
                            );
                          })}
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {/* Totals Review - Hidden from Field Techs */}
                  {!isFieldTech && (
                    <Card>
                      <CardHeader className="pb-3">
                        <CardTitle className="text-base sm:text-lg flex items-center gap-2">
                          <Calculator className="w-4 h-4 sm:w-5 sm:h-5 text-blue-600" />
                          Financial Summary
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-2">
                        <div className="flex justify-between">
                          <span>Labor ({totalHours} hrs)</span>
                          <span>{formatCurrency(totals.laborSubtotal)}</span>
                        </div>
                        {totals.partsSubtotal > 0 && (
                          <div className="flex justify-between">
                            <span>Parts Subtotal</span>
                            <span>{formatCurrency(totals.partsSubtotal)}</span>
                          </div>
                        )}
                        <Separator />
                        <div className="flex justify-between font-bold text-lg">
                          <span>Total</span>
                          <span>{formatCurrency(totals.totalAmount)}</span>
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </div>
              ) : (
                // Edit Mode
                <div className="space-y-4 sm:space-y-6">
                  {/* Customer & Location */}
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base sm:text-lg flex items-center gap-2">
                        <User className="w-4 h-4 sm:w-5 sm:h-5 text-blue-600" />
                        Customer & Location
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="space-y-4 sm:space-y-0 sm:grid sm:grid-cols-2 sm:gap-4 min-w-0">
                        <FormField
                          control={form.control}
                          name="customerId"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Customer *</FormLabel>
                              <FormControl>
                                <CustomerSelector
                                  selectedCustomer={selectedCustomer}
                                  onSelectCustomer={(customer) => {
                                    field.onChange(customer.id);
                                    form.setValue("customerName", customer.name);
                                    setSelectedCustomer(customer);
                                    form.setValue("laborRate", parseFloat(customer.laborRate || "0"));
                                    form.setValue("branchName", "");
                                  }}
                                  placeholder="Select customer"
                                  hideLabel={true}
                                  canCreateCustomer={currentUser?.role !== 'field_tech' && currentUser?.role !== 'irrigation_manager'}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        {/* Branch selector — only shown if customer has branches configured */}
                        {selectedCustomer && (selectedCustomer as any).branches && (selectedCustomer as any).branches.length > 0 && (
                          <FormField
                            control={form.control}
                            name="branchName"
                            rules={{ required: "Branch is required" }}
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Branch *</FormLabel>
                                <Select onValueChange={field.onChange} value={field.value || ""}>
                                  <FormControl>
                                    <SelectTrigger>
                                      <SelectValue placeholder="Select branch location..." />
                                    </SelectTrigger>
                                  </FormControl>
                                  <SelectContent>
                                    {((selectedCustomer as any).branches as string[]).map((branch: string) => (
                                      <SelectItem key={branch} value={branch}>{branch}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        )}
                        
                        <div className="sm:col-span-2">
                          <FormField
                            control={form.control}
                            name="propertyAddress"
                            render={({ field }) => (
                              <FormItem>
                                <div className="flex items-center justify-between">
                                  <FormLabel>Repair Location</FormLabel>
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
                                </div>
                                <FormControl>
                                  <Input {...field} placeholder="Repair site address (optional)" />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />

                          {!selectedCustomer && (
                            <div className="text-sm text-gray-500 mt-2">
                              <p>Please select a customer first to set repair location.</p>
                            </div>
                          )}

                          {selectedCustomer && !showLocationPicker && (
                            <div className="text-sm text-gray-600 mt-2">
                              <p><strong>Default Location:</strong> {selectedCustomer.address || "No address on file"}</p>
                              <p className="mt-1">Click "Select Location on Map" to choose a specific repair location different from the customer's address.</p>
                            </div>
                          )}
                          
                          {selectedCustomer && showLocationPicker && (
                            <div className="mt-4">
                              <LocationPicker
                                key={selectedCustomer.id}
                                defaultAddress={selectedCustomer.address || ""}
                                onLocationSelect={(location) => {
                                  setSelectedLocation(location);
                                  form.setValue("workLocationLat", location.lat);
                                  form.setValue("workLocationLng", location.lng);
                                  form.setValue("workLocationAddress", location.address || "");
                                  form.setValue("propertyAddress", location.address || "");
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
                            </div>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Work Details */}
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base sm:text-lg flex items-center gap-2">
                        <Calendar className="w-4 h-4 sm:w-5 sm:h-5 text-blue-600" />
                        Work Details
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {/* Basic Info */}
                      <div className="space-y-4 sm:space-y-0 sm:grid sm:grid-cols-2 sm:gap-4 min-w-0">
                        <FormField
                          control={form.control}
                          name="workDate"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Work Date *</FormLabel>
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
                                  disabled={isFieldTech && !!fieldTechAutoName}
                                  className={isFieldTech && !!fieldTechAutoName ? "bg-gray-50" : ""}
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
                            <div className="flex items-center justify-between">
                              <FormLabel>Work Description</FormLabel>
                              <AiExpandButton
                                getValue={() => field.value || ""}
                                onSuggestion={setAiSuggestion}
                              />
                            </div>
                            <FormControl>
                              <Textarea {...field} placeholder="Describe the work performed" />
                            </FormControl>
                            <AiSuggestionCard
                              suggestion={aiSuggestion}
                              onAccept={() => {
                                form.setValue("workDescription", aiSuggestion!, { shouldDirty: true });
                                setAiSuggestion(null);
                              }}
                              onDismiss={() => setAiSuggestion(null)}
                            />
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      {/* Labor & Time */}
                      <div className="bg-blue-50 p-4 rounded-lg space-y-4">
                        <h4 className="font-medium text-gray-900 flex items-center gap-2">
                          <Clock className="w-4 h-4 text-blue-600" />
                          Labor Information
                        </h4>
                        
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <FormField
                            control={form.control}
                            name="totalHours"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Hours Worked *</FormLabel>
                                <FormControl>
                                  <Input 
                                    {...field} 
                                    type="number"
                                    inputMode="decimal"
                                    step="0.25" 
                                    min="0" 
                                    placeholder="0.00"
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />

                          <div>
                            <p className="text-sm font-medium mb-2">Labor Rate</p>
                            {selectedCustomer ? (
                              <div className="flex items-center h-10 px-3 rounded-md border border-gray-200 bg-gray-50 text-gray-700 text-sm">
                                ${parseFloat(selectedCustomer.laborRate || "0").toFixed(2)}/hr
                                <span className="ml-2 text-xs text-gray-500">(from customer record)</span>
                              </div>
                            ) : (
                              <div className="flex items-center h-10 px-3 rounded-md border border-gray-200 bg-gray-50 text-gray-400 text-sm">
                                Select a customer first
                              </div>
                            )}
                          </div>
                        </div>

                      </div>
                    </CardContent>
                  </Card>

                  {/* Parts & Materials */}
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base sm:text-lg flex items-center justify-between">
                        <span className="flex items-center gap-2">
                          <Package className="w-4 h-4 sm:w-5 sm:h-5 text-blue-600" />
                          Parts & Materials Used
                        </span>
                        {!isFieldTech && fields.length > 0 && (
                          <div className="text-sm font-normal text-gray-600">
                            Total: {formatCurrency(totals.partsSubtotal)}
                          </div>
                        )}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {/* Add Parts Section */}
                      <div className="space-y-4">
                        {/* Quick Add from Popular Parts */}
                        {!partsSearchQuery && popularParts && popularParts.length > 0 && (
                          <div className="border rounded-lg bg-white">
                            <button
                              type="button"
                              onClick={() => setIsFrequentPartsExpanded(!isFrequentPartsExpanded)}
                              className="w-full p-3 border-b bg-blue-50 hover:bg-blue-100 transition-colors flex items-center justify-between text-left"
                            >
                              <div className="flex items-center gap-2">
                                <Package className="w-4 h-4 text-blue-600" />
                                <div>
                                  <h4 className="font-medium text-gray-900">Frequently Used Parts</h4>
                                  <p className="text-sm text-gray-600">Quick access to your most used parts ({popularParts.length} available)</p>
                                </div>
                              </div>
                              {isFrequentPartsExpanded ? (
                                <ChevronUp className="w-4 h-4 text-gray-600" />
                              ) : (
                                <ChevronDown className="w-4 h-4 text-gray-600" />
                              )}
                            </button>
                            
                            {isFrequentPartsExpanded && (
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-3">
                                {popularParts.map((part) => {
                                  const isAlreadyUsed = fields.some(field => field.partId === part.id);
                                  
                                  return (
                                    <button
                                      key={part.id}
                                      type="button"
                                      onClick={() => addPart(part, 1)}
                                      className={`
                                        group flex items-center justify-between p-2 border rounded-lg hover:bg-gray-50 transition-colors text-left
                                        ${isAlreadyUsed ? 'bg-green-50 border-green-200' : 'bg-white border-gray-200'}
                                      `}
                                    >
                                      <div className="flex-1 min-w-0">
                                        <div className="font-medium text-sm text-gray-900">{part.name}</div>
                                        {!isFieldTech && (
                                          <div className="text-xs text-gray-500">{formatCurrency(parseFloat(part.price))}</div>
                                        )}
                                      </div>
                                      {isAlreadyUsed ? (
                                        <Check className="w-4 h-4 text-green-600" />
                                      ) : (
                                        <Plus className="w-4 h-4 text-gray-400 group-hover:text-blue-600" />
                                      )}
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        )}

                        {/* All Parts Catalog - Collapsible */}
                        <div className="border rounded-lg bg-white">
                          <button
                            type="button"
                            onClick={() => setIsAllPartsExpanded(!isAllPartsExpanded)}
                            className="w-full p-3 border-b bg-gray-50 hover:bg-gray-100 transition-colors flex items-center justify-between text-left"
                          >
                            <div className="flex items-center gap-2">
                              <Search className="w-4 h-4 text-gray-600" />
                              <div>
                                <h4 className="font-medium text-gray-900">Add from Catalog</h4>
                                <p className="text-sm text-gray-600">Search and add any part from your inventory ({parts?.length || 0} total parts)</p>
                              </div>
                            </div>
                            {isAllPartsExpanded ? (
                              <ChevronUp className="w-4 h-4 text-gray-600" />
                            ) : (
                              <ChevronDown className="w-4 h-4 text-gray-600" />
                            )}
                          </button>

                          {isAllPartsExpanded && (
                            <div className="p-3 space-y-3">
                              {/* Search Bar */}
                              <div className="relative">
                                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                                <Input
                                  placeholder="Search parts by name..."
                                  value={partsSearchQuery}
                                  onChange={(e) => setPartsSearchQuery(e.target.value)}
                                  className="pl-10"
                                />
                              </div>
                              
                              <div>
                                {(filteredParts?.length ?? 0) > 0 ? (
                                  <div className="divide-y">
                                    {filteredParts!.map((part) => {
                                      const isAlreadyUsed = fields.some(field => field.partId === part.id);
                                      
                                      return (
                                        <div
                                          key={part.id}
                                          className={`
                                            flex items-center justify-between p-3 hover:bg-gray-50 transition-colors
                                            ${isAlreadyUsed ? 'bg-green-50' : ''}
                                          `}
                                        >
                                          <div className="flex-1 min-w-0">
                                            <div className="font-medium text-sm text-gray-900">{part.name}</div>
                                            <div className="text-xs text-gray-500">{part.description}</div>
                                            {!isFieldTech && (
                                              <div className="text-xs text-gray-500">{formatCurrency(parseFloat(part.price))}</div>
                                            )}
                                          </div>
                                          
                                          <div className="flex items-center gap-2">
                                            {isAlreadyUsed && (
                                              <div className="flex items-center gap-1 text-xs text-green-600">
                                                <Check className="w-3 h-3" />
                                                <span>Added</span>
                                              </div>
                                            )}
                                            
                                            <Button
                                              type="button"
                                              onClick={() => addPart(part, 1)}
                                              className="bg-blue-600 hover:bg-blue-700 text-white h-11 w-11 p-0 flex-shrink-0"
                                              title="Add part"
                                            >
                                              <Plus className="w-5 h-5" />
                                            </Button>
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                ) : partsSearchQuery ? (
                                  <div className="p-6 text-center text-gray-500">
                                    <p>No parts found matching "{partsSearchQuery}"</p>
                                    {!isFieldTech && (
                                      <Button
                                        type="button"
                                        onClick={addManualItem}
                                        variant="outline"
                                        size="sm"
                                        className="mt-2"
                                      >
                                        <Plus className="w-3 h-3 mr-1" />
                                        Add as Manual Item
                                      </Button>
                                    )}
                                  </div>
                                ) : (
                                  <div className="p-6 text-center text-gray-500">
                                    <p>Start typing to search for parts</p>
                                    {!isFieldTech && (
                                      <Button
                                        type="button"
                                        onClick={addManualItem}
                                        variant="outline"
                                        size="sm"
                                        className="mt-2"
                                      >
                                        <Plus className="w-3 h-3 mr-1" />
                                        Add Manual Item
                                      </Button>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Manual Add Button — hidden for field techs to prevent blank-item validation errors */}
                        {!isFieldTech && (
                          <Button
                            type="button"
                            onClick={addManualItem}
                            variant="outline"
                            className="w-full"
                          >
                            <Plus className="w-4 h-4 mr-2" />
                            Add Manual Item
                          </Button>
                        )}
                      </div>

                      {/* Added Items List */}
                      {fields.length > 0 && (
                        <div className="space-y-4">
                          <Separator />
                          <h4 className="font-medium text-gray-900 flex items-center gap-2">
                            <Package className="w-4 h-4" />
                            Added Items ({fields.length})
                          </h4>
                          
                          <div className="space-y-3">
                            {fields.map((field, index) => (
                              <Card key={field.id}>
                                <CardContent className="p-4">
                                  {/* Mobile-first responsive layout */}
                                  <div className="space-y-4">
                                    {/* Item header with name and remove button */}
                                    <div className="flex items-start justify-between gap-3">
                                      <div className="flex-1 min-w-0">
                                        <FormField
                                          control={form.control}
                                          name={`items.${index}.partName`}
                                          render={({ field }) => (
                                            <FormItem>
                                              <FormLabel className="text-sm font-medium">Item Name</FormLabel>
                                              <FormControl>
                                                <Input 
                                                  {...field} 
                                                  placeholder="Part/Material name" 
                                                  className="text-sm font-medium" 
                                                  readOnly={!!form.watch(`items.${index}.partId`)}
                                                  disabled={!!form.watch(`items.${index}.partId`)}
                                                />
                                              </FormControl>
                                              <FormMessage />
                                            </FormItem>
                                          )}
                                        />
                                      </div>
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => remove(index)}
                                        className="text-red-600 hover:text-red-700 hover:bg-red-50 mt-6"
                                      >
                                        <Trash2 className="w-4 h-4" />
                                      </Button>
                                    </div>

                                    {/* Description field - read-only if from catalog */}
                                    {form.watch(`items.${index}.partDescription`) && (
                                      <div>
                                        <label className="text-sm text-gray-600 block mb-1">Description</label>
                                        <div className="text-sm text-gray-800 p-2 bg-gray-50 rounded border">
                                          {form.watch(`items.${index}.partDescription`)}
                                        </div>
                                      </div>
                                    )}

                                    {/* Quantity and price in grid */}
                                    <div className="grid grid-cols-2 gap-3 min-w-0">
                                      <FormField
                                        control={form.control}
                                        name={`items.${index}.quantity`}
                                        render={({ field }) => (
                                          <FormItem>
                                            <FormLabel className="text-sm font-medium">Quantity</FormLabel>
                                            <FormControl>
                                              <Input 
                                                {...field} 
                                                type="number"
                                                inputMode="decimal"
                                                step="0.01" 
                                                min="0" 
                                                placeholder="0.00"
                                                className="text-sm"
                                              />
                                            </FormControl>
                                            <FormMessage />
                                          </FormItem>
                                        )}
                                      />

                                      {!isFieldTech && (
                                        <FormField
                                          control={form.control}
                                          name={`items.${index}.unitPrice`}
                                          render={({ field }) => (
                                            <FormItem>
                                              <FormLabel className="text-sm font-medium">Unit Price</FormLabel>
                                              <FormControl>
                                                <Input 
                                                  {...field} 
                                                  type="number"
                                                  inputMode="decimal"
                                                  step="0.01" 
                                                  min="0" 
                                                  placeholder="0.00"
                                                  className="text-sm"
                                                  readOnly={!!form.watch(`items.${index}.partId`)}
                                                  disabled={!!form.watch(`items.${index}.partId`)}
                                                />
                                              </FormControl>
                                              <FormMessage />
                                            </FormItem>
                                          )}
                                        />
                                      )}
                                    </div>

                                    {/* Labor hours */}
                                    <FormField
                                      control={form.control}
                                      name={`items.${index}.laborHours`}
                                      render={({ field }) => (
                                        <FormItem>
                                          <FormLabel className="text-sm font-medium">Additional Labor Hours (for this item)</FormLabel>
                                          <FormControl>
                                            <Input 
                                              {...field} 
                                              type="number"
                                              inputMode="decimal"
                                              step="0.25" 
                                              min="0" 
                                              placeholder="0.00"
                                              className="text-sm"
                                            />
                                          </FormControl>
                                          <FormMessage />
                                        </FormItem>
                                      )}
                                    />

                                    {/* Notes */}
                                    <FormField
                                      control={form.control}
                                      name={`items.${index}.notes`}
                                      render={({ field }) => (
                                        <FormItem>
                                          <FormLabel className="text-sm font-medium">Notes (optional)</FormLabel>
                                          <FormControl>
                                            <Textarea 
                                              {...field} 
                                              placeholder="Special notes for this item..."
                                              className="text-sm resize-none"
                                              rows={2}
                                            />
                                          </FormControl>
                                          <FormMessage />
                                        </FormItem>
                                      )}
                                    />

                                    {/* Item total */}
                                    {!isFieldTech && (
                                      <div className="bg-gray-50 p-3 rounded border-t">
                                        <div className="flex justify-between items-center">
                                          <span className="text-sm font-medium text-gray-600">Item Total</span>
                                          <span className="text-base font-semibold text-gray-900">
                                            {formatCurrency((form.watch(`items.${index}.quantity`) || 0) * (form.watch(`items.${index}.unitPrice`) || 0))}
                                          </span>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                </CardContent>
                              </Card>
                            ))}
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  {/* Photos */}
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base sm:text-lg flex items-center gap-2">
                        <Camera className="w-4 h-4 sm:w-5 sm:h-5 text-blue-600" />
                        Photos
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <FileUpload
                        type="photo"
                        label="Photos"
                        accept="image/*"
                        multiple
                        files={uploadedPhotos}
                        onFilesChange={setUploadedPhotos}
                      />
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
                              <Textarea 
                                {...field} 
                                placeholder="Any additional notes about the work performed..."
                                rows={3}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </CardContent>
                  </Card>

                  {/* Totals Summary */}
                  {!isFieldTech && (
                    <Card>
                      <CardHeader className="pb-3">
                        <CardTitle className="text-base sm:text-lg flex items-center gap-2">
                          <Calculator className="w-4 h-4 sm:w-5 sm:h-5 text-blue-600" />
                          Cost Summary
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-2">
                        <div className="flex justify-between">
                          <span>Labor ({totalHours} hrs)</span>
                          <span>{formatCurrency(totals.laborSubtotal)}</span>
                        </div>
                        {totals.partsSubtotal > 0 && (
                          <div className="flex justify-between">
                            <span>Parts Subtotal</span>
                            <span>{formatCurrency(totals.partsSubtotal)}</span>
                          </div>
                        )}
                        <Separator />
                        <div className="flex justify-between font-bold text-lg">
                          <span>Total</span>
                          <span>{formatCurrency(totals.totalAmount)}</span>
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </div>
              )}
            </form>
          </Form>
        </div>

        {/* Footer with action buttons */}
        <div className="p-4 sm:p-6 border-t border-gray-200 bg-gray-50 flex-shrink-0">
          <div className="flex flex-col sm:flex-row gap-3 sm:justify-between">
            <div className="flex gap-2">
              {showReview && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowReview(false)}
                  className="flex items-center gap-2"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Back to Edit
                </Button>
              )}
            </div>
            
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={handleClose}
              >
                Cancel
              </Button>
              
              <Button
                type="button"
                onClick={() => form.handleSubmit(onSubmit, onValidationError)()}
                disabled={isSubmitting}
                className="bg-blue-600 hover:bg-blue-700 text-white"
              >
                {isSubmitting ? (
                  "Saving..."
                ) : showReview ? (
                  <>
                    <Save className="w-4 h-4 mr-2" />
                    {isFieldTech ? "Submit Billing Sheet" : "Save Billing Sheet"}
                  </>
                ) : (
                  "Review & Submit"
                )}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>

      {/* Cancel Confirmation Dialog */}
      <AlertDialog open={showCancelDialog} onOpenChange={setShowCancelDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard Changes?</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved changes. Are you sure you want to close without saving?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Continue Editing</AlertDialogCancel>
            <AlertDialogAction onClick={forceClose} className="bg-red-600 hover:bg-red-700">
              Discard Changes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Parts Search Modal */}
      <PartsSearchModal
        open={showPartsModal}
        onOpenChange={setShowPartsModal}
        onSelectPart={(part) => addPart(part, 1)}
      />
    </Dialog>
  );
}