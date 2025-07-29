import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  Search, 
  Package, 
  Plus, 
  Edit, 
  Trash2, 
  Filter,
  Tag
} from "lucide-react";
import type { Part } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

export default function PartsList() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: parts, isLoading } = useQuery<Part[]>({
    queryKey: ["/api/parts"],
  });

  // Get unique categories for filter
  const categories = Array.from(new Set(parts?.map(part => part.category).filter(Boolean))) || [];

  // Filter parts based on search and category
  const filteredParts = parts?.filter(part => {
    const matchesSearch = !searchQuery || 
      part.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      part.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      part.sku.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesCategory = selectedCategory === "all" || part.category === selectedCategory;
    
    return matchesSearch && matchesCategory;
  });

  const deletePart = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest(`/api/parts/${id}`, { method: 'DELETE' });
    },
    onSuccess: () => {
      toast({
        title: "Part Deleted",
        description: "Part has been removed from the catalog."
      });
      queryClient.invalidateQueries({ queryKey: ["/api/parts"] });
    },
    onError: (error: any) => {
      toast({
        title: "Delete Failed",
        description: error.message || "Failed to delete part",
        variant: "destructive"
      });
    }
  });



  const getCategoryColor = (category: string) => {
    const colors: Record<string, string> = {
      'Sprinklers': 'bg-blue-100 text-blue-800 border-blue-200',
      'Rotors': 'bg-green-100 text-green-800 border-green-200',
      'Pipes': 'bg-yellow-100 text-yellow-800 border-yellow-200',
      'Controllers': 'bg-purple-100 text-purple-800 border-purple-200',
      'Valves': 'bg-red-100 text-red-800 border-red-200',
      'Nozzles': 'bg-indigo-100 text-indigo-800 border-indigo-200',
      'Tubing': 'bg-pink-100 text-pink-800 border-pink-200',
      'Rotators': 'bg-emerald-100 text-emerald-800 border-emerald-200',
      'Spray Heads': 'bg-cyan-100 text-cyan-800 border-cyan-200',
      'Drip Irrigation': 'bg-orange-100 text-orange-800 border-orange-200',
      'Filters': 'bg-gray-100 text-gray-800 border-gray-200',
    };
    return colors[category] || 'bg-gray-100 text-gray-800 border-gray-200';
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* Header */}
      <div className="mb-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Parts Catalog</h1>
            <p className="text-gray-600 mt-1">
              Browse and manage your irrigation parts inventory
            </p>
          </div>
          <div className="mt-4 sm:mt-0">
            <Button className="bg-primary text-white hover:bg-blue-700">
              <Plus className="w-4 h-4 mr-2" />
              Add New Part
            </Button>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">Total Parts</p>
                  <p className="text-2xl font-bold text-gray-900">
                    {parts?.length || 0}
                  </p>
                </div>
                <Package className="w-8 h-8 text-blue-600" />
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">Categories</p>
                  <p className="text-2xl font-bold text-gray-900">
                    {categories.length}
                  </p>
                </div>
                <Filter className="w-8 h-8 text-green-600" />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="mb-6 space-y-4">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
            <Input
              placeholder="Search parts by name, description, or SKU..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
          
          <div className="flex gap-2">
            <Button
              variant={selectedCategory === "all" ? "default" : "outline"}
              size="sm"
              onClick={() => setSelectedCategory("all")}
            >
              All Categories
            </Button>
            {categories.slice(0, 4).map(category => (
              <Button
                key={category}
                variant={selectedCategory === category ? "default" : "outline"}
                size="sm"
                onClick={() => setSelectedCategory(category)}
                className="hidden sm:inline-flex"
              >
                {category}
              </Button>
            ))}
          </div>
        </div>
      </div>

      {/* Parts Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {Array.from({ length: 9 }).map((_, i) => (
            <Card key={i} className="animate-pulse">
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
          ))}
        </div>
      ) : filteredParts?.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <Package className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              {searchQuery || selectedCategory !== "all" ? "No parts found" : "No parts in catalog"}
            </h3>
            <p className="text-gray-600 mb-4">
              {searchQuery || selectedCategory !== "all" 
                ? "Try adjusting your search or filter criteria." 
                : "Get started by adding your first part to the catalog."
              }
            </p>
            <Button className="bg-primary text-white hover:bg-blue-700">
              <Plus className="w-4 h-4 mr-2" />
              Add New Part
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredParts?.map((part) => (
            <Card key={part.id} className="hover:shadow-lg transition-shadow">
              <CardContent className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="bg-blue-50 p-2 rounded-lg">
                    <Package className="w-5 h-5 text-blue-600" />
                  </div>
                  <div className="flex items-center space-x-2">
                    <Button variant="ghost" size="sm" className="text-gray-600 hover:text-gray-900">
                      <Edit className="w-4 h-4" />
                    </Button>
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="text-red-600 hover:text-red-900"
                      onClick={() => deletePart.mutate(part.id)}
                      disabled={deletePart.isPending}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
                
                <div className="mb-3">
                  <h3 className="font-semibold text-gray-900 mb-1 line-clamp-2">
                    {part.name}
                  </h3>
                  {part.description && (
                    <p className="text-sm text-gray-600 line-clamp-2 mb-2">
                      {part.description}
                    </p>
                  )}
                  <div className="flex items-center gap-2 mb-2">
                    <Badge variant="outline" className="text-xs">
                      <Tag className="w-3 h-3 mr-1" />
                      {part.sku}
                    </Badge>
                    {part.category && (
                      <Badge className={`text-xs ${getCategoryColor(part.category)}`}>
                        {part.category}
                      </Badge>
                    )}
                  </div>
                </div>
                
                <div className="flex items-center justify-between pt-3 border-t border-gray-100">
                  <div className="text-sm text-gray-600">
                    Part Number: <span className="font-medium text-gray-900">{part.sku}</span>
                  </div>
                  <div className="text-sm text-gray-600">
                    In Stock
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