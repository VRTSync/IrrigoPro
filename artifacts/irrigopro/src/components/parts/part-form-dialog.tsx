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
import { apiRequest, queryClient, useArrayQuery } from "@/lib/queryClient";
import { insertPartSchema } from "@workspace/db/schema";
import { useGetActiveMarkupSchedule, getGetActiveMarkupScheduleQueryKey } from "@workspace/api-client-react";
import { computeCustomerPrice, computeTieredMarkup, isMaterialMarkupEligible } from "@workspace/shared";
import { useAuth } from "@/lib/auth-context";
import { errorMessage, formatMoney, isNotFoundError } from "@/lib/markup-tier-form";
import type { Part, PartCategory, PartBrand, PartSize, PartMaterial, PartFittingType } from "@workspace/db/schema";

interface QuickAddPopoverProps {
  label: string;
  apiPath: string;
  queryKey: string;
  onAdded: (name: string) => void;
}

export function QuickAddPopover({ label, apiPath, queryKey, onAdded }: QuickAddPopoverProps) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");

  // Category markup is retired (Task #2173); the payload never carries it.
  type QuickAddPayload = { name: string };

  const createMutation = useMutation({
    mutationFn: (data: QuickAddPayload) => apiRequest(apiPath, "POST", data),
    onSuccess: (result: { name: string }) => {
      queryClient.invalidateQueries({ queryKey: [queryKey] });
      onAdded(result.name);
      setName("");
      setOpen(false);
      toast({ title: `${label} added` });
    },
    onError: () => toast({ title: `Failed to add ${label}`, variant: "destructive" }),
  });

  const handleAdd = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const data: QuickAddPayload = { name: trimmed };
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

  const { data: partCategories = [] } = useArrayQuery<PartCategory>({ queryKey: ["/api/part-settings/categories"] });
  const { data: partBrands = [] } = useArrayQuery<PartBrand>({ queryKey: ["/api/part-settings/brands"] });
  const { data: partSizes = [] } = useArrayQuery<PartSize>({ queryKey: ["/api/part-settings/sizes"] });
  const { data: partMaterials = [] } = useArrayQuery<PartMaterial>({ queryKey: ["/api/part-settings/materials"] });
  const { data: partFittingTypes = [] } = useArrayQuery<PartFittingType>({ queryKey: ["/api/part-settings/fitting-types"] });

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

  // Tier 2 — live shared-engine preview. The server recomputes eligible
  // prices on save; this preview is cosmetic but mirrors the same math.
  const { user } = useAuth();
  const watchedCost = form.watch("cost");
  const watchedCategory = form.watch("category");
  const watchedCompanyId = form.watch("companyId");
  const markupParams = user?.role === "super_admin"
    ? { companyId: Number(part?.companyId ?? watchedCompanyId) || undefined }
    : undefined;
  const activeSchedule = useGetActiveMarkupSchedule(markupParams, {
    query: {
      enabled: open && (user?.role !== "super_admin" || !!markupParams?.companyId),
      queryKey: getGetActiveMarkupScheduleQueryKey(markupParams),
      retry: false,
    },
  });
  const costNumber = watchedCost === null || watchedCost === undefined || String(watchedCost).trim() === "" ? NaN : Number(watchedCost);
  const eligible = isMaterialMarkupEligible({ cost: Number.isFinite(costNumber) ? costNumber : null, category: watchedCategory ?? "" });
  const excludedCategory = ["rental", "service", "labor"].includes(String(watchedCategory ?? "").trim().toLowerCase());
  const noActiveSchedule = activeSchedule.isError && isNotFoundError(activeSchedule.error);
  const scheduleError = activeSchedule.isError && !noActiveSchedule ? activeSchedule.error : null;
  let pricing: { mode: "computed"; price: number; markup: number } | { mode: "manual"; reason: string } | { mode: "loading" } | { mode: "error"; message: string };
  if (!eligible) {
    pricing = { mode: "manual", reason: excludedCategory ? "This category is excluded from material markup." : "No positive cost recorded." };
  } else if (activeSchedule.isLoading || (activeSchedule.isFetching && !activeSchedule.data && !activeSchedule.isError)) {
    pricing = { mode: "loading" };
  } else if (noActiveSchedule) {
    pricing = { mode: "manual", reason: "No active markup schedule." };
  } else if (scheduleError) {
    pricing = { mode: "error", message: errorMessage(scheduleError, "Could not load the markup schedule.") };
  } else if (activeSchedule.data) {
    const tiers = activeSchedule.data.tiers;
    pricing = { mode: "computed", price: computeCustomerPrice(costNumber, tiers), markup: computeTieredMarkup(costNumber, tiers) };
  } else {
    pricing = { mode: "loading" };
  }
  const computedPrice = pricing.mode === "computed" ? pricing.price : null;
  useEffect(() => {
    if (computedPrice !== null) form.setValue("price", computedPrice.toFixed(2), { shouldValidate: true });
  }, [computedPrice, form]);
  const saveBlocked = pricing.mode === "loading" || pricing.mode === "error";

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
    if (saveBlocked) return;
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
                    <FormLabel>{pricing.mode === "computed" ? "Customer Price ($)" : "Price ($) *"}</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="number"
                        step="any"
                        min="0"
                        max="99999999.99"
                        readOnly={pricing.mode === "computed"}
                        aria-readonly={pricing.mode === "computed"}
                        aria-describedby="part-pricing-status"
                        className={pricing.mode === "computed" ? "bg-gray-50" : undefined}
                        data-testid="input-part-price"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div
              id="part-pricing-status"
              role="status"
              aria-live="polite"
              data-testid="status-part-pricing"
              className={
                pricing.mode === "error"
                  ? "rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
                  : pricing.mode === "computed"
                    ? "rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-sm text-blue-900"
                    : "rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700"
              }
            >
              {pricing.mode === "computed" && (
                <>
                  Computed from {activeSchedule.data?.schedule.name}: {formatMoney(pricing.price)} (markup {formatMoney(pricing.markup)},{" "}
                  {((pricing.markup / costNumber) * 100).toFixed(1)}% effective). Price is set by the schedule.
                </>
              )}
              {pricing.mode === "manual" && <>Manual price. {pricing.reason}</>}
              {pricing.mode === "loading" && <>Loading markup schedule...</>}
              {pricing.mode === "error" && (
                <>
                  {pricing.message} Saving is disabled until pricing loads.{" "}
                  <button type="button" className="underline" onClick={() => activeSchedule.refetch()} data-testid="button-retry-pricing">
                    Retry
                  </button>
                </>
              )}
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
                disabled={createPartMutation.isPending || updatePartMutation.isPending || saveBlocked}
                data-testid="button-save-part"
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
