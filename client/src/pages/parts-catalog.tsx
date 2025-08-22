import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Package, Search, Edit, Trash2, FileSpreadsheet, Upload, Settings, Calculator, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useState } from "react";
import type { Part } from "@shared/schema";
import { PartsIntegration } from "@/components/integrations/parts-integration";

export default function PartsCatalog() {
  const [searchQuery, setSearchQuery] = useState("");
  const { toast } = useToast();

  const { data: parts, isLoading } = useQuery<Part[]>({
    queryKey: ["/api/parts"],
  });

  // QuickBooks parts sync mutation
  const syncPartsMutation = useMutation({
    mutationFn: async () => {
      console.log("Triggering QuickBooks parts sync...");
      return await apiRequest("/api/quickbooks/sync-parts", "POST");
    },
    onSuccess: (data) => {
      console.log("QuickBooks parts sync successful:", data);
      toast({
        title: "Parts Sync Successful",
        description: `Found ${data.totalParts} irrigation parts out of ${data.filteredFrom} total items`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/parts"] });
    },
    onError: (error: any) => {
      console.error("QuickBooks parts sync failed:", error);
      toast({
        title: "Sync Failed",
        description: error.message || "Failed to sync parts from QuickBooks",
        variant: "destructive",
      });
    },
  });

  const filteredParts = parts?.filter(part =>
    part.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    part.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    part.sku.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* Header */}
      <div className="mb-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Parts Catalog</h1>
            <p className="text-gray-600 mt-1">Manage your irrigation parts and pricing</p>
          </div>
          <div className="mt-4 sm:mt-0 flex gap-2">
            <Button className="bg-primary text-white hover:bg-blue-700">
              <Plus className="w-4 h-4 mr-2" />
              Add New Part
            </Button>
          </div>
        </div>
      </div>

      <Tabs defaultValue="catalog" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="catalog">Parts Catalog</TabsTrigger>
          <TabsTrigger value="integrations">
            <Settings className="w-4 h-4 mr-2" />
            Integrations
          </TabsTrigger>
        </TabsList>

        <TabsContent value="catalog" className="space-y-4">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
            <Input
              placeholder="Search parts catalog..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>

          {/* Parts Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {isLoading ? (
          Array.from({ length: 9 }).map((_, i) => (
            <Card key={i} className="bg-white shadow-sm border border-gray-200">
              <CardContent className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <Skeleton className="h-8 w-8 rounded-lg" />
                  <Skeleton className="h-4 w-16" />
                </div>
                <Skeleton className="h-5 w-3/4 mb-2" />
                <Skeleton className="h-4 w-full mb-4" />
                <div className="flex items-center justify-between">
                  <Skeleton className="h-6 w-16" />
                  <Skeleton className="h-4 w-20" />
                </div>
              </CardContent>
            </Card>
          ))
        ) : (
          filteredParts?.map((part) => (
            <Card key={part.id} className="bg-white shadow-sm border border-gray-200 hover:shadow-md transition-shadow">
              <CardContent className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="bg-blue-50 p-2 rounded-lg">
                    <Package className="w-5 h-5 text-blue-600" />
                  </div>
                  <div className="flex items-center space-x-2">
                    <Button variant="ghost" size="sm" className="text-gray-600 hover:text-gray-900">
                      <Edit className="w-4 h-4" />
                    </Button>
                    <Button variant="ghost" size="sm" className="text-gray-600 hover:text-red-600">
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
                <div>
                  <h3 className="font-medium text-gray-900 mb-2">{part.name}</h3>
                  <p className="text-sm text-gray-600 mb-4">{part.description}</p>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-lg font-semibold text-gray-900">{formatCurrency(parseFloat(part.price))}</p>
                      <p className="text-xs text-gray-500">SKU: {part.sku}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm text-gray-600">{part.laborHours} hours</p>
                      <p className="text-xs text-gray-500">Labor time</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
          </div>

          {/* Empty State */}
          {!isLoading && filteredParts?.length === 0 && (
            <Card className="bg-white shadow-sm border border-gray-200">
              <CardContent className="p-12 text-center">
                <Package className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">No parts found</h3>
                <p className="text-gray-600 mb-4">
                  {searchQuery ? "No parts match your search criteria." : "Get started by adding your first part to the catalog."}
                </p>
                <Button className="bg-primary text-white hover:bg-blue-700">
                  <Plus className="w-4 h-4 mr-2" />
                  Add New Part
                </Button>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="integrations" className="space-y-6">
          <Card className="bg-white shadow-sm border border-gray-200">
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center space-x-3">
                  <div className="bg-green-50 p-2 rounded-lg">
                    <Calculator className="w-5 h-5 text-green-600" />
                  </div>
                  <div>
                    <h3 className="font-medium text-gray-900">QuickBooks Parts Sync</h3>
                    <p className="text-sm text-gray-600">Sync irrigation parts from your QuickBooks inventory</p>
                  </div>
                </div>
                <Button 
                  className="bg-green-600 text-white hover:bg-green-700"
                  onClick={() => syncPartsMutation.mutate()}
                  disabled={syncPartsMutation.isPending}
                >
                  <RefreshCw className={`w-4 h-4 mr-2 ${syncPartsMutation.isPending ? 'animate-spin' : ''}`} />
                  {syncPartsMutation.isPending ? 'Syncing...' : 'Sync Parts'}
                </Button>
              </div>
              <div className="bg-blue-50 p-4 rounded-lg">
                <h4 className="font-medium text-blue-900 mb-2">Irrigation Parts Filter</h4>
                <p className="text-sm text-blue-700 mb-3">
                  This sync will only import QuickBooks inventory items that contain irrigation-related keywords:
                </p>
                <div className="flex flex-wrap gap-2">
                  {['sprinkler', 'irrigation', 'valve', 'controller', 'nozzle', 'pipe', 'fitting', 'timer', 'drip', 'emitter', 'backflow', 'decoder', 'filter', 'bushing'].map(keyword => (
                    <Badge key={keyword} variant="secondary" className="bg-blue-100 text-blue-800">
                      {keyword}
                    </Badge>
                  ))}
                </div>
                <p className="text-xs text-blue-600 mt-3">
                  Only items with these keywords in their name or description will be imported.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-white shadow-sm border border-gray-200">
            <CardContent className="p-6">
              <div className="flex items-center space-x-3 mb-4">
                <div className="bg-orange-50 p-2 rounded-lg">
                  <Settings className="w-5 h-5 text-orange-600" />
                </div>
                <div>
                  <h3 className="font-medium text-gray-900">Sync Settings</h3>
                  <p className="text-sm text-gray-600">Configure how parts are imported from QuickBooks</p>
                </div>
              </div>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-900">Include inactive items</p>
                    <p className="text-xs text-gray-600">Import parts marked as inactive in QuickBooks</p>
                  </div>
                  <Button variant="outline" size="sm">Configure</Button>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-900">Price synchronization</p>
                    <p className="text-xs text-gray-600">Update local prices when QuickBooks prices change</p>
                  </div>
                  <Button variant="outline" size="sm">Configure</Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
