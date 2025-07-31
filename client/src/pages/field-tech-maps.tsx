import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { MapPin, Search, Eye, Users } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import type { Customer, SiteMap } from "@shared/schema";

interface CustomerWithMaps extends Customer {
  siteMaps: SiteMap[];
}

export default function FieldTechMaps() {
  const [searchTerm, setSearchTerm] = useState("");

  // Get current user
  const getCurrentUser = () => {
    const savedUser = localStorage.getItem("user");
    return savedUser ? JSON.parse(savedUser) : null;
  };
  const currentUser = getCurrentUser();

  // Fetch customers with their site maps
  const { data: customersWithMaps, isLoading } = useQuery({
    queryKey: ['/api/customers/with-maps'],
    queryFn: async () => {
      const customers = await apiRequest('/api/customers') as Customer[];
      
      // Fetch site maps for each customer
      const customersWithMaps = await Promise.all(
        customers.map(async (customer) => {
          try {
            const siteMaps = await apiRequest(`/api/customers/${customer.id}/site-maps`) as SiteMap[];
            return { ...customer, siteMaps };
          } catch (error) {
            return { ...customer, siteMaps: [] };
          }
        })
      );
      
      return customersWithMaps.filter(customer => customer.siteMaps.length > 0);
    },
    enabled: !!currentUser?.id,
  });

  // Filter customers based on search term
  const filteredCustomers = customersWithMaps?.filter(customer =>
    customer.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    customer.address?.toLowerCase().includes(searchTerm.toLowerCase())
  ) || [];

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-6 space-y-6 max-w-4xl">
        <div className="space-y-2">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-5 w-96" />
        </div>
        <Skeleton className="h-10 w-full" />
        <div className="grid gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-6 space-y-6 max-w-4xl">
      {/* Header */}
      <div className="space-y-2">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <MapPin className="w-6 h-6 text-blue-600" />
          Customer Site Maps
        </h1>
        <p className="text-gray-600">Quick access to customer irrigation site maps and controllers</p>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
        <Input
          placeholder="Search customers or locations..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="pl-10"
        />
      </div>

      {/* Customer List */}
      {filteredCustomers.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <div className="text-center text-gray-500">
              <MapPin className="w-12 h-12 mx-auto mb-4 text-gray-300" />
              <h3 className="text-lg font-medium mb-2">No Site Maps Found</h3>
              <p>No customers have uploaded site maps yet.</p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {filteredCustomers.map((customer) => (
            <Card key={customer.id} className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Users className="w-5 h-5 text-blue-600" />
                      {customer.name}
                    </CardTitle>
                    {customer.address && (
                      <p className="text-sm text-gray-600 flex items-center gap-1">
                        <MapPin className="w-4 h-4" />
                        {customer.address}
                      </p>
                    )}
                  </div>
                  <Badge variant="secondary" className="ml-2">
                    {customer.siteMaps.length} Map{customer.siteMaps.length !== 1 ? 's' : ''}
                  </Badge>
                </div>
              </CardHeader>
              
              <CardContent className="pt-0">
                <div className="space-y-3">
                  {/* Site Maps */}
                  <div className="grid gap-2 sm:grid-cols-2">
                    {customer.siteMaps.map((siteMap) => (
                      <div key={siteMap.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm truncate">{siteMap.name}</p>
                          <p className="text-xs text-gray-500">
                            Site Map Available
                          </p>
                        </div>
                        <Link href={`/customers/${customer.id}/site-maps`}>
                          <Button size="sm" variant="outline" className="ml-2 shrink-0">
                            <Eye className="w-4 h-4 mr-1" />
                            View
                          </Button>
                        </Link>
                      </div>
                    ))}
                  </div>

                  {/* Quick Access Button */}
                  <div className="pt-2 border-t">
                    <Link href={`/customers/${customer.id}/site-maps`}>
                      <Button variant="default" size="sm" className="w-full">
                        <MapPin className="w-4 h-4 mr-2" />
                        View All Site Maps
                      </Button>
                    </Link>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}