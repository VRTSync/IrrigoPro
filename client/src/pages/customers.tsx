import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { CustomerListSkeleton } from "@/components/ui/loading-skeleton";
import { MetricTile, MetricGrid } from "@/components/ui/metric-tile";
import { PageContainer, PageContent, PageHeader } from "@/components/ui/page-header";
import { FAB } from "@/components/ui/fab";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Users, Search, Edit, Trash2, Phone, Mail, Settings, Eye, MapPin, ChevronRight, ChevronDown, ChevronUp, Building2, EyeOff } from "lucide-react";
import { useState, useEffect } from "react";
import { useLocation } from "wouter";
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
  const [activeExpanded, setActiveExpanded] = useState(true);
  const [hiddenExpanded, setHiddenExpanded] = useState(false);
  const [, setLocation] = useLocation();
  
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

  // Toggle hidden from billing mutation
  const toggleHiddenMutation = useMutation({
    mutationFn: async ({ customerId, hidden }: { customerId: number; hidden: boolean }) => {
      return await apiRequest(`/api/customers/${customerId}`, "PATCH", { hiddenFromBilling: hidden });
    },
    onSuccess: (_, { hidden }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/customers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/customers/billing-preview"] });
      toast({
        title: hidden ? "Hidden from Billing" : "Visible in Billing",
        description: hidden
          ? "This customer will no longer appear in the billing list."
          : "This customer will now appear in the billing list.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update billing visibility. Please try again.",
        variant: "destructive",
      });
    },
  });

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

  const filteredCustomers = customers?.filter(customer => {
    const q = searchQuery.toLowerCase();
    return (
      customer.name.toLowerCase().includes(q) ||
      (customer.irrigoName || "").toLowerCase().includes(q) ||
      customer.email.toLowerCase().includes(q) ||
      customer.phone?.toLowerCase().includes(q)
    );
  });

  const sortByName = (a: Customer, b: Customer) =>
    (a.irrigoName || a.name).localeCompare(b.irrigoName || b.name);

  const activeCustomers = (filteredCustomers?.filter(c => !c.hiddenFromBilling) || []).sort(sortByName);
  const hiddenCustomers = (filteredCustomers?.filter(c => c.hiddenFromBilling) || []).sort(sortByName);

  // Show full page skeleton while loading (after all hooks)
  if (isLoading) {
    return <CustomerListSkeleton />;
  }

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
    <PageContainer>
      <PageHeader
        title="Customers"
        subtitle="Manage your customer database"
        actions={
          (userRole === 'company_admin' || userRole === 'super_admin') && (
            <CustomerForm
              trigger={
                <Button className="hidden sm:flex" data-testid="button-add-customer">
                  <Plus className="w-4 h-4 mr-2" />
                  Add Customer
                </Button>
              }
            />
          )
        }
      />

      <PageContent className="space-y-5">
        {/* Stats Row */}
        <MetricGrid className="grid-cols-2 sm:grid-cols-3">
          <MetricTile
            label="Total Customers"
            value={customers?.length || 0}
            icon={Users}
            variant="primary"
            testId="metric-total-customers"
          />
          <MetricTile
            label="Active"
            value={customers?.length || 0}
            icon={Building2}
            variant="success"
            testId="metric-active-customers"
          />
        </MetricGrid>

        <Tabs defaultValue="customers" className="w-full">
          <TabsList className={(userRole === 'company_admin' || userRole === 'super_admin') ? "grid w-full grid-cols-2 rounded-xl h-12" : "grid w-full grid-cols-1 rounded-xl h-12"}>
            <TabsTrigger value="customers" className="text-sm rounded-lg data-[state=active]:shadow-sm">Customer List</TabsTrigger>
            {(userRole === 'company_admin' || userRole === 'super_admin') && (
              <TabsTrigger value="integrations" className="text-sm rounded-lg data-[state=active]:shadow-sm">
                <Settings className="w-4 h-4 mr-2" />
                <span className="hidden sm:inline">Integrations</span>
                <span className="sm:hidden">Setup</span>
              </TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="customers" className="space-y-4 mt-4">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400" />
              <Input
                placeholder="Search customers..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-12"
                data-testid="input-search-customers"
              />
            </div>

            {/* Customers List - Mobile Card View */}
            <div className="lg:hidden space-y-4">

              {/* Active Customers Section */}
              {activeCustomers.length > 0 && (
                <div className="space-y-3">
                  <button
                    onClick={() => setActiveExpanded(!activeExpanded)}
                    className="w-full flex items-center justify-between px-1 py-1 text-left"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-slate-700 text-sm">Active Customers</span>
                      <span className="text-xs bg-sky-100 text-sky-700 px-2 py-0.5 rounded-full font-medium">{activeCustomers.length}</span>
                    </div>
                    {activeExpanded ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                  </button>
                  {activeExpanded && activeCustomers.map((customer) => (
                    <Card 
                      key={customer.id} 
                      className="glass-card p-4 active:scale-[0.98] transition-all duration-200"
                      onClick={() => userRole === 'field_tech' 
                        ? setLocation(`/customers/${customer.id}/profile`)
                        : setSelectedCustomer(customer)
                      }
                      data-testid={`card-customer-${customer.id}`}
                    >
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm bg-gradient-to-br from-sky-400 to-sky-600">
                          <span className="text-white font-semibold text-lg">
                            {(customer.irrigoName || customer.name).charAt(0).toUpperCase()}
                          </span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-base font-semibold text-slate-900 truncate">
                            {customer.irrigoName || customer.name}
                          </div>
                          {customer.irrigoName && customer.irrigoName !== customer.name && (
                            <div className="text-xs text-slate-400 truncate">{customer.name}</div>
                          )}
                          {userRole !== 'field_tech' && customer.email && (
                            <div className="flex items-center gap-1.5 text-sm text-slate-500 mt-0.5">
                              <Mail className="w-3.5 h-3.5" />
                              <span className="truncate">{customer.email}</span>
                            </div>
                          )}
                          {customer.phone && (
                            <div className="flex items-center gap-1.5 text-sm text-slate-500 mt-0.5">
                              <Phone className="w-3.5 h-3.5" />
                              <span>{customer.phone}</span>
                            </div>
                          )}
                        </div>
                        {(userRole === 'company_admin' || userRole === 'super_admin' || userRole === 'billing_manager') && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="flex-shrink-0 text-slate-400 hover:text-orange-600"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleHiddenMutation.mutate({ customerId: customer.id, hidden: true });
                            }}
                            title="Hide from billing"
                          >
                            <EyeOff className="w-4 h-4" />
                          </Button>
                        )}
                        <ChevronRight className="w-5 h-5 text-slate-400 flex-shrink-0" />
                      </div>
                      {customer.address && (
                        <div className="flex items-center gap-1.5 mt-3 pt-3 border-t border-slate-100 text-sm text-slate-500">
                          <MapPin className="w-3.5 h-3.5 flex-shrink-0" />
                          <span className="truncate">{customer.address}</span>
                        </div>
                      )}
                    </Card>
                  ))}
                </div>
              )}

              {/* Hidden from Billing Section */}
              {hiddenCustomers.length > 0 && (
                <div className="space-y-3">
                  <button
                    onClick={() => setHiddenExpanded(!hiddenExpanded)}
                    className="w-full flex items-center justify-between px-1 py-1 text-left"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-slate-500 text-sm">Hidden from Billing</span>
                      <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full font-medium">{hiddenCustomers.length}</span>
                    </div>
                    {hiddenExpanded ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                  </button>
                  {hiddenExpanded && hiddenCustomers.map((customer) => (
                    <Card 
                      key={customer.id} 
                      className="glass-card p-4 active:scale-[0.98] transition-all duration-200 opacity-60"
                      onClick={() => userRole === 'field_tech' 
                        ? setLocation(`/customers/${customer.id}/profile`)
                        : setSelectedCustomer(customer)
                      }
                      data-testid={`card-customer-${customer.id}`}
                    >
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm bg-gradient-to-br from-slate-300 to-slate-400">
                          <span className="text-white font-semibold text-lg">
                            {(customer.irrigoName || customer.name).charAt(0).toUpperCase()}
                          </span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-base font-semibold text-slate-900 truncate">
                            {customer.irrigoName || customer.name}
                          </div>
                          {customer.irrigoName && customer.irrigoName !== customer.name && (
                            <div className="text-xs text-slate-400 truncate">{customer.name}</div>
                          )}
                          {userRole !== 'field_tech' && customer.email && (
                            <div className="flex items-center gap-1.5 text-sm text-slate-500 mt-0.5">
                              <Mail className="w-3.5 h-3.5" />
                              <span className="truncate">{customer.email}</span>
                            </div>
                          )}
                          {customer.phone && (
                            <div className="flex items-center gap-1.5 text-sm text-slate-500 mt-0.5">
                              <Phone className="w-3.5 h-3.5" />
                              <span>{customer.phone}</span>
                            </div>
                          )}
                        </div>
                        {(userRole === 'company_admin' || userRole === 'super_admin' || userRole === 'billing_manager') && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="flex-shrink-0 text-slate-400 hover:text-slate-600"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleHiddenMutation.mutate({ customerId: customer.id, hidden: false });
                            }}
                            title="Show in billing"
                          >
                            <Eye className="w-4 h-4" />
                          </Button>
                        )}
                        <ChevronRight className="w-5 h-5 text-slate-400 flex-shrink-0" />
                      </div>
                      {customer.address && (
                        <div className="flex items-center gap-1.5 mt-3 pt-3 border-t border-slate-100 text-sm text-slate-500">
                          <MapPin className="w-3.5 h-3.5 flex-shrink-0" />
                          <span className="truncate">{customer.address}</span>
                        </div>
                      )}
                    </Card>
                  ))}
                </div>
              )}

            </div>

          {/* Desktop Table View */}
          <div className="hidden lg:block space-y-4">

            {/* Active Customers */}
            {activeCustomers.length > 0 && (
              <Card className="bg-white shadow-sm border border-gray-200">
                <CardHeader
                  className="px-6 py-4 border-b border-gray-200 cursor-pointer select-none"
                  onClick={() => setActiveExpanded(!activeExpanded)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <CardTitle className="text-lg font-semibold text-gray-900">Active Customers</CardTitle>
                      <span className="text-xs bg-sky-100 text-sky-700 px-2.5 py-0.5 rounded-full font-medium">{activeCustomers.length}</span>
                    </div>
                    {activeExpanded ? <ChevronUp className="w-5 h-5 text-gray-400" /> : <ChevronDown className="w-5 h-5 text-gray-400" />}
                  </div>
                </CardHeader>
                {activeExpanded && (
                  <CardContent className="p-0">
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Customer</th>
                            {userRole !== 'field_tech' && (
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Contact</th>
                            )}
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Address</th>
                            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                          {activeCustomers.map((customer) => (
                            <tr key={customer.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => userRole !== 'field_tech' && setSelectedCustomer(customer)}>
                              <td className="px-6 py-4 whitespace-nowrap">
                                <div className="flex items-center">
                                  <div className="p-2 rounded-lg mr-3 bg-blue-50">
                                    <Users className="w-4 h-4 text-blue-600" />
                                  </div>
                                  <div className="flex-1">
                                    <div className="text-sm font-medium text-gray-900">{customer.irrigoName || customer.name}</div>
                                    {customer.irrigoName && customer.irrigoName !== customer.name && (
                                      <div className="text-xs text-gray-400 mt-0.5">{customer.name}</div>
                                    )}
                                  </div>
                                </div>
                              </td>
                              {userRole !== 'field_tech' && (
                                <td className="px-6 py-4 whitespace-nowrap">
                                  <div className="space-y-1">
                                    <div className="flex items-center text-sm text-gray-900">
                                      <Mail className="w-4 h-4 mr-2 text-gray-400" />{customer.email}
                                    </div>
                                    {customer.phone && (
                                      <div className="flex items-center text-sm text-gray-500">
                                        <Phone className="w-4 h-4 mr-2 text-gray-400" />{customer.phone}
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
                                    <Button variant="ghost" size="sm" className="text-blue-600 hover:text-blue-900" onClick={() => setLocation(`/customers/${customer.id}/profile`)}>
                                      <Eye className="w-4 h-4 mr-1" />View Profile
                                    </Button>
                                  ) : (
                                    <>
                                      <Button variant="ghost" size="sm" className="text-blue-600 hover:text-blue-900" onClick={(e) => { e.stopPropagation(); setSelectedCustomer(customer); }}>
                                        <Eye className="w-4 h-4" />
                                      </Button>
                                      {(userRole === 'company_admin' || userRole === 'super_admin' || userRole === 'billing_manager') && (
                                        <>
                                          <Button variant="ghost" size="sm" className="text-gray-400 hover:text-orange-600" onClick={(e) => { e.stopPropagation(); toggleHiddenMutation.mutate({ customerId: customer.id, hidden: true }); }} title="Hide from billing">
                                            <EyeOff className="w-4 h-4" />
                                          </Button>
                                          <CustomerForm customer={customer} trigger={<Button variant="ghost" size="sm" className="text-gray-600 hover:text-gray-900" onClick={(e) => e.stopPropagation()}><Edit className="w-4 h-4" /></Button>} />
                                          {(userRole === 'company_admin' || userRole === 'super_admin') && (
                                            <AlertDialog>
                                              <AlertDialogTrigger asChild>
                                                <Button variant="ghost" size="sm" className="text-gray-600 hover:text-red-600" onClick={(e) => e.stopPropagation()}><Trash2 className="w-4 h-4" /></Button>
                                              </AlertDialogTrigger>
                                              <AlertDialogContent>
                                                <AlertDialogHeader>
                                                  <AlertDialogTitle>Delete Customer</AlertDialogTitle>
                                                  <AlertDialogDescription>Are you sure you want to delete "{customer.name}"? This action cannot be undone and will remove all associated data including estimates, work orders, and billing records.</AlertDialogDescription>
                                                </AlertDialogHeader>
                                                <AlertDialogFooter>
                                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                  <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={(e) => { e.stopPropagation(); handleDeleteCustomer(customer.id); }} disabled={deleteCustomerMutation.isPending}>
                                                    {deleteCustomerMutation.isPending ? "Deleting..." : "Delete Customer"}
                                                  </AlertDialogAction>
                                                </AlertDialogFooter>
                                              </AlertDialogContent>
                                            </AlertDialog>
                                          )}
                                        </>
                                      )}
                                    </>
                                  )}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                )}
              </Card>
            )}

            {/* Hidden from Billing */}
            {hiddenCustomers.length > 0 && (
              <Card className="bg-white shadow-sm border border-gray-200 opacity-80">
                <CardHeader
                  className="px-6 py-4 border-b border-gray-200 cursor-pointer select-none"
                  onClick={() => setHiddenExpanded(!hiddenExpanded)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <CardTitle className="text-lg font-semibold text-gray-500">Hidden from Billing</CardTitle>
                      <span className="text-xs bg-slate-100 text-slate-500 px-2.5 py-0.5 rounded-full font-medium">{hiddenCustomers.length}</span>
                    </div>
                    {hiddenExpanded ? <ChevronUp className="w-5 h-5 text-gray-400" /> : <ChevronDown className="w-5 h-5 text-gray-400" />}
                  </div>
                </CardHeader>
                {hiddenExpanded && (
                  <CardContent className="p-0">
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Customer</th>
                            {userRole !== 'field_tech' && (
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Contact</th>
                            )}
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Address</th>
                            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                          {hiddenCustomers.map((customer) => (
                            <tr key={customer.id} className="hover:bg-gray-50 cursor-pointer opacity-70" onClick={() => userRole !== 'field_tech' && setSelectedCustomer(customer)}>
                              <td className="px-6 py-4 whitespace-nowrap">
                                <div className="flex items-center">
                                  <div className="p-2 rounded-lg mr-3 bg-slate-100">
                                    <Users className="w-4 h-4 text-slate-400" />
                                  </div>
                                  <div className="flex-1">
                                    <div className="text-sm font-medium text-gray-900">{customer.irrigoName || customer.name}</div>
                                    {customer.irrigoName && customer.irrigoName !== customer.name && (
                                      <div className="text-xs text-gray-400 mt-0.5">{customer.name}</div>
                                    )}
                                  </div>
                                </div>
                              </td>
                              {userRole !== 'field_tech' && (
                                <td className="px-6 py-4 whitespace-nowrap">
                                  <div className="space-y-1">
                                    <div className="flex items-center text-sm text-gray-900">
                                      <Mail className="w-4 h-4 mr-2 text-gray-400" />{customer.email}
                                    </div>
                                    {customer.phone && (
                                      <div className="flex items-center text-sm text-gray-500">
                                        <Phone className="w-4 h-4 mr-2 text-gray-400" />{customer.phone}
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
                                    <Button variant="ghost" size="sm" className="text-blue-600 hover:text-blue-900" onClick={() => setLocation(`/customers/${customer.id}/profile`)}>
                                      <Eye className="w-4 h-4 mr-1" />View Profile
                                    </Button>
                                  ) : (
                                    <>
                                      <Button variant="ghost" size="sm" className="text-blue-600 hover:text-blue-900" onClick={(e) => { e.stopPropagation(); setSelectedCustomer(customer); }}>
                                        <Eye className="w-4 h-4" />
                                      </Button>
                                      {(userRole === 'company_admin' || userRole === 'super_admin' || userRole === 'billing_manager') && (
                                        <>
                                          <Button variant="ghost" size="sm" className="text-slate-400 hover:text-slate-700" onClick={(e) => { e.stopPropagation(); toggleHiddenMutation.mutate({ customerId: customer.id, hidden: false }); }} title="Show in billing">
                                            <Eye className="w-4 h-4" />
                                          </Button>
                                          <CustomerForm customer={customer} trigger={<Button variant="ghost" size="sm" className="text-gray-600 hover:text-gray-900" onClick={(e) => e.stopPropagation()}><Edit className="w-4 h-4" /></Button>} />
                                          {(userRole === 'company_admin' || userRole === 'super_admin') && (
                                            <AlertDialog>
                                              <AlertDialogTrigger asChild>
                                                <Button variant="ghost" size="sm" className="text-gray-600 hover:text-red-600" onClick={(e) => e.stopPropagation()}><Trash2 className="w-4 h-4" /></Button>
                                              </AlertDialogTrigger>
                                              <AlertDialogContent>
                                                <AlertDialogHeader>
                                                  <AlertDialogTitle>Delete Customer</AlertDialogTitle>
                                                  <AlertDialogDescription>Are you sure you want to delete "{customer.name}"? This action cannot be undone and will remove all associated data including estimates, work orders, and billing records.</AlertDialogDescription>
                                                </AlertDialogHeader>
                                                <AlertDialogFooter>
                                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                  <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={(e) => { e.stopPropagation(); handleDeleteCustomer(customer.id); }} disabled={deleteCustomerMutation.isPending}>
                                                    {deleteCustomerMutation.isPending ? "Deleting..." : "Delete Customer"}
                                                  </AlertDialogAction>
                                                </AlertDialogFooter>
                                              </AlertDialogContent>
                                            </AlertDialog>
                                          )}
                                        </>
                                      )}
                                    </>
                                  )}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                )}
              </Card>
            )}

          </div>

            {/* Empty State */}
            {!isLoading && filteredCustomers?.length === 0 && (
              <Card className="glass-card">
                <CardContent className="p-12 text-center">
                  <Users className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                  <h3 className="text-lg font-semibold text-slate-900 mb-2">No customers found</h3>
                  <p className="text-slate-500 mb-6">
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
                        <Button data-testid="button-add-customer-empty">
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
      </PageContent>

      {/* FAB for Mobile - Admin Users Only */}
      {(userRole === 'company_admin' || userRole === 'super_admin') && (
        <CustomerForm
          trigger={
            <button 
              className="fab sm:hidden"
              data-testid="fab-add-customer"
              type="button"
            >
              <Plus className="w-7 h-7" />
            </button>
          }
        />
      )}
    </PageContainer>
  );
}
