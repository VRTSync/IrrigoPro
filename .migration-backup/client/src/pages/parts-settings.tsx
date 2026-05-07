import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Edit, Trash2, Plus, Check, X, Download } from "lucide-react";

type RefEntry = { id: number; name: string; companyId: number; markupPercent?: string };
type CreatePayload = { name: string; markupPercent?: string };
type UpdatePayload = { name?: string; markupPercent?: string };

interface RefListSectionProps {
  title: string;
  queryKey: string;
  apiPath: string;
  withMarkup?: boolean;
}

function RefListSection({ title, queryKey, apiPath, withMarkup = false }: RefListSectionProps) {
  const { toast } = useToast();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editMarkup, setEditMarkup] = useState("");
  const [addName, setAddName] = useState("");
  const [addMarkup, setAddMarkup] = useState("0.00");
  const [isAdding, setIsAdding] = useState(false);

  const { data: items = [], isLoading } = useQuery<RefEntry[]>({
    queryKey: [queryKey],
  });

  const createMutation = useMutation({
    mutationFn: (data: CreatePayload) => apiRequest(apiPath, "POST", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [queryKey] });
      setAddName("");
      setAddMarkup("0.00");
      setIsAdding(false);
      toast({ title: `${title} added` });
    },
    onError: () => toast({ title: "Failed to add entry", variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: UpdatePayload }) => apiRequest(`${apiPath}/${id}`, "PATCH", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [queryKey] });
      setEditingId(null);
      toast({ title: `${title} updated` });
    },
    onError: () => toast({ title: "Failed to update entry", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest(`${apiPath}/${id}`, "DELETE"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [queryKey] });
      toast({ title: `${title} deleted` });
    },
    onError: () => toast({ title: "Failed to delete entry", variant: "destructive" }),
  });

  const startEdit = (item: RefEntry) => {
    setEditingId(item.id);
    setEditName(item.name);
    setEditMarkup(item.markupPercent ?? "0.00");
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditName("");
    setEditMarkup("");
  };

  const saveEdit = (id: number) => {
    const name = editName.trim();
    if (!name) return;
    const data: UpdatePayload = { name };
    if (withMarkup) data.markupPercent = editMarkup || "0.00";
    updateMutation.mutate({ id, data });
  };

  const handleAdd = () => {
    const name = addName.trim();
    if (!name) return;
    const data: CreatePayload = { name };
    if (withMarkup) data.markupPercent = addMarkup || "0.00";
    createMutation.mutate(data);
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{title}</CardTitle>
          <Badge variant="secondary">{items.length} entries</Badge>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              {withMarkup && <TableHead className="w-32">Markup %</TableHead>}
              <TableHead className="w-24 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={withMarkup ? 3 : 2} className="text-center text-gray-500 py-4">
                  Loading...
                </TableCell>
              </TableRow>
            ) : items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={withMarkup ? 3 : 2} className="text-center text-gray-500 py-4">
                  No entries yet
                </TableCell>
              </TableRow>
            ) : (
              items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    {editingId === item.id ? (
                      <Input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="h-8"
                        autoFocus
                        onKeyDown={(e) => { if (e.key === "Enter") saveEdit(item.id); if (e.key === "Escape") cancelEdit(); }}
                      />
                    ) : (
                      <span className="font-medium">{item.name}</span>
                    )}
                  </TableCell>
                  {withMarkup && (
                    <TableCell>
                      {editingId === item.id ? (
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          value={editMarkup}
                          onChange={(e) => setEditMarkup(e.target.value)}
                          className="h-8 w-24"
                        />
                      ) : (
                        <span className="text-gray-600">{item.markupPercent ?? "0.00"}%</span>
                      )}
                    </TableCell>
                  )}
                  <TableCell className="text-right">
                    {editingId === item.id ? (
                      <div className="flex gap-1 justify-end">
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => saveEdit(item.id)} disabled={updateMutation.isPending}>
                          <Check className="h-3.5 w-3.5 text-green-600" />
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={cancelEdit}>
                          <X className="h-3.5 w-3.5 text-red-500" />
                        </Button>
                      </div>
                    ) : (
                      <div className="flex gap-1 justify-end">
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => startEdit(item)}>
                          <Edit className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0"
                          onClick={() => deleteMutation.mutate(item.id)}
                          disabled={deleteMutation.isPending}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-red-500" />
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
            {/* Inline add row */}
            {isAdding ? (
              <TableRow>
                <TableCell>
                  <Input
                    value={addName}
                    onChange={(e) => setAddName(e.target.value)}
                    placeholder="Enter name..."
                    className="h-8"
                    autoFocus
                    onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); if (e.key === "Escape") setIsAdding(false); }}
                  />
                </TableCell>
                {withMarkup && (
                  <TableCell>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={addMarkup}
                      onChange={(e) => setAddMarkup(e.target.value)}
                      placeholder="0.00"
                      className="h-8 w-24"
                    />
                  </TableCell>
                )}
                <TableCell className="text-right">
                  <div className="flex gap-1 justify-end">
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={handleAdd} disabled={createMutation.isPending}>
                      <Check className="h-3.5 w-3.5 text-green-600" />
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => { setIsAdding(false); setAddName(""); }}>
                      <X className="h-3.5 w-3.5 text-red-500" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
        {!isAdding && (
          <Button
            variant="outline"
            size="sm"
            className="mt-3 w-full"
            onClick={() => setIsAdding(true)}
          >
            <Plus className="h-4 w-4 mr-1" />
            Add {title}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function escapeCSVCell(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function exportPartsSettingsCSV(
  categories: RefEntry[],
  brands: RefEntry[],
  sizes: RefEntry[],
  materials: RefEntry[],
  fittingTypes: RefEntry[],
) {
  const lines: string[] = [];

  lines.push("Categories");
  lines.push("Name,Markup %");
  for (const c of categories) {
    lines.push(`${escapeCSVCell(c.name)},${escapeCSVCell(c.markupPercent ?? "0.00")}`);
  }

  lines.push("");
  lines.push("Brands");
  lines.push("Name");
  for (const b of brands) {
    lines.push(escapeCSVCell(b.name));
  }

  lines.push("");
  lines.push("Sizes");
  lines.push("Name");
  for (const s of sizes) {
    lines.push(escapeCSVCell(s.name));
  }

  lines.push("");
  lines.push("Materials");
  lines.push("Name");
  for (const m of materials) {
    lines.push(escapeCSVCell(m.name));
  }

  lines.push("");
  lines.push("Fitting Types");
  lines.push("Name");
  for (const f of fittingTypes) {
    lines.push(escapeCSVCell(f.name));
  }

  return lines.join("\n");
}

export default function PartsSettings() {
  const { data: categories = [], isLoading: loadingCategories } = useQuery<RefEntry[]>({ queryKey: ["/api/part-settings/categories"] });
  const { data: brands = [], isLoading: loadingBrands } = useQuery<RefEntry[]>({ queryKey: ["/api/part-settings/brands"] });
  const { data: sizes = [], isLoading: loadingSizes } = useQuery<RefEntry[]>({ queryKey: ["/api/part-settings/sizes"] });
  const { data: materials = [], isLoading: loadingMaterials } = useQuery<RefEntry[]>({ queryKey: ["/api/part-settings/materials"] });
  const { data: fittingTypes = [], isLoading: loadingFittingTypes } = useQuery<RefEntry[]>({ queryKey: ["/api/part-settings/fitting-types"] });

  const isLoading = loadingCategories || loadingBrands || loadingSizes || loadingMaterials || loadingFittingTypes;

  const handleExport = () => {
    const csv = exportPartsSettingsCSV(categories, brands, sizes, materials, fittingTypes);
    const date = new Date().toISOString().slice(0, 10);
    const filename = `parts-settings-${date}.csv`;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="max-w-4xl mx-auto py-6 px-4">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Parts Settings</h1>
          <p className="text-gray-500 mt-1">
            Manage the reference lists used throughout your parts catalog. Changes apply company-wide.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={handleExport} disabled={isLoading} className="flex items-center gap-1.5 mt-1">
          <Download className="h-4 w-4" />
          Export
        </Button>
      </div>

      <Tabs defaultValue="categories">
        <TabsList className="mb-6 grid grid-cols-5 w-full">
          <TabsTrigger value="categories">Categories</TabsTrigger>
          <TabsTrigger value="brands">Brands</TabsTrigger>
          <TabsTrigger value="sizes">Sizes</TabsTrigger>
          <TabsTrigger value="materials">Materials</TabsTrigger>
          <TabsTrigger value="fitting-types">Fitting Types</TabsTrigger>
        </TabsList>

        <TabsContent value="categories">
          <RefListSection
            title="Category"
            queryKey="/api/part-settings/categories"
            apiPath="/api/part-settings/categories"
            withMarkup
          />
        </TabsContent>

        <TabsContent value="brands">
          <RefListSection
            title="Brand"
            queryKey="/api/part-settings/brands"
            apiPath="/api/part-settings/brands"
          />
        </TabsContent>

        <TabsContent value="sizes">
          <RefListSection
            title="Size"
            queryKey="/api/part-settings/sizes"
            apiPath="/api/part-settings/sizes"
          />
        </TabsContent>

        <TabsContent value="materials">
          <RefListSection
            title="Material"
            queryKey="/api/part-settings/materials"
            apiPath="/api/part-settings/materials"
          />
        </TabsContent>

        <TabsContent value="fitting-types">
          <RefListSection
            title="Fitting Type"
            queryKey="/api/part-settings/fitting-types"
            apiPath="/api/part-settings/fitting-types"
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
