import { useQuery, useMutation } from "@tanstack/react-query";
import { PartsListSkeleton } from "@/components/ui/loading-skeleton";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Package, Search, Edit, Trash2, FileSpreadsheet, Upload, Settings, Calculator, Filter, DollarSign, Clock, ChevronDown, ChevronRight, Layers, X, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useState, useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type { Part, Assembly, AssemblyWithParts, InsertAssembly, InsertAssemblyPart } from "@shared/schema";
import { insertPartSchema, insertAssemblySchema } from "@shared/schema";

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
      companyId: 1,
      name: "",
      description: "",
      price: "0.00",
      cost: "",
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
      console.log("updatePartMutation.mutationFn called with:", { 
        partId: part?.id, 
        url: `/api/parts/${part?.id}`,
        data 
      });
      
      const result = await apiRequest(`/api/parts/${part?.id}`, "PATCH", data);
      console.log("updatePartMutation.mutationFn result:", result);
      return result;
    },
    onSuccess: (result) => {
      console.log("updatePartMutation.onSuccess called with:", result);
      toast({
        title: "Part Updated",
        description: "Part has been updated successfully",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/parts"] });
      onOpenChange(false);
    },
    onError: (error: any) => {
      console.error("updatePartMutation.onError called with:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to update part",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: z.infer<typeof PartFormSchema>) => {
    console.log("Parts form onSubmit called", { 
      hasPartForEdit: !!part, 
      partId: part?.id,
      formData: data,
      formErrors: form.formState.errors
    });
    
    // Transform "none" values to null for optional fields
    const processedData = {
      ...data,
      material: data.material === "none" ? null : data.material,
      size: data.size === "none" ? null : data.size,
      brand: data.brand === "none" ? null : data.brand,
      fittingType: data.fittingType === "none" ? null : data.fittingType,
      detail: data.detail === "none" ? null : data.detail,
    };
    
    console.log("Parts form processed data:", processedData);
    
    if (part) {
      console.log("Calling updatePartMutation with:", { partId: part.id, data: processedData });
      updatePartMutation.mutate(processedData);
    } else {
      console.log("Calling createPartMutation with:", processedData);
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
              
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="cost"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Cost ($)</FormLabel>
                    <FormControl>
                      <Input {...field} type="number" step="any" min="0" value={field.value || ""} />
                    </FormControl>
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
                      <Input {...field} type="number" step="any" min="0" />
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

// Assembly form schema
const AssemblyFormSchema = insertAssemblySchema.omit({ 
  companyId: true, 
  createdBy: true,
  id: true,
  createdAt: true,
  updatedAt: true 
}).extend({
  parts: z.array(z.object({
    partId: z.number(),
    quantity: z.number().min(0.01).default(1),
  })).min(1, "Assembly must have at least one part")
});

interface AssemblyFormDialogProps {
  assembly?: AssemblyWithParts;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function AssemblyFormDialog({ assembly, open, onOpenChange }: AssemblyFormDialogProps) {
  const { toast } = useToast();
  const [selectedParts, setSelectedParts] = useState<Array<{ partId: number; part: Part; quantity: number }>>([]);
  const [partSearchQuery, setPartSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  
  const { data: parts } = useQuery<Part[]>({
    queryKey: ["/api/parts"],
  });

  // Filter parts for selection (exclude already selected parts)
  const filteredPartsForSelection = useMemo(() => {
    if (!parts) return [];
    
    let filtered = parts.filter(part => 
      !selectedParts.some(sp => sp.partId === part.id)
    );
    
    if (partSearchQuery) {
      const query = partSearchQuery.toLowerCase();
      filtered = filtered.filter(part =>
        part.name.toLowerCase().includes(query) ||
        part.category.toLowerCase().includes(query) ||
        part.sku.toLowerCase().includes(query) ||
        part.brand?.toLowerCase().includes(query)
      );
    }
    
    if (selectedCategory !== "all") {
      filtered = filtered.filter(part => part.category === selectedCategory);
    }
    
    return filtered.slice(0, 20); // Limit to 20 results for performance
  }, [parts, selectedParts, partSearchQuery, selectedCategory]);
  
  const form = useForm<z.infer<typeof AssemblyFormSchema>>({
    resolver: zodResolver(AssemblyFormSchema),
    defaultValues: {
      name: "",
      description: "",
      category: "",
      parts: []
    }
  });

  // Set default values when editing
  useEffect(() => {
    if (assembly && open) {
      form.reset({
        name: assembly.name,
        description: assembly.description || "",
        category: assembly.category || "",
        parts: assembly.parts.map(p => ({
          partId: p.partId,
          quantity: parseFloat(p.quantity.toString())
        }))
      });
      
      // Update selected parts for display
      if (parts) {
        const assemblyParts = assembly.parts.map(ap => {
          const part = parts.find(p => p.id === ap.partId);
          return part ? {
            partId: ap.partId,
            part,
            quantity: parseFloat(ap.quantity.toString())
          } : null;
        }).filter(Boolean) as Array<{ partId: number; part: Part; quantity: number }>;
        
        setSelectedParts(assemblyParts);
      }
    } else if (!assembly && open) {
      form.reset({
        name: "",
        description: "",
        category: "",
        parts: []
      });
      setSelectedParts([]);
      setPartSearchQuery("");
      setSelectedCategory("all");
    }
    
    if (!open) {
      // Reset search state when dialog closes
      setPartSearchQuery("");
      setSelectedCategory("all");
    }
  }, [assembly, open, form, parts]);

  const createAssemblyMutation = useMutation({
    mutationFn: async (data: { assembly: InsertAssembly; parts: InsertAssemblyPart[] }) => {
      return await apiRequest("/api/assemblies", "POST", data);
    },
    onSuccess: () => {
      toast({
        title: "Assembly Created",
        description: "Your parts assembly has been added to the catalog",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/assemblies"] });
      onOpenChange(false);
      form.reset();
      setSelectedParts([]);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create assembly",
        variant: "destructive",
      });
    },
  });

  const updateAssemblyMutation = useMutation({
    mutationFn: async (data: { assembly: Partial<InsertAssembly>; parts: InsertAssemblyPart[] }) => {
      return await apiRequest(`/api/assemblies/${assembly?.id}`, "PUT", data);
    },
    onSuccess: () => {
      toast({
        title: "Assembly Updated",
        description: "Assembly has been updated successfully",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/assemblies"] });
      onOpenChange(false);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update assembly",
        variant: "destructive",
      });
    },
  });

  const addPart = (part: Part) => {
    const existing = selectedParts.find(sp => sp.partId === part.id);
    if (existing) {
      toast({
        title: "Part Already Added",
        description: "This part is already in the assembly. Adjust the quantity if needed.",
        variant: "destructive",
      });
      return;
    }

    const newSelectedParts = [...selectedParts, { partId: part.id, part, quantity: 1 }];
    setSelectedParts(newSelectedParts);
    
    // Update form with validation
    const partsData = newSelectedParts.map(sp => ({
      partId: sp.partId,
      quantity: sp.quantity
    }));
    form.setValue("parts", partsData);
  };

  const removePart = (partId: number) => {
    const newSelectedParts = selectedParts.filter(sp => sp.partId !== partId);
    setSelectedParts(newSelectedParts);
    
    // Update form with validation
    const partsData = newSelectedParts.map(sp => ({
      partId: sp.partId,
      quantity: sp.quantity
    }));
    form.setValue("parts", partsData);
  };

  const updateQuantity = (partId: number, quantity: number) => {
    const newSelectedParts = selectedParts.map(sp => 
      sp.partId === partId ? { ...sp, quantity } : sp
    );
    setSelectedParts(newSelectedParts);
    
    // Update form with validation
    const partsData = newSelectedParts.map(sp => ({
      partId: sp.partId,
      quantity: sp.quantity
    }));
    form.setValue("parts", partsData);
  };

  const calculateTotals = () => {
    let totalPrice = 0;
    let totalLaborHours = 0;

    selectedParts.forEach(sp => {
      const partPrice = parseFloat(sp.part.price.toString());
      totalPrice += partPrice * sp.quantity;
    });

    return { totalPrice, totalLaborHours };
  };

  const onSubmit = async (data: z.infer<typeof AssemblyFormSchema>) => {
    const getCurrentUser = () => {
      const user = JSON.parse(localStorage.getItem("user") || "{}");
      return user;
    };

    const user = getCurrentUser();
    const assemblyData = {
      name: data.name,
      description: data.description || null,
      category: data.category || null,
      companyId: user.companyId || 1,
      createdBy: user.id || 1,
    };

    const partsData = data.parts.map((part, index) => ({
      partId: part.partId,
      quantity: part.quantity,
      assemblyId: 0, // Will be set by the server
      sortOrder: index
    }));

    if (assembly) {
      updateAssemblyMutation.mutate({ assembly: assemblyData, parts: partsData });
    } else {
      createAssemblyMutation.mutate({ assembly: assemblyData, parts: partsData });
    }
  };

  const { totalPrice, totalLaborHours } = calculateTotals();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{assembly ? "Edit Assembly" : "Create Parts Assembly"}</DialogTitle>
          <DialogDescription>
            {assembly ? "Update the assembly details and parts list" : "Create a pre-configured bundle of parts for common repairs"}
          </DialogDescription>
        </DialogHeader>
        
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            {/* Assembly Details */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Assembly Name *</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="e.g., Sprinkler Head Replacement Kit" />
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
                    <FormLabel>Category</FormLabel>
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
            </div>

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Textarea {...field} placeholder="Describe what this assembly is used for..." rows={2} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Parts Selection */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">Assembly Parts</h3>
                <Badge variant="outline" className="text-xs">
                  {selectedParts.length} part{selectedParts.length !== 1 ? 's' : ''}
                </Badge>
              </div>

              {/* Selected Parts List */}
              {selectedParts.length > 0 && (
                <div className="space-y-2 max-h-40 overflow-y-auto border rounded-md p-3">
                  {selectedParts.map(sp => (
                    <div key={sp.partId} className="flex items-center justify-between gap-2 p-2 bg-muted/50 rounded">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{sp.part.name}</p>
                        <p className="text-xs text-muted-foreground">${parseFloat(sp.part.price.toString()).toFixed(2)} each</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          min="0.01"
                          step="0.01"
                          value={sp.quantity}
                          onChange={(e) => updateQuantity(sp.partId, parseFloat(e.target.value) || 1)}
                          className="w-20 text-center"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => removePart(sp.partId)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Part Search and Selection - Enhanced UI */}
              <div className="space-y-3 p-4 border rounded-lg bg-gray-50">
                <Label className="text-sm font-medium">Add Parts to Assembly</Label>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <Input
                      placeholder="Search parts by name, category, brand, or SKU..."
                      value={partSearchQuery}
                      onChange={(e) => setPartSearchQuery(e.target.value)}
                      className="w-full"
                    />
                  </div>
                  <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                    <SelectTrigger className="w-48">
                      <SelectValue placeholder="Filter by category" />
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
                </div>
                
                {/* Filtered Parts List */}
                <div className="max-h-48 overflow-y-auto space-y-2">
                  {filteredPartsForSelection.map((part) => (
                    <div
                      key={part.id}
                      className="flex items-center justify-between p-3 bg-white rounded border cursor-pointer hover:bg-blue-50 hover:border-blue-200 transition-colors"
                      onClick={() => addPart(part)}
                    >
                      <div className="flex-1">
                        <div className="font-medium text-sm">{part.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {part.category} • ${parseFloat(part.price.toString()).toFixed(2)}
                        </div>
                        {part.brand && (
                          <div className="text-xs text-blue-600 mt-1">{part.brand}</div>
                        )}
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          addPart(part);
                        }}
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                  {filteredPartsForSelection.length === 0 && partSearchQuery && (
                    <div className="text-center py-4 text-muted-foreground text-sm">
                      No parts found matching "{partSearchQuery}"
                    </div>
                  )}
                  {filteredPartsForSelection.length === 0 && !partSearchQuery && selectedParts.length < (parts?.length || 0) && (
                    <div className="text-center py-4 text-muted-foreground text-sm">
                      Use search or category filter to find parts
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Totals */}
            {selectedParts.length > 0 && (
              <div className="space-y-2 p-4 bg-muted/30 rounded-md">
                <h4 className="font-semibold text-sm">Assembly Totals</h4>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Total Price:</span>
                    <span className="ml-2 font-medium">${totalPrice.toFixed(2)}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Total Labor:</span>
                    <span className="ml-2 font-medium">{totalLaborHours.toFixed(2)} hrs</span>
                  </div>
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button 
                type="submit" 
                disabled={createAssemblyMutation.isPending || updateAssemblyMutation.isPending || selectedParts.length === 0}
              >
                {createAssemblyMutation.isPending || updateAssemblyMutation.isPending ? "Saving..." : assembly ? "Update Assembly" : "Create Assembly"}
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
  
  // Assembly state
  const [selectedAssembly, setSelectedAssembly] = useState<AssemblyWithParts | undefined>();
  const [isAssemblyFormOpen, setIsAssemblyFormOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("individual");
  
  const { toast } = useToast();

  // Get user from localStorage (production-compatible)
  const [currentUser, setCurrentUser] = useState<any>(null);
  
  useEffect(() => {
    const savedUser = localStorage.getItem("user");
    if (savedUser) {
      try {
        setCurrentUser(JSON.parse(savedUser));
      } catch (error) {
        console.error("Error parsing user data:", error);
      }
    }
  }, []);
  
  const userRole = currentUser?.role || "";
  const canImport = userRole === "company_admin" || userRole === "super_admin";

  const { data: parts, isLoading } = useQuery<Part[]>({
    queryKey: ["/api/parts"],
  });

  const { data: assemblies, isLoading: isLoadingAssemblies } = useQuery<AssemblyWithParts[]>({
    queryKey: ["/api/assemblies"],
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

  const handleEditAssembly = (assembly: AssemblyWithParts) => {
    setSelectedAssembly(assembly);
    setIsAssemblyFormOpen(true);
  };

  const handleAddAssembly = () => {
    setSelectedAssembly(undefined);
    setIsAssemblyFormOpen(true);
  };

  const deleteAssemblyMutation = useMutation({
    mutationFn: async (assemblyId: number) => {
      return await apiRequest(`/api/assemblies/${assemblyId}`, "DELETE");
    },
    onSuccess: () => {
      toast({
        title: "Assembly Deleted",
        description: "Assembly has been removed from your catalog",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/assemblies"] });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete assembly",
        variant: "destructive",
      });
    },
  });

  const toggleSection = (category: string) => {
    const newCollapsed = new Set(collapsedSections);
    if (newCollapsed.has(category)) {
      newCollapsed.delete(category);
    } else {
      newCollapsed.add(category);
    }
    setCollapsedSections(newCollapsed);
  };

  // Show full page skeleton while loading (after all hooks)
  if (isLoading || isLoadingAssemblies) {
    return <PartsListSkeleton />;
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold">Parts Catalog</h1>
          <p className="text-muted-foreground">
            Manage your irrigation parts inventory and pre-configured assemblies
          </p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid grid-cols-2 w-full md:w-auto">
          <TabsTrigger value="individual" className="gap-2">
            <Package className="h-4 w-4" />
            Individual Parts
          </TabsTrigger>
          <TabsTrigger value="assemblies" className="gap-2">
            <Layers className="h-4 w-4" />
            Assemblies
          </TabsTrigger>
        </TabsList>

        <TabsContent value="individual" className="space-y-6">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-semibold">Individual Parts</h2>
            <Button onClick={handleAddPart} className="gap-2">
              <Plus className="h-4 w-4" />
              Add Part
            </Button>
          </div>
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

        <TabsContent value="assemblies" className="space-y-6">
          <div className="flex justify-between items-center">
            <div>
              <h2 className="text-xl font-semibold">Parts Assemblies</h2>
              <p className="text-muted-foreground text-sm">Pre-configured bundles for common repairs</p>
            </div>
            <Button onClick={handleAddAssembly} className="gap-2">
              <Plus className="h-4 w-4" />
              Create Assembly
            </Button>
          </div>

          {/* Assemblies Display */}
          {isLoadingAssemblies ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-48" />
              ))}
            </div>
          ) : !assemblies?.length ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Layers className="h-12 w-12 text-muted-foreground mb-4" />
                <h3 className="text-lg font-semibold mb-2">No Assemblies Found</h3>
                <p className="text-muted-foreground text-center mb-4">
                  Create pre-configured part bundles for common irrigation repairs
                </p>
                <Button onClick={handleAddAssembly} className="gap-2">
                  <Plus className="h-4 w-4" />
                  Create Your First Assembly
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {/* Desktop Table View */}
              <div className="hidden md:block border rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead className="font-semibold">Assembly Name</TableHead>
                      <TableHead className="font-semibold">Parts Count</TableHead>
                      <TableHead className="font-semibold text-right">Total Price</TableHead>
                      <TableHead className="font-semibold text-center">Labor Hours</TableHead>
                      <TableHead className="font-semibold text-center">Usage Count</TableHead>
                      <TableHead className="font-semibold text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {assemblies.map((assembly, index) => (
                      <TableRow 
                        key={assembly.id} 
                        className={`${
                          index % 2 === 0 
                            ? 'bg-white dark:bg-gray-950 hover:bg-blue-50 dark:hover:bg-blue-950/30' 
                            : 'bg-gray-50 dark:bg-gray-900 hover:bg-blue-50 dark:hover:bg-blue-950/30'
                        }`}
                      >
                        <TableCell className="py-3">
                          <div>
                            <div className="font-medium text-sm leading-tight">{assembly.name}</div>
                            {assembly.description && (
                              <div className="text-xs text-muted-foreground mt-1 max-w-md">
                                {assembly.description}
                              </div>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="py-3">
                          <Badge variant="outline" className="text-xs">
                            {assembly.parts.length} part{assembly.parts.length !== 1 ? 's' : ''}
                          </Badge>
                        </TableCell>
                        <TableCell className="py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <DollarSign className="h-3 w-3 text-green-600" />
                            <span className="font-semibold text-sm text-green-700 dark:text-green-400">
                              {formatCurrency(assembly.totalPrice)}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="py-3 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <Clock className="h-3 w-3 text-blue-600" />
                            <span className="font-medium text-xs text-blue-700 dark:text-blue-400">
                              {assembly.totalLaborHours}h
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="py-3 text-center">
                          <Badge variant="secondary" className="text-xs">
                            {assembly.usageCount || 0}
                          </Badge>
                        </TableCell>
                        <TableCell className="py-3 text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="hover:bg-blue-100 hover:text-blue-700 dark:hover:bg-blue-900 dark:hover:text-blue-300 h-7 px-2"
                              onClick={() => handleEditAssembly(assembly)}
                            >
                              <Edit className="h-3 w-3" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="hover:bg-red-100 hover:text-red-700 dark:hover:bg-red-900 dark:hover:text-red-300 h-7 px-2"
                              onClick={() => deleteAssemblyMutation.mutate(assembly.id)}
                              disabled={deleteAssemblyMutation.isPending}
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

              {/* Mobile Card View */}
              <div className="md:hidden space-y-3">
                {assemblies.map((assembly) => (
                  <Card key={assembly.id} className="p-4 shadow-sm hover:shadow-md transition-shadow border-l-4 border-l-blue-500">
                    <div className="flex justify-between items-start mb-3">
                      <div className="flex-1">
                        <h3 className="font-semibold text-base leading-tight">{assembly.name}</h3>
                        {assembly.description && (
                          <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                            {assembly.description}
                          </p>
                        )}
                      </div>
                      <div className="flex gap-1 ml-3">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="hover:bg-blue-100 hover:text-blue-700 dark:hover:bg-blue-900 dark:hover:text-blue-300"
                          onClick={() => handleEditAssembly(assembly)}
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="hover:bg-red-100 hover:text-red-700 dark:hover:bg-red-900 dark:hover:text-red-300"
                          onClick={() => deleteAssemblyMutation.mutate(assembly.id)}
                          disabled={deleteAssemblyMutation.isPending}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>

                    <div className="space-y-2 mb-3">
                      <div className="flex items-center gap-2">
                        <Package className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm text-muted-foreground">
                          {assembly.parts.length} part{assembly.parts.length !== 1 ? 's' : ''}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <TrendingUp className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm text-muted-foreground">
                          Used {assembly.usageCount || 0} times
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4 pt-2 border-t border-muted/30">
                      <div className="flex items-center gap-2">
                        <DollarSign className="h-4 w-4 text-green-600" />
                        <span className="font-semibold text-green-700 dark:text-green-400 text-base">
                          {formatCurrency(assembly.totalPrice)}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Clock className="h-4 w-4 text-blue-600" />
                        <span className="font-medium text-blue-700 dark:text-blue-400">
                          {assembly.totalLaborHours}h
                        </span>
                      </div>
                    </div>

                    {/* Parts Preview */}
                    <div className="mt-3 pt-3 border-t border-muted/30">
                      <h4 className="text-xs font-medium text-muted-foreground mb-2">Parts Included:</h4>
                      <div className="space-y-1">
                        {assembly.parts.slice(0, 3).map((part) => (
                          <div key={part.id} className="flex justify-between text-xs">
                            <span className="text-muted-foreground truncate">{part.part.name}</span>
                            <span className="text-muted-foreground ml-2">×{part.quantity}</span>
                          </div>
                        ))}
                        {assembly.parts.length > 3 && (
                          <div className="text-xs text-muted-foreground">
                            +{assembly.parts.length - 3} more parts...
                          </div>
                        )}
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
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

      <AssemblyFormDialog
        assembly={selectedAssembly}
        open={isAssemblyFormOpen}
        onOpenChange={setIsAssemblyFormOpen}
      />
    </div>
  );
}