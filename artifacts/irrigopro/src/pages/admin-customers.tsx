import { safeGet } from "@/utils/safeStorage";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageContainer, PageContent, PageHeader } from "@/components/ui/page-header";
import { Plus, Users, Search, Edit, Trash2, Phone, Mail, Eye, EyeOff } from "lucide-react";
import { useState, useEffect } from "react";
import { Switch } from "@/components/ui/switch";
import type { Customer } from "@workspace/db/schema";
import { CustomerForm } from "@/components/customer-form";
import { apiRequest, useArrayQuery } from "@/lib/queryClient";
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

export default function AdminCustomers() {
  const [searchQuery, setSearchQuery] = useState("");
  const [userRole, setUserRole] = useState<string>("company_admin");
  const queryClient = useQueryClient();
  const { toast } = useToast();

  useEffect(() => {
    const savedUser = safeGet("user");
    if (savedUser) {
      try {
        const userData = JSON.parse(savedUser);
        setUserRole(userData.role);
      } catch (error) {
        console.error("Error parsing user data:", error);
      }
    }
  }, []);

  const { data: customers = [], isLoading } = useArrayQuery<Customer>({
    queryKey: ["/api/customers"],
  });

  const deleteCustomerMutation = useMutation({
    mutationFn: async (customerId: number) => {
      return await apiRequest(`/api/customers/${customerId}`, "DELETE");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/customers"] });
      toast({ title: "Customer deleted successfully" });
    },
    onError: () => {
      toast({ title: "Failed to delete customer", variant: "destructive" });
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

  const sortByName = (a: Customer, b: Customer) =>
    (a.irrigoName || a.name).localeCompare(b.irrigoName || b.name);

  const filteredCustomers = customers
    ?.filter(customer => {
      const q = searchQuery.toLowerCase();
      return (
        customer.name.toLowerCase().includes(q) ||
        (customer.irrigoName || "").toLowerCase().includes(q) ||
        customer.email.toLowerCase().includes(q) ||
        customer.phone?.toLowerCase().includes(q)
      );
    })
    .sort(sortByName) || [];

  const visibleCount = customers?.filter(c => !c.hiddenFromBilling).length ?? 0;
  const hiddenCount = customers?.filter(c => c.hiddenFromBilling).length ?? 0;

  if (userRole !== "company_admin" && userRole !== "super_admin") {
    return (
      <PageContainer>
        <PageContent>
          <div className="text-center py-16">
            <Users className="w-16 h-16 text-slate-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-slate-900 mb-2">Access Restricted</h3>
            <p className="text-slate-500">Only company administrators can access the master customer list.</p>
          </div>
        </PageContent>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        title="All Customers"
        subtitle="Master customer list — manage billing visibility for all customers"
        actions={
          <CustomerForm
            trigger={
              <Button className="hidden sm:flex">
                <Plus className="w-4 h-4 mr-2" />
                Add Customer
              </Button>
            }
          />
        }
      />

      <PageContent className="space-y-5">
        <div className="flex gap-4 text-sm text-slate-600">
          <span className="flex items-center gap-1.5">
            <Eye className="w-4 h-4 text-sky-500" />
            <strong>{visibleCount}</strong> billing-visible
          </span>
          <span className="flex items-center gap-1.5">
            <EyeOff className="w-4 h-4 text-slate-400" />
            <strong>{hiddenCount}</strong> hidden from billing
          </span>
        </div>

        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400" />
          <Input
            placeholder="Search customers..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-12"
          />
        </div>

        {isLoading ? (
          <Card>
            <CardContent className="p-8 text-center text-slate-500">Loading customers...</CardContent>
          </Card>
        ) : filteredCustomers.length === 0 ? (
          <Card>
            <CardContent className="p-12 text-center">
              <Users className="w-16 h-16 text-slate-300 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-slate-900 mb-2">No customers found</h3>
              <p className="text-slate-500 mb-6">
                {searchQuery ? "No customers match your search." : "Add your first customer to get started."}
              </p>
              {!searchQuery && (
                <CustomerForm trigger={<Button><Plus className="w-4 h-4 mr-2" />Add Customer</Button>} />
              )}
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Mobile Cards */}
            <div className="lg:hidden space-y-3">
              {filteredCustomers.map((customer) => (
                <Card
                  key={customer.id}
                  className={`glass-card p-4 transition-all duration-200 ${customer.hiddenFromBilling ? "opacity-60" : ""}`}
                >
                  <div className="flex items-center gap-4">
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm ${customer.hiddenFromBilling ? "bg-gradient-to-br from-slate-300 to-slate-400" : "bg-gradient-to-br from-sky-400 to-sky-600"}`}>
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
                      {customer.email && (
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
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <div className="flex flex-col items-center gap-0.5">
                        <Switch
                          checked={!customer.hiddenFromBilling}
                          onCheckedChange={(checked) =>
                            toggleHiddenMutation.mutate({ customerId: customer.id, hidden: !checked })
                          }
                          disabled={toggleHiddenMutation.isPending}
                        />
                        <span className="text-xs text-slate-400">{customer.hiddenFromBilling ? "Hidden" : "Visible"}</span>
                      </div>
                    </div>
                  </div>
                </Card>
              ))}
            </div>

            {/* Desktop Table */}
            <Card className="hidden lg:block bg-white shadow-sm border border-gray-200">
              <CardHeader className="px-6 py-4 border-b border-gray-200">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg font-semibold text-gray-900">
                    All Customers ({filteredCustomers.length})
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Customer</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Contact</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Address</th>
                        <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Show in Billing</th>
                        <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {filteredCustomers.map((customer) => (
                        <tr key={customer.id} className={`hover:bg-gray-50 ${customer.hiddenFromBilling ? "opacity-60" : ""}`}>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="flex items-center">
                              <div className={`p-2 rounded-lg mr-3 ${customer.hiddenFromBilling ? "bg-slate-100" : "bg-blue-50"}`}>
                                <Users className={`w-4 h-4 ${customer.hiddenFromBilling ? "text-slate-400" : "text-blue-600"}`} />
                              </div>
                              <div className="flex-1">
                                <div className="text-sm font-medium text-gray-900">{customer.irrigoName || customer.name}</div>
                                {customer.irrigoName && customer.irrigoName !== customer.name && (
                                  <div className="text-xs text-gray-400 mt-0.5">{customer.name}</div>
                                )}
                              </div>
                            </div>
                          </td>
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
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm text-gray-900">{customer.address}</div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-center">
                            <div className="flex items-center justify-center gap-2">
                              <Switch
                                checked={!customer.hiddenFromBilling}
                                onCheckedChange={(checked) =>
                                  toggleHiddenMutation.mutate({ customerId: customer.id, hidden: !checked })
                                }
                                disabled={toggleHiddenMutation.isPending}
                              />
                              <span className={`text-xs ${customer.hiddenFromBilling ? "text-slate-400" : "text-sky-600 font-medium"}`}>
                                {customer.hiddenFromBilling ? "Hidden" : "Visible"}
                              </span>
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                            <div className="flex items-center space-x-2 justify-end">
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
                                      Are you sure you want to delete "{customer.name}"? This action cannot be undone and will remove all associated data.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction
                                      className="bg-red-600 hover:bg-red-700"
                                      onClick={() => deleteCustomerMutation.mutate(customer.id)}
                                      disabled={deleteCustomerMutation.isPending}
                                    >
                                      {deleteCustomerMutation.isPending ? "Deleting..." : "Delete Customer"}
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </>
        )}

        <CustomerForm
          trigger={
            <button className="fab sm:hidden" type="button">
              <Plus className="w-7 h-7" />
            </button>
          }
        />
      </PageContent>
    </PageContainer>
  );
}
