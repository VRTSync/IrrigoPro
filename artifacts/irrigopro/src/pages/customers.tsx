import { safeGet, safeRemove } from "@/utils/safeStorage";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CustomerListSkeleton } from "@/components/ui/loading-skeleton";
import { MetricTile, MetricGrid } from "@/components/ui/metric-tile";
import { PageContainer, PageContent, PageHeader } from "@/components/ui/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Plus, Users, Search, Trash2, Phone, Mail, Eye, EyeOff, MapPin, ChevronRight, ChevronDown, ChevronUp, Building2 } from "lucide-react";
import { useState, useEffect } from "react";
import { useLocation, useSearch } from "wouter";
import type { Customer } from "@workspace/db/schema";
import { CustomerForm } from "@/components/customer-form";
import { useCustomerRecordsLock } from "@/hooks/use-customer-records-lock";
import { apiRequest, useArrayQuery } from "@/lib/queryClient";
import { displayCustomerAddress } from "@/lib/customer-address";
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
  const lock = useCustomerRecordsLock();
  const [searchQuery, setSearchQuery] = useState("");
  // Read the role before starting queries so non-admins never fetch the all list.
  const [userRole] = useState<string | undefined>(() => {
    const savedUser = safeGet("user");
    if (savedUser) {
      try {
        return JSON.parse(savedUser)?.role;
      } catch (error) {
        console.error("Error parsing user data:", error);
      }
    }
  });
  const isAdmin = userRole === "company_admin" || userRole === "super_admin";
  const [activeExpanded, setActiveExpanded] = useState(true);
  const [, setLocation] = useLocation();
  const search = useSearch();
  const showAll = isAdmin && new URLSearchParams(search).get("view") === "all";
  const view = showAll ? "all" : "billable";

  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: billableCustomers = [], isLoading: billableLoading } = useArrayQuery<Customer>({
    queryKey: ["/api/customers", { billingVisible: true }],
    queryFn: () => apiRequest("/api/customers?billingVisible=true"),
  });
  const { data: allCustomers = [], isLoading: allLoading } = useArrayQuery<Customer>({
    queryKey: ["/api/customers"],
    enabled: isAdmin,
  });
  const customers = showAll ? allCustomers : billableCustomers;
  const hiddenCount = allCustomers.filter(customer => customer.hiddenFromBilling).length;

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

  const toggleHiddenMutation = useMutation({
    mutationFn: async ({ customerId, hidden }: { customerId: number; hidden: boolean }) => {
      return await apiRequest(`/api/customers/${customerId}`, "PATCH", { hiddenFromBilling: hidden });
    },
    onSuccess: (_, { hidden }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/customers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/customers/billing-preview"] });
      toast({
        title: hidden ? "Hidden from billing" : "Visible in billing",
        description: hidden
          ? "This customer will no longer appear in billing views."
          : "This customer will now appear in billing views.",
      });
    },
    onError: () => {
      toast({ title: "Failed to update billing visibility", variant: "destructive" });
    },
  });

  const billingVisibility = (customer: Customer, mobile = false) => (
    <div
      className={mobile
        ? "flex w-20 shrink-0 flex-col items-center gap-0.5 text-center"
        : "flex flex-col items-center justify-center gap-1 text-center xl:flex-row xl:gap-2"}
      onClick={(event) => event.stopPropagation()}
    >
      <Switch
        aria-label={`Show ${customer.irrigoName || customer.name} in billing`}
        checked={!customer.hiddenFromBilling}
        onCheckedChange={(checked) =>
          toggleHiddenMutation.mutate({ customerId: customer.id, hidden: !checked })
        }
        disabled={toggleHiddenMutation.isPending}
      />
      <span className={`text-xs ${mobile || customer.hiddenFromBilling ? "text-slate-400" : "text-sky-600 font-medium"}`}>
        {customer.hiddenFromBilling ? "Hidden" : "Visible"}
        {customer.hiddenFromBilling && customer.hiddenByQuickbooks && (
          <span className="block text-[10px] text-slate-400">Inactive in QuickBooks</span>
        )}
      </span>
    </div>
  );

  const handleDeleteCustomer = (customerId: number) => {
    deleteCustomerMutation.mutate(customerId);
  };

  // Restore deep-link navigation from site-maps page (uses routes instead of inline render)
  useEffect(() => {
    const selectedCustomerId = safeGet('selectedCustomerId');
    const shouldShowSiteMaps = safeGet('showSiteMaps') === 'true';
    if (selectedCustomerId) {
      safeRemove('selectedCustomerId');
      safeRemove('showSiteMaps');
      safeRemove('selectedSiteMapId');
      if (shouldShowSiteMaps) {
        setLocation(`/customers/${selectedCustomerId}/site-maps`);
      } else {
        setLocation(`/customers/${selectedCustomerId}/profile`);
      }
    }
  }, [setLocation]);

  const filteredCustomers = customers.filter(customer => {
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

  const sortedCustomers = filteredCustomers.sort(sortByName);

  if (billableLoading || allLoading) {
    return <CustomerListSkeleton />;
  }

  const list = (
          <div className="space-y-4 mt-4">
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

            {/* Mobile Card View */}
            <div className="lg:hidden space-y-4">
              {sortedCustomers.length > 0 && (
                <div className="space-y-3">
                  <button
                    onClick={() => setActiveExpanded(!activeExpanded)}
                    className="w-full flex items-center justify-between px-1 py-1 text-left"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-slate-700 text-sm">Customers</span>
                      <span className="text-xs bg-sky-100 text-sky-700 px-2 py-0.5 rounded-full font-medium">{sortedCustomers.length}</span>
                    </div>
                    {activeExpanded ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                  </button>
                  {activeExpanded && sortedCustomers.map((customer) => (
                    <Card
                      key={customer.id}
                      className={`glass-card p-4 active:scale-[0.98] transition-all duration-200 ${showAll && customer.hiddenFromBilling ? "opacity-60" : ""}`}
                      onClick={() => setLocation(`/customers/${customer.id}/profile`)}
                      data-testid={`card-customer-${customer.id}`}
                    >
                      <div className="flex items-center gap-3 sm:gap-4">
                        <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm bg-gradient-to-br ${showAll && customer.hiddenFromBilling ? "from-slate-300 to-slate-400" : "from-sky-400 to-sky-600"}`}>
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
                              <Phone className="w-3.5 h-3.5 shrink-0" />
                              <span className="min-w-0 break-words">{customer.phone}</span>
                            </div>
                          )}
                        </div>
                        {showAll ? billingVisibility(customer, true) : (
                          <ChevronRight className="w-5 h-5 text-slate-400 flex-shrink-0" />
                        )}
                      </div>
                      {(() => {
                        const addr = displayCustomerAddress(customer);
                        return addr ? (
                          <div className="flex items-center gap-1.5 mt-3 pt-3 border-t border-slate-100 text-sm text-slate-500">
                            <MapPin className="w-3.5 h-3.5 flex-shrink-0" />
                            <span className="truncate">{addr}</span>
                          </div>
                        ) : null;
                      })()}
                    </Card>
                  ))}
                </div>
              )}
            </div>

            {/* Desktop Table View */}
            <div className="hidden lg:block space-y-4">
              {sortedCustomers.length > 0 && (
                <Card className="bg-white shadow-sm border border-gray-200">
                  <CardHeader
                    className="px-6 py-4 border-b border-gray-200 cursor-pointer select-none"
                    onClick={() => setActiveExpanded(!activeExpanded)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <CardTitle className="text-lg font-semibold text-gray-900">Customers</CardTitle>
                        <span className="text-xs bg-sky-100 text-sky-700 px-2.5 py-0.5 rounded-full font-medium">{sortedCustomers.length}</span>
                      </div>
                      {activeExpanded ? <ChevronUp className="w-5 h-5 text-gray-400" /> : <ChevronDown className="w-5 h-5 text-gray-400" />}
                    </div>
                  </CardHeader>
                  {activeExpanded && (
                    <CardContent className="p-0">
                      <div>
                        <table className="w-full table-fixed">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className={`${showAll ? "w-1/4" : "w-[30%]"} px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider`}>Customer</th>
                              {userRole !== 'field_tech' && (
                                <th className={`${showAll ? "w-1/4" : "w-[30%]"} px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider`}>Contact</th>
                              )}
                              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Address</th>
                              {showAll && (
                                <th className="w-32 px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Show in Billing</th>
                              )}
                              <th className={`${showAll ? "w-32" : "w-40"} px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider`}>Actions</th>
                            </tr>
                          </thead>
                          <tbody className="bg-white divide-y divide-gray-200">
                            {sortedCustomers.map((customer) => (
                              <tr
                                key={customer.id}
                                className={`hover:bg-gray-50 cursor-pointer ${showAll && customer.hiddenFromBilling ? "opacity-60" : ""}`}
                                onClick={() => setLocation(`/customers/${customer.id}/profile`)}
                              >
                                <td className="px-4 py-4">
                                  <div className="flex items-center">
                                    <div className={`p-2 rounded-lg mr-3 shrink-0 ${showAll && customer.hiddenFromBilling ? "bg-slate-100" : "bg-blue-50"}`}>
                                      <Users className={`w-4 h-4 ${showAll && customer.hiddenFromBilling ? "text-slate-400" : "text-blue-600"}`} />
                                    </div>
                                    <div className="flex-1 min-w-0 break-words">
                                      <div className="text-sm font-medium text-gray-900">{customer.irrigoName || customer.name}</div>
                                      {customer.irrigoName && customer.irrigoName !== customer.name && (
                                        <div className="text-xs text-gray-400 mt-0.5">{customer.name}</div>
                                      )}
                                    </div>
                                  </div>
                                </td>
                                {userRole !== 'field_tech' && (
                                  <td className="px-4 py-4">
                                    <div className="space-y-1">
                                      <div className="flex min-w-0 items-center text-sm text-gray-900">
                                        <Mail className="w-4 h-4 mr-2 shrink-0 text-gray-400" />
                                        <span className="min-w-0 truncate" title={customer.email}>{customer.email}</span>
                                      </div>
                                      {customer.phone && (
                                        <div className="flex items-center text-sm text-gray-500">
                                          <Phone className="w-4 h-4 mr-2 shrink-0 text-gray-400" />
                                          <span className="min-w-0 break-words">{customer.phone}</span>
                                        </div>
                                      )}
                                    </div>
                                  </td>
                                )}
                                <td className="px-4 py-4">
                                  <div className="break-words text-sm text-gray-900">{displayCustomerAddress(customer)}</div>
                                </td>
                                {showAll && (
                                  <td className="px-4 py-4 text-center">{billingVisibility(customer)}</td>
                                )}
                                <td className="px-4 py-4 whitespace-nowrap text-right text-sm font-medium" onClick={(event) => event.stopPropagation()}>
                                  <div className="flex items-center space-x-2 justify-end">
                                    {userRole === 'field_tech' ? (
                                      <Button variant="ghost" size="sm" className="text-blue-600 hover:text-blue-900" onClick={() => setLocation(`/customers/${customer.id}/profile`)}>
                                        <Eye className="w-4 h-4 mr-1" />View Profile
                                      </Button>
                                    ) : (
                                      <>
                                        <Button variant="ghost" size="icon-sm" className="text-blue-600 hover:text-blue-900" aria-label="View Profile" onClick={() => setLocation(`/customers/${customer.id}/profile`)}>
                                          <Eye className="w-4 h-4" />
                                        </Button>
                                        {isAdmin && !(lock.locked && customer.quickbooksId) && (
                                          <AlertDialog>
                                            <AlertDialogTrigger asChild>
                                              <Button variant="ghost" size="icon-sm" className="text-gray-600 hover:text-red-600" aria-label="Delete Customer"><Trash2 className="w-4 h-4" /></Button>
                                            </AlertDialogTrigger>
                                            <AlertDialogContent>
                                              <AlertDialogHeader>
                                                <AlertDialogTitle>Delete Customer</AlertDialogTitle>
                                                <AlertDialogDescription>Are you sure you want to delete "{customer.name}"? This action cannot be undone and will remove all associated data including estimates, work orders, and billing records.</AlertDialogDescription>
                                              </AlertDialogHeader>
                                              <AlertDialogFooter>
                                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={() => handleDeleteCustomer(customer.id)} disabled={deleteCustomerMutation.isPending}>
                                                  {deleteCustomerMutation.isPending ? "Deleting..." : "Delete Customer"}
                                                </AlertDialogAction>
                                              </AlertDialogFooter>
                                            </AlertDialogContent>
                                          </AlertDialog>
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
            {sortedCustomers.length === 0 && (
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
                  {isAdmin && (lock.canCreateCustomers ? (
                    <CustomerForm
                      trigger={
                        <Button data-testid="button-add-customer-empty">
                          <Plus className="w-4 h-4 mr-2" />
                          Add New Customer
                        </Button>
                      }
                    />
                  ) : lock.locked ? <p className="text-sm text-slate-500">New customers are added in {lock.label}.</p> : null)}
                </CardContent>
              </Card>
            )}
          </div>
  );

  return (
    <PageContainer>
      <PageHeader
        title="Customers"
        subtitle="Manage your customer database"
        actions={
          isAdmin && (lock.canCreateCustomers ? (
            <CustomerForm
              trigger={
                <Button className="hidden sm:flex" data-testid="button-add-customer">
                  <Plus className="w-4 h-4 mr-2" />
                  Add Customer
                </Button>
              }
            />
          ) : lock.locked ? <p className="text-sm text-slate-500">New customers are added in {lock.label}.</p> : null)
        }
      />
      {showAll && lock.locked && !lock.quickbooksConnected && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">QuickBooks is disconnected. New customers can't reach IrrigoPro until it is reconnected.</div>
      )}

      <PageContent className="space-y-5">
        <MetricGrid className={isAdmin ? "grid-cols-3 gap-2 sm:gap-4 md:grid-cols-3 lg:grid-cols-3" : undefined}>
          <MetricTile
            label={isAdmin ? "Billable" : "Customers"}
            value={billableCustomers.length}
            icon={Users}
            variant="primary"
            className={isAdmin ? "px-3 sm:px-5" : undefined}
            testId="metric-billable-customers"
          />
          {isAdmin && (
            <>
              <MetricTile
                label="Hidden from billing"
                value={hiddenCount}
                icon={EyeOff}
                className="px-3 sm:px-5"
                testId="metric-hidden-customers"
              />
              <MetricTile
                label="Total"
                value={allCustomers.length}
                icon={Building2}
                className="px-3 sm:px-5"
                testId="metric-total-customers"
              />
            </>
          )}
        </MetricGrid>

        {isAdmin ? (
          <Tabs
            value={view}
            onValueChange={(nextView) => setLocation(nextView === "all" ? "/customers?view=all" : "/customers", { replace: true })}
            className="w-full"
          >
            <TabsList className="grid w-full grid-cols-2 rounded-xl h-12">
              <TabsTrigger value="billable" data-testid="tab-customers-billable" className="whitespace-normal text-sm rounded-lg">
                Billable customers ({billableCustomers.length})
              </TabsTrigger>
              <TabsTrigger value="all" data-testid="tab-customers-all" className="whitespace-normal text-sm rounded-lg">
                All customers ({allCustomers.length})
              </TabsTrigger>
            </TabsList>
            <TabsContent value={view}>{list}</TabsContent>
          </Tabs>
        ) : list}
      </PageContent>

      {/* FAB for Mobile - Admin Users Only */}
      {isAdmin && lock.canCreateCustomers && (
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
