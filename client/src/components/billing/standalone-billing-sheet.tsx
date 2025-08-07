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
  Minus,
  Search,
  ChevronDown,
  ChevronUp
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
  const [partsSearchQuery, setPartsSearchQuery] = useState("");
  const [isFrequentPartsExpanded, setIsFrequentPartsExpanded] = useState(false);
  const [isAllPartsExpanded, setIsAllPartsExpanded] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Get current user role and info
  const getCurrentUser = () => {
    const savedUser = localStorage.getItem("user");
    return savedUser ? JSON.parse(savedUser) : null;
  };
  const currentUser = getCurrentUser();
  const isFieldTech = currentUser?.role === 'field_tech';

  // Fetch customers for draft loading
  const { data: customers } = useQuery<Customer[]>({
    queryKey: ["/api/customers"],
    queryFn: () => fetch("/api/customers").then(res => res.json()),
  });

  // Fetch parts for the improved parts selection
  const { data: parts } = useQuery<Part[]>({
    queryKey: ["/api/parts"],
    queryFn: () => fetch("/api/parts").then(res => res.json()),
  });

  // Fetch popular parts for the frequently used section
  const { data: popularParts } = useQuery<(Part & { usageCount: number })[]>({
    queryKey: ["/api/parts/popular"],
    queryFn: () => fetch("/api/parts/popular?limit=6").then(res => res.json()),
  });

  // Filter parts based on search query
  const filteredParts = parts?.filter(part =>
    part.name.toLowerCase().includes(partsSearchQuery.toLowerCase()) ||
    part.description?.toLowerCase().includes(partsSearchQuery.toLowerCase()) ||
    part.sku?.toLowerCase().includes(partsSearchQuery.toLowerCase())
  );

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
      // Set selected customer first - this is crucial for form functionality
      if (customers && draftData.customerId) {
        const customer = customers.find(c => c.id === draftData.customerId);
        if (customer) {
          setSelectedCustomer(customer);
        }
      }
      
      form.reset({
        customerId: draftData.customerId,
        customerName: draftData.customerName,
        propertyAddress: draftData.propertyAddress,
        workDate: draftData.workDate,
        technicianName: draftData.technicianName,
        workDescription: draftData.workDescription,
        totalHours: draftData.totalHours,
        laborRate: draftData.laborRate,
        notes: draftData.notes || "",
        items: [],
      });
      
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
  }, [draftData, form, append, remove, fields, isFieldTech, customers]);

  // Load temporary data on mount (crash recovery)
  useEffect(() => {
    if (currentUser?.id && !draftData) {
      const tempDataKey = `billing-temp-${currentUser.id}`;
      const tempDataStr = localStorage.getItem(tempDataKey);
      
      if (tempDataStr) {
        try {
          const tempData = JSON.parse(tempDataStr);
          // Check if temp data is recent (within 24 hours)
          const isRecent = tempData.timestamp && (Date.now() - tempData.timestamp) < 24 * 60 * 60 * 1000;
          
          if (isRecent && tempData.customerId) {
            // Show recovery dialog or auto-restore
            console.log("Found recent temporary data, could restore:", tempData);
            // For now, just clear old temp data - could add recovery dialog later
            localStorage.removeItem(tempDataKey);
          }
        } catch (error) {
          console.warn("Failed to parse temporary data:", error);
          localStorage.removeItem(tempDataKey);
        }
      }
    }
  }, [currentUser?.id, draftData]);



  const handleCustomerSelect = (customer: Customer) => {
    setSelectedCustomer(customer);
    form.setValue("customerId", customer.id);
    form.setValue("customerName", customer.name);
    form.setValue("propertyAddress", customer.address || "");
    form.setValue("laborRate", parseFloat(customer.laborRate || "45"));
  };

  // Track part usage when parts are added
  const trackPartUsageMutation = useMutation({
    mutationFn: async (partId: number) => {
      return fetch(`/api/parts/${partId}/track-usage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
    },
  });

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
    
    // Track part usage for analytics
    if (part.id) {
      trackPartUsageMutation.mutate(part.id);
    }
    
    // Auto-save to localStorage when parts are added
    if (selectedCustomer) {
      setTimeout(() => autoSaveToLocalStorage(), 500); // Delay to ensure form state is updated
    }
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
    
    // Don't auto-save on manual item creation - wait for user to fill it out
    // Auto-save will trigger when they start entering meaningful content
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

  // Format currency helper
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
  };

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
    
    // Check for specific validation issues
    if (!data.customerId || data.customerId === 0) {
      toast({
        title: "Validation Error",
        description: "Please select a customer",
        variant: "destructive",
      });
      return;
    }
    
    if (!data.workDescription?.trim()) {
      toast({
        title: "Validation Error", 
        description: "Please enter a work description",
        variant: "destructive",
      });
      return;
    }
    
    if (!data.totalHours || data.totalHours <= 0) {
      toast({
        title: "Validation Error",
        description: "Please enter total hours worked",
        variant: "destructive",
      });
      return;
    }
    
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

  // Auto-save to localStorage (temporary storage, not database)
  const autoSaveToLocalStorage = () => {
    if (!selectedCustomer || !currentUser) return;

    try {
      const formData = form.getValues();
      const tempData = {
        ...formData,
        customerId: selectedCustomer.id,
        customerName: selectedCustomer.name,
        propertyAddress: selectedCustomer.address || "",
        photos: photos.map(p => p.url),
        technicianId: currentUser.id,
        timestamp: Date.now()
      };

      localStorage.setItem(`billing-temp-${currentUser.id}`, JSON.stringify(tempData));
    } catch (error) {
      console.warn("Auto-save to localStorage failed:", error);
    }
  };

  // Clear temporary localStorage data
  const clearTempData = () => {
    if (currentUser?.id) {
      localStorage.removeItem(`billing-temp-${currentUser.id}`);
    }
  };

  // Auto-save when meaningful content is added (but not immediately on customer selection)
  useEffect(() => {
    const subscription = form.watch((value, { name }) => {
      // Only auto-save when there's substantial content, not just customer selection
      if (selectedCustomer && name && [
        'workDescription', 
        'totalHours', 
        'technicianName',
        'workDate'
      ].includes(name)) {
        const formData = form.getValues();
        // Only auto-save if there's actual work content beyond just customer selection
        const hasSubstantialContent = formData.workDescription.trim().length > 10 || 
                                    formData.totalHours > 0 || 
                                    formData.items.length > 0;
        
        if (hasSubstantialContent) {
          const timeoutId = setTimeout(() => {
            autoSaveToLocalStorage();
          }, 2000); // 2 second delay for localStorage auto-save

          return () => clearTimeout(timeoutId);
        }
      }
    });

    return () => subscription.unsubscribe();
  }, [form, selectedCustomer]);

  // Save temporary data before browser/tab close (crash recovery)
  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (hasFormData() && selectedCustomer) {
        autoSaveToLocalStorage();
        // Show browser confirmation dialog
        event.preventDefault();
        event.returnValue = '';
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasFormData, selectedCustomer]);

  // Handle cancel button click
  const handleCancel = () => {
    if (hasFormData()) {
      setShowCancelDialog(true);
    } else {
      clearTempData(); // Clear temporary data if no form data
      handleOpenChange(false);
    }
  };

  // Save as draft to database and close
  const handleSaveAsDraft = async () => {
    try {
      clearTempData(); // Clear temporary data since we're saving to database
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
      clearTempData(); // Clear temporary data when closing
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
                {/* Improved Parts Selection Interface */}
                <div className="space-y-4">

                  {/* Hide search when parts sections are available, they have their own search */}
                  {!popularParts || popularParts.length === 0 && (
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                      <Input
                        placeholder="Search parts by name..."
                        value={partsSearchQuery}
                        onChange={(e) => setPartsSearchQuery(e.target.value)}
                        className="pl-10"
                      />
                    </div>
                  )}

                  {/* Frequently Used Parts Section - Collapsible */}
                  {!partsSearchQuery && popularParts && popularParts.length > 0 && (
                    <div className="border rounded-lg bg-white mb-4">
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
                          {popularParts.slice(0, 6).map((part) => {
                            const isAlreadyUsed = fields.some(field => field.partId === part.id);
                            
                            return (
                              <button
                                key={part.id}
                                onClick={() => addPart(part, 1)}
                                className="flex items-center gap-3 p-3 border border-gray-200 rounded-lg hover:border-blue-300 hover:bg-blue-50 transition-all text-left group"
                              >
                                <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center group-hover:bg-blue-200">
                                  <Package className="w-4 h-4 text-blue-600" />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="text-sm font-medium text-gray-900 truncate">{part.name}</div>
                                  <div className="text-xs text-gray-500">Used {part.usageCount} times</div>
                                  {!isFieldTech && (
                                    <div className="text-xs text-green-600">{formatCurrency(parseFloat(part.price))}</div>
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
                        {/* Search Bar - only show when expanded */}
                        <div className="relative">
                          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                          <Input
                            placeholder="Search parts by name..."
                            value={partsSearchQuery}
                            onChange={(e) => setPartsSearchQuery(e.target.value)}
                            className="pl-10"
                          />
                        </div>
                    
                    <div className="max-h-48 overflow-y-auto">
                      {filteredParts?.length > 0 ? (
                        <div className="divide-y">
                          {filteredParts.map((part) => {
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
                                    size="sm"
                                    onClick={() => addPart(part, 1)}
                                    className="bg-blue-600 hover:bg-blue-700 text-white h-8 w-8 p-0"
                                    title="Add part"
                                  >
                                    <Plus className="w-4 h-4" />
                                  </Button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : partsSearchQuery ? (
                        <div className="p-6 text-center text-gray-500">
                          <p>No parts found matching "{partsSearchQuery}"</p>
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
                        </div>
                      ) : (
                        <div className="p-6 text-center text-gray-500">
                          <p>Start typing to search for parts</p>
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
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {fields.length === 0 ? (
                  <div className="text-center py-8 border-2 border-dashed border-gray-200 rounded-lg">
                    <Package className="w-12 h-12 text-gray-400 mx-auto mb-3" />
                    <p className="text-gray-500 text-sm">No items added yet</p>
                    <p className="text-gray-400 text-xs mt-1">Use the buttons above to add parts and materials</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {fields.map((field, index) => (
                      <Card key={field.id} className="border-l-4 border-l-blue-500 shadow-sm">
                        <CardContent className="p-4">
                          {/* Mobile-first responsive layout */}
                          <div className="space-y-4">
                            {/* Item header with name and remove button */}
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex-1">
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

                            {/* Description field - read-only */}
                            {form.watch(`items.${index}.partDescription`) && (
                              <div>
                                <label className="text-sm text-gray-600 block mb-1">Description</label>
                                <div className="text-sm text-gray-800 p-2 bg-gray-50 rounded border">
                                  {form.watch(`items.${index}.partDescription`)}
                                </div>
                              </div>
                            )}

                            {/* Quantity section with better mobile controls */}
                            <div className="bg-gray-50 rounded-lg p-3">
                              <FormField
                                control={form.control}
                                name={`items.${index}.quantity`}
                                render={({ field }) => (
                                  <FormItem>
                                    <FormLabel className="text-sm font-medium flex items-center gap-2">
                                      <span>Quantity</span>
                                    </FormLabel>
                                    <FormControl>
                                      <div className="flex items-center justify-center gap-3 mt-2">
                                        <Button
                                          type="button"
                                          variant="outline"
                                          size="sm"
                                          className="h-9 w-9 rounded-full"
                                          onClick={() => {
                                            const currentValue = parseFloat(field.value) || 0;
                                            if (currentValue > 0) {
                                              field.onChange(Math.max(0, currentValue - 1));
                                            }
                                          }}
                                        >
                                          -
                                        </Button>
                                        <div className="flex-1 max-w-24">
                                          <Input 
                                            {...field} 
                                            type="number" 
                                            step="0.01" 
                                            min="0"
                                            className="text-center text-lg font-semibold h-9 bg-white" 
                                          />
                                        </div>
                                        <Button
                                          type="button"
                                          variant="outline"
                                          size="sm"
                                          className="h-9 w-9 rounded-full"
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
                            
                            {/* Pricing section - hidden for field techs */}
                            {!isFieldTech && (
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-3 bg-blue-50 rounded-lg">
                                <FormField
                                  control={form.control}
                                  name={`items.${index}.unitPrice`}
                                  render={({ field }) => (
                                    <FormItem>
                                      <FormLabel className="text-sm font-medium">Unit Price ($)</FormLabel>
                                      <FormControl>
                                        <Input 
                                          {...field} 
                                          type="number" 
                                          step="0.01" 
                                          placeholder="0.00"
                                          className="text-sm font-mono"
                                        />
                                      </FormControl>
                                      <FormMessage />
                                    </FormItem>
                                  )}
                                />
                                
                                <FormField
                                  control={form.control}
                                  name={`items.${index}.laborHours`}
                                  render={({ field }) => (
                                    <FormItem>
                                      <FormLabel className="text-sm font-medium">Labor Hours</FormLabel>
                                      <FormControl>
                                        <Input 
                                          {...field} 
                                          type="number" 
                                          step="0.25" 
                                          placeholder="0.00"
                                          className="text-sm font-mono"
                                        />
                                      </FormControl>
                                      <FormMessage />
                                    </FormItem>
                                  )}
                                />
                              </div>
                            )}
                            
                            {/* Item total - hidden for field techs */}
                            {!isFieldTech && (
                              <div className="border-t pt-3">
                                <div className="flex justify-between items-center">
                                  <span className="text-sm text-gray-600">Item Total:</span>
                                  <span className="text-lg font-semibold text-green-600">
                                    ${(form.watch(`items.${index}.quantity`) * form.watch(`items.${index}.unitPrice`)).toFixed(2)}
                                  </span>
                                </div>
                              </div>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Labor Hours - Visible to all users */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base sm:text-lg flex items-center gap-2">
                  <Timer className="w-4 h-4 sm:w-5 sm:h-5 text-blue-600" />
                  Labor Hours
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="totalHours"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Total Hours Worked *</FormLabel>
                        <FormControl>
                          <Input 
                            {...field} 
                            type="number" 
                            step="0.25" 
                            min="0.01"
                            placeholder="e.g., 2.5" 
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* Labor Rate - hidden from field techs */}
                  {!isFieldTech && (
                    <FormField
                      control={form.control}
                      name="laborRate"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Labor Rate ($/hour)</FormLabel>
                          <FormControl>
                            <Input 
                              {...field} 
                              type="number" 
                              step="0.01"
                              min="0"
                              placeholder="e.g., 45.00"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}
                </div>
              </CardContent>
            </Card>

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
                  type="button"
                  onClick={() => {
                    console.log('Final submit button clicked!');
                    const formData = form.getValues();
                    createBillingSheetMutation.mutate(formData);
                  }}
                  disabled={createBillingSheetMutation.isPending}
                  className="bg-green-600 hover:bg-green-700 w-full sm:w-auto"
                >
                  <Check className="w-4 h-4 mr-2" />
                  {createBillingSheetMutation.isPending ? "Submitting..." : "Submit Billing Sheet"}
                </Button>
              </>
            ) : (
              <Button
                type="button"
                onClick={() => {
                  const formData = form.getValues();
                  
                  // Validate manually first
                  if (!formData.customerId || formData.customerId === 0) {
                    toast({
                      title: "Validation Error",
                      description: "Please select a customer",
                      variant: "destructive",
                    });
                    return;
                  }
                  
                  if (!formData.workDescription?.trim()) {
                    toast({
                      title: "Validation Error", 
                      description: "Please enter a work description",
                      variant: "destructive",
                    });
                    return;
                  }
                  
                  if (!formData.totalHours || formData.totalHours <= 0) {
                    toast({
                      title: "Validation Error",
                      description: "Please enter total hours worked",
                      variant: "destructive",
                    });
                    return;
                  }
                  
                  setShowReview(true);
                }}
                disabled={createBillingSheetMutation.isPending}
                className="bg-blue-600 hover:bg-blue-700 w-full sm:w-auto"
              >
                <Save className="w-4 h-4 mr-2" />
                {createBillingSheetMutation.isPending ? "Creating..." : "Review & Submit"}
              </Button>
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