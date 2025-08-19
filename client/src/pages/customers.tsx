import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Users, Search, Edit, Trash2, Phone, Mail, Settings, Eye } from "lucide-react";
import { useState, useEffect } from "react";
import type { Customer } from "@shared/schema";
import { CustomerIntegration } from "@/components/integrations/customer-integration";
import { CustomerForm } from "@/components/customer-form";
import { CustomerProfile } from "@/components/customers/customer-profile";
import { CustomerSiteMaps } from "@/components/customers/customer-site-maps";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export default function Customers() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [showSiteMaps, setShowSiteMaps] = useState<Customer | null>(null);
  const [userRole, setUserRole] = useState<string>("company_admin");
  
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Get user role from localStorage
  useEffect(() => {
    const savedUser = localStorage.getItem("user");
    if (savedUser) {
      try {
        const userData = JSON.parse(savedUser);
        setUserRole(userData.role);
      } catch (error) {
        console.error("Error parsing user data:", error);
      }
    }
  }, []);

  const { data: customers, isLoading } = useQuery<Customer[]>({
    queryKey: ["/api/customers"],
  });

  // Delete customer mutation
  const deleteCustomerMutation = useMutation({
    mutationFn: async (customerId: number) => {
      return await apiRequest(`/api/customers/${customerId}`, "DELETE");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/customers"] });
      toast({
        title: "Success",
        description: "Customer deleted successfully",
      });
    },
    onError: (error) => {
      console.error("Delete customer error:", error);
      toast({
        title: "Error",
        description: "Failed to delete customer. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleDeleteCustomer = (customerId: number) => {
    deleteCustomerMutation.mutate(customerId);
  };

  // Check for auto-selection from site maps page
  useEffect(() => {
    const selectedCustomerId = localStorage.getItem('selectedCustomerId');
    const shouldShowSiteMaps = localStorage.getItem('showSiteMaps') === 'true';
    
    if (selectedCustomerId && customers) {
      const customer = customers.find(c => c.id.toString() === selectedCustomerId);
      if (customer) {
        if (shouldShowSiteMaps) {
          setShowSiteMaps(customer);
        } else {
          setSelectedCustomer(customer);
        }
        // Clear the stored values after using them
        localStorage.removeItem('selectedCustomerId');
        localStorage.removeItem('showSiteMaps');
        localStorage.removeItem('selectedSiteMapId');
      }
    }
  }, [customers]);

  const filteredCustomers = customers?.filter(customer =>
    customer.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    customer.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
    customer.phone?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Show site maps if selected for field tech
  if (showSiteMaps) {
    return (
      <CustomerSiteMaps 
        customer={showSiteMaps} 
        onBack={() => setShowSiteMaps(null)}
        userRole={userRole}
      />
    );
  }

  // Show customer profile if selected (non-field tech users)
  if (selectedCustomer) {
    return (
      <CustomerProfile 
        customer={selectedCustomer} 
        onBack={() => setSelectedCustomer(null)}
        userRole={userRole}
      />
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-2 sm:px-4 lg:px-8 py-4 lg:py-6">
      {/* Header */}
      <div className="mb-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Customers</h1>
            <p className="text-gray-600 mt-1">Manage your customer database</p>
          </div>
          {(userRole === 'company_admin' || userRole === 'super_admin') && (
            <div className="mt-4 sm:mt-0">
              <CustomerForm
                trigger={
                  <Button className="bg-primary text-white hover:bg-blue-700">
                    <Plus className="w-4 h-4 mr-2" />
                    Add New Customer
                  </Button>
                }
              />
            </div>
          )}
        </div>
      </div>

      <Tabs defaultValue="customers" className="w-full">
        <TabsList className={(userRole === 'company_admin' || userRole === 'super_admin') ? "grid w-full grid-cols-2" : "grid w-full grid-cols-1"}>
          <TabsTrigger value="customers" className="text-sm">Customer List</TabsTrigger>
          {(userRole === 'company_admin' || userRole === 'super_admin') && (
            <TabsTrigger value="integrations" className="text-sm">
              <Settings className="w-3 h-3 sm:w-4 sm:h-4 mr-1 sm:mr-2" />
              <span className="hidden sm:inline">Integrations</span>
              <span className="sm:hidden">Setup</span>
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="customers" className="space-y-4">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
            <Input
              placeholder="Search customers..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>

          {/* Customers List - Responsive Design */}
          {/* Mobile Card View */}
          <div className="lg:hidden space-y-3">
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <Card key={i} className="p-4">
                  <div className="flex items-center space-x-3">
                    <Skeleton className="h-10 w-10 rounded-lg" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-4 w-32" />
                      <Skeleton className="h-3 w-24" />
                    </div>
                  </div>
                </Card>
              ))
            ) : (
              filteredCustomers?.map((customer) => (
                <Card key={customer.id} className="p-4 hover:shadow-md transition-shadow">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3 flex-1 min-w-0">
                      <div className="bg-blue-50 p-2 rounded-lg flex-shrink-0">
                        <Users className="w-4 h-4 text-blue-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-gray-900 truncate">{customer.name}</div>
                        {userRole !== 'field_tech' && (
                          <div className="text-xs text-gray-500 truncate">{customer.email}</div>
                        )}
                        {customer.phone && (
                          <div className="text-xs text-gray-500">{customer.phone}</div>
                        )}
                      </div>
                    </div>
                    <div className="flex-shrink-0">
                      {userRole === 'field_tech' ? (
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="text-blue-600 hover:text-blue-900"
                          onClick={() => setShowSiteMaps(customer)}
                        >
                          <Eye className="w-4 h-4" />
                        </Button>
                      ) : (
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="text-blue-600 hover:text-blue-900"
                          onClick={() => setSelectedCustomer(customer)}
                        >
                          <Eye className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                  {customer.address && (
                    <div className="mt-2 text-xs text-gray-600 truncate">{customer.address}</div>
                  )}
                </Card>
              ))
            )}
          </div>

          {/* Desktop Table View */}
          <div className="hidden lg:block">
            <Card className="bg-white shadow-sm border border-gray-200">
              <CardHeader className="px-6 py-4 border-b border-gray-200">
                <CardTitle className="text-lg font-semibold text-gray-900">All Customers</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Customer
                        </th>
                        {userRole !== 'field_tech' && (
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Contact
                          </th>
                        )}
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Address
                        </th>
                        <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Actions
                        </th>
                      </tr>
                    </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {isLoading ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <tr key={i}>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center">
                            <Skeleton className="h-8 w-8 rounded-lg mr-3" />
                            <Skeleton className="h-4 w-32" />
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="space-y-1">
                            <Skeleton className="h-4 w-40" />
                            <Skeleton className="h-4 w-24" />
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <Skeleton className="h-4 w-48" />
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right">
                          <Skeleton className="h-8 w-16" />
                        </td>
                      </tr>
                    ))
                  ) : (
                    filteredCustomers?.map((customer) => (
                      <tr key={customer.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => userRole !== 'field_tech' && setSelectedCustomer(customer)}>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center">
                            <div className="bg-blue-50 p-2 rounded-lg mr-3">
                              <Users className="w-4 h-4 text-blue-600" />
                            </div>
                            <div className="flex-1">
                              <div className="text-sm font-medium text-gray-900">{customer.name}</div>
                            </div>

                          </div>
                        </td>
                        {userRole !== 'field_tech' && (
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="space-y-1">
                              <div className="flex items-center text-sm text-gray-900">
                                <Mail className="w-4 h-4 mr-2 text-gray-400" />
                                {customer.email}
                              </div>
                              {customer.phone && (
                                <div className="flex items-center text-sm text-gray-500">
                                  <Phone className="w-4 h-4 mr-2 text-gray-400" />
                                  {customer.phone}
                                </div>
                              )}
                            </div>
                          </td>
                        )}
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-900">{customer.address}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                          <div className="flex items-center space-x-2 justify-end">
                            {userRole === 'field_tech' ? (
                              <Button 
                                variant="ghost" 
                                size="sm" 
                                className="text-blue-600 hover:text-blue-900"
                                onClick={() => setShowSiteMaps(customer)}
                              >
                                <Eye className="w-4 h-4 mr-1" />
                                Map View
                              </Button>
                            ) : (
                              <>
                                <Button 
                                  variant="ghost" 
                                  size="sm" 
                                  className="text-blue-600 hover:text-blue-900"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedCustomer(customer);
                                  }}
                                >
                                  <Eye className="w-4 h-4" />
                                </Button>
                                {(userRole === 'company_admin' || userRole === 'super_admin') && (
                                  <>
                                    <CustomerForm
                                      customer={customer}
                                      trigger={
                                        <Button variant="ghost" size="sm" className="text-gray-600 hover:text-gray-900" onClick={(e) => e.stopPropagation()}>
                                          <Edit className="w-4 h-4" />
                                        </Button>
                                      }
                                    />
                                    <AlertDialog>
                                      <AlertDialogTrigger asChild>
                                        <Button variant="ghost" size="sm" className="text-gray-600 hover:text-red-600" onClick={(e) => e.stopPropagation()}>
                                          <Trash2 className="w-4 h-4" />
                                        </Button>
                                      </AlertDialogTrigger>
                                      <AlertDialogContent>
                                        <AlertDialogHeader>
                                          <AlertDialogTitle>Delete Customer</AlertDialogTitle>
                                          <AlertDialogDescription>
                                            Are you sure you want to delete "{customer.name}"? This action cannot be undone and will remove all associated data including estimates, work orders, and billing records.
                                          </AlertDialogDescription>
                                        </AlertDialogHeader>
                                        <AlertDialogFooter>
                                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                                          <AlertDialogAction
                                            className="bg-red-600 hover:bg-red-700"
                                            onClick={() => handleDeleteCustomer(customer.id)}
                                            disabled={deleteCustomerMutation.isPending}
                                          >
                                            {deleteCustomerMutation.isPending ? "Deleting..." : "Delete Customer"}
                                          </AlertDialogAction>
                                        </AlertDialogFooter>
                                      </AlertDialogContent>
                                    </AlertDialog>
                                  </>
                                )}
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                  </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Empty State */}
          {!isLoading && filteredCustomers?.length === 0 && (
            <Card className="bg-white shadow-sm border border-gray-200">
              <CardContent className="p-12 text-center">
                <Users className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">No customers found</h3>
                <p className="text-gray-600 mb-4">
                  {searchQuery 
                    ? "No customers match your search criteria." 
                    : userRole === 'field_tech' 
                      ? "No customers available to view." 
                      : "Get started by adding your first customer."
                  }
                </p>
                {(userRole === 'company_admin' || userRole === 'super_admin') && (
                  <CustomerForm
                    trigger={
                      <Button className="bg-primary text-white hover:bg-blue-700">
                        <Plus className="w-4 h-4 mr-2" />
                        Add New Customer
                      </Button>
                    }
                  />
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {(userRole === 'company_admin' || userRole === 'super_admin') && (
          <TabsContent value="integrations">
            <CustomerIntegration />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
