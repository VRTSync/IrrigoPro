import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, Package, Plus } from "lucide-react";
import type { Part } from "@shared/schema";

interface PartsSearchModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectPart: (part: Part, quantity?: number) => void;
}

export function PartsSearchModal({ open, onOpenChange, onSelectPart }: PartsSearchModalProps) {
  const [searchQuery, setSearchQuery] = useState("");

  const { data: parts, isLoading } = useQuery<Part[]>({
    queryKey: ["/api/parts"],
    enabled: open,
  });

  // Fetch popular parts for the frequently used section
  const { data: popularParts, isLoading: isLoadingPopular } = useQuery<(Part & { usageCount: number })[]>({
    queryKey: ["/api/parts/popular"],
    enabled: open,
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

  const handleSelectPart = (part: Part) => {
    onSelectPart(part, 1);
    onOpenChange(false);
    setSearchQuery("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Parts to Estimate</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
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

          {/* Popular Parts Section */}
          {!searchQuery && popularParts && popularParts.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-gray-900 flex items-center gap-2">
                <Package className="w-4 h-4 text-blue-600" />
                Frequently Used Parts
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {popularParts.slice(0, 6).map((part) => (
                  <button
                    key={part.id}
                    onClick={() => handleSelectPart(part)}
                    className="flex items-center gap-3 p-3 border border-gray-200 rounded-lg hover:border-blue-300 hover:bg-blue-50 transition-all text-left group"
                  >
                    <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center group-hover:bg-blue-200">
                      <Package className="w-4 h-4 text-blue-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-900 truncate">{part.name}</div>
                      <div className="text-xs text-gray-500">Used {part.usageCount} times</div>
                    </div>
                    <Plus className="w-4 h-4 text-gray-400 group-hover:text-blue-600" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* All Parts List */}
          <div className="space-y-3">
            {!searchQuery && <h3 className="text-sm font-medium text-gray-900">All Parts Catalog</h3>}
            <div className="space-y-3 max-h-96 overflow-y-auto">
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center justify-between p-4 border border-gray-200 rounded-lg">
                  <div className="flex items-center space-x-4">
                    <Skeleton className="h-10 w-10 rounded-lg" />
                    <div className="space-y-2">
                      <Skeleton className="h-4 w-32" />
                      <Skeleton className="h-3 w-48" />
                      <Skeleton className="h-3 w-24" />
                    </div>
                  </div>
                  <div className="text-right space-y-2">
                    <Skeleton className="h-4 w-16" />
                    <Skeleton className="h-8 w-12" />
                  </div>
                </div>
              ))
            ) : (
              filteredParts?.map((part) => (
                <div
                  key={part.id}
                  className="flex items-center justify-between p-4 border border-gray-200 rounded-lg hover:bg-gray-50"
                >
                  <div className="flex items-center space-x-4">
                    <div className="bg-blue-50 p-2 rounded-lg">
                      <Package className="w-5 h-5 text-blue-600" />
                    </div>
                    <div>
                      <p className="font-medium text-gray-900">{part.name}</p>
                      <p className="text-sm text-gray-600">{part.description}</p>
                      <p className="text-xs text-gray-500">
                        Labor: {part.laborHours} hours • SKU: {part.sku}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-gray-900">{formatCurrency(parseFloat(part.price))}</p>
                    <Button
                      onClick={() => handleSelectPart(part)}
                      className="mt-2 bg-primary text-white hover:bg-blue-700"
                      size="sm"
                    >
                      <Plus className="w-4 h-4 mr-1" />
                      Add
                    </Button>
                  </div>
                </div>
              ))
            )}
            </div>

            {/* Empty State */}
            {!isLoading && filteredParts?.length === 0 && (
              <div className="text-center py-8">
                <Package className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-500">
                  {searchQuery ? "No parts match your search criteria." : "No parts available."}
                </p>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
