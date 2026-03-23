import { safeGet } from "@/utils/safeStorage";
import { useState, useEffect, useRef } from "react";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CalendarIcon, DollarSign, Percent, FileText, Tag, Plus, X, Building2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { insertCustomerSchema } from "@shared/schema";
import type { Customer, User } from "@shared/schema";

const customerFormSchema = insertCustomerSchema.extend({
  companyId: z.number().min(1, "Company ID is required"),
  irrigoName: z.string().optional(),
  totalControllers: z.coerce.number().min(1, "Must have at least 1 controller").max(10, "Maximum 10 controllers").default(1),
  contractType: z.enum(["standard", "premium", "commercial", "residential"]).default("standard"),
  laborRate: z.string().regex(/^\d+(\.\d{1,2})?$/, "Must be a valid number").default("45.00"),
  emergencyLaborRate: z.string().regex(/^\d+(\.\d{1,2})?$/, "Must be a valid number").default("125.00"),
  taxPercent: z.string().regex(/^\d+(\.\d{1,2})?$/, "Must be a valid number").default("0.00"),
  discountPercent: z.string().regex(/^\d+(\.\d{1,2})?$/, "Must be a valid number").default("0.00"),
  paymentTerms: z.enum(["net_30", "net_15", "due_on_receipt"]).default("net_30"),
  contractStartDate: z.string().optional(),
  contractEndDate: z.string().optional(),
  notes: z.string().optional(),
  branches: z.array(z.string()).optional(),
});

type CustomerFormData = z.infer<typeof customerFormSchema>;

const CONTRACT_TYPES = ["standard", "premium", "commercial", "residential"] as const;
type ContractType = typeof CONTRACT_TYPES[number];
function toContractType(value: string | null | undefined): ContractType {
  if (value && (CONTRACT_TYPES as readonly string[]).includes(value)) {
    return value as ContractType;
  }
  return "standard";
}

const PAYMENT_TERMS = ["net_30", "net_15", "due_on_receipt"] as const;
type PaymentTerms = typeof PAYMENT_TERMS[number];
function toPaymentTerms(value: string | null | undefined): PaymentTerms {
  if (value && (PAYMENT_TERMS as readonly string[]).includes(value)) {
    return value as PaymentTerms;
  }
  return "net_30";
}

function customerToFormValues(customer: Customer): CustomerFormData {
  return {
    name: customer.name,
    irrigoName: customer.irrigoName || customer.name,
    email: customer.email,
    phone: customer.phone || "",
    address: customer.address || "",
    companyId: customer.companyId,
    totalControllers: customer.totalControllers || 1,
    contractType: toContractType(customer.contractType),
    laborRate: customer.laborRate || "45.00",
    emergencyLaborRate: customer.emergencyLaborRate || "125.00",
    taxPercent: customer.taxPercent || "0.00",
    discountPercent: customer.discountPercent || "0.00",
    paymentTerms: toPaymentTerms(customer.paymentTerms),
    contractStartDate: customer.contractStartDate ? new Date(customer.contractStartDate).toISOString().split('T')[0] : "",
    contractEndDate: customer.contractEndDate ? new Date(customer.contractEndDate).toISOString().split('T')[0] : "",
    notes: customer.notes || "",
    branches: (customer as any).branches || [],
  };
}

interface CustomerFormProps {
  customer?: Customer;
  trigger: React.ReactNode;
}

export function CustomerForm({ customer, trigger }: CustomerFormProps) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  // Tracks form values saved in the most recent successful mutation so the
  // open-trigger reset does not overwrite them before the query refetches.
  const justSavedValues = useRef<CustomerFormData | null>(null);

  // Get user from localStorage (production-compatible)
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isLoadingUser, setIsLoadingUser] = useState(true);
  
  useEffect(() => {
    const savedUser = safeGet("user");
    if (savedUser) {
      try {
        setCurrentUser(JSON.parse(savedUser));
      } catch (error) {
        console.error("Error parsing user data:", error);
      }
    }
    setIsLoadingUser(false);
  }, []);

  const companyId = currentUser?.companyId;

  const [newBranchInput, setNewBranchInput] = useState("");

  const form = useForm<CustomerFormData>({
    resolver: zodResolver(customerFormSchema),
    defaultValues: customer ? customerToFormValues(customer) : {
      name: "",
      irrigoName: "",
      email: "",
      phone: "",
      address: "",
      companyId: companyId || currentUser?.companyId || 3,
      totalControllers: 1,
      contractType: "standard",
      laborRate: "45.00",
      emergencyLaborRate: "125.00",
      taxPercent: "0.00",
      discountPercent: "0.00",
      paymentTerms: "net_30",
      contractStartDate: "",
      contractEndDate: "",
      notes: "",
      branches: [],
    },
  });

  // Re-initialize form with latest customer data whenever the dialog opens.
  // If we just saved, use the saved values (the query refetch may not have
  // completed yet), then clear the ref so subsequent opens use fresh server data.
  useEffect(() => {
    if (open && customer) {
      if (justSavedValues.current) {
        form.reset(justSavedValues.current);
        justSavedValues.current = null;
      } else {
        form.reset(customerToFormValues(customer));
      }
    }
  }, [open, customer, form]);

  // Update companyId when user data loads
  useEffect(() => {
    if (companyId && !customer) {
      form.setValue('companyId', companyId);
    }
  }, [companyId, customer, form]);

  // For new customers: auto-fill irrigoName from name as the user types (only while irrigoName is still blank)
  const watchedName = form.watch("name");
  const watchedIrrigoName = form.watch("irrigoName");
  useEffect(() => {
    if (!customer && (!watchedIrrigoName || watchedIrrigoName === "")) {
      form.setValue("irrigoName", watchedName);
    }
  }, [watchedName, customer, form]);

  const mutation = useMutation({
    mutationFn: async (data: CustomerFormData) => {
      const endpoint = customer ? `/api/customers/${customer.id}` : "/api/customers";
      const method = customer ? "PUT" : "POST";
      
      return apiRequest(endpoint, method, {
        ...data,
        contractStartDate: data.contractStartDate ? new Date(data.contractStartDate).toISOString() : null,
        contractEndDate: data.contractEndDate ? new Date(data.contractEndDate).toISOString() : null,
      });
    },
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/customers"] });
      justSavedValues.current = variables;
      form.reset(variables);
      setOpen(false);
      toast({
        title: customer ? "Customer Updated" : "Customer Created",
        description: customer ? "Customer information has been updated successfully." : "New customer has been added to your database.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to save customer",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: CustomerFormData) => {
    // Ensure companyId is set for new customers
    const submissionData = {
      ...data,
      companyId: companyId || currentUser?.companyId
    };
    
    if (!submissionData.companyId || submissionData.companyId < 1) {
      toast({
        title: "Error",
        description: "Unable to determine company. Please refresh and try again.",
        variant: "destructive",
      });
      return;
    }
    
    mutation.mutate({
      ...submissionData,
      companyId: submissionData.companyId as number
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger}
      </DialogTrigger>
      <DialogContent className="w-[95vw] max-w-4xl h-[95vh] max-h-[95vh] overflow-y-auto p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle>
            {customer ? "Edit Customer" : "Add New Customer"}
          </DialogTitle>
        </DialogHeader>

        {isLoadingUser ? (
          <div className="flex items-center justify-center p-8">
            <div className="text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
              <p className="mt-2 text-sm text-gray-600">Loading user data...</p>
            </div>
          </div>
        ) : (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            {/* Basic Information */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Basic Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* IrrigoPro Display Name — prominently styled */}
                <div className="rounded-xl border-2 border-emerald-400 bg-emerald-50 p-4 shadow-sm">
                  <FormField
                    control={form.control}
                    name="irrigoName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="flex items-center gap-2 text-emerald-800 font-semibold text-base">
                          <Tag className="w-4 h-4 text-emerald-600" />
                          IrrigoPro Display Name
                          <Badge className="bg-emerald-600 text-white text-xs px-2 py-0.5 ml-1">Irrigo Facing</Badge>
                        </FormLabel>
                        <FormControl>
                          <Input
                            placeholder="Enter the name your team will see (e.g. property name)"
                            className="border-emerald-300 focus:border-emerald-500 focus:ring-emerald-500 bg-white text-base font-medium"
                            {...field}
                            value={field.value || ""}
                          />
                        </FormControl>
                        <p className="text-xs text-emerald-700 mt-1">
                          This is what all IrrigoPro users see — use the property name or nickname your team knows this customer by.
                        </p>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Official Customer Name</FormLabel>
                        <FormControl>
                          <Input placeholder="Enter official/QuickBooks customer name" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email Address</FormLabel>
                        <FormControl>
                          <Input type="email" placeholder="Enter email address" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="phone"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Phone Number</FormLabel>
                        <FormControl>
                          <Input placeholder="Enter phone number" {...field} value={field.value || ""} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="address"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Address</FormLabel>
                        <FormControl>
                          <Input placeholder="Enter address" {...field} value={field.value || ""} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="totalControllers"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Number of Controllers</FormLabel>
                        <FormControl>
                          <Select onValueChange={(value) => field.onChange(parseInt(value))} value={field.value?.toString()}>
                            <SelectTrigger>
                              <SelectValue placeholder="Select number of controllers" />
                            </SelectTrigger>
                            <SelectContent>
                              {Array.from({ length: 10 }, (_, i) => (
                                <SelectItem key={i + 1} value={(i + 1).toString()}>
                                  {i + 1} Controller{i + 1 > 1 ? 's' : ''}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </CardContent>
            </Card>

            {/* Contract Information */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center">
                  <FileText className="w-5 h-5 mr-2" />
                  Contract Information
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <FormField
                    control={form.control}
                    name="contractType"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Contract Type</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select contract type" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="standard">Standard</SelectItem>
                            <SelectItem value="premium">Premium</SelectItem>
                            <SelectItem value="commercial">Commercial</SelectItem>
                            <SelectItem value="residential">Residential</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="contractStartDate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Contract Start Date</FormLabel>
                        <FormControl>
                          <Input type="date" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="contractEndDate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Contract End Date</FormLabel>
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
                  name="paymentTerms"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Payment Terms</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select payment terms" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="net_30">Net 30 Days</SelectItem>
                          <SelectItem value="net_15">Net 15 Days</SelectItem>
                          <SelectItem value="due_on_receipt">Due on Receipt</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            {/* Billing Rates */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center">
                  <DollarSign className="w-5 h-5 mr-2" />
                  Billing Rates
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="laborRate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Labor Rate (per hour)</FormLabel>
                        <FormControl>
                          <div className="relative">
                            <DollarSign className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                            <Input placeholder="45.00" {...field} className="pl-10" />
                          </div>
                        </FormControl>
                        <FormDescription>
                          Hourly rate for labor charges
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="emergencyLaborRate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Emergency Labor Rate (per hour)</FormLabel>
                        <FormControl>
                          <div className="relative">
                            <DollarSign className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                            <Input placeholder="125.00" {...field} className="pl-10" />
                          </div>
                        </FormControl>
                        <FormDescription>
                          Hourly rate for emergency labor calls
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <FormField
                    control={form.control}
                    name="taxPercent"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Tax Percentage</FormLabel>
                        <FormControl>
                          <div className="relative">
                            <Percent className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                            <Input placeholder="8.25" {...field} className="pl-10" />
                          </div>
                        </FormControl>
                        <FormDescription>
                          Sales tax percentage
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="discountPercent"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Discount Percentage</FormLabel>
                        <FormControl>
                          <div className="relative">
                            <Percent className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                            <Input placeholder="0.00" {...field} className="pl-10" />
                          </div>
                        </FormControl>
                        <FormDescription>
                          Default discount for this customer
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </CardContent>
            </Card>

            {/* Branch Management */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center">
                  <Building2 className="w-5 h-5 mr-2" />
                  Branch Locations
                </CardTitle>
              </CardHeader>
              <CardContent>
                <FormField
                  control={form.control}
                  name="branches"
                  render={({ field }) => {
                    const branches = field.value || [];
                    const addBranch = () => {
                      const trimmed = newBranchInput.trim();
                      if (!trimmed || branches.includes(trimmed)) return;
                      field.onChange([...branches, trimmed]);
                      setNewBranchInput("");
                    };
                    const removeBranch = (index: number) => {
                      field.onChange(branches.filter((_, i) => i !== index));
                    };
                    return (
                      <FormItem>
                        <p className="text-sm text-gray-500 mb-3">
                          Add branch names for customers with multiple locations (e.g. a bank with multiple branches). When branches are defined, a required "Branch" dropdown will appear on billing sheets and work orders for this customer.
                        </p>
                        <div className="space-y-2">
                          {branches.map((branch, index) => (
                            <div key={index} className="flex items-center gap-2">
                              <span className="flex-1 text-sm bg-blue-50 border border-blue-200 rounded-md px-3 py-1.5 text-blue-900">
                                {branch}
                              </span>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => removeBranch(index)}
                                className="text-red-500 hover:text-red-700 h-8 w-8 p-0"
                              >
                                <X className="w-4 h-4" />
                              </Button>
                            </div>
                          ))}
                          <div className="flex gap-2 mt-2">
                            <Input
                              placeholder="Enter branch name..."
                              value={newBranchInput}
                              onChange={(e) => setNewBranchInput(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  addBranch();
                                }
                              }}
                              className="flex-1"
                            />
                            <Button
                              type="button"
                              variant="outline"
                              onClick={addBranch}
                              disabled={!newBranchInput.trim()}
                              className="gap-1"
                            >
                              <Plus className="w-4 h-4" />
                              Add
                            </Button>
                          </div>
                        </div>
                        <FormMessage />
                      </FormItem>
                    );
                  }}
                />
              </CardContent>
            </Card>

            {/* Notes */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Notes</CardTitle>
              </CardHeader>
              <CardContent>
                <FormField
                  control={form.control}
                  name="notes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Additional Notes</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="Enter any additional notes about this customer..."
                          className="min-h-[100px]"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            <div className="flex justify-end space-x-4">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button 
                type="submit" 
                disabled={mutation.isPending}
              >
                {mutation.isPending ? "Saving..." : customer ? "Update Customer" : "Create Customer"}
              </Button>
            </div>
          </form>
        </Form>
        )}
      </DialogContent>
    </Dialog>
  );
}