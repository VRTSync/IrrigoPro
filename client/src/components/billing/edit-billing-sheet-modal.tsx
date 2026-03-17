import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Trash2, Plus } from "lucide-react";
import type { BillingSheet, BillingSheetItem } from "@shared/schema";

const editBillingSheetSchema = z.object({
  workDescription: z.string().min(1, "Work description is required"),
  workDate: z.string().min(1, "Work date is required"),
  totalHours: z.string().min(1, "Total hours is required"),
  laborRate: z.string().min(1, "Labor rate is required"),
  propertyAddress: z.string().optional(),
  notes: z.string().optional(),
});

type EditBillingSheetFormData = z.infer<typeof editBillingSheetSchema>;

interface PartRow {
  partName: string;
  quantity: string;
  unitPrice: string;
  laborHours: string;
}

interface EditBillingSheetModalProps {
  billingSheet: BillingSheet;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function EditBillingSheetModal({ billingSheet, open, onClose, onSuccess }: EditBillingSheetModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [parts, setParts] = useState<PartRow[]>([]);
  const [partsLoaded, setPartsLoaded] = useState(false);

  const { data: existingItems } = useQuery<BillingSheetItem[]>({
    queryKey: ["/api/billing-sheets", billingSheet.id, "items"],
    queryFn: async () => {
      const res = await fetch(`/api/billing-sheets/${billingSheet.id}/items`);
      if (!res.ok) throw new Error("Failed to fetch items");
      return res.json();
    },
    enabled: open && !partsLoaded,
  });

  useEffect(() => {
    if (existingItems && !partsLoaded) {
      setParts(existingItems.map(item => ({
        partName: item.partName,
        quantity: String(item.quantity),
        unitPrice: String(item.unitPrice),
        laborHours: String(item.laborHours),
      })));
      setPartsLoaded(true);
    }
  }, [existingItems, partsLoaded]);

  const formatDateForInput = (date: string | Date | null | undefined): string => {
    if (!date) return "";
    const d = new Date(date);
    if (isNaN(d.getTime())) return "";
    return d.toISOString().slice(0, 10);
  };

  const form = useForm<EditBillingSheetFormData>({
    resolver: zodResolver(editBillingSheetSchema),
    defaultValues: {
      workDescription: billingSheet.workDescription || "",
      workDate: formatDateForInput(billingSheet.workDate),
      totalHours: billingSheet.totalHours?.toString() || "0",
      laborRate: billingSheet.laborRate?.toString() || "0",
      propertyAddress: billingSheet.propertyAddress || "",
      notes: billingSheet.notes || "",
    },
  });

  const updateBillingSheet = useMutation({
    mutationFn: async (data: EditBillingSheetFormData) => {
      const hours = parseFloat(data.totalHours) || 0;
      const rate = parseFloat(data.laborRate) || 0;
      const laborSubtotal = hours * rate;
      const partsSubtotal = parts.reduce((sum, p) => sum + (Number(p.quantity) || 0) * (Number(p.unitPrice) || 0), 0);
      const totalAmount = laborSubtotal + partsSubtotal;

      const submitData: Record<string, unknown> = {
        workDescription: data.workDescription,
        workDate: data.workDate,
        totalHours: data.totalHours,
        laborRate: data.laborRate,
        laborSubtotal: laborSubtotal.toFixed(2),
        partsSubtotal: partsSubtotal.toFixed(2),
        totalAmount: totalAmount.toFixed(2),
        propertyAddress: data.propertyAddress || "",
        notes: data.notes || "",
        items: parts
          .filter(p => p.partName.trim())
          .map(p => ({
            partName: p.partName,
            quantity: Number(p.quantity) || 0,
            unitPrice: Number(p.unitPrice) || 0,
            laborHours: Number(p.laborHours) || 0,
          })),
      };
      return apiRequest(`/api/billing-sheets/${billingSheet.id}`, "PATCH", submitData);
    },
    onSuccess: () => {
      toast({
        title: "Billing Sheet Updated",
        description: "Billing sheet has been updated successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/billing-sheets"] });
      queryClient.invalidateQueries({ queryKey: ["/api/billing-sheets", billingSheet.id, "items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/customers/billing-preview"] });
      queryClient.invalidateQueries({ queryKey: ["/api/customers"] });
      onSuccess();
      onClose();
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update billing sheet",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: EditBillingSheetFormData) => {
    updateBillingSheet.mutate(data);
  };

  const addPart = () => {
    setParts(prev => [...prev, { partName: "", quantity: "1", unitPrice: "0", laborHours: "0" }]);
  };

  const removePart = (index: number) => {
    setParts(prev => prev.filter((_, i) => i !== index));
  };

  const updatePart = (index: number, field: keyof PartRow, value: string) => {
    setParts(prev => prev.map((p, i) => i === index ? { ...p, [field]: value } : p));
  };

  const partsTotal = parts.reduce((sum, p) => {
    return sum + (Number(p.quantity) || 0) * (Number(p.unitPrice) || 0);
  }, 0);

  const watchedHours = form.watch("totalHours");
  const watchedRate = form.watch("laborRate");
  const laborSubtotal = (parseFloat(watchedHours) || 0) * (parseFloat(watchedRate) || 0);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="w-screen h-screen sm:w-[95vw] sm:max-w-3xl sm:h-auto sm:max-h-[90vh] sm:rounded-lg overflow-hidden p-0 flex flex-col">
        <DialogHeader className="p-4 sm:p-6 border-b border-gray-200 flex-shrink-0">
          <DialogTitle className="text-lg sm:text-xl">Edit Billing Sheet</DialogTitle>
          <DialogDescription>
            Update billing sheet details for {billingSheet.billingNumber}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
              <FormField
                control={form.control}
                name="workDescription"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Work Description *</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Describe the work performed..."
                        className="min-h-[80px]"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="propertyAddress"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Property Address</FormLabel>
                    <FormControl>
                      <Input placeholder="Enter property address" {...field} value={field.value || ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <FormField
                  control={form.control}
                  name="workDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Work Date *</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="totalHours"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Total Hours *</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.25"
                          min="0"
                          placeholder="0"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="laborRate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Labor Rate ($/hr) *</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          placeholder="0.00"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Notes</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Additional notes..."
                        className="min-h-[60px]"
                        {...field}
                        value={field.value || ""}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-gray-700">Parts / Materials</h3>
                  <Button type="button" variant="outline" size="sm" onClick={addPart} className="gap-1">
                    <Plus className="h-4 w-4" />
                    Add Part
                  </Button>
                </div>

                {parts.length > 0 && (
                  <div className="border rounded-lg overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="text-left px-3 py-2 font-medium text-gray-600">Part Name</th>
                          <th className="text-left px-3 py-2 font-medium text-gray-600 w-20">Qty</th>
                          <th className="text-left px-3 py-2 font-medium text-gray-600 w-28">Unit Price</th>
                          <th className="text-left px-3 py-2 font-medium text-gray-600 w-24">Labor Hrs</th>
                          <th className="text-right px-3 py-2 font-medium text-gray-600 w-24">Total</th>
                          <th className="w-10"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {parts.map((part, index) => {
                          const lineTotal = (Number(part.quantity) || 0) * (Number(part.unitPrice) || 0);
                          return (
                            <tr key={index} className="bg-white">
                              <td className="px-3 py-2">
                                <Input
                                  value={part.partName}
                                  onChange={e => updatePart(index, "partName", e.target.value)}
                                  placeholder="Part name"
                                  className="h-8 text-sm"
                                />
                              </td>
                              <td className="px-3 py-2">
                                <Input
                                  type="number"
                                  min="0"
                                  step="1"
                                  value={part.quantity}
                                  onChange={e => updatePart(index, "quantity", e.target.value)}
                                  className="h-8 text-sm"
                                />
                              </td>
                              <td className="px-3 py-2">
                                <Input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={part.unitPrice}
                                  onChange={e => updatePart(index, "unitPrice", e.target.value)}
                                  placeholder="0.00"
                                  className="h-8 text-sm"
                                />
                              </td>
                              <td className="px-3 py-2">
                                <Input
                                  type="number"
                                  min="0"
                                  step="0.25"
                                  value={part.laborHours}
                                  onChange={e => updatePart(index, "laborHours", e.target.value)}
                                  placeholder="0"
                                  className="h-8 text-sm"
                                />
                              </td>
                              <td className="px-3 py-2 text-right text-gray-700 font-medium">
                                ${lineTotal.toFixed(2)}
                              </td>
                              <td className="px-2 py-2">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => removePart(index)}
                                  className="h-8 w-8 p-0 text-red-500 hover:text-red-700 hover:bg-red-50"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot className="bg-gray-50 border-t">
                        <tr>
                          <td colSpan={4} className="px-3 py-2 text-right text-sm font-semibold text-gray-700">Parts Total:</td>
                          <td className="px-3 py-2 text-right text-sm font-bold text-gray-900">${partsTotal.toFixed(2)}</td>
                          <td></td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}

                {parts.length === 0 && (
                  <p className="text-sm text-gray-400 italic">No parts added. Click "Add Part" to add materials used.</p>
                )}
              </div>

              <div className="bg-gray-50 rounded-lg p-4 space-y-1 text-sm">
                <div className="flex justify-between text-gray-600">
                  <span>Labor ({watchedHours || 0} hrs × ${watchedRate || 0}/hr)</span>
                  <span>${laborSubtotal.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-gray-600">
                  <span>Parts</span>
                  <span>${partsTotal.toFixed(2)}</span>
                </div>
                <div className="flex justify-between font-semibold text-gray-900 border-t pt-1 mt-1">
                  <span>Total</span>
                  <span>${(laborSubtotal + partsTotal).toFixed(2)}</span>
                </div>
              </div>

              <div className="flex gap-3 pt-4 border-t">
                <Button
                  type="button"
                  variant="outline"
                  onClick={onClose}
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={updateBillingSheet.isPending}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
                >
                  {updateBillingSheet.isPending ? "Saving..." : "Save Changes"}
                </Button>
              </div>
            </form>
          </Form>
        </div>
      </DialogContent>
    </Dialog>
  );
}
