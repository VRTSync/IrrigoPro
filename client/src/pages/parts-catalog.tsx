import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Package, Search, Edit, Trash2, FileSpreadsheet, Upload, Settings, Calculator, Filter, DollarSign, Clock, ChevronDown, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type { Part } from "@shared/schema";
import { insertPartSchema } from "@shared/schema";

import { BulkImport } from "@/components/parts/bulk-import";

// Irrigation parts categories based on your CSV
const PART_CATEGORIES = [
  "Backflow", "Bushing", "Controller", "Decoder", "Filter", "Fitting", 
  "Head", "Irrigation Box", "Labor", "Misc", "Module", "Nipple", 
  "Nozzle", "Pipe", "Rental", "Service", "Valve", "Wire"
];

const MATERIALS = [
  "PVC", "Copper", "Brass", "NETAFIM", "POLY", "BACKFLOW", "Insert"
];

const BRANDS = [
  "Hunter", "Rainbird", "Febco", "LEIT", "EBON", "Wilkins", "Mcdonald", "Leemco", "Ranier"
];

const FITTING_TYPES = [
  "90° Coupler", "45° Coupler", "Tee", "Union", "Cap", "Coupler", "Male Adapter", 
  "Female Adapter", "Plug", "Slip-Fix", "Cross", "Manifold", "Ball Valve"
];

const COMMON_SIZES = [
  "0.125\"", "0.25\"", "0.375\"", "0.5\"", "0.75\"", "1\"", "1.25\"", "1.5\"", 
  "2\"", "2.5\"", "3\"", "4\"", "6\"", "8\"", "10\"", "12\""
];

const PartFormSchema = insertPartSchema;

interface PartFormDialogProps {
  part?: Part;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function PartFormDialog({ part, open, onOpenChange }: PartFormDialogProps) {
  const { toast } = useToast();
  
  const form = useForm<z.infer<typeof PartFormSchema>>({
    resolver: zodResolver(PartFormSchema),
    defaultValues: {
      companyId: 1, // Default company ID
      name: "",
      description: "",
      price: "0.00",
      cost: "",
      laborHours: "1.00",
      sku: "",
      category: "",
      material: "",
      size: "",
      brand: "",
      fittingType: "",
      detail: "",
      isActive: true,
    },
  });

  // Reset form when part changes (for editing)
  useEffect(() => {
    if (part) {
      form.reset({
        companyId: 3,
        name: part.name || "",
        description: part.description || "",
        price: part.price?.toString() || "0.00",
        cost: part.cost?.toString() || "",
        laborHours: part.laborHours?.toString() || "1.00",
        sku: part.sku || "",
        category: part.category || "",
        material: part.material || "",
        size: part.size || "",
        brand: part.brand || "",
        fittingType: part.fittingType || "",
        detail: part.detail || "",
        isActive: part.isActive ?? true,
      });
    } else {
      // Reset to empty form for adding new part
      form.reset({
        companyId: 3,
        name: "",
        description: "",
        price: "0.00",
        cost: "",
        laborHours: "1.00",
        sku: "",
        category: "",
        material: "",
        size: "",
        brand: "",
        fittingType: "",
        detail: "",
        isActive: true,
      });
    }
  }, [part, form]);

  const createPartMutation = useMutation({
    mutationFn: async (data: z.infer<typeof PartFormSchema>) => {
      return await apiRequest("/api/parts", "POST", data);
    },
    onSuccess: () => {
      toast({
        title: "Part Created",
        description: "Part has been added to your catalog",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/parts"] });
      onOpenChange(false);
      form.reset();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create part",
        variant: "destructive",
      });
    },
  });

  const updatePartMutation = useMutation({
    mutationFn: async (data: z.infer<typeof PartFormSchema>) => {
      return await apiRequest(`/api/parts/${part?.id}`, "PATCH", data);
    },
    onSuccess: () => {
      toast({
        title: "Part Updated",
        description: "Part has been updated successfully",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/parts"] });
      onOpenChange(false);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update part",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: z.infer<typeof PartFormSchema>) => {
    // Transform "none" values to null for optional fields
    const processedData = {
      ...data,
      material: data.material === "none" ? null : data.material,
      size: data.size === "none" ? null : data.size,
      brand: data.brand === "none" ? null : data.brand,
      fittingType: data.fittingType === "none" ? null : data.fittingType,
      detail: data.detail === "none" ? null : data.detail,
    };
    
    if (part) {
      updatePartMutation.mutate(processedData);
    } else {
      createPartMutation.mutate(processedData);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{part ? "Edit Part" : "Add New Part"}</DialogTitle>
          <DialogDescription>
            {part ? "Update the part details below" : "Add a new irrigation part to your catalog"}
          </DialogDescription>
        </DialogHeader>
        
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Part Name *</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="e.g., Sprinkler Head - Hunter - 1 inch" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <FormField
                control={form.control}
                name="sku"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>SKU *</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="e.g., HUN-SP-1IN" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <FormField
                control={form.control}
                name="category"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Category *</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select category" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {PART_CATEGORIES.map((category) => (
                          <SelectItem key={category} value={category}>
                            {category}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <FormField
                control={form.control}
                name="material"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Material</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value || "none"}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select material" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        {MATERIALS.map((material) => (
                          <SelectItem key={material} value={material}>
                            {material}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <FormField
                control={form.control}
                name="size"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Size</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value || "none"}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select size" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        {COMMON_SIZES.map((size) => (
                          <SelectItem key={size} value={size}>
                            {size}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <FormField
                control={form.control}
                name="brand"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Brand</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value || "none"}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select brand" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        {BRANDS.map((brand) => (
                          <SelectItem key={brand} value={brand}>
                            {brand}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <FormField
                control={form.control}
                name="fittingType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Fitting Type</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value || "none"}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select fitting type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        {FITTING_TYPES.map((type) => (
                          <SelectItem key={type} value={type}>
                            {type}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <FormField
                control={form.control}
                name="price"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Price ($) *</FormLabel>
                    <FormControl>
                      <Input {...field} type="number" step="0.01" min="0" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <FormField
                control={form.control}
                name="cost"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Cost ($)</FormLabel>
                    <FormControl>
                      <Input {...field} type="number" step="0.01" min="0" value={field.value || ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <FormField
                control={form.control}
                name="laborHours"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Labor Hours *</FormLabel>
                    <FormControl>
                      <Input {...field} type="number" step="0.25" min="0" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            
            <FormField
              control={form.control}
              name="detail"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Detail</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="Additional specifications" value={field.value || ""} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Textarea {...field} placeholder="Detailed description of the part" value={field.value || ""} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <div className="flex justify-end space-x-2 pt-4">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button 
                type="submit" 
                disabled={createPartMutation.isPending || updatePartMutation.isPending}
              >
                {createPartMutation.isPending || updatePartMutation.isPending ? "Saving..." : part ? "Update Part" : "Create Part"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

export default function PartsCatalog() {
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("");
  const [materialFilter, setMaterialFilter] = useState<string>("");
  const [selectedPart, setSelectedPart] = useState<Part | undefined>();
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const { toast } = useToast();

  // Get current user role to determine permissions
  const getCurrentUserRole = (): string => {
    const user = JSON.parse(localStorage.getItem("user") || "{}");
    return user.role || "";
  };
  
  const userRole = getCurrentUserRole();
  const canImport = userRole === "company_admin" || userRole === "super_admin";

  const { data: parts, isLoading } = useQuery<Part[]>({
    queryKey: ["/api/parts"],
  });



  const deletePartMutation = useMutation({
    mutationFn: async (partId: number) => {
      return await apiRequest(`/api/parts/${partId}`, "DELETE");
    },
    onSuccess: () => {
      toast({
        title: "Part Deleted",
        description: "Part has been removed from your catalog",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/parts"] });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete part",
        variant: "destructive",
      });
    },
  });

  const filteredParts = parts?.filter(part => {
    const matchesSearch = part.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      part.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      part.sku.toLowerCase().includes(searchQuery.toLowerCase()) ||
      part.brand?.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesCategory = !categoryFilter || categoryFilter === "all" || part.category === categoryFilter;
    const matchesMaterial = !materialFilter || materialFilter === "all" || part.material === materialFilter;
    
    return matchesSearch && matchesCategory && matchesMaterial;
  });

  const groupedParts = filteredParts?.reduce((acc, part) => {
    const category = part.category || 'Uncategorized';
    if (!acc[category]) {
      acc[category] = [];
    }
    acc[category].push(part);
    return acc;
  }, {} as Record<string, Part[]>);

  const formatCurrency = (amount: string | number) => {
    const num = typeof amount === 'string' ? parseFloat(amount) : amount;
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(num);
  };

  const handleEditPart = (part: Part) => {
    setSelectedPart(part);
    setIsFormOpen(true);
  };

  const handleAddPart = () => {
    setSelectedPart(undefined);
    setIsFormOpen(true);
  };

  const toggleSection = (category: string) => {
    const newCollapsed = new Set(collapsedSections);
    if (newCollapsed.has(category)) {
      newCollapsed.delete(category);
    } else {
      newCollapsed.add(category);
    }
    setCollapsedSections(newCollapsed);
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold">Parts Catalog</h1>
          <p className="text-muted-foreground">
            Manage your irrigation parts inventory with categorized organization
          </p>
        </div>
        
        <div className="flex gap-2">
          <Button onClick={handleAddPart} className="gap-2">
            <Plus className="h-4 w-4" />
            Add Part
          </Button>
        </div>
      </div>

      <Tabs defaultValue="catalog" className="w-full">
        <TabsList>
          <TabsTrigger value="catalog">Parts Catalog</TabsTrigger>
          {canImport && <TabsTrigger value="import">Bulk Import</TabsTrigger>}
        </TabsList>

        <TabsContent value="catalog" className="space-y-6">
          {/* Search and Filters */}
          <div className="flex flex-col md:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
              <Input
                placeholder="Search parts, SKU, or description..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-full md:w-48">
                <SelectValue placeholder="All Categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {PART_CATEGORIES.map((category) => (
                  <SelectItem key={category} value={category}>
                    {category}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            
            <Select value={materialFilter} onValueChange={setMaterialFilter}>
              <SelectTrigger className="w-full md:w-48">
                <SelectValue placeholder="All Materials" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Materials</SelectItem>
                {MATERIALS.map((material) => (
                  <SelectItem key={material} value={material}>
                    {material}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Parts Display */}
          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-48" />
              ))}
            </div>
          ) : !filteredParts?.length ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Package className="h-12 w-12 text-muted-foreground mb-4" />
                <h3 className="text-lg font-semibold mb-2">No Parts Found</h3>
                <p className="text-muted-foreground text-center mb-4">
                  {parts?.length === 0 
                    ? "Start by adding parts to your catalog or syncing from QuickBooks"
                    : "Try adjusting your search filters"
                  }
                </p>
                {parts?.length === 0 && (
                  <Button onClick={handleAddPart} className="gap-2">
                    <Plus className="h-4 w-4" />
                    Add Your First Part
                  </Button>
                )}
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-6">
              {Object.entries(groupedParts || {}).map(([category, categoryParts]) => {
                const isCollapsed = collapsedSections.has(category);
                return (
                  <Collapsible key={category} open={!isCollapsed} onOpenChange={() => toggleSection(category)}>
                    <div className="space-y-4">
                      <CollapsibleTrigger asChild>
                        <div className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 p-2 rounded-lg transition-colors">
                          {isCollapsed ? (
                            <ChevronRight className="h-5 w-5 text-muted-foreground" />
                          ) : (
                            <ChevronDown className="h-5 w-5 text-muted-foreground" />
                          )}
                          <h2 className="text-xl font-semibold">{category}</h2>
                          <Badge variant="secondary">{categoryParts.length}</Badge>
                        </div>
                      </CollapsibleTrigger>
                      
                      <CollapsibleContent>
                  
                  {/* Desktop Table View */}
                  <div className="hidden md:block">
                    <div className="rounded-lg border bg-card shadow-sm">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-blue-600 hover:bg-blue-600 border-b border-blue-700">
                            <TableHead className="font-semibold text-white text-sm py-2">Part Name</TableHead>
                            <TableHead className="font-semibold text-white text-sm py-2">Description</TableHead>
                            <TableHead className="font-semibold text-white text-sm py-2 text-right">Cost</TableHead>
                            <TableHead className="font-semibold text-white text-sm py-2 text-right">Price</TableHead>
                            <TableHead className="font-semibold text-white text-sm py-2 text-center">Labor</TableHead>
                            <TableHead className="font-semibold text-white text-sm py-2 text-right">Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {categoryParts.map((part, index) => (
                            <TableRow 
                              key={part.id} 
                              className={`transition-colors border-b ${
                                index === categoryParts.length - 1 ? 'border-b-0' : ''
                              } ${
                                index % 2 === 0 
                                  ? 'bg-white dark:bg-gray-950 hover:bg-blue-50 dark:hover:bg-blue-950/30' 
                                  : 'bg-gray-50 dark:bg-gray-900 hover:bg-blue-50 dark:hover:bg-blue-950/30'
                              }`}
                            >
                              <TableCell className="py-3">
                                <div className="font-medium text-sm leading-tight">{part.name}</div>
                              </TableCell>
                              <TableCell className="py-3">
                                <div className="text-xs text-muted-foreground max-w-md">
                                  {part.description || 'No description available'}
                                </div>
                              </TableCell>
                              <TableCell className="py-3 text-right">
                                <div className="flex items-center justify-end gap-1">
                                  <DollarSign className="h-3 w-3 text-orange-600" />
                                  <span className="font-semibold text-sm text-orange-700 dark:text-orange-400">
                                    {part.cost ? formatCurrency(part.cost) : '-'}
                                  </span>
                                </div>
                              </TableCell>
                              <TableCell className="py-3 text-right">
                                <div className="flex items-center justify-end gap-1">
                                  <DollarSign className="h-3 w-3 text-green-600" />
                                  <span className="font-semibold text-sm text-green-700 dark:text-green-400">
                                    {formatCurrency(part.price)}
                                  </span>
                                </div>
                              </TableCell>
                              <TableCell className="py-3 text-center">
                                <div className="flex items-center justify-center gap-1">
                                  <Clock className="h-3 w-3 text-blue-600" />
                                  <span className="font-medium text-xs text-blue-700 dark:text-blue-400">
                                    {part.laborHours}h
                                  </span>
                                </div>
                              </TableCell>
                              <TableCell className="py-3 text-right">
                                <div className="flex justify-end gap-1">
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="hover:bg-blue-100 hover:text-blue-700 dark:hover:bg-blue-900 dark:hover:text-blue-300 h-7 px-2"
                                    onClick={() => handleEditPart(part)}
                                  >
                                    <Edit className="h-3 w-3" />
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="hover:bg-red-100 hover:text-red-700 dark:hover:bg-red-900 dark:hover:text-red-300 h-7 px-2"
                                    onClick={() => deletePartMutation.mutate(part.id)}
                                    disabled={deletePartMutation.isPending}
                                  >
                                    <Trash2 className="h-3 w-3" />
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>

                  {/* Mobile List View */}
                  <div className="md:hidden space-y-3">
                    {categoryParts.map((part) => (
                      <Card key={part.id} className="p-4 shadow-sm hover:shadow-md transition-shadow border-l-4 border-l-blue-500">
                        <div className="flex justify-between items-start mb-3">
                          <div className="flex-1">
                            <h3 className="font-semibold text-base leading-tight">{part.name}</h3>
                          </div>
                          <div className="flex gap-1 ml-3">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="hover:bg-blue-100 hover:text-blue-700 dark:hover:bg-blue-900 dark:hover:text-blue-300"
                              onClick={() => handleEditPart(part)}
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="hover:bg-red-100 hover:text-red-700 dark:hover:bg-red-900 dark:hover:text-red-300"
                              onClick={() => deletePartMutation.mutate(part.id)}
                              disabled={deletePartMutation.isPending}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                        
                        <div className="flex flex-wrap gap-1 mb-3">
                          {part.material && (
                            <Badge variant="secondary" className="text-xs bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                              {part.material}
                            </Badge>
                          )}
                          {part.size && (
                            <Badge variant="secondary" className="text-xs bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                              {part.size}
                            </Badge>
                          )}
                          {part.brand && (
                            <Badge variant="secondary" className="text-xs bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200">
                              {part.brand}
                            </Badge>
                          )}
                          {part.fittingType && (
                            <Badge variant="secondary" className="text-xs bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200">
                              {part.fittingType}
                            </Badge>
                          )}
                        </div>
                        
                        {part.description && (
                          <p className="text-sm text-muted-foreground mb-4 line-clamp-2 leading-relaxed">
                            {part.description}
                          </p>
                        )}
                        
                        <div className="flex justify-between items-center pt-2 border-t border-muted/30">
                          <div className="flex flex-col gap-1">
                            {part.cost && (
                              <div className="flex items-center gap-2">
                                <DollarSign className="h-4 w-4 text-orange-600" />
                                <span className="text-sm text-orange-700 dark:text-orange-400">
                                  Cost: {formatCurrency(part.cost)}
                                </span>
                              </div>
                            )}
                            <div className="flex items-center gap-2">
                              <DollarSign className="h-4 w-4 text-green-600" />
                              <span className="font-semibold text-green-700 dark:text-green-400 text-base">
                                Price: {formatCurrency(part.price)}
                              </span>
                            </div>
                          </div>
                          <div className="flex items-center gap-1">
                            <Clock className="h-4 w-4 text-blue-600" />
                            <span className="font-medium text-blue-700 dark:text-blue-400">
                              {part.laborHours}h
                            </span>
                          </div>
                        </div>
                      </Card>
                    ))}
                  </div>
                      </CollapsibleContent>
                    </div>
                  </Collapsible>
                );
              })}
            </div>
          )}
        </TabsContent>

        {canImport && (
          <TabsContent value="import" className="space-y-6">
            <BulkImport onImportComplete={() => {
              queryClient.invalidateQueries({ queryKey: ["/api/parts"] });
            }} />
          </TabsContent>
        )}
      </Tabs>

      <PartFormDialog
        part={selectedPart}
        open={isFormOpen}
        onOpenChange={setIsFormOpen}
      />
    </div>
  );
}