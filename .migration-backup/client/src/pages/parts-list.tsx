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
  Tag,
  Grid3X3,
  List,
  ArrowUpDown,
  ArrowUp,
  ArrowDown
} from "lucide-react";
import type { Part } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { PartFormDialog } from "@/components/parts/part-form-dialog";

type SortColumn = "name" | "sku" | "category" | "size" | "material";
type SortDirection = "asc" | "desc";

export default function PartsList() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [viewMode, setViewMode] = useState<"cards" | "list">("cards");
  const [sortColumn, setSortColumn] = useState<SortColumn | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editingPart, setEditingPart] = useState<Part | undefined>(undefined);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: parts, isLoading } = useQuery<Part[]>({
    queryKey: ["/api/parts"],
  });

  const categories = Array.from(new Set(parts?.map(part => part.category).filter(Boolean))) || [];

  const filteredParts = parts?.filter(part => {
    const words = searchQuery.toLowerCase().split(/\s+/).filter(Boolean);
    const matchesSearch = words.length === 0 || words.every(word =>
      part.name.toLowerCase().includes(word) ||
      part.description?.toLowerCase().includes(word) ||
      part.sku.toLowerCase().includes(word)
    );
    const matchesCategory = selectedCategory === "all" || part.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const sortedParts = filteredParts ? [...filteredParts].sort((a, b) => {
    if (!sortColumn) return 0;
    const aVal = (a[sortColumn] ?? "").toLowerCase();
    const bVal = (b[sortColumn] ?? "").toLowerCase();
    if (aVal < bVal) return sortDirection === "asc" ? -1 : 1;
    if (aVal > bVal) return sortDirection === "asc" ? 1 : -1;
    return 0;
  }) : filteredParts;

  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection(prev => prev === "asc" ? "desc" : "asc");
    } else {
      setSortColumn(column);
      setSortDirection("asc");
    }
  };

  const SortIcon = ({ column }: { column: SortColumn }) => {
    if (sortColumn !== column) return <ArrowUpDown className="w-3 h-3 ml-1 inline opacity-40" />;
    return sortDirection === "asc"
      ? <ArrowUp className="w-3 h-3 ml-1 inline text-blue-600" />
      : <ArrowDown className="w-3 h-3 ml-1 inline text-blue-600" />;
  };

  const deletePart = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest(`/api/parts/${id}`, 'DELETE');
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

  const handleEditPart = (part: Part) => {
    setEditingPart(part);
  };

  const handleDialogClose = (open: boolean) => {
    if (!open) {
      setShowAddDialog(false);
      setEditingPart(undefined);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* Part Form Dialog */}
      <PartFormDialog
        part={editingPart}
        open={showAddDialog || editingPart !== undefined}
        onOpenChange={handleDialogClose}
      />

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
            <Button
              className="bg-primary text-white hover:bg-blue-700"
              onClick={() => setShowAddDialog(true)}
            >
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

        {/* View Toggle */}
        <div className="flex justify-end">
          <div className="flex bg-gray-100 rounded-lg p-1">
            <Button
              variant={viewMode === "cards" ? "default" : "ghost"}
              size="sm"
              onClick={() => setViewMode("cards")}
              className="rounded-md"
            >
              <Grid3X3 className="w-4 h-4 mr-2" />
              Cards
            </Button>
            <Button
              variant={viewMode === "list" ? "default" : "ghost"}
              size="sm"
              onClick={() => setViewMode("list")}
              className="rounded-md"
            >
              <List className="w-4 h-4 mr-2" />
              List
            </Button>
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
      ) : sortedParts?.length === 0 ? (
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
            <Button
              className="bg-primary text-white hover:bg-blue-700"
              onClick={() => setShowAddDialog(true)}
            >
              <Plus className="w-4 h-4 mr-2" />
              Add New Part
            </Button>
          </CardContent>
        </Card>
      ) : viewMode === "cards" ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredParts?.map((part) => (
            <Card key={part.id} className="hover:shadow-lg transition-shadow">
              <CardContent className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="bg-blue-50 p-2 rounded-lg">
                    <Package className="w-5 h-5 text-blue-600" />
                  </div>
                  <div className="flex items-center space-x-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-gray-600 hover:text-gray-900"
                      onClick={() => handleEditPart(part)}
                    >
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
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <Badge variant="outline" className="text-xs">
                      <Tag className="w-3 h-3 mr-1" />
                      {part.sku}
                    </Badge>
                    {part.category && (
                      <Badge className={`text-xs ${getCategoryColor(part.category)}`}>
                        {part.category}
                      </Badge>
                    )}
                    {part.size && (
                      <Badge variant="outline" className="text-xs text-gray-600">
                        {part.size}
                      </Badge>
                    )}
                    {part.material && (
                      <Badge variant="outline" className="text-xs text-gray-600">
                        {part.material}
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
      ) : (
        // List View
        <div className="bg-white rounded-lg border">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none"
                    onClick={() => handleSort("name")}
                  >
                    Part Details <SortIcon column="name" />
                  </th>
                  <th
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none"
                    onClick={() => handleSort("sku")}
                  >
                    SKU <SortIcon column="sku" />
                  </th>
                  <th
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none"
                    onClick={() => handleSort("category")}
                  >
                    Category <SortIcon column="category" />
                  </th>
                  <th
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none"
                    onClick={() => handleSort("size")}
                  >
                    Size <SortIcon column="size" />
                  </th>
                  <th
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none"
                    onClick={() => handleSort("material")}
                  >
                    Material <SortIcon column="material" />
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {sortedParts?.map((part) => (
                  <tr key={part.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4">
                      <div className="flex items-start">
                        <div className="bg-blue-50 p-2 rounded-lg mr-3 mt-1">
                          <Package className="w-4 h-4 text-blue-600" />
                        </div>
                        <div>
                          <div className="text-sm font-medium text-gray-900 mb-1">
                            {part.name}
                          </div>
                          {part.description && (
                            <div className="text-sm text-gray-600 max-w-md">
                              {part.description}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <Badge variant="outline" className="text-xs">
                        <Tag className="w-3 h-3 mr-1" />
                        {part.sku}
                      </Badge>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {part.category ? (
                        <Badge className={`text-xs ${getCategoryColor(part.category)}`}>
                          {part.category}
                        </Badge>
                      ) : (
                        <span className="text-gray-400 text-sm">—</span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                      {part.size || <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                      {part.material || <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                        In Stock
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <div className="flex items-center justify-end space-x-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-gray-600 hover:text-gray-900"
                          onClick={() => handleEditPart(part)}
                        >
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
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
