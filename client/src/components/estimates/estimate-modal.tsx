import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { CustomerSelector } from "@/components/ui/customer-selector";
import { LocationFields } from "@/components/location/location-fields";
import { Plus, Trash2, ArrowUp, ArrowDown, User, FileText, Image, Paperclip } from "lucide-react";
import { PartsSearchModal } from "./parts-search-modal";
import { EstimateSummary } from "./estimate-summary";
import { FileUpload, type UploadedFile } from "@/components/ui/file-upload";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { Part, Customer, EstimateWithItems, EstimateItem } from "@shared/schema";

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
});

type EstimateFormValues = z.infer<typeof estimateFormSchema>;

interface EstimateLineItem {
  rowId: string;
  partId: number;
  partName: string;
  partPrice: number;
  quantity: number;
  laborHours: number;
  description: string;
}

interface EstimateModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  estimateId?: number | null;
}

export function EstimateModal({ open, onOpenChange, estimateId }: EstimateModalProps) {
  const isEdit = !!estimateId;
  const [items, setItems] = useState<EstimateLineItem[]>([]);
  const [showPartsModal, setShowPartsModal] = useState(false);
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
    },
  });

  const { data: existingEstimate } = useQuery<EstimateWithItems>({
    queryKey: ["/api/estimates", estimateId],
    enabled: isEdit && open,
  });

  useEffect(() => {
    if (isEdit && existingEstimate && open) {
      form.reset({
        customerId: existingEstimate.customerId ?? 0,
        customerName: existingEstimate.customerName ?? "",
        customerEmail: existingEstimate.customerEmail ?? "",
        customerPhone: existingEstimate.customerPhone ?? "",
        projectName: existingEstimate.projectName ?? "",
        projectAddress: existingEstimate.projectAddress ?? "",
        locationNotes: existingEstimate.locationNotes ?? "",
        accessInstructions: existingEstimate.accessInstructions ?? "",
        estimateDate: existingEstimate.estimateDate
          ? new Date(existingEstimate.estimateDate).toISOString().split('T')[0]
          : new Date().toISOString().split('T')[0],
        createdBy: existingEstimate.createdBy ?? "Irrigation Manager",
        laborRate: parseFloat(existingEstimate.laborRate ?? "45"),
      });
      const loaded: EstimateLineItem[] = (existingEstimate.items ?? []).map((it: EstimateItem, idx: number) => {
        const qty = Math.max(Number(it.quantity ?? 1), 1);
        // Stored laborHours is the per-line total; the editor shows per-unit hours.
        return {
          rowId: `${idx}-${it.id}`,
          partId: it.partId,
          partName: it.partName,
          partPrice: parseFloat(String(it.partPrice ?? "0")),
          quantity: Number(it.quantity ?? 1),
          laborHours: parseFloat(String(it.laborHours ?? "0")) / qty,
          description: it.description ?? "",
        };
      });
      setItems(loaded);
      const urlToFile = (url: string): UploadedFile => {
        const fileName = url.split("/").pop() || url;
        return { url, fileName, originalName: fileName };
      };
      setPhotos((existingEstimate.photos ?? []).map(urlToFile));
      setAttachments((existingEstimate.attachments ?? []).map(urlToFile));
      if (existingEstimate.customerId) {
        setSelectedCustomer({
          id: existingEstimate.customerId,
          name: existingEstimate.customerName,
          email: existingEstimate.customerEmail,
          phone: existingEstimate.customerPhone,
          address: existingEstimate.projectAddress,
        } as Customer);
      }
    }
  }, [isEdit, existingEstimate, open]);

  const handleCustomerSelect = (customer: Customer) => {
    setSelectedCustomer(customer);
    form.setValue("customerId", customer.id);
    form.setValue("customerName", customer.name);
    form.setValue("customerEmail", customer.email);
    form.setValue("customerPhone", customer.phone || "");
    if (customer.address) {
      form.setValue("projectAddress", customer.address);
    }
    const safeParseFloat = (value: string | null | undefined, defaultValue: string): number => {
      if (value === null || value === undefined || value === "") return parseFloat(defaultValue);
      return parseFloat(value);
    };
    form.setValue("laborRate", safeParseFloat(customer.laborRate, "45"));
    form.clearErrors("customerName");
    form.clearErrors("customerEmail");
    form.clearErrors("projectAddress");
  };

  const addPart = (part: Part & { laborHours?: string }, quantity: number = 1) => {
    setItems((prev) => [
      ...prev,
      {
        rowId: `${Date.now()}-${Math.random()}`,
        partId: part.id,
        partName: part.name,
        partPrice: parseFloat(part.price) || 0,
        quantity,
        laborHours: parseFloat(part.laborHours || "0") || 0,
        description: "",
      },
    ]);
  };

  const updateItem = (rowId: string, updates: Partial<EstimateLineItem>) => {
    setItems((prev) => prev.map((it) => (it.rowId === rowId ? { ...it, ...updates } : it)));
  };

  const removeItem = (rowId: string) => {
    setItems((prev) => prev.filter((it) => it.rowId !== rowId));
  };

  const moveItem = (rowId: string, direction: -1 | 1) => {
    setItems((prev) => {
      const idx = prev.findIndex((it) => it.rowId === rowId);
      if (idx < 0) return prev;
      const newIdx = idx + direction;
      if (newIdx < 0 || newIdx >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[newIdx]] = [next[newIdx], next[idx]];
      return next;
    });
  };

  const calculateTotals = () => {
    const partsSubtotal = items.reduce((sum, it) => sum + it.partPrice * it.quantity, 0);
    const totalLaborHours = items.reduce((sum, it) => sum + it.laborHours * it.quantity, 0);
    const laborRate = Number(form.getValues("laborRate")) || 0;
    const laborSubtotal = totalLaborHours * laborRate;
    return {
      partsSubtotal,
      laborSubtotal,
      totalAmount: partsSubtotal + laborSubtotal,
      totalLaborHours,
    };
  };

  const saveMutation = useMutation({
    mutationFn: async (data: { estimate: any; items: any[] }) => {
      if (isEdit) {
        return await apiRequest(`/api/estimates/${estimateId}`, "PUT", data);
      }
      return await apiRequest("/api/estimates", "POST", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/estimates"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      if (isEdit && estimateId) {
        queryClient.invalidateQueries({ queryKey: ["/api/estimates", estimateId] });
      }
      toast({
        title: "Success",
        description: isEdit ? "Estimate updated successfully" : "Estimate created successfully",
      });
      onOpenChange(false);
      form.reset();
      setItems([]);
      setSelectedCustomer(null);
      setPhotos([]);
      setAttachments([]);
    },
    onError: () => {
      toast({
        title: "Error",
        description: isEdit ? "Failed to update estimate" : "Failed to create estimate",
        variant: "destructive",
      });
    },
  });

  const onSubmit = async (data: EstimateFormValues) => {
    if (!selectedCustomer && !isEdit) {
      toast({ title: "Customer Required", description: "Please select a customer.", variant: "destructive" });
      return;
    }
    if (items.length === 0) {
      toast({ title: "Error", description: "Add at least one line item to the estimate", variant: "destructive" });
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
      status: existingEstimate?.status ?? "pending",
      partsSubtotal: totals.partsSubtotal.toFixed(2),
      laborSubtotal: totals.laborSubtotal.toFixed(2),
      totalAmount: totals.totalAmount.toFixed(2),
      laborRate: data.laborRate.toFixed(2),
      photos: photos.map((p) => p.url),
      attachments: attachments.map((a) => a.url),
    };

    const itemsPayload = items.map((it, index) => ({
      partId: it.partId,
      partName: it.partName,
      partPrice: it.partPrice.toFixed(2),
      quantity: it.quantity,
      laborHours: (it.laborHours * it.quantity).toFixed(2),
      totalPrice: (it.partPrice * it.quantity).toFixed(2),
      description: it.description,
      sortOrder: index,
    }));

    saveMutation.mutate({ estimate, items: itemsPayload });
  };

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);

  const summaryItems = items.map((it) => ({
    part: { id: it.partId ?? 0, name: it.partName, price: it.partPrice.toString() } as Part,
    quantity: it.quantity,
    totalPrice: it.partPrice * it.quantity,
    totalLaborHours: it.laborHours * it.quantity,
  }));

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="w-[95vw] max-w-[95vw] sm:max-w-2xl md:max-w-4xl lg:max-w-6xl max-h-[95vh] overflow-y-auto p-2 sm:p-4 md:p-6">
          <DialogHeader className="pb-4">
            <DialogTitle className="flex items-center gap-2 text-lg sm:text-xl">
              <FileText className="w-5 h-5 sm:w-6 sm:h-6 text-blue-600" />
              {isEdit ? `Edit Estimate #${estimateId}` : "Create New Estimate"}
            </DialogTitle>
            <DialogDescription className="text-sm sm:text-base">
              {isEdit
                ? "Update customer, project info, and line items."
                : "Create a new estimate by selecting a customer and adding line items."}
            </DialogDescription>
          </DialogHeader>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 sm:space-y-6 w-full">
              {/* Customer */}
              <Card>
                <CardHeader className="pb-3 sm:pb-6">
                  <CardTitle className="text-base sm:text-lg flex items-center gap-2">
                    <User className="w-4 h-4 sm:w-5 sm:h-5 text-blue-600" />
                    Customer
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 sm:space-y-4">
                  {!isEdit && (
                    <CustomerSelector
                      selectedCustomer={selectedCustomer}
                      onSelectCustomer={handleCustomerSelect}
                      placeholder="Search and select a customer..."
                    />
                  )}
                  {(selectedCustomer || isEdit) && (
                    <div className="grid grid-cols-1 gap-3 sm:gap-4">
                      <FormField
                        control={form.control}
                        name="customerName"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-sm">Customer Name</FormLabel>
                            <FormControl><Input {...field} readOnly className="bg-gray-50 text-sm" /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="customerEmail"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-sm">Email</FormLabel>
                            <FormControl><Input {...field} readOnly className="bg-gray-50 text-sm" /></FormControl>
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
                            <FormControl><Input {...field} readOnly className="bg-gray-50 text-sm" value={field.value || ""} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Project Info */}
              <Card>
                <CardHeader className="pb-3 sm:pb-6">
                  <CardTitle className="text-base sm:text-lg">Project Information</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 sm:space-y-4">
                  <FormField
                    control={form.control}
                    name="projectName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Project Name *</FormLabel>
                        <FormControl><Input {...field} placeholder="e.g., Backyard Irrigation System" /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Separator />
                  <LocationFields control={form.control} readOnlyAddress={!!selectedCustomer} />
                </CardContent>
              </Card>

              {/* Line Items */}
              <Card>
                <CardHeader className="pb-3 sm:pb-6">
                  <CardTitle className="text-base sm:text-lg">Line Items</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex flex-col sm:flex-row gap-2">
                    <Button type="button" onClick={() => setShowPartsModal(true)} className="bg-primary text-white hover:bg-blue-700" size="sm">
                      <Plus className="w-4 h-4 mr-2" />
                      Add Part From Catalog
                    </Button>
                  </div>

                  {items.length === 0 ? (
                    <div className="bg-gray-50 rounded-lg p-8 text-center">
                      <p className="text-gray-500">No line items yet. Add a part from the catalog to get started.</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {items.map((it, idx) => (
                        <div key={it.rowId} className="border rounded-lg p-3 bg-gray-50 space-y-2">
                          <div className="flex items-start gap-2">
                            <div className="flex flex-col gap-1">
                              <Button type="button" size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => moveItem(it.rowId, -1)} disabled={idx === 0}>
                                <ArrowUp className="w-3 h-3" />
                              </Button>
                              <Button type="button" size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => moveItem(it.rowId, 1)} disabled={idx === items.length - 1}>
                                <ArrowDown className="w-3 h-3" />
                              </Button>
                            </div>
                            <div className="flex-1 grid grid-cols-1 sm:grid-cols-12 gap-2">
                              <div className="sm:col-span-4 flex items-center text-sm font-medium text-gray-900 break-words" data-testid={`item-name-${it.rowId}`}>
                                {it.partName}
                              </div>
                              <Input
                                className="sm:col-span-2"
                                type="number"
                                min="0"
                                step="1"
                                placeholder="Qty"
                                value={it.quantity}
                                onChange={(e) => updateItem(it.rowId, { quantity: parseInt(e.target.value) || 0 })}
                              />
                              <Input
                                className="sm:col-span-2 bg-gray-100"
                                type="number"
                                placeholder="Unit $"
                                value={it.partPrice}
                                readOnly
                                title="Unit price comes from the catalog and is read-only"
                              />
                              <Input
                                className="sm:col-span-2"
                                type="number"
                                min="0"
                                step="0.01"
                                placeholder="Labor h"
                                value={it.laborHours}
                                onChange={(e) => updateItem(it.rowId, { laborHours: parseFloat(e.target.value) || 0 })}
                              />
                              <div className="sm:col-span-2 flex items-center justify-end font-medium">
                                {formatCurrency(it.partPrice * it.quantity)}
                              </div>
                              <Input
                                className="sm:col-span-12"
                                placeholder="Description (optional)"
                                value={it.description}
                                onChange={(e) => updateItem(it.rowId, { description: e.target.value })}
                              />
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              onClick={() => removeItem(it.rowId)}
                              className="text-red-600 hover:text-red-700 w-9 h-9 p-0 flex-shrink-0"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Photos & Attachments */}
              <Card>
                <CardHeader className="pb-3 sm:pb-6">
                  <CardTitle className="text-base sm:text-lg flex items-center gap-2">
                    <Image className="w-4 h-4 sm:w-5 sm:h-5 text-blue-600" />
                    Photos & Attachments
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 sm:space-y-6">
                  <div>
                    <h4 className="font-medium text-gray-900 mb-3 flex items-center gap-2">
                      <Image className="w-4 h-4" />
                      Site Photos
                    </h4>
                    <FileUpload type="photo" label="Photos" accept="image/*" multiple files={photos} onFilesChange={setPhotos} />
                  </div>
                  <div>
                    <h4 className="font-medium text-gray-900 mb-3 flex items-center gap-2">
                      <Paperclip className="w-4 h-4" />
                      Attachments
                    </h4>
                    <FileUpload type="attachment" label="Attachments" accept="*/*" multiple files={attachments} onFilesChange={setAttachments} />
                  </div>
                </CardContent>
              </Card>

              {/* Summary */}
              <Card>
                <CardHeader className="pb-3 sm:pb-6">
                  <CardTitle className="text-base sm:text-lg">Estimate Summary</CardTitle>
                </CardHeader>
                <CardContent>
                  <EstimateSummary items={summaryItems} laborRate={form.watch("laborRate")} />
                </CardContent>
              </Card>

              <Separator />
              <div className="flex flex-col sm:flex-row gap-3 pt-4">
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)} className="w-full sm:flex-1">
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={saveMutation.isPending}
                  className="w-full sm:flex-1 bg-primary text-white hover:bg-blue-700"
                >
                  {saveMutation.isPending
                    ? (isEdit ? "Saving..." : "Creating...")
                    : (isEdit ? "Save Changes" : "Create Estimate")}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <PartsSearchModal open={showPartsModal} onOpenChange={setShowPartsModal} onSelectPart={addPart} />
    </>
  );
}
