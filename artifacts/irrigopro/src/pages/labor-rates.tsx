import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient, useArrayQuery } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Check, X, Edit, DollarSign } from "lucide-react";
import type { Customer } from "@workspace/db/schema";

interface EditState {
  laborRate: string;
  emergencyLaborRate: string;
}

export default function LaborRates() {
  const { toast } = useToast();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editState, setEditState] = useState<EditState>({ laborRate: "", emergencyLaborRate: "" });

  const { data: customers = [], isLoading } = useArrayQuery<Customer>({
    queryKey: ["/api/customers", { billingVisible: true }],
    queryFn: () => apiRequest("/api/customers?billingVisible=true"),
  });

  const sorted = [...customers].sort((a, b) =>
    (a.irrigoName || a.name).localeCompare(b.irrigoName || b.name)
  );

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<EditState> }) =>
      apiRequest(`/api/customers/${id}/labor-rates`, "PATCH", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/customers"] });
      setEditingId(null);
      toast({ title: "Labor rates updated" });
    },
    onError: () => {
      toast({ title: "Failed to update labor rates", variant: "destructive" });
    },
  });

  const startEdit = (customer: Customer) => {
    setEditingId(customer.id);
    setEditState({
      laborRate: customer.laborRate ?? "45.00",
      emergencyLaborRate: customer.emergencyLaborRate ?? "125.00",
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditState({ laborRate: "", emergencyLaborRate: "" });
  };

  const saveEdit = (id: number) => {
    updateMutation.mutate({ id, data: editState });
  };

  return (
    <div className="max-w-5xl mx-auto py-6 px-4">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Labor Rates</h1>
        <p className="text-gray-500 mt-1">
          View and edit standard and emergency labor rates for every customer.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-gray-500" />
            <CardTitle className="text-base">Customer Labor Rates</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Customer</TableHead>
                  <TableHead className="w-40">Standard Rate ($/hr)</TableHead>
                  <TableHead className="w-44">Emergency Rate ($/hr)</TableHead>
                  <TableHead className="w-24 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-gray-500 py-8">
                      Loading customers...
                    </TableCell>
                  </TableRow>
                ) : sorted.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-gray-500 py-8">
                      No customers found
                    </TableCell>
                  </TableRow>
                ) : (
                  sorted.map((customer) => (
                    <TableRow key={customer.id}>
                      <TableCell>
                        <div className="font-medium text-gray-900">
                          {customer.irrigoName || customer.name}
                        </div>
                        {customer.irrigoName && customer.irrigoName !== customer.name && (
                          <div className="text-xs text-gray-400">{customer.name}</div>
                        )}
                      </TableCell>
                      <TableCell>
                        {editingId === customer.id ? (
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            value={editState.laborRate}
                            onChange={(e) => setEditState(s => ({ ...s, laborRate: e.target.value }))}
                            className="h-8 w-32"
                            autoFocus
                          />
                        ) : (
                          <span className="text-gray-700">
                            ${parseFloat(customer.laborRate ?? "45.00").toFixed(2)}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        {editingId === customer.id ? (
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            value={editState.emergencyLaborRate}
                            onChange={(e) => setEditState(s => ({ ...s, emergencyLaborRate: e.target.value }))}
                            className="h-8 w-32"
                          />
                        ) : (
                          <span className="text-gray-700">
                            ${parseFloat(customer.emergencyLaborRate ?? "125.00").toFixed(2)}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {editingId === customer.id ? (
                          <div className="flex gap-1 justify-end">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0"
                              onClick={() => saveEdit(customer.id)}
                              disabled={updateMutation.isPending}
                            >
                              <Check className="h-3.5 w-3.5 text-green-600" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0"
                              onClick={cancelEdit}
                            >
                              <X className="h-3.5 w-3.5 text-red-500" />
                            </Button>
                          </div>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0"
                            onClick={() => startEdit(customer)}
                          >
                            <Edit className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
