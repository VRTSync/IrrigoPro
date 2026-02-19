import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Search, Package } from "lucide-react";

interface PartsListManagerProps {
  onBack: () => void;
}

interface PartWithoutPrice {
  id: number;
  name: string;
  description: string;
  sku: string;
  category: string;
}

export function PartsListManager({ onBack }: PartsListManagerProps) {
  const [searchQuery, setSearchQuery] = useState("");

  const { data: parts, isLoading } = useQuery<PartWithoutPrice[]>({
    queryKey: ["/api/parts/field-tech"], // This endpoint excludes pricing
  });

  const filteredParts = parts?.filter(part =>
    part.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    part.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    part.sku.toLowerCase().includes(searchQuery.toLowerCase()) ||
    part.category?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const getCategoryColor = (category: string) => {
    const colors: Record<string, string> = {
      'Sprinklers': 'bg-blue-100 text-blue-800',
      'Rotors': 'bg-green-100 text-green-800',
      'Pipes': 'bg-yellow-100 text-yellow-800',
      'Controllers': 'bg-purple-100 text-purple-800',
      'Valves': 'bg-red-100 text-red-800',
      'Nozzles': 'bg-indigo-100 text-indigo-800',
      'Tubing': 'bg-pink-100 text-pink-800',
    };
    return colors[category] || 'bg-gray-100 text-gray-800';
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <Button variant="outline" onClick={onBack}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Dashboard
          </Button>
          <h1 className="text-3xl font-bold text-gray-900">Parts List</h1>
        </div>
      </div>

      {/* Search */}
      <div className="mb-6">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
          <Input
            placeholder="Search parts..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>

      {/* Parts Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {isLoading ? (
          Array.from({ length: 9 }).map((_, i) => (
            <Card key={i} className="animate-pulse">
              <CardContent className="p-4">
                <div className="h-4 bg-gray-200 rounded mb-2"></div>
                <div className="h-3 bg-gray-200 rounded mb-2"></div>
                <div className="h-3 bg-gray-200 rounded w-2/3"></div>
              </CardContent>
            </Card>
          ))
        ) : filteredParts?.length === 0 ? (
          <div className="col-span-full text-center py-8">
            <Package className="w-16 h-16 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-500">
              {searchQuery ? "No parts match your search" : "No parts available"}
            </p>
          </div>
        ) : (
          filteredParts?.map((part) => (
            <Card key={part.id} className="hover:shadow-md transition-shadow">
              <CardContent className="p-4">
                <div className="flex items-start justify-between mb-3">
                  <div className="bg-blue-50 p-2 rounded-lg">
                    <Package className="w-5 h-5 text-blue-600" />
                  </div>
                  <Badge className={getCategoryColor(part.category)}>
                    {part.category}
                  </Badge>
                </div>
                
                <h3 className="font-semibold text-gray-900 mb-2 line-clamp-2">
                  {part.name}
                </h3>
                
                <p className="text-sm text-gray-600 mb-3 line-clamp-2">
                  {part.description || 'No description available'}
                </p>
                
                <div>
                  <p className="text-xs text-gray-500">SKU</p>
                  <p className="text-sm font-medium text-gray-900">{part.sku}</p>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* Parts Count */}
      {filteredParts && (
        <div className="mt-6 text-center">
          <p className="text-sm text-gray-500">
            Showing {filteredParts.length} of {parts?.length} parts
          </p>
        </div>
      )}
    </div>
  );
}