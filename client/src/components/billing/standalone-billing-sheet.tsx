import { useState } from "react";
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
  Clock
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
  propertyAddress: z.string().min(1, "Property address is required"),
  workDate: z.string().min(1, "Work date is required"),
  technicianName: z.string().min(1, "Technician name is required"),
  workDescription: z.string().min(1, "Work description is required"),
  totalHours: z.coerce.number().min(0.1, "Total hours must be greater than 0"),
  laborRate: z.coerce.number().min(0, "Labor rate must be positive"),
  notes: z.string().optional(),
  items: z.array(billingItemSchema).min(1, "At least one item is required"),
});

type BillingSheetData = z.infer<typeof billingSheetSchema>;
type BillingItem = z.infer<typeof billingItemSchema>;

interface StandaloneBillingSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function StandaloneBillingSheet({ open, onOpenChange }: StandaloneBillingSheetProps) {
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [showPartsModal, setShowPartsModal] = useState(false);
  const [photos, setPhotos] = useState<UploadedFile[]>([]);
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
      customerId: 0,
      customerName: "",
      propertyAddress: "",
      workDate: new Date().toISOString().split('T')[0],
      technicianName: isFieldTech ? currentUser?.name || "" : "",
      workDescription: "",
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
    const laborRate = form.watch("laborRate");
    const totalHours = form.watch("totalHours");
    
    const partsSubtotal = items.reduce((sum, item) => 
      sum + (item.quantity * item.unitPrice), 0
    );
    
    const laborSubtotal = totalHours * laborRate;
    const subtotal = partsSubtotal + laborSubtotal;
    
    // Use customer's contract rates if available
    const markupPercent = selectedCustomer?.markupPercent ? parseFloat(selectedCustomer.markupPercent) : 20;
    const taxPercent = selectedCustomer?.taxPercent ? parseFloat(selectedCustomer.taxPercent) : 8.25;
    
    const markupAmount = subtotal * (markupPercent / 100);
    const taxAmount = (subtotal + markupAmount) * (taxPercent / 100);
    const totalAmount = subtotal + markupAmount + taxAmount;

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
      };
      return await apiRequest("/api/billing-sheets", "POST", billingSheetData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/billing-sheets"] });
      toast({
        title: "Success",
        description: "Billing sheet created successfully",
      });
      onOpenChange(false);
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
    form.reset();
    setSelectedCustomer(null);
    setPhotos([]);
  };

  const onSubmit = async (data: BillingSheetData) => {
    await createBillingSheetMutation.mutateAsync(data);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[95vh] overflow-y-auto p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle>Create Billing Sheet</DialogTitle>
          <DialogDescription>
            Create a billing sheet for work performed without a work order
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            {/* Customer & Location */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <User className="w-5 h-5" />
                  Customer & Location
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
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
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="w-5 h-5" />
                  Work Details
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
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
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Package className="w-5 h-5" />
                  Parts & Materials Used
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex gap-2">
                  <Button
                    type="button"
                    onClick={() => setShowPartsModal(true)}
                    variant="outline"
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    Add from Catalog
                  </Button>
                  <Button
                    type="button"
                    onClick={addManualItem}
                    variant="outline"
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    Add Manual Item
                  </Button>
                </div>

                {fields.length === 0 ? (
                  <p className="text-gray-500 text-center py-4">No items added yet</p>
                ) : (
                  <div className="space-y-4">
                    {fields.map((field, index) => (
                      <Card key={field.id} className="border-l-4 border-l-blue-500">
                        <CardContent className="pt-4">
                          <div className={`grid gap-4 items-end ${isFieldTech ? 'grid-cols-4' : 'grid-cols-6'}`}>
                            <div className="col-span-2">
                              <FormField
                                control={form.control}
                                name={`items.${index}.partName`}
                                render={({ field }) => (
                                  <FormItem>
                                    <FormLabel>Item Name</FormLabel>
                                    <FormControl>
                                      <Input {...field} placeholder="Part/Material name" />
                                    </FormControl>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />
                            </div>
                            
                            <FormField
                              control={form.control}
                              name={`items.${index}.quantity`}
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>Quantity</FormLabel>
                                  <FormControl>
                                    <Input {...field} type="number" step="0.01" />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                            
                            {/* Hide pricing for field techs */}
                            {!isFieldTech && (
                              <FormField
                                control={form.control}
                                name={`items.${index}.unitPrice`}
                                render={({ field }) => (
                                  <FormItem>
                                    <FormLabel>Unit Price</FormLabel>
                                    <FormControl>
                                      <Input {...field} type="number" step="0.01" />
                                    </FormControl>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />
                            )}
                            
                            {!isFieldTech && (
                              <FormField
                                control={form.control}
                                name={`items.${index}.laborHours`}
                                render={({ field }) => (
                                  <FormItem>
                                    <FormLabel>Labor Hours</FormLabel>
                                    <FormControl>
                                      <Input {...field} type="number" step="0.25" />
                                    </FormControl>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />
                            )}
                            
                            <Button
                              type="button"
                              variant="destructive"
                              size="sm"
                              onClick={() => remove(index)}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
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

            {/* Labor Hours - Field techs enter this last */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Timer className="w-5 h-5" />
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

            {/* Additional Notes */}
            <Card>
              <CardHeader>
                <CardTitle>Additional Notes</CardTitle>
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
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Calculator className="w-5 h-5" />
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
                disabled={createBillingSheetMutation.isPending}
                className="bg-blue-600 hover:bg-blue-700"
              >
                <Save className="w-4 h-4 mr-2" />
                {createBillingSheetMutation.isPending ? "Creating..." : "Create Billing Sheet"}
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