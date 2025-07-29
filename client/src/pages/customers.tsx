import { useQuery } from "@tanstack/react-query";
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

export default function Customers() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [userRole, setUserRole] = useState<string>("company_admin");

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

  const filteredCustomers = customers?.filter(customer =>
    customer.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    customer.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
    customer.phone?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Show customer profile if selected
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
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* Header */}
      <div className="mb-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Customers</h1>
            <p className="text-gray-600 mt-1">Manage your customer database</p>
          </div>
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
        </div>
      </div>

      <Tabs defaultValue="customers" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="customers">Customer List</TabsTrigger>
          <TabsTrigger value="integrations">
            <Settings className="w-4 h-4 mr-2" />
            Integrations
          </TabsTrigger>
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
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Contact
                        </th>
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
                      <tr key={customer.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center">
                            <div className="bg-blue-50 p-2 rounded-lg mr-3">
                              <Users className="w-4 h-4 text-blue-600" />
                            </div>
                            <div className="flex-1">
                              <div className="text-sm font-medium text-gray-900">{customer.name}</div>
                            </div>
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              className="text-blue-600 hover:text-blue-900 ml-2"
                              onClick={() => setSelectedCustomer(customer)}
                            >
                              <Eye className="w-4 h-4" />
                            </Button>
                          </div>
                        </td>
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
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-900">{customer.address}</div>
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
                            <Button variant="ghost" size="sm" className="text-gray-600 hover:text-red-600" onClick={(e) => e.stopPropagation()}>
                              <Trash2 className="w-4 h-4" />
                            </Button>
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

          {/* Mobile Card View */}
          <div className="lg:hidden space-y-4">
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <Card key={i} className="bg-white shadow-sm border border-gray-200">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center">
                        <Skeleton className="h-10 w-10 rounded-lg mr-3" />
                        <div>
                          <Skeleton className="h-4 w-32 mb-1" />
                          <Skeleton className="h-3 w-24" />
                        </div>
                      </div>
                      <Skeleton className="h-8 w-8" />
                    </div>
                    <div className="space-y-2">
                      <Skeleton className="h-3 w-40" />
                      <Skeleton className="h-3 w-24" />
                      <Skeleton className="h-3 w-48" />
                    </div>
                  </CardContent>
                </Card>
              ))
            ) : (
              filteredCustomers?.map((customer) => (
                <Card key={customer.id} className="bg-white shadow-sm border border-gray-200 hover:shadow-md transition-shadow">
                  <CardContent className="p-4">
                    {/* Header */}
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center">
                        <div className="bg-blue-50 p-2 rounded-lg mr-3">
                          <Users className="w-5 h-5 text-blue-600" />
                        </div>
                        <div>
                          <div className="text-sm font-semibold text-gray-900">{customer.name}</div>
                          <button
                            onClick={() => setSelectedCustomer(customer)}
                            className="text-xs text-blue-600 hover:text-blue-800 hover:underline"
                          >
                            View Details
                          </button>
                        </div>
                      </div>
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        className="text-blue-600 hover:text-blue-900"
                        onClick={() => setSelectedCustomer(customer)}
                      >
                        <Eye className="w-4 h-4" />
                      </Button>
                    </div>

                    {/* Contact Info */}
                    <div className="space-y-2 mb-4">
                      <div className="flex items-center text-sm text-gray-900">
                        <Mail className="w-4 h-4 mr-2 text-gray-400 flex-shrink-0" />
                        <span className="break-all">{customer.email}</span>
                      </div>
                      {customer.phone && (
                        <div className="flex items-center text-sm text-gray-600">
                          <Phone className="w-4 h-4 mr-2 text-gray-400 flex-shrink-0" />
                          <span>{customer.phone}</span>
                        </div>
                      )}
                      <div className="flex items-start text-sm text-gray-600">
                        <div className="w-4 h-4 mr-2 text-gray-400 flex-shrink-0 mt-0.5">
                          📍
                        </div>
                        <span className="break-words">{customer.address}</span>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center space-x-2 pt-3 border-t border-gray-100">
                      <CustomerForm
                        customer={customer}
                        trigger={
                          <Button variant="outline" size="sm" className="flex-1">
                            <Edit className="w-4 h-4 mr-2" />
                            Edit
                          </Button>
                        }
                      />
                      <Button variant="outline" size="sm" className="text-red-600 hover:text-red-700 hover:bg-red-50">
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>

          {/* Empty State */}
          {!isLoading && filteredCustomers?.length === 0 && (
            <Card className="bg-white shadow-sm border border-gray-200">
              <CardContent className="p-12 text-center">
                <Users className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">No customers found</h3>
                <p className="text-gray-600 mb-4">
                  {searchQuery ? "No customers match your search criteria." : "Get started by adding your first customer."}
                </p>
                <CustomerForm
                  trigger={
                    <Button className="bg-primary text-white hover:bg-blue-700">
                      <Plus className="w-4 h-4 mr-2" />
                      Add New Customer
                    </Button>
                  }
                />
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="integrations">
          <CustomerIntegration />
        </TabsContent>
      </Tabs>
    </div>
  );
}
