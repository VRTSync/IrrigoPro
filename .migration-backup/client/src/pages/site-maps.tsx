import { safeGet, safeSet } from "@/utils/safeStorage";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { MapPin, Search, Eye, Users, Building } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import type { Customer, SiteMap } from "@shared/schema";

interface SiteMapWithCustomer extends SiteMap {
  customer: Customer;
}

export default function SiteMaps() {
  const [searchTerm, setSearchTerm] = useState("");

  // Get current user
  const getCurrentUser = () => {
    const savedUser = safeGet("user");
    return savedUser ? JSON.parse(savedUser) : null;
  };
  const currentUser = getCurrentUser();

  // Fetch billing-visible customers for filtering
  const { data: billingCustomers } = useQuery<Customer[]>({
    queryKey: ['/api/customers', { billingVisible: true }],
    queryFn: () => apiRequest('/api/customers?billingVisible=true'),
    enabled: !!currentUser?.id,
  });

  // Fetch all site maps
  const { data: siteMaps, isLoading } = useQuery({
    queryKey: ['/api/site-maps', (billingCustomers || []).map(c => c.id)],
    queryFn: async () => {
      const maps = await apiRequest('/api/site-maps') as SiteMap[];
      const visibleIds = new Set((billingCustomers || []).map(c => c.id));
      
      // Fetch customer details for each map
      const mapsWithCustomers = await Promise.all(
        maps.map(async (map) => {
          try {
            const customer = await apiRequest(`/api/customers/${map.customerId}`) as Customer;
            return { ...map, customer };
          } catch (error) {
            return { ...map, customer: { id: map.customerId, name: 'Unknown Customer' } as Customer };
          }
        })
      );
      
      // Only show site maps for billing-visible customers
      return mapsWithCustomers.filter(map => map.customerId != null && visibleIds.has(map.customerId));
    },
    enabled: !!currentUser?.id && billingCustomers !== undefined,
  });

  // Filter site maps based on search term
  const filteredSiteMaps = siteMaps?.filter(map =>
    map.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (map.customer.irrigoName || map.customer.name).toLowerCase().includes(searchTerm.toLowerCase()) ||
    map.customer.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    map.customer.address?.toLowerCase().includes(searchTerm.toLowerCase())
  ) || [];

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-6 space-y-6 max-w-6xl">
        <div className="space-y-2">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-5 w-96" />
        </div>
        <Skeleton className="h-10 w-full" />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-6 space-y-6 max-w-6xl">
      {/* Header */}
      <div className="space-y-2">
        <h1 className="text-3xl font-bold text-gray-900">Site Maps</h1>
        <p className="text-gray-600">View all available irrigation site maps</p>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
        <Input
          placeholder="Search maps by name, customer, or address..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="pl-10"
        />
      </div>

      {/* Results Count */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-600">
          {filteredSiteMaps.length} of {siteMaps?.length || 0} site maps
        </p>
      </div>

      {/* Site Maps Grid */}
      {filteredSiteMaps.length === 0 ? (
        <Card className="text-center py-8">
          <CardContent className="space-y-4">
            <MapPin className="h-12 w-12 text-gray-400 mx-auto" />
            <div>
              <h3 className="text-lg font-medium text-gray-900">No site maps found</h3>
              <p className="text-gray-600">
                {searchTerm ? "Try adjusting your search terms" : "No site maps have been created yet"}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredSiteMaps.map((siteMap) => (
            <Card key={siteMap.id} className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <CardTitle className="text-lg">{siteMap.name}</CardTitle>
                    <div className="flex items-center text-sm text-gray-600">
                      <Building className="h-4 w-4 mr-1" />
                      {siteMap.customer.irrigoName || siteMap.customer.name}
                    </div>
                  </div>
                  <Badge variant="secondary" className="ml-2">
                    Active
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Customer Address */}
                {siteMap.customer.address && (
                  <div className="flex items-start text-sm text-gray-600">
                    <MapPin className="h-4 w-4 mr-2 mt-0.5 flex-shrink-0" />
                    <span className="line-clamp-2">{siteMap.customer.address}</span>
                  </div>
                )}

                {/* Map Details */}
                <div className="space-y-2">
                  <div className="text-sm text-gray-500">
                    Created: {new Date(siteMap.createdAt).toLocaleDateString()}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex gap-2 pt-2">
                  <Link href="/customers">
                    <Button 
                      variant="default" 
                      size="sm" 
                      className="flex-1"
                      onClick={() => {
                        // Store the customer and map to auto-select when navigating to customers page
                        if (siteMap.customerId) {
                          safeSet('selectedCustomerId', siteMap.customerId.toString());
                          safeSet('selectedSiteMapId', siteMap.id.toString());
                          safeSet('showSiteMaps', 'true');
                        }
                      }}
                    >
                      <Eye className="h-4 w-4 mr-1" />
                      View Map
                    </Button>
                  </Link>
                  <Link href="/customers">
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="flex-1"
                      onClick={() => {
                        // Store the customer to auto-select when navigating to customers page
                        if (siteMap.customerId) {
                          safeSet('selectedCustomerId', siteMap.customerId.toString());
                          safeSet('showSiteMaps', 'false');
                        }
                      }}
                    >
                      <Users className="h-4 w-4 mr-1" />
                      Customer
                    </Button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}