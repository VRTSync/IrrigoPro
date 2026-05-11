import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useForm } from "react-hook-form";
import { zodResolver } from "@/lib/zod-resolver";
import { z } from "zod/v4";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { insertPartSchema } from "@shared/schema";
import type { Part, PartCategory, PartBrand, PartSize, PartMaterial, PartFittingType } from "@shared/schema";

interface QuickAddPopoverProps {
  label: string;
  apiPath: string;
  queryKey: string;
  withMarkup?: boolean;
  onAdded: (name: string) => void;
}

export function QuickAddPopover({ label, apiPath, queryKey, withMarkup = false, onAdded }: QuickAddPopoverProps) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [markup, setMarkup] = useState("0.00");

  type QuickAddPayload = { name: string; markupPercent?: string };

  const createMutation = useMutation({
    mutationFn: (data: QuickAddPayload) => apiRequest(apiPath, "POST", data),
    onSuccess: (result: { name: string }) => {
      queryClient.invalidateQueries({ queryKey: [queryKey] });
      onAdded(result.name);
      setName("");
      setMarkup("0.00");
      setOpen(false);
      toast({ title: `${label} added` });
    },
    onError: () => toast({ title: `Failed to add ${label}`, variant: "destructive" }),
  });

  const handleAdd = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const data: QuickAddPayload = { name: trimmed };
    if (withMarkup) data.markupPercent = markup || "0.00";
    createMutation.mutate(data);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="text-xs text-blue-600 hover:text-blue-800 hover:underline ml-1 flex-shrink-0"
          tabIndex={-1}
        >
          + Add new
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3" align="start">
        <p className="text-sm font-medium mb-2">Add new {label}</p>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={`${label} name`}
          className="h-8 text-sm mb-2"
          autoFocus
          onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); if (e.key === "Escape") setOpen(false); }}
        />
        {withMarkup && (
          <div className="mb-2">
            <label className="text-xs text-gray-500 mb-1 block">Markup % (optional)</label>
            <Input
              type="number"
              step="0.01"
              min="0"
              value={markup}
              onChange={(e) => setMarkup(e.target.value)}
              placeholder="0.00"
              className="h-8 text-sm"
            />
          </div>
        )}
        <div className="flex gap-2">
          <Button size="sm" className="flex-1 h-7 text-xs" onClick={handleAdd} disabled={createMutation.isPending || !name.trim()}>
            Add
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export const PartFormSchema = insertPartSchema;

export interface PartFormDialogProps {
  part?: Part;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PartFormDialog({ part, open, onOpenChange }: PartFormDialogProps) {
  const { toast } = useToast();

  const { data: partCategories = [] } = useQuery<PartCategory[]>({ queryKey: ["/api/part-settings/categories"] });
  const { data: partBrands = [] } = useQuery<PartBrand[]>({ queryKey: ["/api/part-settings/brands"] });
  const { data: partSizes = [] } = useQuery<PartSize[]>({ queryKey: ["/api/part-settings/sizes"] });
  const { data: partMaterials = [] } = useQuery<PartMaterial[]>({ queryKey: ["/api/part-settings/materials"] });
  const { data: partFittingTypes = [] } = useQuery<PartFittingType[]>({ queryKey: ["/api/part-settings/fitting-types"] });

  type PartFormInput = z.input<typeof PartFormSchema>;
  const form = useForm<PartFormInput>({
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

  useEffect(() => {
    if (part) {
      form.reset({
        companyId: part.companyId,
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
    mutationFn: async (data: PartFormInput) => {
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
    mutationFn: async (data: PartFormInput) => {
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

  const onSubmit = (data: PartFormInput) => {
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
                    <div className="flex items-center gap-1">
                      <FormLabel>Category *</FormLabel>
                      <QuickAddPopover
                        label="Category"
                        apiPath="/api/part-settings/categories"
                        queryKey="/api/part-settings/categories"
                        withMarkup
                        onAdded={(name) => field.onChange(name)}
                      />
                    </div>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select category" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {partCategories.map((cat) => (
                          <SelectItem key={cat.id} value={cat.name}>
                            {cat.name}
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
                    <div className="flex items-center gap-1">
                      <FormLabel>Material</FormLabel>
                      <QuickAddPopover
                        label="Material"
                        apiPath="/api/part-settings/materials"
                        queryKey="/api/part-settings/materials"
                        onAdded={(name) => field.onChange(name)}
                      />
                    </div>
                    <Select onValueChange={field.onChange} value={field.value || "none"}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select material" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        {partMaterials.map((mat) => (
                          <SelectItem key={mat.id} value={mat.name}>
                            {mat.name}
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
                    <div className="flex items-center gap-1">
                      <FormLabel>Size</FormLabel>
                      <QuickAddPopover
                        label="Size"
                        apiPath="/api/part-settings/sizes"
                        queryKey="/api/part-settings/sizes"
                        onAdded={(name) => field.onChange(name)}
                      />
                    </div>
                    <Select onValueChange={field.onChange} value={field.value || "none"}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select size" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        {partSizes.map((sz) => (
                          <SelectItem key={sz.id} value={sz.name}>
                            {sz.name}
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
                    <div className="flex items-center gap-1">
                      <FormLabel>Brand</FormLabel>
                      <QuickAddPopover
                        label="Brand"
                        apiPath="/api/part-settings/brands"
                        queryKey="/api/part-settings/brands"
                        onAdded={(name) => field.onChange(name)}
                      />
                    </div>
                    <Select onValueChange={field.onChange} value={field.value || "none"}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select brand" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        {partBrands.map((br) => (
                          <SelectItem key={br.id} value={br.name}>
                            {br.name}
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
                    <div className="flex items-center gap-1">
                      <FormLabel>Fitting Type</FormLabel>
                      <QuickAddPopover
                        label="Fitting Type"
                        apiPath="/api/part-settings/fitting-types"
                        queryKey="/api/part-settings/fitting-types"
                        onAdded={(name) => field.onChange(name)}
                      />
                    </div>
                    <Select onValueChange={field.onChange} value={field.value || "none"}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select fitting type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        {partFittingTypes.map((ft) => (
                          <SelectItem key={ft.id} value={ft.name}>
                            {ft.name}
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
                      <Input {...field} type="number" step="any" min="0" max="99999999.99" value={field.value || ""} />
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
                      <Input {...field} type="number" step="any" min="0" max="99999999.99" />
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
