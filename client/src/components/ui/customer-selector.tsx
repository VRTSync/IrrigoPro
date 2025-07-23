import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, Plus, User, Building, Mail, Phone, MapPin, FileText } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { insertCustomerSchema } from "@shared/schema";
import type { Customer } from "@shared/schema";

const newCustomerSchema = insertCustomerSchema.extend({
  laborRate: z.string().optional(),
  markupPercent: z.string().optional(),
  taxPercent: z.string().optional(),
  discountPercent: z.string().optional(),
});

type NewCustomerFormData = z.infer<typeof newCustomerSchema>;

interface CustomerSelectorProps {
  selectedCustomer?: Customer | null;
  onSelectCustomer: (customer: Customer) => void;
  placeholder?: string;
  className?: string;
}

export function CustomerSelector({ 
  selectedCustomer, 
  onSelectCustomer, 
  placeholder = "Search and select a customer...",
  className = ""
}: CustomerSelectorProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [showNewCustomerDialog, setShowNewCustomerDialog] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: customers, isLoading } = useQuery<Customer[]>({
    queryKey: ["/api/customers"],
  });

  const filteredCustomers = customers?.filter(customer =>
    customer.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    customer.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
    customer.address?.toLowerCase().includes(searchQuery.toLowerCase())
  ) || [];

  const form = useForm<NewCustomerFormData>({
    resolver: zodResolver(newCustomerSchema),
    defaultValues: {
      name: "",
      email: "",
      phone: "",
      address: "",
      contractType: "standard",
      laborRate: "45.00",
      markupPercent: "20.00",
      taxPercent: "8.25",
      discountPercent: "0.00",
      paymentTerms: "net_30",
      notes: "",
    },
  });

  const createCustomer = useMutation({
    mutationFn: async (data: NewCustomerFormData) => {
      return await apiRequest("/api/customers", "POST", data);
    },
    onSuccess: (newCustomer) => {
      toast({
        title: "Customer Created",
        description: `${newCustomer.name} has been added successfully.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/customers"] });
      onSelectCustomer(newCustomer);
      setShowNewCustomerDialog(false);
      form.reset();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create customer",
        variant: "destructive",
      });
    },
  });

  const handleCreateCustomer = (data: NewCustomerFormData) => {
    createCustomer.mutate(data);
  };

  const handleSelectCustomer = (customer: Customer) => {
    onSelectCustomer(customer);
    setIsOpen(false);
    setSearchQuery("");
  };

  if (isLoading) {
    return (
      <div className={`space-y-2 ${className}`}>
        <Label>Customer</Label>
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  return (
    <>
      <div className={`space-y-2 ${className}`}>
        <Label>Customer *</Label>
        
        {selectedCustomer ? (
          <Card className="border-2 border-blue-200 bg-blue-50/30 w-full">
            <CardContent className="p-3 sm:p-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="flex items-start space-x-3 min-w-0 flex-1">
                  <div className="bg-blue-100 p-2 rounded-lg flex-shrink-0">
                    <Building className="w-4 h-4 text-blue-600" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h4 className="font-medium text-gray-900 truncate">{selectedCustomer.name}</h4>
                    <div className="flex flex-col sm:flex-row sm:items-center sm:space-x-4 space-y-1 sm:space-y-0 text-sm text-gray-600 mt-1">
                      <span className="flex items-center min-w-0">
                        <Mail className="w-3 h-3 mr-1 flex-shrink-0" />
                        <span className="truncate">{selectedCustomer.email}</span>
                      </span>
                      {selectedCustomer.phone && (
                        <span className="flex items-center">
                          <Phone className="w-3 h-3 mr-1 flex-shrink-0" />
                          <span className="truncate">{selectedCustomer.phone}</span>
                        </span>
                      )}
                    </div>
                    {selectedCustomer.address && (
                      <div className="flex items-center text-sm text-gray-600 mt-1">
                        <MapPin className="w-3 h-3 mr-1 flex-shrink-0" />
                        <span className="truncate">{selectedCustomer.address}</span>
                      </div>
                    )}
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsOpen(true)}
                  className="flex-shrink-0 w-full sm:w-auto"
                >
                  Change
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Button
            variant="outline"
            onClick={() => setIsOpen(true)}
            className="w-full justify-start text-gray-500 h-10"
          >
            <Search className="w-4 h-4 mr-2" />
            {placeholder}
          </Button>
        )}
      </div>

      {/* Customer Selection Dialog */}
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <User className="w-5 h-5 text-blue-600" />
              Select Customer
            </DialogTitle>
            <DialogDescription>
              Choose an existing customer or create a new one
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
              <Input
                placeholder="Search customers by name, email, or address..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>

            {/* Create New Customer Button */}
            <Button
              onClick={() => setShowNewCustomerDialog(true)}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white"
            >
              <Plus className="w-4 h-4 mr-2" />
              Create New Customer
            </Button>

            {/* Customer List */}
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {filteredCustomers.length === 0 ? (
                <div className="text-center py-8">
                  <Building className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-gray-900 mb-2">No customers found</h3>
                  <p className="text-gray-600">
                    {searchQuery ? "No customers match your search." : "No customers available."}
                  </p>
                </div>
              ) : (
                filteredCustomers.map((customer) => (
                  <Card
                    key={customer.id}
                    className="cursor-pointer hover:bg-blue-50 hover:border-blue-200 transition-colors"
                    onClick={() => handleSelectCustomer(customer)}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-center space-x-3">
                        <div className="bg-gray-100 p-2 rounded-lg">
                          <Building className="w-4 h-4 text-gray-600" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <h4 className="font-medium text-gray-900 truncate">{customer.name}</h4>
                          <div className="flex items-center space-x-4 text-sm text-gray-600 mt-1">
                            <span className="flex items-center">
                              <Mail className="w-3 h-3 mr-1" />
                              {customer.email}
                            </span>
                            {customer.phone && (
                              <span className="flex items-center">
                                <Phone className="w-3 h-3 mr-1" />
                                {customer.phone}
                              </span>
                            )}
                          </div>
                          {customer.address && (
                            <div className="flex items-center text-sm text-gray-600 mt-1">
                              <MapPin className="w-3 h-3 mr-1" />
                              <span className="truncate">{customer.address || ""}</span>
                            </div>
                          )}
                          <div className="flex items-center space-x-2 mt-2">
                            <Badge variant="outline" className="text-xs">
                              {customer.contractType || "standard"}
                            </Badge>
                            <Badge variant="outline" className="text-xs">
                              ${customer.laborRate || "45.00"}/hr
                            </Badge>
                            <Badge variant="outline" className="text-xs">
                              {customer.markupPercent || "20"}% markup
                            </Badge>
                            <Badge variant="outline" className="text-xs">
                              {customer.taxPercent || "8.25"}% tax
                            </Badge>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* New Customer Dialog */}
      <Dialog open={showNewCustomerDialog} onOpenChange={setShowNewCustomerDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="w-5 h-5 text-blue-600" />
              Create New Customer
            </DialogTitle>
            <DialogDescription>
              Add a new customer to your database
            </DialogDescription>
          </DialogHeader>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(handleCreateCustomer)} className="space-y-6">
              {/* Basic Information */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Company/Name *</FormLabel>
                      <FormControl>
                        <Input placeholder="Johnson Family" {...field} />
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
                      <FormLabel>Email *</FormLabel>
                      <FormControl>
                        <Input type="email" placeholder="johnson@example.com" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="phone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Phone</FormLabel>
                      <FormControl>
                        <Input placeholder="(555) 123-4567" {...field} value={field.value || ""} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

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
              </div>

              <FormField
                control={form.control}
                name="address"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Address</FormLabel>
                    <FormControl>
                      <Input placeholder="123 Oak Street, Springfield, IL 62701" {...field} value={field.value || ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Contract Details */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="laborRate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Labor Rate ($/hour)</FormLabel>
                      <FormControl>
                        <Input type="number" step="0.01" placeholder="45.00" {...field} />
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
                        <Input type="number" step="0.01" placeholder="20.00" {...field} />
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
                        <Input type="number" step="0.01" placeholder="8.25" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

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
                          <SelectItem value="due_on_receipt">Due on Receipt</SelectItem>
                          <SelectItem value="net_15">Net 15</SelectItem>
                          <SelectItem value="net_30">Net 30</SelectItem>
                        </SelectContent>
                      </Select>
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
                        placeholder="Additional notes about the customer..." 
                        className="min-h-[80px]"
                        {...field} 
                        value={field.value || ""}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex gap-4 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowNewCustomerDialog(false)}
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={createCustomer.isPending}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
                >
                  {createCustomer.isPending ? "Creating..." : "Create Customer"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </>
  );
}