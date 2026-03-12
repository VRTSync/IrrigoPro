import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { BillingSheet } from "@shared/schema";

const editBillingSheetSchema = z.object({
  workDescription: z.string().min(1, "Work description is required"),
  workDate: z.string().min(1, "Work date is required"),
  totalHours: z.string().min(1, "Total hours is required"),
  laborRate: z.string().min(1, "Labor rate is required"),
  propertyAddress: z.string().optional(),
  notes: z.string().optional(),
});

type EditBillingSheetFormData = z.infer<typeof editBillingSheetSchema>;

interface EditBillingSheetModalProps {
  billingSheet: BillingSheet;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function EditBillingSheetModal({ billingSheet, open, onClose, onSuccess }: EditBillingSheetModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

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
      const partsSubtotal = parseFloat(billingSheet.partsSubtotal?.toString() || "0");
      const totalAmount = laborSubtotal + partsSubtotal;

      const submitData: Record<string, string | number | null> = {
        workDescription: data.workDescription,
        workDate: data.workDate,
        totalHours: data.totalHours,
        laborRate: data.laborRate,
        laborSubtotal: laborSubtotal.toFixed(2),
        totalAmount: totalAmount.toFixed(2),
        propertyAddress: data.propertyAddress || "",
        notes: data.notes || "",
      };
      return apiRequest(`/api/billing-sheets/${billingSheet.id}`, "PATCH", submitData);
    },
    onSuccess: () => {
      toast({
        title: "Billing Sheet Updated",
        description: "Billing sheet has been updated successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/billing-sheets"] });
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
