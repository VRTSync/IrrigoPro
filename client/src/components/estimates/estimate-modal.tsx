import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Plus, Trash2, Search } from "lucide-react";
import { PartsSearchModal } from "./parts-search-modal";
import { EstimateSummary } from "./estimate-summary";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { Part } from "@shared/schema";

const estimateFormSchema = z.object({
  customerName: z.string().min(1, "Customer name is required"),
  customerEmail: z.string().email("Valid email is required"),
  customerPhone: z.string().optional(),
  projectName: z.string().min(1, "Project name is required"),
  projectAddress: z.string().optional(),
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

interface EstimateModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EstimateModal({ open, onOpenChange }: EstimateModalProps) {
  const [items, setItems] = useState<EstimateItem[]>([]);
  const [showPartsModal, setShowPartsModal] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const form = useForm<EstimateFormValues>({
    resolver: zodResolver(estimateFormSchema),
    defaultValues: {
      customerName: "",
      customerEmail: "",
      customerPhone: "",
      projectName: "",
      projectAddress: "",
      laborRate: 75,
      markupPercent: 20,
      taxPercent: 8.25,
    },
  });

  const createEstimateMutation = useMutation({
    mutationFn: async (data: { estimate: any; items: any[] }) => {
      const response = await apiRequest("POST", "/api/estimates", data);
      return response.json();
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
      setItems([]);
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: "Failed to create estimate",
        variant: "destructive",
      });
    },
  });

  const addPart = (part: Part, quantity: number = 1) => {
    const existingIndex = items.findIndex(item => item.part.id === part.id);
    
    if (existingIndex >= 0) {
      const updatedItems = [...items];
      updatedItems[existingIndex].quantity += quantity;
      updatedItems[existingIndex].totalPrice = parseFloat(part.price) * updatedItems[existingIndex].quantity;
      updatedItems[existingIndex].totalLaborHours = parseFloat(part.laborHours) * updatedItems[existingIndex].quantity;
      setItems(updatedItems);
    } else {
      const newItem: EstimateItem = {
        part,
        quantity,
        totalPrice: parseFloat(part.price) * quantity,
        totalLaborHours: parseFloat(part.laborHours) * quantity,
      };
      setItems([...items, newItem]);
    }
  };

  const updateQuantity = (partId: number, quantity: number) => {
    const updatedItems = items.map(item => {
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
    
    setItems(updatedItems);
  };

  const removePart = (partId: number) => {
    setItems(items.filter(item => item.part.id !== partId));
  };

  const calculateTotals = () => {
    const partsSubtotal = items.reduce((sum, item) => sum + item.totalPrice, 0);
    const totalLaborHours = items.reduce((sum, item) => sum + item.totalLaborHours, 0);
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
    if (items.length === 0) {
      toast({
        title: "Error",
        description: "Please add at least one part to the estimate",
        variant: "destructive",
      });
      return;
    }

    const totals = calculateTotals();
    
    const estimate = {
      customerName: data.customerName,
      customerEmail: data.customerEmail,
      customerPhone: data.customerPhone || "",
      projectName: data.projectName,
      projectAddress: data.projectAddress || "",
      status: "pending",
      partsSubtotal: totals.partsSubtotal.toFixed(2),
      laborSubtotal: totals.laborSubtotal.toFixed(2),
      markupAmount: totals.markupAmount.toFixed(2),
      taxAmount: totals.taxAmount.toFixed(2),
      totalAmount: totals.totalAmount.toFixed(2),
      laborRate: data.laborRate.toFixed(2),
      markupPercent: data.markupPercent.toFixed(2),
      taxPercent: data.taxPercent.toFixed(2),
    };

    const estimateItems = items.map(item => ({
      partId: item.part.id,
      partName: item.part.name,
      partPrice: item.part.price,
      quantity: item.quantity,
      laborHours: item.totalLaborHours.toFixed(2),
      totalPrice: item.totalPrice.toFixed(2),
    }));

    createEstimateMutation.mutate({ estimate, items: estimateItems });
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
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create New Estimate</DialogTitle>
          </DialogHeader>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              {/* Customer Information */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="customerName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Customer Name</FormLabel>
                      <FormControl>
                        <Input placeholder="Enter customer name" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="projectName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Project Name</FormLabel>
                      <FormControl>
                        <Input placeholder="Enter project name" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="customerEmail"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email Address</FormLabel>
                      <FormControl>
                        <Input type="email" placeholder="customer@example.com" {...field} />
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
                      <FormLabel>Phone Number</FormLabel>
                      <FormControl>
                        <Input type="tel" placeholder="(555) 123-4567" {...field} />
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
                      <Textarea placeholder="Enter full project address" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Parts Section */}
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-medium text-gray-900">Parts & Materials</h3>
                  <Button
                    type="button"
                    onClick={() => setShowPartsModal(true)}
                    className="bg-primary text-white hover:bg-blue-700"
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    Add Part
                  </Button>
                </div>

                {items.length > 0 ? (
                  <div className="bg-gray-50 rounded-lg p-4">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-gray-200">
                            <th className="text-left py-2">Part Name</th>
                            <th className="text-left py-2">Unit Price</th>
                            <th className="text-left py-2">Quantity</th>
                            <th className="text-left py-2">Labor Hours</th>
                            <th className="text-left py-2">Total</th>
                            <th className="text-left py-2">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {items.map((item) => (
                            <tr key={item.part.id} className="border-b border-gray-200">
                              <td className="py-2">{item.part.name}</td>
                              <td className="py-2">{formatCurrency(parseFloat(item.part.price))}</td>
                              <td className="py-2">
                                <Input
                                  type="number"
                                  min="1"
                                  value={item.quantity}
                                  onChange={(e) => updateQuantity(item.part.id, parseInt(e.target.value) || 0)}
                                  className="w-16 text-center"
                                />
                              </td>
                              <td className="py-2">{item.totalLaborHours.toFixed(2)}</td>
                              <td className="py-2 font-medium">{formatCurrency(item.totalPrice)}</td>
                              <td className="py-2">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => removePart(item.part.id)}
                                  className="text-red-600 hover:text-red-700"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : (
                  <div className="bg-gray-50 rounded-lg p-8 text-center">
                    <p className="text-gray-500">No parts added yet. Click "Add Part" to get started.</p>
                  </div>
                )}
              </div>

              {/* Labor Configuration */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <FormField
                  control={form.control}
                  name="laborRate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Labor Rate ($/hour)</FormLabel>
                      <FormControl>
                        <Input type="number" step="0.01" min="0" {...field} />
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
                        <Input type="number" step="0.01" min="0" {...field} />
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
                        <Input type="number" step="0.01" min="0" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Estimate Summary */}
              <EstimateSummary
                items={items}
                laborRate={form.watch("laborRate")}
                markupPercent={form.watch("markupPercent")}
                taxPercent={form.watch("taxPercent")}
              />

              {/* Action Buttons */}
              <Separator />
              <div className="flex flex-col sm:flex-row gap-3 pt-4">
                <Button
                  type="submit"
                  disabled={createEstimateMutation.isPending}
                  className="flex-1 bg-primary text-white hover:bg-blue-700"
                >
                  {createEstimateMutation.isPending ? "Creating..." : "Create Estimate"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  className="flex-1"
                >
                  Cancel
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
